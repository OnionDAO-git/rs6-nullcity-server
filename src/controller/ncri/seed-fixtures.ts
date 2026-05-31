import { NcriPricingStore, type NcriPricing } from './ncri-pricing-store';
import { NcriRegistry, type NcriRecord, type CreateNcriInput } from './ncri-registry';

export interface NcriSeedFixture {
    fixtureId: string;
    itemId: number;
    displayName: string;
    lore: string;
    propertyTags: string[];
    printable: boolean;
    printAssetRef?: string;
    owner: string;
    apPrice: number;
    gpRedemptionCost: number;
    adminNotes: string;
    setBy: string;
}

export interface SeedNcriFixturesOptions {
    memoryRoot: string;
    now?: () => Date;
    fixtures?: readonly NcriSeedFixture[];
}

export interface SeedNcriFixtureResult {
    fixtureId: string;
    ncriId: string;
    created: boolean;
    priced: boolean;
    record: NcriRecord;
    pricing: NcriPricing;
}

export const DEFAULT_NCRI_SEED_FIXTURES: readonly NcriSeedFixture[] = [
    {
        fixtureId: 'bronze-sword-first-light',
        itemId: 1277,
        displayName: 'Bronze Sword of First Light',
        lore: 'A humble bronze blade, kept for the first citizen who proves courage before skill.',
        propertyTags: ['combat', 'starter', 'seed:sncri4'],
        printable: true,
        printAssetRef: 'prints/ncri/bronze-sword-first-light.glb',
        owner: 'res:duke',
        apPrice: 150,
        gpRedemptionCost: 500,
        adminNotes: 'S-NCRI-4 default seed: starter combat icon.',
        setBy: 's-ncri-4-seed',
    },
    {
        fixtureId: 'tinderbox-of-the-flame',
        itemId: 590,
        displayName: 'Tinderbox of the Flame',
        lore: 'A practical spark-box for residents who turn ordinary logs into public warmth.',
        propertyTags: ['firemaking', 'starter', 'seed:sncri4'],
        printable: true,
        printAssetRef: 'prints/ncri/tinderbox-of-the-flame.glb',
        owner: 'res:hans',
        apPrice: 125,
        gpRedemptionCost: 500,
        adminNotes: 'S-NCRI-4 default seed: firemaking icon.',
        setBy: 's-ncri-4-seed',
    },
    {
        fixtureId: 'small-fishing-net-of-first-catch',
        itemId: 303,
        displayName: 'Small Fishing Net of First Catch',
        lore: 'A net for the first meal pulled honestly from Null City water.',
        propertyTags: ['fishing', 'starter', 'seed:sncri4'],
        printable: true,
        printAssetRef: 'prints/ncri/small-fishing-net-of-first-catch.glb',
        owner: 'res:pip',
        apPrice: 125,
        gpRedemptionCost: 500,
        adminNotes: 'S-NCRI-4 default seed: fishing icon.',
        setBy: 's-ncri-4-seed',
    },
];

export function ncriSeedTag(fixtureId: string): string {
    return `seed:${fixtureId}`;
}

export function seedNcriFixtures(options: SeedNcriFixturesOptions): SeedNcriFixtureResult[] {
    const now = options.now ?? (() => new Date());
    const fixtures = options.fixtures ?? DEFAULT_NCRI_SEED_FIXTURES;
    const registry = new NcriRegistry(options.memoryRoot, now);
    const pricingStore = new NcriPricingStore(options.memoryRoot, now);
    const results: SeedNcriFixtureResult[] = [];

    for (const fixture of fixtures) {
        const tag = ncriSeedTag(fixture.fixtureId);
        const existing = registry.list().find(record => record.propertyTags.includes(tag));
        let record: NcriRecord;
        let created = false;
        if (existing) {
            record = existing;
        } else {
            record = registry.create(toCreateInput(fixture, tag));
            created = true;
        }

        if (record.approvalStatus !== 'approved') {
            record = registry.approve(record.id, fixture.adminNotes);
        }

        const latest = pricingStore.latestPrice(record.id);
        const priceMatches =
            latest?.apPrice === fixture.apPrice &&
            latest.gpRedemptionCost === fixture.gpRedemptionCost &&
            latest.pricingMode === 'admin-fixed';
        const pricing = priceMatches
            ? latest
            : pricingStore.setPrice(record.id, {
                  pricingMode: 'admin-fixed',
                  apPrice: fixture.apPrice,
                  gpRedemptionCost: fixture.gpRedemptionCost,
                  setBy: fixture.setBy,
              });

        if (!isPostSaleState(record.saleStatus) && record.saleStatus !== 'listed') {
            record = registry.listForSale(record.id);
        }

        results.push({
            fixtureId: fixture.fixtureId,
            ncriId: record.id,
            created,
            priced: !priceMatches,
            record,
            pricing,
        });
    }

    return results;
}

function toCreateInput(fixture: NcriSeedFixture, seedTag: string): CreateNcriInput {
    return {
        itemId: fixture.itemId,
        displayName: fixture.displayName,
        lore: fixture.lore,
        propertyTags: [...fixture.propertyTags, seedTag],
        printable: fixture.printable,
        printAssetRef: fixture.printAssetRef,
        owner: fixture.owner,
    };
}

function isPostSaleState(saleStatus: NcriRecord['saleStatus']): boolean {
    return saleStatus === 'sold' || saleStatus === 'awaiting_redemption' || saleStatus === 'redeemed';
}
