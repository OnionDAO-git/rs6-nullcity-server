import { ENGINE_KNOWLEDGE_ENTRIES, formatKnowledgeForPrompt, retrieveKnowledge, enforceKnowledgeBudget, type KnowledgeEntry } from './knowledge-retriever';

describe('RuneScape knowledge retriever', () => {
    it('retrieves firemaking facts for a fire goal', () => {
        const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'make a fire with tinderbox and logs', { limit: 2 });

        expect(results[0]?.entry.id).toBe('skill-firemaking-basic');
        expect(results[0]?.entry.actions).toContain('use_item_on_item');
        expect(results[0]?.entry.requiredItems).toEqual(expect.arrayContaining(['rs:tinderbox', 'rs:logs']));
    });

    it('retrieves fishing methods when the query mentions shrimp and nets', () => {
        const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'catch shrimp with a small net near a fishing spot', { limit: 2 });

        expect(results[0]?.entry.id).toBe('skill-fishing-basic');
        expect(results[0]?.entry.requiredItems).toContain('rs:small_fishing_net');
    });

    it('retrieves safe combat and prayer together for low-level fighting goals', () => {
        const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'fight chickens safely then bury bones', { limit: 3 });
        const ids = results.map(result => result.entry.id);

        expect(ids).toContain('combat-safe-basic');
        expect(ids).toContain('skill-prayer-basic');
    });

    it('formats compact source-labeled prompt context', () => {
        const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'chop tree and light logs', { limit: 2 });
        const formatted = formatKnowledgeForPrompt(results, { maxChars: 1000 });

        expect(formatted).toContain('Skill: Woodcutting');
        expect(formatted).toContain('Skill: Firemaking');
        expect(formatted).toContain('Source:');
        expect(formatted.length).toBeLessThanOrEqual(1000);
    });

    describe('knowledge token budget and overshoot enforcement', () => {
        it('admits within overshoot budget (correct sorting order)', () => {
            const large1: KnowledgeEntry = {
                id: 'large-1',
                title: 'Large Entry 1',
                summary: 'A'.repeat(4000), // 4000 chars = 1000 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };
            const large2: KnowledgeEntry = {
                id: 'large-2',
                title: 'Large Entry 2',
                summary: 'A'.repeat(2400), // 2400 chars = 600 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };
            const large3: KnowledgeEntry = {
                id: 'large-3',
                title: 'Large Entry 3',
                summary: 'A'.repeat(800), // 800 chars = 200 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };

            const entries = [large3, large2, large1];
            const sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title));

            expect(sorted[0].id).toBe('large-1');
            expect(sorted[1].id).toBe('large-2');
            expect(sorted[2].id).toBe('large-3');

            const admitted = enforceKnowledgeBudget(sorted, 1500);

            // large-1 (1000 tokens) + large-2 (600 tokens) = 1600 tokens (overshoot is 100 <= 200) -> Accepted!
            // large-3 (200 tokens) is evaluated but total tokens (1600) already exceeds budget (1500) -> Rejected!
            expect(admitted.map(e => e.id)).toEqual(['large-1', 'large-2']);
            expect(admitted.budgetTrimmed).toBe(true);
            expect(admitted.budgetOvershot).toBe(true);
        });

        it('rejects next entry if the overshoot exceeds 200 tokens', () => {
            const large1: KnowledgeEntry = {
                id: 'large-1',
                title: 'Large Entry 1',
                summary: 'A'.repeat(4000), // 1000 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };
            const large2: KnowledgeEntry = {
                id: 'large-2',
                title: 'Large Entry 2',
                summary: 'A'.repeat(2804), // 2804 chars = 701 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };
            const large3: KnowledgeEntry = {
                id: 'large-3',
                title: 'Large Entry 3',
                summary: 'A'.repeat(800), // 200 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };

            const sorted = [large1, large2, large3];

            const admitted = enforceKnowledgeBudget(sorted, 1500);

            // large-1 (1000 tokens) -> Accepted. Remaining = 500.
            // large-2 (701 tokens) -> cumulative = 1701. Overshoot = 201 > 200 -> Rejected!
            // large-3 (200 tokens) -> cumulative = 1200 <= 1500 -> Accepted!
            expect(admitted.map(e => e.id)).toEqual(['large-1', 'large-3']);
            expect(admitted.budgetTrimmed).toBe(true);
            expect(admitted.budgetOvershot).toBe(false);
        });

        it('admits the first entry even if it exceeds the budget entirely', () => {
            const huge: KnowledgeEntry = {
                id: 'huge',
                title: 'Huge Entry',
                summary: 'A'.repeat(8000), // 2000 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };
            const other: KnowledgeEntry = {
                id: 'other',
                title: 'Other Entry',
                summary: 'A'.repeat(400), // 100 tokens
                topics: [],
                keywords: [],
                source: 'test'
            };

            const admitted = enforceKnowledgeBudget([huge, other], 1500);

            // huge (2000 tokens) is the first entry -> Admitted anyway!
            // other (100 tokens) is subsequent, but current tokens (2000) exceeds budget (1500) -> Rejected!
            expect(admitted.map(e => e.id)).toEqual(['huge']);
            expect(admitted.budgetTrimmed).toBe(true);
            expect(admitted.budgetOvershot).toBe(true);
        });
    });
});
