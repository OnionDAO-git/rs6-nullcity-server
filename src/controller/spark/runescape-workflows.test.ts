import {
    SUPPORTED_WORKFLOWS,
    type WorkflowActor,
    type WorkflowCard,
    type WorkflowItem,
    hasSmallFishingNet,
    hasWoodcuttingAxe,
    isBones,
    isFiremakingLog,
    isFishingSpot,
    isSafeBoneSource,
    isSafeCombatTarget,
    isSmallFishingNet,
    isStarterRawFish,
    isTinderbox,
    isWoodcuttingAxe,
} from './runescape-workflows';

const item = (itemId: number, key?: string, amount = 1): WorkflowItem => ({ itemId, key, amount });

const actor = (overrides: Partial<WorkflowActor>): WorkflowActor => ({
    id: 'actor-1',
    kind: 'npc',
    hpFraction: 1,
    ...overrides,
});

describe('runescape-workflows item-type predicates', () => {
    describe('isTinderbox', () => {
        it('matches the canonical tinderbox itemId (590)', () => {
            expect(isTinderbox(item(590))).toBe(true);
        });

        it('matches by key when item id is unknown', () => {
            expect(isTinderbox(item(99999, 'rs:tinderbox'))).toBe(true);
            expect(isTinderbox(item(99999, 'TINDERBOX'))).toBe(true);
        });

        it('rejects unrelated items', () => {
            expect(isTinderbox(item(995, 'rs:coins'))).toBe(false);
            expect(isTinderbox(item(1511, 'rs:logs'))).toBe(false);
        });
    });

    describe('isFiremakingLog', () => {
        it('matches canonical log itemIds', () => {
            for (const id of [1511, 2862, 1521, 1519, 6333, 1517, 6332, 1515, 1513]) {
                expect(isFiremakingLog(item(id))).toBe(true);
            }
        });

        it('matches rs:logs and *_logs keys', () => {
            expect(isFiremakingLog(item(99999, 'rs:logs'))).toBe(true);
            expect(isFiremakingLog(item(99999, 'rs:oak_logs'))).toBe(true);
            expect(isFiremakingLog(item(99999, 'rs:maple_logs'))).toBe(true);
        });

        it('rejects non-log items', () => {
            expect(isFiremakingLog(item(590, 'rs:tinderbox'))).toBe(false);
            expect(isFiremakingLog(item(995, 'rs:coins'))).toBe(false);
        });
    });

    describe('isWoodcuttingAxe', () => {
        it('matches canonical axe itemIds', () => {
            for (const id of [1351, 1349, 1353, 1361, 1355, 1357, 1359]) {
                expect(isWoodcuttingAxe(item(id))).toBe(true);
            }
        });

        it('matches keys containing the words axe/hatchet at word boundaries', () => {
            expect(isWoodcuttingAxe(item(99999, 'rs:bronze axe'))).toBe(true);
            expect(isWoodcuttingAxe(item(99999, 'iron hatchet'))).toBe(true);
            // Underscore is not a word boundary, so `iron_hatchet` does NOT match —
            // the canonical itemIds carry that workload; this is preserved verbatim
            // from the monolith.
            expect(isWoodcuttingAxe(item(99999, 'iron_hatchet'))).toBe(false);
        });

        it('rejects non-axe items', () => {
            expect(isWoodcuttingAxe(item(995, 'rs:coins'))).toBe(false);
        });
    });

    describe('isSmallFishingNet', () => {
        it('matches the canonical small fishing net itemId (303)', () => {
            expect(isSmallFishingNet(item(303))).toBe(true);
        });

        it('matches by key variants', () => {
            expect(isSmallFishingNet(item(99999, 'rs:small_fishing_net'))).toBe(true);
            expect(isSmallFishingNet(item(99999, 'small_net'))).toBe(true);
        });

        it('rejects unrelated items', () => {
            expect(isSmallFishingNet(item(995, 'rs:coins'))).toBe(false);
        });
    });

    describe('isStarterRawFish', () => {
        it('matches raw shrimp and raw anchovies itemIds', () => {
            expect(isStarterRawFish(item(317))).toBe(true);
            expect(isStarterRawFish(item(321))).toBe(true);
        });

        it('matches by key pattern', () => {
            expect(isStarterRawFish(item(99999, 'rs:raw_shrimp'))).toBe(true);
            expect(isStarterRawFish(item(99999, 'rs:raw_anchovies'))).toBe(true);
        });

        it('rejects cooked or unrelated fish', () => {
            expect(isStarterRawFish(item(99999, 'rs:shrimp'))).toBe(false);
            expect(isStarterRawFish(item(99999, 'rs:raw_lobster'))).toBe(false);
        });
    });

    describe('isBones', () => {
        it('matches canonical bone itemIds', () => {
            expect(isBones(item(526))).toBe(true);
            expect(isBones(item(532))).toBe(true);
            expect(isBones(item(6729))).toBe(true);
        });

        it('matches by key pattern', () => {
            expect(isBones(item(99999, 'rs:bones'))).toBe(true);
            expect(isBones(item(99999, 'rs:big_bones'))).toBe(true);
            expect(isBones(item(99999, 'rs:bones_dragon'))).toBe(true);
        });

        it('rejects non-bone items', () => {
            expect(isBones(item(995, 'rs:coins'))).toBe(false);
            expect(isBones(item(99999, 'rs:bonemeal'))).toBe(false);
        });
    });
});

describe('runescape-workflows inventory predicates', () => {
    it('hasWoodcuttingAxe finds any axe in inventory', () => {
        expect(hasWoodcuttingAxe({ resident: { inventory: [item(1351), null] } })).toBe(true);
        expect(hasWoodcuttingAxe({ resident: { inventory: [null, null, item(99999, 'rs:bronze axe')] } })).toBe(true);
    });

    it('hasWoodcuttingAxe returns false on an empty or axe-less inventory', () => {
        expect(hasWoodcuttingAxe({ resident: { inventory: [] } })).toBe(false);
        expect(hasWoodcuttingAxe({ resident: { inventory: [item(995, 'rs:coins')] } })).toBe(false);
        expect(hasWoodcuttingAxe({})).toBe(false);
    });

    it('hasSmallFishingNet finds the net by itemId or key', () => {
        expect(hasSmallFishingNet({ resident: { inventory: [item(303)] } })).toBe(true);
        expect(hasSmallFishingNet({ resident: { inventory: [item(99999, 'rs:small_fishing_net')] } })).toBe(true);
    });

    it('hasSmallFishingNet returns false when absent', () => {
        expect(hasSmallFishingNet({ resident: { inventory: [item(995)] } })).toBe(false);
        expect(hasSmallFishingNet({})).toBe(false);
    });

    it('hasWoodcuttingAxe ignores null inventory slots', () => {
        expect(hasWoodcuttingAxe({ resident: { inventory: [null, null, null] } })).toBe(false);
    });
});

describe('runescape-workflows actor predicates', () => {
    describe('isFishingSpot', () => {
        it('matches actors whose name contains "fishing spot"', () => {
            expect(isFishingSpot(actor({ name: 'Fishing spot' }))).toBe(true);
            expect(isFishingSpot(actor({ key: 'rs:fishing spot net' }))).toBe(true);
        });

        it('rejects actors without a fishing-spot label', () => {
            expect(isFishingSpot(actor({ name: 'Goblin' }))).toBe(false);
            expect(isFishingSpot(actor({ id: 'fish-1' }))).toBe(false);
        });
    });

    describe('isSafeBoneSource', () => {
        it('matches safe NPCs by name', () => {
            expect(isSafeBoneSource(actor({ name: 'Chicken' }))).toBe(true);
            expect(isSafeBoneSource(actor({ name: 'Cow' }))).toBe(true);
            expect(isSafeBoneSource(actor({ name: 'Goblin' }))).toBe(true);
            expect(isSafeBoneSource(actor({ name: 'Man' }))).toBe(true);
        });

        it('rejects players and dead actors', () => {
            expect(isSafeBoneSource(actor({ kind: 'player', name: 'Chicken' }))).toBe(false);
            expect(isSafeBoneSource(actor({ name: 'Cow', hpFraction: 0 }))).toBe(false);
        });

        it('rejects unsafe NPCs', () => {
            expect(isSafeBoneSource(actor({ name: 'Black dragon' }))).toBe(false);
            expect(isSafeBoneSource(actor({ name: 'Hill giant' }))).toBe(false);
        });
    });

    describe('isSafeCombatTarget', () => {
        it('matches the canonical safe targets', () => {
            expect(isSafeCombatTarget(actor({ name: 'Chicken' }))).toBe(true);
            expect(isSafeCombatTarget(actor({ name: 'Cow' }))).toBe(true);
            expect(isSafeCombatTarget(actor({ name: 'Rat' }))).toBe(true);
            expect(isSafeCombatTarget(actor({ name: 'Giant rat' }))).toBe(true);
            expect(isSafeCombatTarget(actor({ name: 'Goblin' }))).toBe(true);
        });

        it('rejects humanoid NPCs that bone-sources allow but combat does NOT', () => {
            // Behavior parity: SAFE_BONE_SOURCE_PATTERN admits man/woman/spider; the
            // narrower SAFE_COMBAT_TARGET_PATTERN does not.
            expect(isSafeCombatTarget(actor({ name: 'Man' }))).toBe(false);
            expect(isSafeCombatTarget(actor({ name: 'Spider' }))).toBe(false);
        });

        it('rejects dead actors and players', () => {
            expect(isSafeCombatTarget(actor({ name: 'Goblin', hpFraction: 0 }))).toBe(false);
            expect(isSafeCombatTarget(actor({ kind: 'player', name: 'Goblin' }))).toBe(false);
        });
    });
});

describe('runescape-workflows card re-export surface', () => {
    it('re-exports SUPPORTED_WORKFLOWS from runebench-playbook (single import point)', () => {
        expect(Array.isArray(SUPPORTED_WORKFLOWS)).toBe(true);
        expect(SUPPORTED_WORKFLOWS.length).toBeGreaterThan(0);
        const ids = SUPPORTED_WORKFLOWS.map(card => card.id);
        expect(ids).toEqual(expect.arrayContaining(['make-fire', 'train-woodcutting', 'safe-combat', 'train-prayer']));
    });

    it('includes the G4 trade-request workflow card', () => {
        const trade = SUPPORTED_WORKFLOWS.find(card => card.id === 'trade-request');
        expect(trade).toBeDefined();
        if (!trade) {
            return;
        }
        expect(trade.actionKinds).toEqual(expect.arrayContaining(['trade_request', 'trade_offer_item', 'trade_accept', 'trade_decline']));
        expect(trade.knowledgeIds).toEqual(expect.arrayContaining(['skill-trading']));
        expect(trade.measurableOutcome.toLowerCase()).toMatch(/trade|inventory|partner/);
    });

    it('every workflow card has the required fields', () => {
        for (const card of SUPPORTED_WORKFLOWS) {
            const typed: WorkflowCard = card;
            expect(typeof typed.id).toBe('string');
            expect(typeof typed.title).toBe('string');
            expect(typeof typed.when).toBe('string');
            expect(Array.isArray(typed.nextSteps)).toBe(true);
            expect(Array.isArray(typed.actionKinds)).toBe(true);
            expect(typeof typed.measurableOutcome).toBe('string');
            expect(Array.isArray(typed.knowledgeIds)).toBe(true);
        }
    });
});
