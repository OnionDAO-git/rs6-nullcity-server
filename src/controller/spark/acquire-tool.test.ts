import { acquireWoodcuttingAxeAction, BOB_AXE_SHOP, BRONZE_AXE_ITEM_ID } from './runescape-body-routines';

/**
 * Slice 4 of the resident tool-acquisition feature: the autonomous body routine
 * that makes a tool-less resident bootstrap its own axe (walk to Bob -> open shop
 * -> buy) instead of stalling forever. Decision logic is unit-tested here; the
 * engine buy_from_shop capability shipped in 1455fcba.
 */
function perception(opts: {
    tick?: number;
    pos?: { x: number; y: number; level: number };
    inventory?: Array<{ itemId: number; amount?: number } | null>;
    npcs?: Array<{ key?: string; name?: string; position: { x: number; y: number; level: number } }>;
}): never {
    return {
        tick: opts.tick ?? 100,
        resident: { position: opts.pos ?? { x: 3225, y: 3230, level: 0 }, inventory: opts.inventory ?? [] },
        nearby: { npcs: opts.npcs ?? [] },
    } as never;
}

const COINS = 995;
const bobNear = (pos = { x: 3230, y: 3203, level: 0 }) => [{ key: 'rs:lumbridge_bob', name: 'Bob', position: pos }];

describe('acquireWoodcuttingAxeAction', () => {
    it('defers (undefined) when the resident already has an axe', () => {
        const p = perception({ inventory: [{ itemId: BRONZE_AXE_ITEM_ID }, { itemId: COINS, amount: 100 }] });
        expect(acquireWoodcuttingAxeAction(p)).toBeUndefined();
    });

    it('defers when the resident cannot afford an axe (caller reports blocked)', () => {
        const p = perception({ inventory: [{ itemId: COINS, amount: 5 }] });
        expect(acquireWoodcuttingAxeAction(p)).toBeUndefined();
    });

    it('travels to Bob’s known shop location when Bob is not in perception', () => {
        const p = perception({ inventory: [{ itemId: COINS, amount: 100 }], npcs: [] });
        const action = acquireWoodcuttingAxeAction(p);
        expect(action).toEqual(expect.objectContaining({ kind: 'move_to', target: BOB_AXE_SHOP.position }));
    });

    it('approaches Bob when he is visible but out of interaction range', () => {
        const p = perception({
            pos: { x: 3225, y: 3230, level: 0 },
            inventory: [{ itemId: COINS, amount: 100 }],
            npcs: bobNear({ x: 3230, y: 3203, level: 0 }),
        });
        const action = acquireWoodcuttingAxeAction(p);
        expect(action).toEqual(expect.objectContaining({ kind: 'move_to', target: { x: 3230, y: 3203, level: 0 } }));
    });

    it('opens the shop (interact trade) when adjacent to Bob and the shop is not yet open', () => {
        const p = perception({
            pos: { x: 3230, y: 3203, level: 0 },
            inventory: [{ itemId: COINS, amount: 100 }],
            npcs: bobNear({ x: 3230, y: 3203, level: 0 }),
        });
        const shopState: { lastShopOpenTick?: number } = {};
        const action = acquireWoodcuttingAxeAction(p, shopState);
        expect(action).toEqual(expect.objectContaining({ kind: 'interact', option: 'trade' }));
        expect(shopState.lastShopOpenTick).toBe(100); // records that it opened the shop this tick
    });

    it('buys a bronze axe once the shop has just been opened', () => {
        const p = perception({
            tick: 110,
            pos: { x: 3230, y: 3203, level: 0 },
            inventory: [{ itemId: COINS, amount: 100 }],
            npcs: bobNear({ x: 3230, y: 3203, level: 0 }),
        });
        const action = acquireWoodcuttingAxeAction(p, { lastShopOpenTick: 108 }, 110);
        expect(action).toEqual(expect.objectContaining({ kind: 'buy_from_shop', itemId: BRONZE_AXE_ITEM_ID, quantity: 1 }));
    });
});
