import { DEFAULT_PERCEPTION_BUDGET_CAPS, renderBudgetedPerception, summarizePerceptionForBudget } from './prompt-budget';

function pos(x: number, y: number, level = 0) {
    return { x, y, level };
}

/** Dense embassy-style scene: hundreds of floor objects, many NPCs/items, hot chat event. */
function heavyPerception(objectCount = 598) {
    const objects = Array.from({ length: objectCount }, (_, i) => ({
        objectId: 1276 + (i % 40),
        position: pos(3200 + (i % 30), 3200 + Math.floor(i / 30)),
        orientation: i % 4,
    }));
    const npcs = Array.from({ length: 40 }, (_, i) => ({
        id: `npc:${i}`,
        kind: 'npc',
        name: `Goblin ${i}`,
        position: pos(3210 + i, 3215),
        hpFraction: 1,
        combatLevel: 2,
    }));
    const worldItems = Array.from({ length: 60 }, (_, i) => ({
        itemId: 526 + (i % 10),
        amount: 1,
        position: pos(3208 + i, 3220),
    }));
    return {
        tick: 12345,
        resident: {
            id: 'res:agent',
            position: pos(3222, 3218),
            hp: { current: 7, max: 10 },
            combatLevel: 3,
            inCombat: false,
            inventory: Array.from({ length: 28 }, (_, s) => (s < 5 ? { itemId: 1511 + s, amount: 1 } : null)),
        },
        nearby: { players: [], npcs, worldItems, objects },
        events: [{ kind: 'chat', from: 'player:bob', text: 'hello there friend' }],
    };
}

describe('prompt-budget perception trimming', () => {
    it('caps nearby objects to the configured maximum (a scene can have 500+)', () => {
        const summary = summarizePerceptionForBudget(heavyPerception(598));
        const nearby = (summary.nearby ?? {}) as Record<string, unknown[]>;
        expect((nearby.objects ?? []).length).toBe(DEFAULT_PERCEPTION_BUDGET_CAPS.maxNearbyObjects);
        expect((nearby.npcs ?? []).length).toBe(DEFAULT_PERCEPTION_BUDGET_CAPS.maxNearbyNpcs);
        expect((nearby.worldItems ?? []).length).toBe(DEFAULT_PERCEPTION_BUDGET_CAPS.maxNearbyItems);
    });

    it('keeps the survival spine: resident state, inventory, and events intact', () => {
        const summary = summarizePerceptionForBudget(heavyPerception());
        const resident = summary.resident as Record<string, unknown>;
        expect(resident).toBeDefined();
        expect(resident.hp).toEqual({ current: 7, max: 10 });
        expect(resident.position).toEqual(pos(3222, 3218));
        expect(Array.isArray(resident.inventory)).toBe(true);
        expect(summary.events).toEqual([{ kind: 'chat', from: 'player:bob', text: 'hello there friend' }]);
    });

    it('retains the NEAREST objects by distance, not the first in the list', () => {
        const perception = {
            resident: { position: pos(0, 0) },
            nearby: {
                objects: [
                    { objectId: 1, position: pos(500, 500) }, // far, first in list
                    { objectId: 2, position: pos(1, 0) }, // nearest
                    { objectId: 3, position: pos(2, 0) },
                ],
            },
        };
        const summary = summarizePerceptionForBudget(perception, { maxNearbyObjects: 2 });
        const objects = (summary.nearby as Record<string, Array<{ objectId: number }>>).objects;
        const ids = objects.map(o => o.objectId).sort((a, b) => a - b);
        expect(ids).toEqual([2, 3]); // the two nearest, NOT the far first entry
    });

    it('reports how many nearby entities were elided so the brain knows the scene is denser', () => {
        const summary = summarizePerceptionForBudget(heavyPerception(598));
        const nearby = summary.nearby as Record<string, unknown>;
        expect(typeof nearby.elidedCount).toBe('number');
        expect(nearby.elidedCount as number).toBeGreaterThan(500);
    });

    it('renders a heavy perception well under the char budget', () => {
        const rendered = renderBudgetedPerception(heavyPerception(598));
        expect(rendered.length).toBeLessThanOrEqual(DEFAULT_PERCEPTION_BUDGET_CAPS.summaryBudgetChars);
        // sanity: survival context survived the trim
        expect(rendered).toContain('"hp"');
        expect(rendered).toContain('"events"');
    });

    it('never throws on malformed / empty perception', () => {
        expect(summarizePerceptionForBudget(undefined)).toEqual({});
        expect(summarizePerceptionForBudget(null)).toEqual({});
        expect(summarizePerceptionForBudget('not an object')).toEqual({});
        expect(renderBudgetedPerception(undefined)).toBe('{}');
    });
});
