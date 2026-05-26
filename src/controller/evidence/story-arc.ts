export type StoryArcPhase = 'pitch' | 'fund' | 'progress' | 'resolve' | 'letter';

export interface StoryArcSummary {
    phase: StoryArcPhase;
    summary: string;
    startedAtTick?: number;
    latestEventTick?: number;
    latestEventKind?: string;
    evidence: {
        pitches: number;
        fundingEvents: number;
        progressEvents: number;
        resolutionEvents: number;
        letterEvents: number;
    };
}

type ArcCategory = keyof StoryArcSummary['evidence'];

interface ClassifiedEvent {
    category: ArcCategory;
    phase: StoryArcPhase;
    tick: number;
    kind: string;
}

const FUNDING_KINDS = new Set(['patron_gift', 'patron_witness', 'patron_sponsor']);
const PROGRESS_KINDS = new Set([
    'first_xp',
    'first_object_interaction',
    'first_place_entry',
    'first_peer_encounter',
    'faction_change',
    'near_death_survival',
    'relationship_repeated',
    'stuck_recovered',
]);
const RESOLUTION_KINDS = new Set(['legacy_event', 'prepared_epitaph', 'wants_unfulfilled']);
const LETTER_KINDS = new Set([
    'civic_milestone',
    'epitaph',
    'epitaph_letter',
    'letter',
    'letter_dispatched',
    'patron_letter',
    'standing_tier_crossed',
]);
const PHASE_RANK: Readonly<Record<StoryArcPhase, number>> = {
    pitch: 1,
    fund: 2,
    progress: 3,
    resolve: 4,
    letter: 5,
};
const PITCH_TEXT = /\b(fund|funding|goal|hope|need|please|request|sponsor|support me|want|wish|would like)\b/i;

export function inferStoryArc(timeline: Array<Record<string, unknown>>): StoryArcSummary {
    const events = [...timeline].sort((a, b) => numberField(a, 'tick') - numberField(b, 'tick'));
    const classified = events.map(classifyEvent).filter((event): event is ClassifiedEvent => event !== undefined);
    const evidence = {
        pitches: classified.filter(event => event.category === 'pitches').length,
        fundingEvents: classified.filter(event => event.category === 'fundingEvents').length,
        progressEvents: classified.filter(event => event.category === 'progressEvents').length,
        resolutionEvents: classified.filter(event => event.category === 'resolutionEvents').length,
        letterEvents: classified.filter(event => event.category === 'letterEvents').length,
    };
    const latest = highestPhaseEvent(classified);
    return {
        phase: latest?.phase ?? 'pitch',
        summary: summaryForPhase(latest?.phase ?? 'pitch', evidence),
        startedAtTick: classified[0]?.tick,
        latestEventTick: latest?.tick,
        latestEventKind: latest?.kind,
        evidence,
    };
}

function highestPhaseEvent(events: ClassifiedEvent[]): ClassifiedEvent | undefined {
    return events.reduce<ClassifiedEvent | undefined>((best, event) => {
        if (!best || PHASE_RANK[event.phase] > PHASE_RANK[best.phase]) {
            return event;
        }
        if (PHASE_RANK[event.phase] === PHASE_RANK[best.phase] && event.tick > best.tick) {
            return event;
        }
        return best;
    }, undefined);
}

function classifyEvent(event: Record<string, unknown>): ClassifiedEvent | undefined {
    const kind = stringField(event, 'kind') || 'event';
    const tick = numberField(event, 'tick');
    if (LETTER_KINDS.has(kind)) {
        return { category: 'letterEvents', phase: 'letter', tick, kind };
    }
    if (RESOLUTION_KINDS.has(kind)) {
        return { category: 'resolutionEvents', phase: 'resolve', tick, kind };
    }
    if (PROGRESS_KINDS.has(kind)) {
        return { category: 'progressEvents', phase: 'progress', tick, kind };
    }
    if (FUNDING_KINDS.has(kind)) {
        return { category: 'fundingEvents', phase: 'fund', tick, kind };
    }
    if (kind === 'request_attention' || (kind === 'say' && PITCH_TEXT.test(stringField(event, 'text') || ''))) {
        return { category: 'pitches', phase: 'pitch', tick, kind };
    }
    return undefined;
}

function summaryForPhase(phase: StoryArcPhase, evidence: StoryArcSummary['evidence']): string {
    if (phase === 'letter') {
        return 'Letter aftermath is visible to patrons and the Library.';
    }
    if (phase === 'resolve') {
        return 'The resident is resolving or closing the current arc.';
    }
    if (phase === 'progress') {
        return evidence.fundingEvents > 0
            ? 'Patron support has turned into visible in-game progress.'
            : 'The resident is making visible in-game progress.';
    }
    if (phase === 'fund') {
        return 'Patron support is recorded and waiting to become action.';
    }
    return evidence.pitches > 0 ? 'The resident has made a visible request or ambition.' : 'No active pitch recorded yet.';
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
