import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';
import { renderPortrait, type PortraitIndex, type PortraitRenderOptions } from './portrait-template';
import type { ProgressLine, TrajectoryLine } from './schemas';
import { classifyProgressLine, classifyTrajectoryLine, type PeerInteraction, peerInteractionFromTrajectoryLine } from './significance';
import type {
    OrientationProgressLibraryEvent,
    OrientationStalledLibraryEvent,
    OrientationNudgeLibraryEvent,
    OrientationGoalEditedLibraryEvent,
} from '../spark/orientation-scorer';
import type { GoalClass } from '../intelligence/planner-pass';

// ---------------------------------------------------------------------------
// RIQ-3-3: Plan lifecycle Library event types
// ---------------------------------------------------------------------------

/**
 * Emitted when PlannerPass creates the first durable plan for a resident.
 * The Storyteller can narrate "resident X is now pursuing: stage1, stage2…"
 */
export interface PlanCreatedLibraryEvent {
    kind: 'plan_created';
    ts: string;
    tick: number;
    goalId: string;
    goalDescription: string;
    stageCount: number;
    /** Ordered subgoal labels — enough for the Storyteller to narrate the arc. */
    stageSubgoals: string[];
}

/**
 * Emitted when PlannerPass replaces an existing plan (plan completed, abandoned,
 * or a stage blocked). Includes why the replan was triggered so the Storyteller
 * can frame it as adaptation rather than failure.
 */
export interface PlanReplannedLibraryEvent {
    kind: 'plan_replanned';
    ts: string;
    tick: number;
    goalId: string;
    goalDescription: string;
    stageCount: number;
    stageSubgoals: string[];
    /** Previous plan status ('completed'|'abandoned') or 'stage_blocked:<stageId>'. */
    replannedReason: string;
}

/**
 * Emitted when the Body detects that the current plan stage's success criteria
 * are met and advances the plan to the next stage (RIQ-A1-OBS).
 */
export interface PlanStageDoneLibraryEvent {
    kind: 'plan_stage_done';
    ts: string;
    tick: number;
    goalId: string;
    stageId: string;
    stageSubgoal: string;
}

/**
 * Emitted when the Body detects that the current plan stage is blocked —
 * the success criteria cannot be met given current world state — and
 * marks the stage blocked so the Planner can re-plan (RIQ-A1-OBS).
 */
export interface PlanStageBlockedLibraryEvent {
    kind: 'plan_stage_blocked';
    ts: string;
    tick: number;
    goalId: string;
    stageId: string;
    stageSubgoal: string;
}

/**
 * Emitted when an open-goal (non-runescape_skill) plan stage completes via the
 * primitive-steps executor. Lets the Storyteller narrate open-goal milestones —
 * e.g. "placed the O in ONIONDAO", "recited first poem". (RIQ-4-4)
 */
export interface OpenGoalProgressLibraryEvent {
    kind: 'open_goal_progress';
    ts: string;
    tick: number;
    goalId: string;
    stageId: string;
    goalClass: GoalClass;
    note: string;
}

export interface NcriLibraryEvent {
    kind: 'ncri_created' | 'ncri_transferred' | 'ncri_redeemed';
    ts: string;
    tick: number;
    ncriId: string;
    /** Real RuneScape item id (coin item 995 = GP; other ids = special items). */
    itemId: number;
    displayName: string;
    /** Current owner (cityUserId) after this event. */
    owner: string;
    /** Previous owner, set only for ncri_transferred events. */
    previousOwner?: string;
}

/**
 * Saved-state Library event emitted when a verified binary GoalContract is
 * marked achieved. Only fires on confirmed completion — not on partial quest
 * progress or aspirational goals. The caller (GoalContractStore.markAchieved)
 * already enforces non-empty evidence before this is called.
 */
export interface GoalAchievedLibraryEvent {
    kind: 'goal_achieved';
    ts: string;
    tick: number;
    /** GoalContract.id — allows cross-referencing the stored contract. */
    goalId: string;
    /** Aspirational goal text at the time of completion. */
    goalText: string;
    /** Non-empty evidence source proving completion (e.g. "runtime:bank-balance"). */
    evidence: string;
    /** AP balance at time of completion, for Storyteller context. */
    apAtCompletion?: number;
    /** GP observed (coin item 995) at time of completion, for Storyteller context. */
    gpAtCompletion?: number;
}

export interface PatronEvent {
    kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor';
    ts: string;
    tick: number;
    patronHandle: string;
    artifact?: string;
    note?: string;
    direction?: 'in' | 'out';
    /**
     * Shards transferred (patron_gift / patron_sponsor only). Surfaces in
     * the Brain's memory rendering so the resident can acknowledge the
     * specific amount. See E7 in `docs/intelligence-verification-log.md`.
     */
    amount?: number;
    /**
     * Standing tier the patron crossed into as a side-effect of this event
     * (e.g. `'acquaintance'` after their first 10-Shard offer). Optional —
     * only set when the verb crossed a threshold.
     */
    standingTier?: string;
    /**
     * Attention bump delivered to the resident from this gift, in units of
     * resident attention (not Shards). Useful for the Brain to understand
     * the magnitude of support beyond the raw Shards count.
     */
    attentionDelta?: number;
}

export interface LibraryUpdaterOptions {
    now?: () => Date;
    /** SOUL factionId forwarded to portrait rendering so portraits include faction affiliation. */
    factionId?: string;
}

interface LibraryIndex extends PortraitIndex {
    schemaVersion: 1;
    relationshipCounts?: Record<string, number>;
}

export class LibraryUpdater {
    private readonly now: () => Date;
    private readonly portraitOptions: PortraitRenderOptions;
    private readonly seenXpSkills = new Set<string>();
    private readonly seenPeers = new Set<string>();
    private readonly peerInteractionCounts = new Map<string, number>();
    private previousStuckSince: number | null = null;
    private recentHpDangerSince: number | null = null;

    constructor(
        private readonly residentName: string,
        private readonly root: string,
        options: LibraryUpdaterOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.portraitOptions = { factionId: options.factionId };
        this.writeIndex(this.readIndex());
        this.hydratePeerContext();
    }

    observeTrajectory(line: TrajectoryLine): void {
        const peerInteraction = peerInteractionFromTrajectoryLine(line);
        const result = classifyTrajectoryLine(line, {
            seenPeers: this.seenPeers,
            peerInteractionCounts: this.peerInteractionCounts,
        });
        if (peerInteraction) {
            this.recordPeerInteraction(peerInteraction);
        }
        if (result.lane !== 'story' || !result.timelineEvent) {
            return;
        }
        const index = this.readIndex();
        if (line.kind === 'legacy_event') {
            this.markLastWords(index.lives, line.tick);
            this.appendUnfulfilledWants(index.lives, line);
        }
        this.appendTimeline({ ...result.timelineEvent, lifeIndex: index.lives, significanceReasons: result.reasons });
        if (line.kind === 'legacy_event') {
            this.applyLegacyEvent(line, index);
        } else {
            this.touchIndex(index);
        }
        this.schedulePortraitRegeneration();
    }

    observeProgress(line: ProgressLine): void {
        const result = classifyProgressLine(line, {
            seenXpSkills: this.seenXpSkills,
            previousStuckSince: this.previousStuckSince,
            recentHpDangerSince: this.recentHpDangerSince,
        });
        if (result.storyKind === 'near_death_survival') {
            this.recentHpDangerSince = null;
        } else if (dangerousHpLoss(line.reasons)) {
            this.recentHpDangerSince = line.tick;
        }
        if (result.lane !== 'story' || !result.timelineEvent) {
            return;
        }

        const index = this.readIndex();
        this.appendTimeline({ ...result.timelineEvent, lifeIndex: index.lives, significanceReasons: result.reasons });
        if (result.storyKind === 'first_xp' && typeof result.timelineEvent.skill === 'string') {
            this.seenXpSkills.add(result.timelineEvent.skill);
        }
        if (result.storyKind === 'stuck_detected') {
            this.previousStuckSince = line.stuckSince;
        } else if (result.storyKind === 'stuck_recovered') {
            this.previousStuckSince = null;
        }
        this.touchIndex(index);
        this.schedulePortraitRegeneration();
    }

    /**
     * Record that the resident was revived (E8 follow-up to Codex's
     * `4f62d181` restart respawn policy). Bumps `index.lives`, flips
     * `currentState` back to `'living'`, and appends a `revival` event to
     * the timeline so the Brain's prompt envelope has a memory beat about
     * the continuity break. Without this, a respawned resident's evidence
     * stream silently picks up from the prior life with no narrative
     * marker — see `docs/intelligence-verification-log.md` § E8 / F8a.
     *
     * Wire-in is one call from `ResidentRuntime.applyRestartRespawnPolicy`
     * (Codex zone — tracked separately).
     */
    observeRevival(event: { ts: string; tick: number; cause: string }): void {
        const index = this.readIndex();
        const nextLifeIndex = index.lives + 1;
        this.writeIndex({
            ...index,
            lives: nextLifeIndex,
            currentState: 'living',
            updatedAt: this.now().toISOString(),
        });
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'revival',
            cause: event.cause,
            lifeIndex: nextLifeIndex,
            significanceReasons: ['life:revival'],
        });
        this.schedulePortraitRegeneration();
    }

    observePatron(event: PatronEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: event.kind,
            patronHandle: event.patronHandle,
            artifact: event.artifact,
            note: event.note,
            amount: event.amount,
            standingTier: event.standingTier,
            attentionDelta: event.attentionDelta,
            lifeIndex: index.lives,
            significanceReasons: [`patron:${event.kind}`],
        });
        this.touchIndex(index);
        this.schedulePortraitRegeneration();
    }

    observeNcriEvent(event: NcriLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: event.kind,
            ncriId: event.ncriId,
            itemId: event.itemId,
            displayName: event.displayName,
            owner: event.owner,
            previousOwner: event.previousOwner,
            lifeIndex: index.lives,
            significanceReasons: [`ncri:${event.kind}`],
        });
        this.touchIndex(index);
        this.schedulePortraitRegeneration();
    }

    /**
     * Record a verified binary goal completion as a durable saved-state Library
     * moment. Only call after GoalContractStore.markAchieved succeeds — that
     * method already enforces non-empty evidence so partial progress cannot reach
     * here. The resulting timeline entry is queryable by the Storyteller digest
     * as a `goal_achieved` resolution event.
     */
    observeGoalAchieved(event: GoalAchievedLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'goal_achieved',
            goalId: event.goalId,
            goalText: event.goalText,
            evidence: event.evidence,
            apAtCompletion: event.apAtCompletion,
            gpAtCompletion: event.gpAtCompletion,
            lifeIndex: index.lives,
            significanceReasons: ['goal:achieved'],
        });
        this.touchIndex(index);
        this.schedulePortraitRegeneration();
    }

    /**
     * Record orientation progress as a durable Library timeline moment (S-GOAL-2).
     * Only call when `scoreOrientationAction` returns `progressDetected: true`.
     * The Storyteller digest can query `orientation_progress` events to narrate
     * advancement toward the resident's north-star goal without invention.
     */
    observeOrientationProgress(event: OrientationProgressLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'orientation_progress',
            orientationGoalId: event.orientationGoalId,
            orientationGoalDescription: event.orientationGoalDescription,
            reason: event.reason,
            lifeIndex: index.lives,
            significanceReasons: ['orientation:progress'],
        });
        this.touchIndex(index);
        this.schedulePortraitRegeneration();
    }

    /**
     * Record orientation stall as a durable Library timeline moment (S-GOAL-2).
     * Only call when `OrientationStallTracker.record` returns `newStall: true`.
     * Emitted at most once per stall episode; resets when progress is detected.
     * Surfaces to the operator dashboard as a signal that the resident may need
     * a goal nudge (operator action; residents cannot rewrite their own goal).
     */
    observeOrientationStalled(event: OrientationStalledLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'orientation_stalled',
            orientationGoalId: event.orientationGoalId,
            orientationGoalDescription: event.orientationGoalDescription,
            nonProgressTicks: event.nonProgressTicks,
            lifeIndex: index.lives,
            significanceReasons: ['orientation:stalled'],
        });
        this.touchIndex(index);
        this.schedulePortraitRegeneration();
    }

    /**
     * Record an operator goal nudge as a durable Library timeline moment (S-GOAL-4).
     * Only operators may call this; residents cannot self-nudge. The nudge text is
     * surfaced to the Brain prompt as a contextual hint on the next think() cycle.
     */
    observeOrientationNudge(event: OrientationNudgeLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'orientation_nudge',
            text: event.text,
            lifeIndex: index.lives,
            significanceReasons: ['orientation:nudge'],
        });
        this.touchIndex(index);
    }

    /**
     * Record an operator soul orientation-goal edit as a durable Library audit
     * moment (S-GOAL-4). Records previous and new goal ids for accountability.
     * Only operators may change a soul's orientation goal.
     */
    observeOrientationGoalEdited(event: OrientationGoalEditedLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'orientation_goal_edited',
            previousGoalId: event.previousGoalId,
            newGoalId: event.newGoalId,
            newGoalDescription: event.newGoalDescription,
            newGoalTier: event.newGoalTier,
            reason: event.reason,
            lifeIndex: index.lives,
            significanceReasons: ['orientation:goal_edited'],
        });
        this.touchIndex(index);
    }

    /**
     * Record a new durable plan as a Library timeline moment (RIQ-3-3).
     * Call only when PlannerPass creates the resident's first plan (no prior plan).
     */
    observePlanCreated(event: PlanCreatedLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'plan_created',
            goalId: event.goalId,
            goalDescription: event.goalDescription,
            stageCount: event.stageCount,
            stageSubgoals: event.stageSubgoals,
            lifeIndex: index.lives,
            significanceReasons: ['plan:created'],
        });
        this.touchIndex(index);
    }

    /**
     * Record a plan replacement as a Library timeline moment (RIQ-3-3).
     * Call when PlannerPass replaces an existing plan because it was completed,
     * abandoned, or a stage became blocked.
     */
    observePlanReplanned(event: PlanReplannedLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'plan_replanned',
            goalId: event.goalId,
            goalDescription: event.goalDescription,
            stageCount: event.stageCount,
            stageSubgoals: event.stageSubgoals,
            replannedReason: event.replannedReason,
            lifeIndex: index.lives,
            significanceReasons: ['plan:replanned'],
        });
        this.touchIndex(index);
    }

    /**
     * Record a plan stage completion as a Library timeline moment (RIQ-A1-OBS).
     * Call when the Body router detects a stage's success criteria are met.
     */
    observePlanStageDone(event: PlanStageDoneLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'plan_stage_done',
            goalId: event.goalId,
            stageId: event.stageId,
            stageSubgoal: event.stageSubgoal,
            lifeIndex: index.lives,
            significanceReasons: ['plan:stage_done'],
        });
        this.touchIndex(index);
    }

    /**
     * Record a plan stage block as a Library timeline moment (RIQ-A1-OBS).
     * Call when the Body router determines the current stage cannot progress
     * and marks it blocked so the Planner can re-plan.
     */
    observePlanStageBlocked(event: PlanStageBlockedLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'plan_stage_blocked',
            goalId: event.goalId,
            stageId: event.stageId,
            stageSubgoal: event.stageSubgoal,
            lifeIndex: index.lives,
            significanceReasons: ['plan:stage_blocked'],
        });
        this.touchIndex(index);
    }

    /**
     * Emit an open_goal_progress Library timeline event when a spatial, creative,
     * or social plan stage completes its authored primitive steps. Makes open-goal
     * milestones visible to the Storyteller substrate. (RIQ-4-4)
     */
    observeOpenGoalProgress(event: OpenGoalProgressLibraryEvent): void {
        const index = this.readIndex();
        this.appendTimeline({
            schemaVersion: 1,
            ts: event.ts,
            tick: event.tick,
            sessionId: 'external',
            kind: 'open_goal_progress',
            goalId: event.goalId,
            stageId: event.stageId,
            goalClass: event.goalClass,
            note: event.note,
            lifeIndex: index.lives,
            significanceReasons: ['plan:open_goal_progress'],
        });
        this.touchIndex(index);
    }

    async regeneratePortrait(): Promise<void> {
        const rendered = renderPortrait(this.residentName, this.readIndex(), this.readTimeline(), this.portraitOptions);
        this.writeAtomic(this.portraitJsonPath(), `${JSON.stringify(rendered.portrait, null, 2)}\n`);
        this.writeAtomic(this.portraitMarkdownPath(), rendered.markdown);
    }

    artifactPaths(): string[] {
        return [this.timelinePath(), this.indexPath(), this.portraitJsonPath(), this.portraitMarkdownPath()];
    }

    private applyLegacyEvent(line: TrajectoryLine, index: LibraryIndex): void {
        const event = isRecord(line.event) ? line.event : {};
        const nextIndex: LibraryIndex = {
            ...index,
            lives: event.rebirth === true ? index.lives + 1 : index.lives,
            currentState: event.rebirth === true ? 'living' : 'ended',
            updatedAt: this.now().toISOString(),
        };
        this.writeIndex(nextIndex);
    }

    private touchIndex(index: LibraryIndex): void {
        this.writeIndex({ ...index, updatedAt: this.now().toISOString() });
    }

    private appendTimeline(event: Record<string, unknown>): void {
        fs.mkdirSync(this.libraryDir(), { recursive: true });
        fs.appendFileSync(this.timelinePath(), `${JSON.stringify(pruneUndefined(event))}\n`);
    }

    private markLastWords(lifeIndex: number, tick: number): void {
        const timeline = this.readTimeline();
        const lastSayIndex = timeline.findLastIndex(
            event => event.kind === 'say' && numberField(event, 'lifeIndex', 1) === lifeIndex && numberField(event, 'tick') <= tick,
        );
        if (lastSayIndex < 0) {
            return;
        }
        timeline[lastSayIndex] = { ...timeline[lastSayIndex], lastWords: true };
        this.writeTimeline(timeline);
    }

    private appendUnfulfilledWants(lifeIndex: number, line: TrajectoryLine): void {
        const timeline = this.readTimeline();
        const existing = new Set(
            timeline
                .filter(event => event.kind === 'wants_unfulfilled' && numberField(event, 'lifeIndex', 1) === lifeIndex)
                .map(event => `${stringField(event, 'want') || ''}:${numberField(event, 'wantedAtTick')}`),
        );
        const wants = uniqueWantEvents(timeline, lifeIndex, line.tick);
        for (const want of wants) {
            const key = `${want.text}:${want.tick}`;
            if (existing.has(key)) {
                continue;
            }
            this.appendTimeline({
                schemaVersion: line.schemaVersion,
                ts: line.ts,
                tick: line.tick,
                sessionId: line.sessionId,
                kind: 'wants_unfulfilled',
                want: want.text,
                wantedAtTick: want.tick,
                lifeIndex,
                significanceReasons: ['want:unfulfilled'],
            });
        }
    }

    private hydratePeerContext(): void {
        for (const [peerId, interactions] of Object.entries(this.readIndex().relationshipCounts || {})) {
            if (Number.isFinite(interactions)) {
                this.seenPeers.add(peerId);
                this.peerInteractionCounts.set(peerId, interactions);
            }
        }
        for (const event of this.readTimeline()) {
            if (event.kind !== 'first_peer_encounter' && event.kind !== 'relationship_repeated') {
                continue;
            }
            const peerId = stringField(event, 'peerId') || stringField(event, 'peer');
            if (!peerId) {
                continue;
            }
            this.seenPeers.add(peerId);
            this.peerInteractionCounts.set(
                peerId,
                Math.max(this.peerInteractionCounts.get(peerId) ?? 0, numberField(event, 'interactions', 1)),
            );
        }
    }

    private recordPeerInteraction(peer: PeerInteraction): void {
        this.seenPeers.add(peer.id);
        const interactions = (this.peerInteractionCounts.get(peer.id) ?? 0) + 1;
        this.peerInteractionCounts.set(peer.id, interactions);
        const index = this.readIndex();
        this.writeIndex({
            ...index,
            relationshipCounts: {
                ...(index.relationshipCounts || {}),
                [peer.id]: interactions,
            },
            updatedAt: this.now().toISOString(),
        });
    }

    private readIndex(): LibraryIndex {
        if (!fs.existsSync(this.indexPath())) {
            const now = this.now().toISOString();
            return {
                schemaVersion: 1,
                resident: this.residentName,
                createdAt: now,
                updatedAt: now,
                lives: 1,
                currentState: 'living',
                relationshipCounts: {},
            };
        }
        return JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as LibraryIndex;
    }

    private readTimeline(): Array<Record<string, unknown>> {
        if (!fs.existsSync(this.timelinePath())) {
            return [];
        }
        return fs
            .readFileSync(this.timelinePath(), 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
                try {
                    return [JSON.parse(line) as Record<string, unknown>];
                } catch {
                    return [];
                }
            });
    }

    private writeTimeline(events: Array<Record<string, unknown>>): void {
        const text = events.map(event => JSON.stringify(pruneUndefined(event))).join('\n');
        this.writeAtomic(this.timelinePath(), text.length > 0 ? `${text}\n` : '');
    }

    private writeIndex(index: LibraryIndex): void {
        fs.mkdirSync(this.libraryDir(), { recursive: true });
        fs.writeFileSync(this.indexPath(), `${JSON.stringify(index, null, 2)}\n`);
    }

    private libraryDir(): string {
        return path.join(this.root, 'library', residentSlug(this.residentName));
    }

    private timelinePath(): string {
        return path.join(this.libraryDir(), 'timeline.jsonl');
    }

    private indexPath(): string {
        return path.join(this.libraryDir(), 'index.json');
    }

    private portraitJsonPath(): string {
        return path.join(this.libraryDir(), 'portrait.json');
    }

    private portraitMarkdownPath(): string {
        return path.join(this.libraryDir(), 'portrait.md');
    }

    private writeAtomic(filePath: string, text: string): void {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, text);
        fs.renameSync(tmpPath, filePath);
    }

    getPatronHandles(): string[] {
        const timeline = this.readTimeline();
        const handles = new Set<string>();
        for (const event of timeline) {
            const handle = event.patronHandle;
            if (typeof handle === 'string' && handle.trim().length > 0) {
                handles.add(handle);
            }
        }
        return Array.from(handles);
    }

    private schedulePortraitRegeneration(): void {
        void this.regeneratePortrait();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function dangerousHpLoss(reasons: string[]): boolean {
    return reasons.some(reason => {
        const match = /^hp:-(\d+(?:\.\d+)?)$/.exec(reason);
        return match ? Number(match[1]) >= 3 : false;
    });
}

function uniqueWantEvents(
    timeline: Array<Record<string, unknown>>,
    lifeIndex: number,
    tick: number,
): Array<{ text: string; tick: number }> {
    const seen = new Set<string>();
    const wants: Array<{ text: string; tick: number }> = [];
    for (const event of timeline) {
        if (event.kind !== 'say' || numberField(event, 'lifeIndex', 1) !== lifeIndex || numberField(event, 'tick') > tick) {
            continue;
        }
        const text = stringField(event, 'text');
        if (!text || !isWantText(text) || seen.has(text)) {
            continue;
        }
        seen.add(text);
        wants.push({ text, tick: numberField(event, 'tick') });
    }
    return wants;
}

function isWantText(text: string): boolean {
    return /\b(want|need|hope|wish|would like)\b/i.test(text);
}

function pruneUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
