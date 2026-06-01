import fs from 'fs';
import os from 'os';
import path from 'path';
import { NcriPricingStore } from './ncri-pricing-store';

function makeStore(): { store: NcriPricingStore; memoryRoot: string } {
    const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-pricing-'));
    const store = new NcriPricingStore(memoryRoot, () => new Date('2026-05-30T20:00:00.000Z'));
    return { store, memoryRoot };
}

describe('NcriPricingStore.setPrice', () => {
    it('persists a pricing row and returns the record', () => {
        const { store } = makeStore();
        const result = store.setPrice('ncri-abc', {
            pricingMode: 'admin-fixed',
            apPrice: 150,
            gpRedemptionCost: 500,
        });
        expect(result.ncriId).toBe('ncri-abc');
        expect(result.pricingMode).toBe('admin-fixed');
        expect(result.apPrice).toBe(150);
        expect(result.gpRedemptionCost).toBe(500);
        expect(result.setAt).toBe('2026-05-30T20:00:00.000Z');
    });

    it('stores optional setBy, floor, ceiling', () => {
        const { store } = makeStore();
        const result = store.setPrice('ncri-xyz', {
            pricingMode: 'resident-quoted',
            apPrice: 200,
            gpRedemptionCost: 1000,
            setBy: 'admin-james',
            floor: 100,
            ceiling: 500,
        });
        expect(result.setBy).toBe('admin-james');
        expect(result.floor).toBe(100);
        expect(result.ceiling).toBe(500);
    });

    it('defaults pricingMode to admin-fixed when omitted', () => {
        const { store } = makeStore();
        const result = store.setPrice('ncri-def', {
            apPrice: 75,
            gpRedemptionCost: 250,
        });
        expect(result.pricingMode).toBe('admin-fixed');
    });

    it('rejects negative apPrice', () => {
        const { store } = makeStore();
        expect(() =>
            store.setPrice('ncri-abc', {
                apPrice: -1,
                gpRedemptionCost: 100,
            }),
        ).toThrow();
    });

    it('rejects non-integer apPrice', () => {
        const { store } = makeStore();
        expect(() =>
            store.setPrice('ncri-abc', {
                apPrice: 10.5,
                gpRedemptionCost: 100,
            }),
        ).toThrow();
    });

    it('rejects empty ncriId', () => {
        const { store } = makeStore();
        expect(() =>
            store.setPrice('', {
                apPrice: 100,
                gpRedemptionCost: 100,
            }),
        ).toThrow();
    });

    it('persists rows to disk (pricing.jsonl)', () => {
        const { store, memoryRoot } = makeStore();
        store.setPrice('ncri-disk', { apPrice: 50, gpRedemptionCost: 100 });
        const pricingPath = path.join(memoryRoot, 'city-integration', 'ncri', 'pricing.jsonl');
        expect(fs.existsSync(pricingPath)).toBe(true);
        const lines = fs.readFileSync(pricingPath, 'utf8').split('\n').filter(Boolean);
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.ncriId).toBe('ncri-disk');
    });
});

describe('NcriPricingStore.latestPrice', () => {
    it('returns undefined for an ncriId that has never been priced', () => {
        const { store } = makeStore();
        expect(store.latestPrice('ncri-never')).toBeUndefined();
    });

    it('returns the only row if just one', () => {
        const { store } = makeStore();
        store.setPrice('ncri-solo', { apPrice: 100, gpRedemptionCost: 200 });
        const latest = store.latestPrice('ncri-solo');
        expect(latest?.apPrice).toBe(100);
    });

    it('returns the last row when multiple rows exist (price update)', () => {
        const { store } = makeStore();
        store.setPrice('ncri-multi', { apPrice: 100, gpRedemptionCost: 200 });
        store.setPrice('ncri-multi', { apPrice: 150, gpRedemptionCost: 300 });
        const latest = store.latestPrice('ncri-multi');
        expect(latest?.apPrice).toBe(150);
        expect(latest?.gpRedemptionCost).toBe(300);
    });

    it('does not confuse rows from different ncriIds', () => {
        const { store } = makeStore();
        store.setPrice('ncri-a', { apPrice: 10, gpRedemptionCost: 20 });
        store.setPrice('ncri-b', { apPrice: 99, gpRedemptionCost: 199 });
        expect(store.latestPrice('ncri-a')?.apPrice).toBe(10);
        expect(store.latestPrice('ncri-b')?.apPrice).toBe(99);
    });

    it('survives a round-trip (persisted then reloaded)', () => {
        const { memoryRoot } = makeStore();
        const storeA = new NcriPricingStore(memoryRoot, () => new Date('2026-05-30T20:00:00.000Z'));
        storeA.setPrice('ncri-rt', { apPrice: 77, gpRedemptionCost: 333 });

        const storeB = new NcriPricingStore(memoryRoot, () => new Date());
        expect(storeB.latestPrice('ncri-rt')?.apPrice).toBe(77);
    });
});

describe('NcriPricingStore.allLatest', () => {
    it('returns empty map when no rows exist', () => {
        const { store } = makeStore();
        expect(store.allLatest().size).toBe(0);
    });

    it('returns one entry per ncriId (latest wins)', () => {
        const { store } = makeStore();
        store.setPrice('ncri-1', { apPrice: 10, gpRedemptionCost: 20 });
        store.setPrice('ncri-2', { apPrice: 50, gpRedemptionCost: 100 });
        store.setPrice('ncri-1', { apPrice: 15, gpRedemptionCost: 25 });
        const map = store.allLatest();
        expect(map.size).toBe(2);
        expect(map.get('ncri-1')?.apPrice).toBe(15);
        expect(map.get('ncri-2')?.apPrice).toBe(50);
    });
});
