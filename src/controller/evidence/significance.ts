import type { ProgressLine, TrajectoryLine } from './schemas';

export type SignificanceLane = 'story' | 'diagnostic' | 'none';

export type StoryEventKind =
    | 'legacy_event'
    | 'say'
    | 'stuck_detected'
    | 'stuck_recovered'
    | 'first_xp'
    | 'first_object_interaction'
    | 'first_place_entry'
    | 'first_peer_encounter'
    | 'faction_change'
    | 'patron_gift'
    | 'patron_witness'
    | 'patron_sponsor'
    | 'relationship_repeated'
    | 'relationship_parting'
    | 'wants_unfulfilled'
    | 'near_death_survival';

export interface SignificanceResult {
    lane: SignificanceLane;
    reasons: string[];
    storyKind?: StoryEventKind;
    timelineEvent?: Record<string, unknown>;
}

export interface ProgressSignificanceContext {
    seenXpSkills?: ReadonlySet<string>;
    previousStuckSince?: number | null;
    recentHpDangerSince?: number | null;
}

export interface TrajectorySignificanceContext {
    seenPeers?: ReadonlySet<string>;
    peerInteractionCounts?: ReadonlyMap<string, number>;
}

export interface PeerInteraction {
    id: string;
    peer: string;
    kind?: string;
    actionKind: string;
}

const DIAGNOSTIC_TRAJECTORY_KINDS = new Set<TrajectoryLine['kind']>(['hook', 'budget', 'plan', 'error']);
const PATRON_KINDS = new Set<StoryEventKind>(['patron_gift', 'patron_witness', 'patron_sponsor']);

export function classifyTrajectoryLine(line: TrajectoryLine, context: TrajectorySignificanceContext = {}): SignificanceResult {
    if (line.kind === 'say') {
        return story('say', ['voice:say'], {
            ...timelineBase(line),
            kind: 'say',
            text: typeof line.text === 'string' ? line.text : '',
            lastWords: line.lastWords === true,
        });
    }
    if (line.kind === 'legacy_event') {
        return story('legacy_event', ['legacy:event'], {
            ...timelineBase(line),
            kind: 'legacy_event',
            event: line.event,
        });
    }
    if (line.kind === 'patron') {
        const patronKind = patronStoryKind(line);
        if (patronKind) {
            return story(patronKind, [`patron:${patronKind}`], {
                ...timelineBase(line),
                kind: patronKind,
                patronHandle: stringField(line, 'patronHandle') || 'anonymous',
                artifact: stringField(line, 'artifact'),
                note: stringField(line, 'note'),
            });
        }
    }
    if (line.kind === 'action') {
        const peerInteraction = peerInteractionFromTrajectoryLine(line);
        if (peerInteraction) {
            return peerRelationshipStory(line, peerInteraction, context);
        }
    }
    if (DIAGNOSTIC_TRAJECTORY_KINDS.has(line.kind)) {
        return diagnostic([`kernel:${line.kind}`]);
    }
    if (line.kind === 'action_result' && line.status === 'success') {
        return diagnostic(['routine:action_result']);
    }

    return none();
}

export function classifyProgressLine(line: ProgressLine, context: ProgressSignificanceContext = {}): SignificanceResult {
    if (line.stuckSince !== null && context.previousStuckSince !== line.stuckSince && !line.meaningful) {
        return story('stuck_detected', ['progress:stuck_detected'], {
            ...timelineBase(line),
            kind: 'stuck_detected',
            stuckSince: line.stuckSince,
        });
    }
    if (line.meaningful && typeof context.previousStuckSince === 'number') {
        return story('stuck_recovered', ['progress:stuck_recovered', ...line.reasons], {
            ...timelineBase(line),
            kind: 'stuck_recovered',
            stuckSince: context.previousStuckSince,
            reasons: line.reasons,
        });
    }

    const firstXp = firstXpReason(line.reasons, context.seenXpSkills);
    if (firstXp) {
        return story('first_xp', [`first_xp:${firstXp.skill}`, firstXp.reason], {
            ...timelineBase(line),
            kind: 'first_xp',
            skill: firstXp.skill,
            amount: firstXp.amount,
            reason: firstXp.reason,
        });
    }

    const hpRecovery = hpRecoveryReason(line.reasons, context.recentHpDangerSince);
    if (hpRecovery) {
        return story('near_death_survival', ['hp:near_death_survival', hpRecovery.reason], {
            ...timelineBase(line),
            kind: 'near_death_survival',
            dangerSince: hpRecovery.dangerSince,
            recoveredAmount: hpRecovery.amount,
            reason: hpRecovery.reason,
        });
    }

    return none();
}

export function isStoryTrajectoryLine(line: TrajectoryLine): boolean {
    return classifyTrajectoryLine(line).lane === 'story';
}

export function isDiagnosticTrajectoryLine(line: TrajectoryLine): boolean {
    return classifyTrajectoryLine(line).lane === 'diagnostic';
}

export function isStoryProgressLine(line: ProgressLine, context: ProgressSignificanceContext = {}): boolean {
    return classifyProgressLine(line, context).lane === 'story';
}

export function peerInteractionFromTrajectoryLine(line: TrajectoryLine): PeerInteraction | undefined {
    if (line.kind !== 'action') {
        return undefined;
    }

    const action = recordField(line, 'action');
    const actionKind = stringField(line, 'actionKind') || stringField(action, 'kind');
    if (!actionKind) {
        return undefined;
    }

    if (actionKind === 'whisper') {
        const to = stringField(action, 'to');
        return to ? { id: to, peer: to, actionKind } : undefined;
    }

    const target = recordField(action, 'target') || recordField(line, 'target');
    if (!target) {
        const peerId = stringField(line, 'peerId') || stringField(line, 'targetResident') || stringField(action, 'targetResident');
        const peer = stringField(line, 'peer') || stringField(action, 'peer') || peerId;
        return peerId && peer ? { id: peerId, peer, actionKind } : undefined;
    }

    const kind = stringField(target, 'kind');
    if (kind !== 'player' && kind !== 'resident') {
        return undefined;
    }

    const id = stringField(target, 'id');
    if (!id) {
        return undefined;
    }

    return {
        id,
        peer: stringField(target, 'name') || stringField(target, 'key') || id,
        kind,
        actionKind,
    };
}

function story(storyKind: StoryEventKind, reasons: string[], timelineEvent: Record<string, unknown>): SignificanceResult {
    return {
        lane: 'story',
        storyKind,
        reasons,
        timelineEvent: pruneUndefined(timelineEvent),
    };
}

function peerRelationshipStory(line: TrajectoryLine, peer: PeerInteraction, context: TrajectorySignificanceContext): SignificanceResult {
    const seen = context.seenPeers?.has(peer.id) ?? false;
    const currentInteractions = context.peerInteractionCounts?.get(peer.id) ?? (seen ? 1 : 0);
    const interactions = currentInteractions + 1;
    const base = {
        ...timelineBase(line),
        peer: peer.peer,
        peerId: peer.id,
        peerKind: peer.kind,
        actionKind: peer.actionKind,
        interactions,
    };

    if (!seen) {
        return story('first_peer_encounter', [`peer:first:${peer.id}`], {
            ...base,
            kind: 'first_peer_encounter',
        });
    }

    if (interactions === 3 || interactions % 5 === 0) {
        return story('relationship_repeated', [`peer:repeated:${peer.id}:${interactions}`], {
            ...base,
            kind: 'relationship_repeated',
        });
    }

    return none();
}

function diagnostic(reasons: string[]): SignificanceResult {
    return { lane: 'diagnostic', reasons };
}

function none(): SignificanceResult {
    return { lane: 'none', reasons: [] };
}

function timelineBase(line: TrajectoryLine | ProgressLine): Record<string, unknown> {
    return {
        schemaVersion: line.schemaVersion,
        ts: line.ts,
        tick: line.tick,
        sessionId: line.sessionId,
    };
}

function patronStoryKind(line: TrajectoryLine): StoryEventKind | undefined {
    const candidate = stringField(line, 'patronKind') || (isRecord(line.event) ? stringField(line.event, 'kind') : undefined);
    return candidate && PATRON_KINDS.has(candidate as StoryEventKind) ? (candidate as StoryEventKind) : undefined;
}

function firstXpReason(
    reasons: string[],
    seenXpSkills: ReadonlySet<string> = new Set(),
): { skill: string; amount: number; reason: string } | undefined {
    for (const reason of reasons) {
        const match = /^xp_gain:([^:]+):(-?\d+(?:\.\d+)?)$/.exec(reason);
        if (!match) {
            continue;
        }
        const skill = match[1];
        if (seenXpSkills.has(skill)) {
            continue;
        }
        return { skill, amount: Number(match[2]), reason };
    }
    return undefined;
}

function hpRecoveryReason(
    reasons: string[],
    recentHpDangerSince: number | null | undefined,
): { amount: number; reason: string; dangerSince: number } | undefined {
    if (typeof recentHpDangerSince !== 'number') {
        return undefined;
    }

    for (const reason of reasons) {
        const match = /^hp:\+(\d+(?:\.\d+)?)$/.exec(reason);
        if (!match) {
            continue;
        }
        return { amount: Number(match[1]), reason, dangerSince: recentHpDangerSince };
    }
    return undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!record) {
        return undefined;
    }
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
    if (!record) {
        return undefined;
    }
    const value = record[key];
    return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pruneUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
