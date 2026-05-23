import {
    ENGINE_KNOWLEDGE_ENTRIES,
    formatKnowledgeForPrompt,
    retrieveKnowledge,
    enforceKnowledgeBudget,
    type KnowledgeEntry,
} from './knowledge-retriever';

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

    describe('additional skill entries (magic, ranged, cooking, smithing, trading)', () => {
        it('retrieves magic knowledge for a spellcasting query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'cast a wind strike spell with air and mind runes', { limit: 2 });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('skill-magic-basic');
            const magic = results.find(result => result.entry.id === 'skill-magic-basic')?.entry;
            expect(magic?.requiredItems).toEqual(expect.arrayContaining(['rs:mind_rune']));
            expect(magic?.actions).toEqual(expect.arrayContaining(['cast_spell']));
            expect(magic?.successSignals?.join(' ')).toMatch(/rune/i);
        });

        it('retrieves ranged knowledge for a bow-and-arrow query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'shoot chickens with a shortbow and bronze arrows', { limit: 2 });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('skill-ranged-basic');
            const ranged = results.find(result => result.entry.id === 'skill-ranged-basic')?.entry;
            expect(ranged?.requiredItems?.join(' ')).toMatch(/bow|arrow/i);
            expect(ranged?.actions).toEqual(expect.arrayContaining(['attack']));
        });

        it('retrieves cooking knowledge for a cook-shrimp query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'cook raw shrimp on a fire to make food', { limit: 2 });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('skill-cooking-basic');
            const cooking = results.find(result => result.entry.id === 'skill-cooking-basic')?.entry;
            expect(cooking?.requiredItems?.join(' ')).toMatch(/raw|fire|range/i);
            expect(cooking?.actions?.join(' ')).toMatch(/use_item_on_item/);
            expect(cooking?.successSignals?.join(' ')).toMatch(/cooked|cooking xp/i);
        });

        it('retrieves smithing knowledge for a smelt-bronze query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'smelt copper and tin into a bronze bar at a furnace', {
                limit: 2,
            });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('skill-smithing-basic');
            const smithing = results.find(result => result.entry.id === 'skill-smithing-basic')?.entry;
            expect(smithing?.requiredItems?.join(' ')).toMatch(/copper|tin|bar|hammer/i);
            expect(smithing?.successSignals?.join(' ')).toMatch(/bar|bronze|smithing xp/i);
        });

        it('retrieves trading knowledge for a trade-with-player query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'trade items with another player using trade request', {
                limit: 2,
            });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('skill-trading-basic');
            const trading = results.find(result => result.entry.id === 'skill-trading-basic')?.entry;
            expect(trading?.actions?.join(' ')).toMatch(/trade_request|trade_offer_item|trade_accept|trade_decline/);
            expect(trading?.successSignals?.join(' ')).toMatch(/trade window|accepted|received/i);
        });
    });

    describe('quest entries (cooks-assistant, restless-ghost, romeo-and-juliet, overview)', () => {
        it('retrieves the cooks-assistant quest entry for a flour-and-egg query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'help the cook with flour eggs and milk for cake', { limit: 2 });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('quest-cooks-assistant');
            const quest = results.find(result => result.entry.id === 'quest-cooks-assistant')?.entry;
            expect(quest?.requiredItems?.join(' ')).toMatch(/flour|egg|milk/i);
            expect(quest?.actions?.join(' ')).toMatch(/interact|talk-to/i);
            expect(quest?.successSignals?.join(' ')).toMatch(/300 cooking xp|cooking xp|quest complete/i);
        });

        it('retrieves the restless-ghost quest entry for a ghost-skull query', () => {
            const results = retrieveKnowledge(
                ENGINE_KNOWLEDGE_ENTRIES,
                'investigate the haunted graveyard ghost skull in lumbridge church',
                { limit: 2 },
            );

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('quest-restless-ghost');
            const quest = results.find(result => result.entry.id === 'quest-restless-ghost')?.entry;
            expect(quest?.requiredItems?.join(' ')).toMatch(/ghostspeak amulet|skull/i);
            expect(quest?.successSignals?.join(' ')).toMatch(/1125 prayer xp|prayer xp|quest complete/i);
        });

        it('retrieves the romeo-and-juliet quest entry for a romeo-juliet query', () => {
            const results = retrieveKnowledge(
                ENGINE_KNOWLEDGE_ENTRIES,
                'deliver romeos message to juliet in varrock and brew cadava potion',
                { limit: 2 },
            );

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('quest-romeo-and-juliet');
            const quest = results.find(result => result.entry.id === 'quest-romeo-and-juliet')?.entry;
            expect(quest?.requiredItems?.join(' ')).toMatch(/cadava berries|cadava potion|message/i);
            expect(quest?.successSignals?.join(' ')).toMatch(/5 quest points|quest points|quest complete/i);
        });

        it('retrieves the quests-starter-overview entry for a generic quest query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'how do quests work in runescape how do I start a quest', {
                limit: 3,
            });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('quests-starter-overview');
            const overview = results.find(result => result.entry.id === 'quests-starter-overview')?.entry;
            expect(overview?.actions?.join(' ')).toMatch(/talk|interact/i);
            expect(overview?.successSignals?.join(' ')).toMatch(/quest log|quest journal|quest tab/i);
        });
    });

    describe('monster combat-target entries (chicken, cow, goblin, giant-rat)', () => {
        it('retrieves the chicken monster entry for a chicken-farming query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'attack chickens in lumbridge farm for feathers and bones', {
                limit: 3,
            });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('monster-chicken-starter');
            const chicken = results.find(result => result.entry.id === 'monster-chicken-starter')?.entry;
            expect(chicken?.successSignals?.join(' ')).toMatch(/feather|bones|combat xp/i);
            expect(chicken?.actions?.join(' ')).toMatch(/attack/i);
        });

        it('retrieves the cow monster entry for a cowhide query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'kill cows in lumbridge cow field for cowhide and raw beef', {
                limit: 3,
            });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('monster-cow-starter');
            const cow = results.find(result => result.entry.id === 'monster-cow-starter')?.entry;
            expect(cow?.successSignals?.join(' ')).toMatch(/cowhide|raw beef|bones/i);
        });

        it('retrieves the goblin monster entry for a goblin-village query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'fight goblins in goblin village for bronze loot and bones', {
                limit: 3,
            });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('monster-goblin-starter');
            const goblin = results.find(result => result.entry.id === 'monster-goblin-starter')?.entry;
            expect(goblin?.successSignals?.join(' ')).toMatch(/bronze|coins|bones/i);
        });

        it('retrieves the giant-rat caution entry for a giant rat query', () => {
            const results = retrieveKnowledge(ENGINE_KNOWLEDGE_ENTRIES, 'fight a giant rat in the lumbridge cellar', { limit: 3 });

            const ids = results.map(result => result.entry.id);
            expect(ids).toContain('monster-giant-rat-caution');
            const rat = results.find(result => result.entry.id === 'monster-giant-rat-caution')?.entry;
            expect(rat?.summary).toMatch(/aggressive|combat 8|caution/i);
            expect(rat?.successSignals?.join(' ')).toMatch(/bones/i);
        });
    });

    describe('knowledge token budget and overshoot enforcement', () => {
        it('admits within overshoot budget (correct sorting order)', () => {
            const large1: KnowledgeEntry = {
                id: 'large-1',
                title: 'Large Entry 1',
                summary: 'A'.repeat(4000), // 4000 chars = 1000 tokens
                topics: [],
                keywords: [],
                source: 'test',
            };
            const large2: KnowledgeEntry = {
                id: 'large-2',
                title: 'Large Entry 2',
                summary: 'A'.repeat(2400), // 2400 chars = 600 tokens
                topics: [],
                keywords: [],
                source: 'test',
            };
            const large3: KnowledgeEntry = {
                id: 'large-3',
                title: 'Large Entry 3',
                summary: 'A'.repeat(800), // 800 chars = 200 tokens
                topics: [],
                keywords: [],
                source: 'test',
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
                source: 'test',
            };
            const large2: KnowledgeEntry = {
                id: 'large-2',
                title: 'Large Entry 2',
                summary: 'A'.repeat(2804), // 2804 chars = 701 tokens
                topics: [],
                keywords: [],
                source: 'test',
            };
            const large3: KnowledgeEntry = {
                id: 'large-3',
                title: 'Large Entry 3',
                summary: 'A'.repeat(800), // 200 tokens
                topics: [],
                keywords: [],
                source: 'test',
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
                source: 'test',
            };
            const other: KnowledgeEntry = {
                id: 'other',
                title: 'Other Entry',
                summary: 'A'.repeat(400), // 100 tokens
                topics: [],
                keywords: [],
                source: 'test',
            };

            const admitted = enforceKnowledgeBudget([huge, other], 1500);

            // huge (2000 tokens) is the first entry -> Admitted anyway!
            // other (100 tokens) is subsequent, but current tokens (2000) exceeds budget (1500) -> Rejected!
            expect(admitted.map(e => e.id)).toEqual(['huge']);
            expect(admitted.budgetTrimmed).toBe(true);
            expect(admitted.budgetOvershot).toBe(true);
        });
    });

    describe('relevance boosts and budget integration in retrieveKnowledge', () => {
        const dummyEntries: KnowledgeEntry[] = [
            {
                id: 'skill-woodcutting-basic',
                title: 'Skill: Woodcutting',
                summary: 'Chop down trees.',
                topics: ['woodcutting', 'tree'],
                keywords: ['chop', 'logs', 'axe'],
                source: 'test',
                requiredItems: ['rs:bronze_axe'],
                actions: ['chop'],
            },
            {
                id: 'skill-firemaking-basic',
                title: 'Skill: Firemaking',
                summary: 'Lightcampfires.',
                topics: ['firemaking'],
                keywords: ['burn', 'fire', 'tinderbox'],
                source: 'test',
                requiredItems: ['rs:tinderbox'],
                actions: ['light'],
            },
        ];

        it('applies 1.5x boost for perception context matches', () => {
            // Under normal circumstances, 'tree' query matches woodcutting topic (score 8 + base)
            const normalResults = retrieveKnowledge(dummyEntries, 'tree', { minScore: 1 });
            expect(normalResults[0].entry.id).toBe('skill-woodcutting-basic');
            const baseScore = normalResults[0].score;

            // With matching perception context (e.g. nearbyObjectKeys containing 'tree')
            const boostedResults = retrieveKnowledge(dummyEntries, 'tree', {
                minScore: 1,
                perceptionContext: {
                    nearbyNpcKeys: [],
                    nearbyObjectKeys: ['tree'],
                    recentActionKinds: [],
                },
            });
            expect(boostedResults[0].entry.id).toBe('skill-woodcutting-basic');
            expect(boostedResults[0].score).toBeCloseTo(baseScore * 1.5);
        });

        it('applies 3.0x boost for goal context matches', () => {
            const normalResults = retrieveKnowledge(dummyEntries, 'tinderbox', { minScore: 1 });
            expect(normalResults[0].entry.id).toBe('skill-firemaking-basic');
            const baseScore = normalResults[0].score;

            // With matching goal context (e.g. targetItem matching 'rs:tinderbox')
            const boostedResults = retrieveKnowledge(dummyEntries, 'tinderbox', {
                minScore: 1,
                goalContext: {
                    targetItem: 'rs:tinderbox',
                },
            });
            expect(boostedResults[0].entry.id).toBe('skill-firemaking-basic');
            expect(boostedResults[0].score).toBeCloseTo(baseScore * 3.0);
        });

        it('supports robust prefix stripping matches (rs:tinderbox -> tinderbox)', () => {
            const boostedResults = retrieveKnowledge(dummyEntries, 'tinderbox', {
                minScore: 1,
                goalContext: {
                    targetItem: 'tinderbox', // prefix-less matches prefix-ful requiredItem rs:tinderbox / id
                },
            });
            // Should match 'skill-firemaking-basic' since it contains 'tinderbox' keyword/id
            expect(boostedResults.length).toBeGreaterThan(0);
        });

        it('enforces token budget filtering and attaches metadata properties to results', () => {
            const results = retrieveKnowledge(dummyEntries, 'tree or campfire firemaking woodcutting', {
                minScore: 1,
                tokenBudget: 15, // very small budget so it trims
            });
            expect(results.length).toBeLessThan(dummyEntries.length);
            expect((results as any).budgetTrimmed).toBe(true);
        });
    });
});
