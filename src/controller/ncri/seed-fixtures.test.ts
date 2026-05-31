import fs from 'fs';
import os from 'os';
import path from 'path';
import { NcriPricingStore } from './ncri-pricing-store';
import { NcriRegistry } from './ncri-registry';
import { DEFAULT_NCRI_SEED_FIXTURES, seedNcriFixtures } from './seed-fixtures';

describe('DEFAULT_NCRI_SEED_FIXTURES', () => {
    it('ships the three default S-NCRI-4 starter items with real OSRS item ids', () => {
        expect(DEFAULT_NCRI_SEED_FIXTURES.map(fixture => fixture.fixtureId)).toEqual([
            'bronze-sword-first-light',
            'tinderbox-of-the-flame',
            'small-fishing-net-of-first-catch',
        ]);
        expect(DEFAULT_NCRI_SEED_FIXTURES.map(fixture => fixture.itemId)).toEqual([1277, 590, 303]);
        expect(DEFAULT_NCRI_SEED_FIXTURES.every(fixture => fixture.apPrice > 0 && fixture.gpRedemptionCost > 0)).toBe(true);
    });
});

describe('seedNcriFixtures', () => {
    let memoryRoot: string;

    beforeEach(() => {
        memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-seed-'));
    });

    afterEach(() => {
        fs.rmSync(memoryRoot, { recursive: true, force: true });
    });

    it('creates, approves, prices, and lists the default seed NCRIs', () => {
        const seeded = seedNcriFixtures({ memoryRoot, now: () => new Date('2026-05-30T19:30:00.000Z') });

        expect(seeded).toHaveLength(3);
        expect(seeded.every(result => result.created)).toBe(true);
        expect(seeded.every(result => result.record.approvalStatus === 'approved')).toBe(true);
        expect(seeded.every(result => result.record.saleStatus === 'listed')).toBe(true);
        expect(seeded.every(result => result.pricing.pricingMode === 'admin-fixed')).toBe(true);

        const registry = new NcriRegistry(memoryRoot);
        expect(registry.list().map(record => record.displayName)).toEqual([
            'Bronze Sword of First Light',
            'Tinderbox of the Flame',
            'Small Fishing Net of First Catch',
        ]);
        const pricing = new NcriPricingStore(memoryRoot);
        expect(pricing.allLatest().size).toBe(3);
    });

    it('is idempotent by fixture tag instead of creating duplicate seed records', () => {
        seedNcriFixtures({ memoryRoot, now: () => new Date('2026-05-30T19:30:00.000Z') });
        const second = seedNcriFixtures({ memoryRoot, now: () => new Date('2026-05-30T19:31:00.000Z') });

        expect(second.every(result => result.created === false)).toBe(true);
        const registry = new NcriRegistry(memoryRoot);
        expect(registry.list()).toHaveLength(3);
    });
});
