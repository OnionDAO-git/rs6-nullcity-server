import { ENGINE_KNOWLEDGE_ENTRIES, formatKnowledgeForPrompt, retrieveKnowledge } from './knowledge-retriever';

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
});
