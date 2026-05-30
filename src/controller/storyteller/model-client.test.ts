import { buildFixtureDigest, resetRefCounter } from './digest-builder';
import { StorytellerModelClient } from './model-client';
import { DEFAULT_STORYTELLER_CONFIG } from './types';
import type { LlmEndpointConfig } from '../config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_BASE_URL = 'http://localhost:11434';

function makeEndpoints(overrides: Partial<LlmEndpointConfig> = {}): Record<string, LlmEndpointConfig> {
    return {
        default: { baseUrl: FIXTURE_BASE_URL, model: 'test-model', timeoutMs: 10_000, ...overrides },
    };
}

function completionResponse(content: string, usage?: { prompt_tokens: number; completion_tokens: number }): Response {
    const body = JSON.stringify({
        model: 'test-model',
        choices: [{ message: { content } }],
        usage: usage ?? { prompt_tokens: 100, completion_tokens: 50 },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

function validDispatchJson(eventRefs: string[]): string {
    return JSON.stringify({
        publicTitle: 'Null City Dispatch',
        publicBody: 'Life continues in Null City today.',
        publicBullets: ['Alice is low on AP.', 'Bob earned GP.'],
        operatorSummary: 'Two notable events this window.',
        operatorWarnings: [],
        eventRefsUsed: eventRefs,
    });
}

const originalFetch = global.fetch;

beforeEach(() => {
    resetRefCounter();
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('StorytellerModelClient.run — happy path', () => {
    it('returns a valid StorytellerDispatch with latency > 0', async () => {
        const { digest, refs } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse(validDispatchJson([refs.gpEarned])));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG, { modelProfile: 'default' });

        expect(dispatch.schemaVersion).toBe(1);
        expect(dispatch.digestId).toBe(digest.digestId);
        expect(dispatch.modelProfile).toBe('default');
        expect(dispatch.latencyMs).toBeGreaterThanOrEqual(0);
        expect(dispatch.publicTitle).toBe('Null City Dispatch');
        expect(dispatch.publicBody).toBe('Life continues in Null City today.');
        expect(dispatch.publicBullets).toEqual(['Alice is low on AP.', 'Bob earned GP.']);
        expect(dispatch.operatorSummary).toBe('Two notable events this window.');
        expect(dispatch.operatorWarnings).toEqual([]);
        expect(dispatch.eventRefsUsed).toEqual([refs.gpEarned]);
    });

    it('sets dispatchId and generatedAt', async () => {
        const { digest, refs } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse(validDispatchJson([refs.apLow])));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.dispatchId).toBeTruthy();
        expect(dispatch.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('records token counts from the model response', async () => {
        const { digest, refs } = buildFixtureDigest();
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce(completionResponse(validDispatchJson([refs.gpEarned]), { prompt_tokens: 200, completion_tokens: 80 }));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.inputTokens).toBe(200);
        expect(dispatch.outputTokens).toBe(80);
    });

    it('calculates estimatedCostUsd from token counts and endpoint cost config', async () => {
        const { digest, refs } = buildFixtureDigest();
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce(completionResponse(validDispatchJson([refs.gpEarned]), { prompt_tokens: 1000, completion_tokens: 500 }));

        const endpointWithCost: LlmEndpointConfig = {
            baseUrl: FIXTURE_BASE_URL,
            model: 'paid-model',
            timeoutMs: 10_000,
            cost: { promptTokenUsd: 0.000_01, completionTokenUsd: 0.000_03 },
        };
        const client = new StorytellerModelClient({ default: endpointWithCost });
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        // 1000 * 0.00001 + 500 * 0.00003 = 0.01 + 0.015 = 0.025
        expect(dispatch.estimatedCostUsd).toBeCloseTo(0.025, 5);
    });

    it('needsReview is false when verifier passes', async () => {
        const { digest, refs } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse(validDispatchJson([refs.gpEarned])));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.needsReview).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Verifier integration
// ---------------------------------------------------------------------------

describe('StorytellerModelClient.run — verifier integration', () => {
    it('sets needsReview when dispatch references unknown event refs', async () => {
        const { digest } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse(validDispatchJson(['nonexistent-ref-xyz'])));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.needsReview).toBe(true);
        expect(dispatch.reviewReasons).toEqual(expect.arrayContaining([expect.stringContaining('nonexistent-ref-xyz')]));
    });

    it('sets needsReview when public text claims death without evidence', async () => {
        const { digest } = buildFixtureDigest();
        const dispatchJson = JSON.stringify({
            publicTitle: 'Tragic News',
            publicBody: 'Alice died today in Null City.',
            publicBullets: [],
            operatorSummary: 'A resident perished.',
            operatorWarnings: [],
            eventRefsUsed: [],
        });
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse(dispatchJson));

        const client = new StorytellerModelClient(makeEndpoints());
        // Use a digest that has no fade evidence
        const emptyDigest = {
            ...digest,
            apEvents: [],
            residents: digest.residents.map(r => ({ ...r, isFaded: false })),
        };
        const dispatch = await client.run(emptyDigest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.needsReview).toBe(true);
        expect(dispatch.reviewReasons).toEqual(expect.arrayContaining([expect.stringContaining('death or fade')]));
    });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('StorytellerModelClient.run — error handling', () => {
    it('returns needsReview dispatch when model returns non-JSON', async () => {
        const { digest } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse('not json at all'));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.needsReview).toBe(true);
        expect(dispatch.reviewReasons).toEqual(expect.arrayContaining([expect.stringContaining('non-JSON')]));
        expect(dispatch.publicTitle).toBeTruthy(); // fallback placeholder
    });

    it('returns needsReview dispatch when model call is nooped', async () => {
        // No baseUrl → LlmClient returns nooped response
        const noopEndpoints: Record<string, LlmEndpointConfig> = {
            default: { timeoutMs: 10_000 },
        };
        const { digest } = buildFixtureDigest();
        const knownRefs = new Set(
            [
                ...digest.apEvents,
                ...digest.gpEvents,
                ...digest.exchangeEvents,
                ...digest.ncriEvents,
                ...digest.goalEvents,
                ...digest.stuckEvents,
                ...digest.miscEvents,
            ].map(event => event.ref),
        );

        const client = new StorytellerModelClient(noopEndpoints);
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.needsReview).toBe(true);
        expect(dispatch.reviewReasons).toEqual(expect.arrayContaining([expect.stringContaining('nooped')]));
        expect(dispatch.reviewReasons?.some(reason => reason.includes('death or fade'))).toBe(false);
        expect(dispatch.publicTitle).not.toBe('(no title generated)');
        expect(dispatch.publicBody).not.toBe('(no body generated)');
        expect(dispatch.publicBody).toMatch(/AP|GP|NCRI|resident/i);
        expect(dispatch.publicBullets.length).toBeGreaterThan(0);
        expect(dispatch.eventRefsUsed.length).toBeGreaterThan(0);
        expect(dispatch.eventRefsUsed.every(ref => knownRefs.has(ref))).toBe(true);
    });

    it('prefers meaningful exchange evidence over zero-GP observation noise in nooped fallback copy', async () => {
        const noopEndpoints: Record<string, LlmEndpointConfig> = {
            default: { timeoutMs: 10_000 },
        };
        const { digest, refs } = buildFixtureDigest();
        const zeroGpEvents = Array.from({ length: 5 }, (_, index) => ({
            ref: `zero-gp-${index}`,
            kind: 'gp_observed' as const,
            residentName: `res:quiet-${index}`,
            ts: `2026-05-29T05:50:0${index}.000Z`,
            note: 'observed 0 GP in item 995',
            importance: 'high' as const,
            evidence: { itemId: 995, amount: 0 },
        }));
        const noisyDigest = {
            ...digest,
            gpEvents: [...zeroGpEvents, ...digest.gpEvents],
            topEvents: [...zeroGpEvents, digest.exchangeEvents[0]],
        };

        const client = new StorytellerModelClient(noopEndpoints);
        const dispatch = await client.run(noisyDigest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.eventRefsUsed).toContain(refs.exchange);
        expect(dispatch.publicBody).toContain('traded 200 GP for 50 AP');
        expect(dispatch.publicBullets.filter(bullet => bullet.includes('observed 0 GP'))).toHaveLength(0);
    });

    it('redacts human and patron handles in nooped fallback public copy', async () => {
        const noopEndpoints: Record<string, LlmEndpointConfig> = {
            default: { timeoutMs: 10_000 },
        };
        const { digest } = buildFixtureDigest();
        const sensitiveNcriEvent = {
            ...digest.ncriEvents[0],
            note: 'NCRI Kindling Relic transferred to human:event-demo by patron:james.',
        };
        const sensitiveDigest = {
            ...digest,
            ncriEvents: [sensitiveNcriEvent],
            topEvents: [sensitiveNcriEvent],
        };

        const client = new StorytellerModelClient(noopEndpoints);
        const dispatch = await client.run(sensitiveDigest, DEFAULT_STORYTELLER_CONFIG);
        const publicText = [dispatch.publicTitle, dispatch.publicBody, ...dispatch.publicBullets].join(' ');

        expect(publicText).not.toContain('human:event-demo');
        expect(publicText).not.toContain('patron:james');
        expect(publicText).toContain('a human');
        expect(publicText).toContain('a patron');
    });

    it('returns needsReview dispatch when model returns empty JSON object', async () => {
        const { digest } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse('{}'));

        const client = new StorytellerModelClient(makeEndpoints());
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(dispatch.publicTitle).toBe('(no title generated)');
        expect(dispatch.publicBody).toBe('(no body generated)');
    });

    it('uses the requested modelProfile in the dispatch', async () => {
        const { digest, refs } = buildFixtureDigest();
        global.fetch = jest.fn().mockResolvedValueOnce(completionResponse(validDispatchJson([refs.apLow])));

        const endpoints: Record<string, LlmEndpointConfig> = {
            'storyteller-v1': { baseUrl: FIXTURE_BASE_URL, model: 'storyteller-model', timeoutMs: 10_000 },
        };
        const client = new StorytellerModelClient(endpoints);
        const dispatch = await client.run(digest, DEFAULT_STORYTELLER_CONFIG, { modelProfile: 'storyteller-v1' });

        expect(dispatch.modelProfile).toBe('storyteller-v1');
    });
});
