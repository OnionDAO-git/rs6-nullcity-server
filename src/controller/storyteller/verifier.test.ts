import { buildFixtureDigest } from './digest-builder';
import { verifyDispatch, applyVerifierResult } from './verifier';
import type { CityEventDigest, DigestEvent, StorytellerDispatch } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDispatch(overrides: Partial<StorytellerDispatch> = {}): StorytellerDispatch {
    return {
        schemaVersion: 1,
        dispatchId: 'test-dispatch-001',
        digestId: 'fixture-digest-001',
        generatedAt: '2026-05-29T06:01:00.000Z',
        modelProfile: 'test-profile',
        latencyMs: 150,
        estimatedCostUsd: null,
        inputTokens: null,
        outputTokens: null,
        publicTitle: 'Null City Update',
        publicBody: 'The city hums along.',
        publicBullets: [],
        operatorSummary: 'Nothing notable.',
        operatorWarnings: [],
        eventRefsUsed: [],
        needsReview: false,
        ...overrides,
    };
}

function makeEmptyDigest(): CityEventDigest {
    return {
        schemaVersion: 1,
        digestId: 'empty-digest',
        windowStart: '2026-05-29T05:50:00.000Z',
        windowEnd: '2026-05-29T06:00:00.000Z',
        builtAt: '2026-05-29T06:00:00.000Z',
        apEvents: [],
        gpEvents: [],
        exchangeEvents: [],
        ncriEvents: [],
        goalEvents: [],
        stuckEvents: [],
        miscEvents: [],
        topEvents: [],
        residents: [],
        systemHealth: { totalResidents: 0, activeResidents: 0, fadedResidents: 0, lowApResidents: 0 },
    };
}

const TS = '2026-05-29T05:55:00.000Z';

function makeEvent(ref: string, kind: DigestEvent['kind'], importance: DigestEvent['importance'] = 'low'): DigestEvent {
    return { ref, kind, residentName: 'res:test', ts: TS, note: 'test', importance };
}

// ---------------------------------------------------------------------------
// eventRefsUsed validation
// ---------------------------------------------------------------------------

describe('verifyDispatch — eventRefsUsed', () => {
    it('passes when no event refs are used', () => {
        const { digest } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ eventRefsUsed: [] }), digest);
        expect(result.passed).toBe(true);
        expect(result.warnings).toHaveLength(0);
    });

    it('passes when all used refs are present in the digest', () => {
        const { digest, refs } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ eventRefsUsed: [refs.apLow, refs.gpEarned] }), digest);
        expect(result.passed).toBe(true);
    });

    it('warns about an unknown event ref', () => {
        const { digest } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ eventRefsUsed: ['does-not-exist'] }), digest);
        expect(result.passed).toBe(false);
        expect(result.warnings.some(w => w.includes('does-not-exist'))).toBe(true);
    });

    it('emits one warning per unknown ref', () => {
        const { digest } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ eventRefsUsed: ['fake-a', 'fake-b'] }), digest);
        expect(result.warnings.filter(w => w.includes('unknown event ref'))).toHaveLength(2);
    });

    it('recognises refs from all event arrays (GP, exchange, NCRI, goal, stuck, misc)', () => {
        const { digest, refs } = buildFixtureDigest();
        const allRefs = [
            refs.apLow,
            refs.gpObserved,
            refs.gpEarned,
            refs.exchange,
            refs.ncri,
            refs.goalCompleted,
            refs.stuckRecovered,
            refs.quietResident,
        ];
        const result = verifyDispatch(makeDispatch({ eventRefsUsed: allRefs }), digest);
        expect(result.passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Private handle detection (public text only)
// ---------------------------------------------------------------------------

describe('verifyDispatch — private handle detection', () => {
    it('warns when publicTitle contains an @mention', () => {
        const result = verifyDispatch(makeDispatch({ publicTitle: 'Thanks @james for the AP' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('private handle'))).toBe(true);
    });

    it('warns when publicBody contains an @mention', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Patron @alice123 funded res:bob.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('private handle'))).toBe(true);
    });

    it('warns when a publicBullet contains an @mention', () => {
        const result = verifyDispatch(makeDispatch({ publicBullets: ['Supported by @john.'] }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('private handle'))).toBe(true);
    });

    it('warns on a Discord-like 18-digit snowflake in public text', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'User 123456789012345678 funded the city.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('private handle'))).toBe(true);
    });

    it('does not warn for a resident slug like res:bob', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'res:bob earned coins today.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('private handle'))).toBe(false);
    });

    it('does not check operatorSummary for private handles', () => {
        const result = verifyDispatch(makeDispatch({ operatorSummary: 'Internal note for @james about the GP route.' }), makeEmptyDigest());
        // operatorSummary is not public text — no warning
        expect(result.warnings.some(w => w.includes('private handle'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported death / fade claims
// ---------------------------------------------------------------------------

describe('verifyDispatch — unsupported death / fade', () => {
    it('warns when publicBody says "died" but no fade evidence', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'A resident died from lack of AP.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(true);
    });

    it('warns when publicBody says "faded" but no fade evidence', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice faded from existence.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(true);
    });

    it('warns when publicBody says "deceased" but no fade evidence', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'The resident is deceased.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(true);
    });

    it('does not warn for explicit zero-fade status lines', () => {
        const result = verifyDispatch(
            makeDispatch({
                publicBody: 'All 12 residents are active.',
                publicBullets: [
                    'No one is faded or low on AP.',
                    'Zero residents faded in this window.',
                    'No one is fading.',
                    'Zero are faded.',
                ],
            }),
            makeEmptyDigest(),
        );
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(false);
    });

    it('passes when resident_faded event is in apEvents', () => {
        const digest = makeEmptyDigest();
        digest.apEvents = [makeEvent('fade-ap', 'resident_faded', 'critical')];
        const result = verifyDispatch(makeDispatch({ publicBody: 'A resident faded from lack of support.' }), digest);
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(false);
    });

    it('passes when resident_faded event is in miscEvents', () => {
        const digest = makeEmptyDigest();
        digest.miscEvents = [makeEvent('fade-misc', 'resident_faded', 'critical')];
        const result = verifyDispatch(makeDispatch({ publicBody: 'A resident died tonight.' }), digest);
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(false);
    });

    it('passes when a resident snapshot has isFaded: true', () => {
        const digest = makeEmptyDigest();
        digest.residents = [{ residentName: 'res:alice', attention: 0, isLowAp: true, isFaded: true, gpObserved: null }];
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice faded tonight.' }), digest);
        expect(result.warnings.some(w => w.includes('death or fade'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported GP movement claims
// ---------------------------------------------------------------------------

describe('verifyDispatch — unsupported GP movement', () => {
    it('warns when publicBody claims GP was earned but no GP events exist', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Bob earned GP from cooking fish.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('GP movement'))).toBe(true);
    });

    it('warns when publicBody claims GP was traded but no events exist', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice traded gold for supplies.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('GP movement'))).toBe(true);
    });

    it('passes when GP events are present in the digest', () => {
        const { digest } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice earned gold today.' }), digest);
        expect(result.warnings.some(w => w.includes('GP movement'))).toBe(false);
    });

    it('passes when only exchange events are present (no standalone GP events)', () => {
        const digest = makeEmptyDigest();
        digest.exchangeEvents = [makeEvent('ex-1', 'ap_for_gp_exchange', 'high')];
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice traded GP for AP.' }), digest);
        expect(result.warnings.some(w => w.includes('GP movement'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported NCRI claims
// ---------------------------------------------------------------------------

describe('verifyDispatch — unsupported NCRI claims', () => {
    it('warns when public text mentions NCRI but no NCRI events exist', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'A new NCRI was minted today.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('NCRI'))).toBe(true);
    });

    it('passes when NCRI events are present in the digest', () => {
        const { digest } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ publicBody: 'An NCRI item changed hands.' }), digest);
        expect(result.warnings.some(w => w.includes('NCRI'))).toBe(false);
    });

    it('does not warn when the word NCRI does not appear in public text', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'A special item was observed.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('NCRI'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported quest / goal completion claims
// ---------------------------------------------------------------------------

describe('verifyDispatch — unsupported quest / goal completion', () => {
    it('warns when publicBody claims a quest was completed but no goal events exist', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Carol completed the quest with great skill.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('goal completion'))).toBe(true);
    });

    it('warns when publicBody says a goal was finished but no goal_completed events exist', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Bob finished his goal.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('goal completion'))).toBe(true);
    });

    it('passes when goal_completed events are present in the digest', () => {
        const { digest } = buildFixtureDigest();
        const result = verifyDispatch(makeDispatch({ publicBody: 'Bob finished the quest objective today.' }), digest);
        expect(result.warnings.some(w => w.includes('goal completion'))).toBe(false);
    });

    it('does not warn when "goal" appears without a completion verb', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice has a goal of making 100 GP/hour.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('goal completion'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported AP grant claims
// ---------------------------------------------------------------------------

describe('verifyDispatch — unsupported AP grant', () => {
    it('warns when publicBody claims AP was granted but no ap_granted events', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'James granted 10 AP to res:alice.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('AP was granted'))).toBe(true);
    });

    it('warns when publicBody says AP was credited but no events', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'AP was credited to the resident.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('AP was granted'))).toBe(true);
    });

    it('passes when ap_granted events are present in the digest', () => {
        const digest = makeEmptyDigest();
        digest.apEvents = [makeEvent('ap-grant-1', 'ap_granted', 'high')];
        const result = verifyDispatch(makeDispatch({ publicBody: 'James granted 10 AP to res:alice.' }), digest);
        expect(result.warnings.some(w => w.includes('AP was granted'))).toBe(false);
    });

    it('does not warn when AP appears without a grant verb (e.g. "low AP")', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'Alice is running low on AP.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('AP was granted'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Unsupported resident birth claims
// ---------------------------------------------------------------------------

describe('verifyDispatch — unsupported resident birth claims', () => {
    it('warns when publicBody claims a resident was born but no soul_born events', () => {
        const result = verifyDispatch(makeDispatch({ publicBody: 'A new resident was born in the city.' }), makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('resident birth'))).toBe(true);
    });

    it('passes when soul_born evidence exists in digest events', () => {
        const digest = makeEmptyDigest();
        digest.miscEvents = [makeEvent('born-1', 'soul_born', 'high')];
        const result = verifyDispatch(makeDispatch({ publicBody: 'A new resident was born in the city.' }), digest);
        expect(result.warnings.some(w => w.includes('resident birth'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// applyVerifierResult
// ---------------------------------------------------------------------------

describe('applyVerifierResult', () => {
    it('returns the same dispatch reference when the result passed', () => {
        const dispatch = makeDispatch();
        const applied = applyVerifierResult(dispatch, { passed: true, warnings: [] });
        expect(applied).toBe(dispatch);
    });

    it('sets needsReview and populates reviewReasons when warnings exist', () => {
        const dispatch = makeDispatch({ needsReview: false, reviewReasons: [] });
        const applied = applyVerifierResult(dispatch, { passed: false, warnings: ['warning A', 'warning B'] });
        expect(applied.needsReview).toBe(true);
        expect(applied.reviewReasons).toEqual(['warning A', 'warning B']);
    });

    it('appends to existing reviewReasons rather than replacing them', () => {
        const dispatch = makeDispatch({ reviewReasons: ['pre-existing'] });
        const applied = applyVerifierResult(dispatch, { passed: false, warnings: ['new warning'] });
        expect(applied.reviewReasons).toEqual(['pre-existing', 'new warning']);
    });

    it('does not mutate the original dispatch', () => {
        const dispatch = makeDispatch({ needsReview: false });
        applyVerifierResult(dispatch, { passed: false, warnings: ['w'] });
        expect(dispatch.needsReview).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Clean fixture — no false positives on neutral text
// ---------------------------------------------------------------------------

describe('verifyDispatch — clean dispatch against fixture digest', () => {
    it('produces no warnings for neutral public text with valid refs', () => {
        const { digest, refs } = buildFixtureDigest();
        const dispatch = makeDispatch({
            publicTitle: 'Null City Digest',
            publicBody: 'Multiple residents were active this window. Progress was made.',
            publicBullets: ['res:alice is running low on AP.', 'res:bob was productive.'],
            eventRefsUsed: [refs.apLow, refs.gpEarned],
        });
        const result = verifyDispatch(dispatch, digest);
        expect(result.warnings).toHaveLength(0);
        expect(result.passed).toBe(true);
    });
});
