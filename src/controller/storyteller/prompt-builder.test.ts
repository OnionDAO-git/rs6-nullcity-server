import { buildFixtureDigest, resetRefCounter } from './digest-builder';
import { buildStorytellerPrompt } from './prompt-builder';
import { DEFAULT_STORYTELLER_CONFIG } from './types';

beforeEach(() => {
    resetRefCounter();
});

describe('buildStorytellerPrompt — AP/GP vocabulary', () => {
    it('uses AP / Attention Points vocabulary, not Shards', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(prompt).toMatch(/AP/);
        expect(prompt).toMatch(/Attention Points/i);
        expect(prompt).not.toMatch(/\bShards\b/);
    });

    it('explains GP as real RuneScape gold, not a Null City ledger', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);

        expect(prompt).toMatch(/GP/);
        expect(prompt).toMatch(/RuneScape/i);
        expect(prompt).toMatch(/coin item 995|real.*gold|995/i);
        expect(prompt).not.toMatch(/GP ledger/i);
    });
});

describe('buildStorytellerPrompt — required output fields', () => {
    it('requests publicTitle in the output schema', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain('publicTitle');
    });

    it('requests publicBody in the output schema', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain('publicBody');
    });

    it('requests publicBullets in the output schema', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain('publicBullets');
    });

    it('requests operatorSummary in the output schema', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain('operatorSummary');
    });

    it('requests operatorWarnings in the output schema', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain('operatorWarnings');
    });

    it('requests eventRefsUsed in the output schema', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain('eventRefsUsed');
    });
});

describe('buildStorytellerPrompt — digest context', () => {
    it('includes window start and end bounds', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain(digest.windowStart);
        expect(prompt).toContain(digest.windowEnd);
    });

    it('includes resident names from the digest', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        for (const r of digest.residents) {
            expect(prompt).toContain(r.residentName);
        }
    });

    it('includes top event notes from the digest', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        // At least the highest-importance events should appear
        expect(digest.topEvents.length).toBeGreaterThan(0);
        // The prompt should mention at least the first top-event note or ref
        const firstTopEvent = digest.topEvents[0];
        expect(prompt).toContain(firstTopEvent.ref);
    });

    it('includes the digest system health counts', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toContain(String(digest.systemHealth.totalResidents));
    });

    it('includes maxPublicBodyWords constraint from config', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, { ...DEFAULT_STORYTELLER_CONFIG, maxPublicBodyWords: 180 });
        expect(prompt).toContain('180');
    });
});

describe('buildStorytellerPrompt — no-invent rule', () => {
    it('instructs the model not to invent facts', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toMatch(/do not invent|only.*digest|no.*fabricat/i);
    });

    it('instructs the model to only cite refs from the digest', () => {
        const { digest } = buildFixtureDigest();
        const prompt = buildStorytellerPrompt(digest, DEFAULT_STORYTELLER_CONFIG);
        expect(prompt).toMatch(/eventRefsUsed.*digest|only.*refs.*digest|refs.*provided/i);
    });
});
