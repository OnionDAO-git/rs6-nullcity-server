import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomyEventLog } from '../city-integration/economy-event';
import { NcriRegistry, NcriRegistryError, createNcriSchema } from './ncri-registry';

function makeRegistry(): { registry: NcriRegistry; memoryRoot: string } {
    const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-registry-'));
    const registry = new NcriRegistry(memoryRoot, () => new Date('2026-05-29T17:00:00.000Z'));
    return { registry, memoryRoot };
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('NcriRegistry.create', () => {
    it('creates an NCRI record with pending+available status', () => {
        const { registry } = makeRegistry();

        const record = registry.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Forged in the Abyss and blessed by the city.',
            propertyTags: ['combat', 'printable'],
            printable: true,
            owner: 'user-abc',
        });

        expect(record.schemaVersion).toBe(1);
        expect(record.itemId).toBe(4151);
        expect(record.displayName).toBe('Abyssal Whip');
        expect(record.approvalStatus).toBe('pending');
        expect(record.redemptionStatus).toBe('available');
        expect(record.owner).toBe('user-abc');
        expect(record.propertyTags).toEqual(['combat', 'printable']);
        expect(record.printable).toBe(true);
        expect(record.id).toBeTruthy();
        expect(record.createdAt).toBe('2026-05-29T17:00:00.000Z');
    });

    it('persists the record to disk', () => {
        const { registry, memoryRoot } = makeRegistry();

        const record = registry.create({
            itemId: 995,
            displayName: 'Coins',
            lore: 'Standard RuneScape coins.',
            printable: false,
            owner: 'user-xyz',
        });

        const loaded = registry.get(record.id);
        expect(loaded).toEqual(record);

        const ncriDir = path.join(memoryRoot, 'city-integration', 'ncri');
        expect(fs.existsSync(ncriDir)).toBe(true);
    });

    it('rejects invalid (zero) itemId', () => {
        const { registry } = makeRegistry();

        expect(() =>
            registry.create({
                itemId: 0,
                displayName: 'Invalid',
                lore: 'Should not work.',
                printable: false,
                owner: 'user-abc',
            }),
        ).toThrow();
    });

    it('rejects negative itemId', () => {
        const { registry } = makeRegistry();

        expect(() =>
            registry.create({
                itemId: -1,
                displayName: 'Invalid',
                lore: 'Should not work.',
                printable: false,
                owner: 'user-abc',
            }),
        ).toThrow();
    });

    it('applies default empty propertyTags and false printable when omitted', () => {
        const { registry } = makeRegistry();

        const record = registry.create({
            itemId: 1234,
            displayName: 'Mystery Item',
            lore: 'Unknown origin.',
            owner: 'user-abc',
        });

        expect(record.propertyTags).toEqual([]);
        expect(record.printable).toBe(false);
    });

    it('stores printAssetRef when provided', () => {
        const { registry } = makeRegistry();

        const record = registry.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Custom print asset.',
            printable: true,
            printAssetRef: 'assets/prints/whip-v1.svg',
            owner: 'user-abc',
        });

        expect(record.printAssetRef).toBe('assets/prints/whip-v1.svg');
    });
});

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

describe('NcriRegistry.approve', () => {
    it('transitions approvalStatus from pending to approved', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 1040, displayName: 'Mithril Sword', lore: 'Shiny.', printable: false, owner: 'admin' });
        const approved = registry.approve(record.id, 'First admin approval');

        expect(approved.approvalStatus).toBe('approved');
        expect(approved.adminNotes).toBe('First admin approval');
        expect(approved.redemptionStatus).toBe('available');
    });

    it('is idempotent — approving an already-approved NCRI returns the record unchanged', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 1040, displayName: 'Mithril Sword', lore: 'Shiny.', printable: false, owner: 'admin' });
        const first = registry.approve(record.id);
        const second = registry.approve(record.id, 'second approval attempt');

        expect(second.approvalStatus).toBe('approved');
        expect(second.id).toBe(first.id);
    });

    it('throws not_found for unknown id', () => {
        const { registry } = makeRegistry();

        expect(() => registry.approve('nonexistent-id')).toThrow(NcriRegistryError);
        try {
            registry.approve('nonexistent-id');
        } catch (err) {
            expect(err).toBeInstanceOf(NcriRegistryError);
            expect((err as NcriRegistryError).code).toBe('not_found');
        }
    });

    it('persists approval to disk', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 555, displayName: 'Test Item', lore: 'Test.', printable: false, owner: 'admin' });
        registry.approve(record.id);

        const loaded = registry.get(record.id);
        expect(loaded?.approvalStatus).toBe('approved');
    });
});

// ---------------------------------------------------------------------------
// transfer
// ---------------------------------------------------------------------------

describe('NcriRegistry.transfer', () => {
    it('transfers ownership to a new city user', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'admin' });
        registry.approve(record.id);
        const transferred = registry.transfer(record.id, 'user-recipient');

        expect(transferred.owner).toBe('user-recipient');
        expect(transferred.approvalStatus).toBe('approved');
        expect(transferred.redemptionStatus).toBe('available');
        expect(transferred.saleStatus).toBe('unlisted');
    });

    it('rejects transfer of a non-approved (pending) NCRI', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'admin' });

        expect(() => registry.transfer(record.id, 'user-recipient')).toThrow(NcriRegistryError);
        try {
            registry.transfer(record.id, 'user-recipient');
        } catch (err) {
            expect((err as NcriRegistryError).code).toBe('not_approved');
        }
    });

    it('rejects transfer of a redeemed NCRI', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'admin' });
        registry.approve(record.id);
        registry.redeem(record.id);

        expect(() => registry.transfer(record.id, 'user-recipient')).toThrow(NcriRegistryError);
        try {
            registry.transfer(record.id, 'user-recipient');
        } catch (err) {
            expect((err as NcriRegistryError).code).toBe('already_redeemed');
        }
    });

    it('rejects empty newOwner', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'admin' });
        registry.approve(record.id);

        expect(() => registry.transfer(record.id, '')).toThrow(NcriRegistryError);
        try {
            registry.transfer(record.id, '');
        } catch (err) {
            expect((err as NcriRegistryError).code).toBe('invalid_owner');
        }
    });

    it('persists owner change to disk', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'admin' });
        registry.approve(record.id);
        registry.transfer(record.id, 'new-owner-id');

        const loaded = registry.get(record.id);
        expect(loaded?.owner).toBe('new-owner-id');
    });

    it('marks listed NCRIs as sold when transferred with sale reason', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'admin' });
        registry.approve(record.id);
        registry.listForSale(record.id);

        const sold = registry.transfer(record.id, 'user-buyer', { reason: 'sale' });
        expect(sold.saleStatus).toBe('sold');
    });
});

// ---------------------------------------------------------------------------
// redeem
// ---------------------------------------------------------------------------

describe('NcriRegistry.redeem', () => {
    it('transitions redemptionStatus to redeemed and records redeemedAt', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'user-abc' });
        registry.approve(record.id);
        const redeemed = registry.redeem(record.id);

        expect(redeemed.redemptionStatus).toBe('redeemed');
        expect(redeemed.redeemedAt).toBe('2026-05-29T17:00:00.000Z');
    });

    it('is idempotent — redeeming an already-redeemed NCRI returns the record unchanged', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'user-abc' });
        registry.approve(record.id);
        const first = registry.redeem(record.id);
        const second = registry.redeem(record.id);

        expect(second.redemptionStatus).toBe('redeemed');
        expect(second.redeemedAt).toBe(first.redeemedAt);
    });

    it('allows redeeming without prior approval (draft items can be redeemed by admin)', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'user-abc' });
        const redeemed = registry.redeem(record.id);

        expect(redeemed.redemptionStatus).toBe('redeemed');
    });

    it('throws not_found for unknown id', () => {
        const { registry } = makeRegistry();

        expect(() => registry.redeem('nonexistent-id')).toThrow(NcriRegistryError);
        try {
            registry.redeem('nonexistent-id');
        } catch (err) {
            expect((err as NcriRegistryError).code).toBe('not_found');
        }
    });

    it('persists redeemed status to disk', () => {
        const { registry } = makeRegistry();

        const record = registry.create({ itemId: 4151, displayName: 'Whip', lore: 'Test.', printable: false, owner: 'user-abc' });
        registry.redeem(record.id);

        const loaded = registry.get(record.id);
        expect(loaded?.redemptionStatus).toBe('redeemed');
    });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('NcriRegistry.list', () => {
    it('returns empty array when no NCRIs exist', () => {
        const { registry } = makeRegistry();
        expect(registry.list()).toEqual([]);
    });

    it('returns all created records sorted by createdAt', () => {
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-registry-'));
        let tick = 0;
        const registry = new NcriRegistry(memoryRoot, () => {
            tick += 1000;
            return new Date(tick);
        });

        registry.create({ itemId: 4151, displayName: 'Whip', lore: 'First.', printable: false, owner: 'user-a' });
        registry.create({ itemId: 995, displayName: 'Coins', lore: 'Second.', printable: false, owner: 'user-b' });
        registry.create({ itemId: 1040, displayName: 'Sword', lore: 'Third.', printable: false, owner: 'user-c' });

        const all = registry.list();
        expect(all).toHaveLength(3);
        expect(all[0].displayName).toBe('Whip');
        expect(all[1].displayName).toBe('Coins');
        expect(all[2].displayName).toBe('Sword');
    });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('NcriRegistry.get', () => {
    it('returns undefined for unknown id', () => {
        const { registry } = makeRegistry();
        expect(registry.get('unknown-id')).toBeUndefined();
    });

    it('round-trips all fields through disk', () => {
        const { registry } = makeRegistry();

        const record = registry.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Blessed by the city.',
            propertyTags: ['combat', 'printable'],
            printable: true,
            printAssetRef: 'assets/whip.svg',
            owner: 'user-james',
        });
        const loaded = registry.get(record.id);

        expect(loaded).toEqual(record);
    });
});

// ---------------------------------------------------------------------------
// createNcriSchema
// ---------------------------------------------------------------------------

describe('createNcriSchema', () => {
    it('rejects non-integer itemId', () => {
        const result = createNcriSchema.safeParse({
            itemId: 1.5,
            displayName: 'Test',
            lore: 'Test.',
            printable: false,
            owner: 'user',
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
        const result = createNcriSchema.safeParse({ itemId: 4151 });
        expect(result.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// EconomyEventLog emission
// ---------------------------------------------------------------------------

describe('NcriRegistry EconomyEventLog emission', () => {
    let memoryRoot: string;
    let log: EconomyEventLog;
    let registry: NcriRegistry;

    beforeEach(() => {
        memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-emit-'));
        log = new EconomyEventLog(memoryRoot, () => new Date('2026-05-30T01:00:00.000Z'));
        registry = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T01:00:00.000Z'), log);
    });

    afterEach(() => {
        fs.rmSync(memoryRoot, { recursive: true, force: true });
    });

    function createApprovedNcri(owner = 'user-orig'): string {
        const rec = registry.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Forged in the Abyss.',
            printable: true,
            owner,
        });
        registry.approve(rec.id);
        return rec.id;
    }

    it('emits ncri_sale on transfer (ncriId + cityUserId of new owner)', () => {
        const id = createApprovedNcri('user-orig');
        registry.transfer(id, 'user-new');
        const sales = log.readAll().filter(e => e.kind === 'ncri_sale');
        expect(sales).toHaveLength(1);
        expect(sales[0]).toMatchObject({
            kind: 'ncri_sale',
            ncriId: id,
            cityUserId: 'user-new',
        });
        expect(sales[0].refId).toBe(id);
    });

    it('emits ncri_sale when reason="sale" is passed explicitly', () => {
        const id = createApprovedNcri('user-orig');
        registry.transfer(id, 'user-new', { reason: 'sale' });
        const events = log.readAll();
        expect(events.filter(e => e.kind === 'ncri_sale')).toHaveLength(1);
        expect(events.filter(e => e.kind === 'ncri_gift')).toHaveLength(0);
        expect(events.filter(e => e.kind === 'ncri_admin_transfer')).toHaveLength(0);
    });

    it('emits AP-priced ncri_sale metadata when provided by the caller', () => {
        const id = createApprovedNcri('res:duke');
        registry.listForSale(id);
        registry.transfer(id, 'city-user:buyer', {
            reason: 'sale',
            sale: {
                apPrice: 150,
                gpRedemptionCost: 500,
                cityUserId: 'city-user:buyer',
                refId: 'ncri-sale:test-1',
            },
        });
        const sales = log.readAll().filter(e => e.kind === 'ncri_sale');
        expect(sales).toHaveLength(1);
        expect(sales[0]).toMatchObject({
            ncriId: id,
            cityUserId: 'city-user:buyer',
            apDelta: 150,
            refId: 'ncri-sale:test-1',
        });
        expect(sales[0].note).toContain('for 150 AP');
        expect(sales[0].note).toContain('redeem 500 GP');
    });

    it('emits ncri_gift (not ncri_sale) when reason="gift"', () => {
        const id = createApprovedNcri('user-orig');
        registry.transfer(id, 'user-new', { reason: 'gift' });
        const events = log.readAll();
        expect(events.filter(e => e.kind === 'ncri_sale')).toHaveLength(0);
        const gifts = events.filter(e => e.kind === 'ncri_gift');
        expect(gifts).toHaveLength(1);
        expect(gifts[0]).toMatchObject({
            kind: 'ncri_gift',
            ncriId: id,
            cityUserId: 'user-new',
        });
        expect(gifts[0].refId).toBe(id);
    });

    it('emits ncri_admin_transfer (not ncri_sale) when reason="admin_transfer"', () => {
        const id = createApprovedNcri('admin');
        registry.transfer(id, 'user-bob', { reason: 'admin_transfer' });
        const events = log.readAll();
        expect(events.filter(e => e.kind === 'ncri_sale')).toHaveLength(0);
        const admin = events.filter(e => e.kind === 'ncri_admin_transfer');
        expect(admin).toHaveLength(1);
        expect(admin[0]).toMatchObject({
            kind: 'ncri_admin_transfer',
            ncriId: id,
            cityUserId: 'user-bob',
        });
    });

    it('emits ncri_redemption on redeem', () => {
        const id = createApprovedNcri('user-orig');
        registry.redeem(id);
        const redemptions = log.readAll().filter(e => e.kind === 'ncri_redemption');
        expect(redemptions).toHaveLength(1);
        expect(redemptions[0]).toMatchObject({
            kind: 'ncri_redemption',
            ncriId: id,
            cityUserId: 'user-orig',
        });
    });

    it('does not double-emit on idempotent redeem', () => {
        const id = createApprovedNcri('user-orig');
        registry.redeem(id);
        registry.redeem(id);
        const redemptions = log.readAll().filter(e => e.kind === 'ncri_redemption');
        expect(redemptions).toHaveLength(1);
    });

    it('does not emit when economyEventLog is undefined (backward compatible)', () => {
        const registryNoLog = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T01:00:00.000Z'));
        const rec = registryNoLog.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Forged in the Abyss.',
            printable: true,
            owner: 'user-x',
        });
        registryNoLog.approve(rec.id);
        registryNoLog.transfer(rec.id, 'user-y');
        registryNoLog.redeem(rec.id);
        expect(log.readAll()).toHaveLength(0);
    });

    it('does not emit ncri_sale if transfer is a no-op (same owner)', () => {
        // transfer to a different owner first to set things up, then we deliberately
        // call with the same owner — the registry currently still updates updatedAt;
        // verify our check on owner-change does NOT emit if owners match.
        const id = createApprovedNcri('user-orig');
        registry.transfer(id, 'user-orig');
        // The emission guard checks updated.owner !== record.owner; since they match,
        // no ncri_sale should fire.
        expect(log.readAll().filter(e => e.kind === 'ncri_sale')).toHaveLength(0);
    });

    it('rolls back transfer when event append fails', () => {
        const failingLog = {
            append: () => {
                throw new Error('disk_full');
            },
        } as unknown as EconomyEventLog;
        const rollbackRegistry = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T01:00:00.000Z'), failingLog);
        const rec = rollbackRegistry.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Forged in the Abyss.',
            printable: true,
            owner: 'user-x',
        });
        rollbackRegistry.approve(rec.id);
        rollbackRegistry.listForSale(rec.id);

        expect(() => rollbackRegistry.transfer(rec.id, 'user-y', { reason: 'sale' })).toThrow(NcriRegistryError);
        try {
            rollbackRegistry.transfer(rec.id, 'user-y', { reason: 'sale' });
        } catch (error) {
            expect((error as NcriRegistryError).code).toBe('event_append_failed');
        }
        const loaded = rollbackRegistry.get(rec.id);
        expect(loaded?.owner).toBe('user-x');
        expect(loaded?.saleStatus).toBe('listed');
    });
});

// ---------------------------------------------------------------------------
// listForSale / delistFromSale (S-NCRI-1)
// ---------------------------------------------------------------------------

describe('NcriRegistry.listForSale', () => {
    function makeApprovedRegistry() {
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-list-'));
        const registry = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T20:00:00.000Z'));
        const rec = registry.create({
            itemId: 995,
            displayName: 'Coins of the City',
            lore: 'Standard RuneScape coins with Null City lore.',
            printable: false,
            owner: 'city',
        });
        registry.approve(rec.id);
        return { registry, id: rec.id };
    }

    it('transitions saleStatus from unlisted to listed', () => {
        const { registry, id } = makeApprovedRegistry();
        const record = registry.listForSale(id);
        expect(record.saleStatus).toBe('listed');
    });

    it('is idempotent — listing an already-listed NCRI returns it unchanged', () => {
        const { registry, id } = makeApprovedRegistry();
        registry.listForSale(id);
        const record = registry.listForSale(id);
        expect(record.saleStatus).toBe('listed');
    });

    it('persists the listed state to disk', () => {
        const { registry, id } = makeApprovedRegistry();
        registry.listForSale(id);
        const loaded = registry.get(id);
        expect(loaded?.saleStatus).toBe('listed');
    });

    it('rejects listing a pending (not yet approved) NCRI', () => {
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-list-'));
        const registry = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T20:00:00.000Z'));
        const rec = registry.create({
            itemId: 4151,
            displayName: 'Abyssal Whip',
            lore: 'Very rare.',
            printable: true,
            owner: 'res:duke',
        });
        expect(() => registry.listForSale(rec.id)).toThrow(NcriRegistryError);
    });

    it('rejects listing a redeemed NCRI', () => {
        const { registry, id } = makeApprovedRegistry();
        registry.redeem(id);
        expect(() => registry.listForSale(id)).toThrow(NcriRegistryError);
    });

    it('throws not_found for an unknown id', () => {
        const { registry } = makeApprovedRegistry();
        expect(() => registry.listForSale('ncri-does-not-exist')).toThrow(NcriRegistryError);
    });

    it('new records start with saleStatus unlisted', () => {
        const { registry } = makeApprovedRegistry();
        const rec = registry.create({
            itemId: 590,
            displayName: 'Tinderbox',
            lore: 'Lights things on fire.',
            printable: false,
            owner: 'city',
        });
        expect(rec.saleStatus).toBe('unlisted');
    });
});

describe('NcriRegistry.delistFromSale', () => {
    function makeListedRegistry() {
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-delist-'));
        const registry = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T20:00:00.000Z'));
        const rec = registry.create({
            itemId: 590,
            displayName: 'Tinderbox',
            lore: 'For sale.',
            printable: false,
            owner: 'city',
        });
        registry.approve(rec.id);
        registry.listForSale(rec.id);
        return { registry, id: rec.id };
    }

    it('transitions saleStatus from listed to delisted', () => {
        const { registry, id } = makeListedRegistry();
        const record = registry.delistFromSale(id);
        expect(record.saleStatus).toBe('delisted');
    });

    it('persists the delisted state to disk', () => {
        const { registry, id } = makeListedRegistry();
        registry.delistFromSale(id);
        const loaded = registry.get(id);
        expect(loaded?.saleStatus).toBe('delisted');
    });

    it('is safe to call on an unlisted NCRI (no-op)', () => {
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncri-delist-'));
        const registry = new NcriRegistry(memoryRoot, () => new Date('2026-05-30T20:00:00.000Z'));
        const rec = registry.create({
            itemId: 590,
            displayName: 'Tinderbox',
            lore: 'Not listed.',
            printable: false,
            owner: 'city',
        });
        registry.approve(rec.id);
        const result = registry.delistFromSale(rec.id);
        expect(result.saleStatus).toBe('unlisted');
    });

    it('is safe to call on an already-delisted NCRI (no-op)', () => {
        const { registry, id } = makeListedRegistry();
        registry.delistFromSale(id);
        const result = registry.delistFromSale(id);
        expect(result.saleStatus).toBe('delisted');
    });

    it('throws not_found for an unknown id', () => {
        const { registry } = makeListedRegistry();
        expect(() => registry.delistFromSale('ncri-does-not-exist')).toThrow(NcriRegistryError);
    });
});
