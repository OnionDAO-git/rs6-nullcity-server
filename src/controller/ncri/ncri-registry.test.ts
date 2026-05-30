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
});
