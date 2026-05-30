import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { EconomyEventLog } from '../city-integration/economy-event';

/**
 * NCRI (Null City RuneScape Item) registry.
 *
 * An NCRI is admin-approved metadata bound to a real RuneScape item id.
 * Lifecycle: pending → approved (admin); available → redeemed (owner).
 * Owner transitions require the NCRI to be approved and not yet redeemed.
 *
 * No GP ledger is created here. GP evidence (coin item 995) for sale/redeem
 * pricing lives in the exchange layer (S3). This module is pure metadata +
 * state machine.
 */

export type NcriApprovalStatus = 'pending' | 'approved';
export type NcriRedemptionStatus = 'available' | 'redeemed';
/**
 * Sale lifecycle state. Independent of approval/redemption status.
 * - `unlisted` (default): approved but not yet offered for sale.
 * - `listed`: actively offered for AP purchase on the marketplace.
 * - `delisted`: was listed, then withdrawn without a sale completing.
 * - `sold`: was listed and ownership changed via a sale.
 */
export type NcriSaleStatus = 'unlisted' | 'listed' | 'delisted' | 'sold';

export interface NcriRecord {
    schemaVersion: 1;
    id: string;
    /** Real RuneScape item id (positive integer, e.g. 4151 = Abyssal Whip). */
    itemId: number;
    displayName: string;
    lore: string;
    propertyTags: string[];
    printable: boolean;
    printAssetRef?: string;
    /** cityUserId of the current owner. */
    owner: string;
    /** Resident that originated or sold the NCRI when known. */
    sourceResidentName?: string;
    approvalStatus: NcriApprovalStatus;
    redemptionStatus: NcriRedemptionStatus;
    /** Sale lifecycle. Defaults to `'unlisted'` for records created before S-NCRI-1. */
    saleStatus: NcriSaleStatus;
    adminNotes?: string;
    createdAt: string;
    updatedAt: string;
    redeemedAt?: string;
}

const ncriRecordSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    itemId: z.number().int().positive(),
    displayName: z.string().min(1),
    lore: z.string().min(1),
    propertyTags: z.array(z.string()),
    printable: z.boolean(),
    printAssetRef: z.string().min(1).optional(),
    owner: z.string().min(1),
    sourceResidentName: z
        .string()
        .regex(/^res:[a-z0-9_-]{1,20}$/)
        .optional(),
    approvalStatus: z.enum(['pending', 'approved']),
    redemptionStatus: z.enum(['available', 'redeemed']),
    saleStatus: z.enum(['unlisted', 'listed', 'delisted', 'sold']).default('unlisted'),
    adminNotes: z.string().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    redeemedAt: z.string().min(1).optional(),
});

export const createNcriSchema = z.object({
    itemId: z.number().int().positive('itemId must be a positive integer RuneScape item id'),
    displayName: z.string().min(1),
    lore: z.string().min(1),
    propertyTags: z.array(z.string()).optional(),
    printable: z.boolean().optional(),
    printAssetRef: z.string().min(1).optional(),
    owner: z.string().min(1),
});

export type CreateNcriInput = z.infer<typeof createNcriSchema>;

/**
 * Reason that an NCRI changes hands. Drives which EconomyEvent kind is
 * emitted so the Storyteller substrate never narrates a gift as a sale.
 *
 * - `sale`           → `ncri_sale` (money/AP changed hands; default for back-compat)
 * - `gift`           → `ncri_gift` (resident-to-resident or resident-to-user gift)
 * - `admin_transfer` → `ncri_admin_transfer` (admin assignment, e.g. CIC giveaway)
 *
 * See {@link NcriRegistry.transfer}, F1 in
 * `docs/audit/2026-05-30-substrate-burst-audit.md`, and issue `QA-20260530-011`.
 */
export type NcriTransferReason = 'sale' | 'gift' | 'admin_transfer';

export interface TransferNcriOptions {
    /** Defaults to `'sale'` for backward compatibility with pre-S-AUDIT-FIX-1 callers. */
    reason?: NcriTransferReason;
    /** Optional sale metadata for richer `ncri_sale` economy evidence. */
    sale?: {
        apPrice?: number;
        gpRedemptionCost?: number;
        cityUserId?: string;
        refId?: string;
    };
}

export class NcriRegistryError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'NcriRegistryError';
    }
}

export class NcriRegistry {
    constructor(
        private readonly memoryRoot: string,
        private readonly now: () => Date = () => new Date(),
        private readonly economyEventLog?: EconomyEventLog,
    ) {}

    create(input: CreateNcriInput): NcriRecord {
        const parsed = createNcriSchema.parse(input);
        const id = `ncri-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ts = this.now().toISOString();
        const record: NcriRecord = {
            schemaVersion: 1,
            id,
            itemId: parsed.itemId,
            displayName: parsed.displayName,
            lore: parsed.lore,
            propertyTags: parsed.propertyTags ?? [],
            printable: parsed.printable ?? false,
            printAssetRef: parsed.printAssetRef,
            owner: parsed.owner,
            sourceResidentName: residentOwner(parsed.owner),
            approvalStatus: 'pending',
            redemptionStatus: 'available',
            saleStatus: 'unlisted',
            createdAt: ts,
            updatedAt: ts,
        };
        this.writeRecord(record);
        return record;
    }

    approve(id: string, adminNotes?: string): NcriRecord {
        const record = this.requireRecord(id);
        if (record.approvalStatus === 'approved') {
            return record;
        }
        const ts = this.now().toISOString();
        const updated: NcriRecord = { ...record, approvalStatus: 'approved', adminNotes, updatedAt: ts };
        this.writeRecord(updated);
        return updated;
    }

    /**
     * Mark an approved NCRI as listed for sale on the marketplace.
     * Idempotent: listing an already-listed NCRI returns it unchanged.
     * Requires `approvalStatus === 'approved'` and `redemptionStatus === 'available'`.
     */
    listForSale(id: string): NcriRecord {
        const record = this.requireRecord(id);
        if (record.approvalStatus !== 'approved') {
            throw new NcriRegistryError('not_approved', `cannot list NCRI '${id}' for sale: approvalStatus is '${record.approvalStatus}'`);
        }
        if (record.redemptionStatus === 'redeemed') {
            throw new NcriRegistryError('already_redeemed', `cannot list NCRI '${id}' for sale: already redeemed`);
        }
        if (record.saleStatus === 'listed') {
            return record;
        }
        const ts = this.now().toISOString();
        const updated: NcriRecord = { ...record, saleStatus: 'listed', updatedAt: ts };
        this.writeRecord(updated);
        return updated;
    }

    /**
     * Remove an NCRI from the marketplace. Safe to call on already-delisted
     * or unlisted NCRIs (returns the record unchanged).
     */
    delistFromSale(id: string): NcriRecord {
        const record = this.requireRecord(id);
        if (record.saleStatus !== 'listed') {
            return record;
        }
        const ts = this.now().toISOString();
        const updated: NcriRecord = { ...record, saleStatus: 'delisted', updatedAt: ts };
        this.writeRecord(updated);
        return updated;
    }

    /**
     * Transfer ownership to a new city user. Requires approved + available.
     *
     * `options.reason` decides which EconomyEvent kind is emitted:
     *   - `'sale'` (default) → `ncri_sale`
     *   - `'gift'`           → `ncri_gift`
     *   - `'admin_transfer'` → `ncri_admin_transfer`
     *
     * The default is `'sale'` strictly for backward compatibility with pre-S-AUDIT-FIX-1
     * callers; production call sites should pass an explicit reason so the Storyteller
     * substrate never narrates a gift as a sale (see F1 in
     * `docs/audit/2026-05-30-substrate-burst-audit.md` / issue `QA-20260530-011`).
     */
    transfer(id: string, newOwner: string, options: TransferNcriOptions = {}): NcriRecord {
        if (!newOwner || newOwner.trim().length === 0) {
            throw new NcriRegistryError('invalid_owner', 'newOwner must be a non-empty string');
        }
        const reason: NcriTransferReason = options.reason ?? 'sale';
        const sale = options.sale;
        const record = this.requireRecord(id);
        if (record.approvalStatus !== 'approved') {
            throw new NcriRegistryError('not_approved', `cannot transfer NCRI '${id}' with approvalStatus '${record.approvalStatus}'`);
        }
        if (record.redemptionStatus === 'redeemed') {
            throw new NcriRegistryError('already_redeemed', `cannot transfer NCRI '${id}' after redemption`);
        }
        const ts = this.now().toISOString();
        const ownershipChanged = newOwner !== record.owner;
        const nextSaleStatus: NcriSaleStatus = reason === 'sale' && ownershipChanged && record.saleStatus === 'listed' ? 'sold' : record.saleStatus;
        const updated: NcriRecord = { ...record, owner: newOwner, saleStatus: nextSaleStatus, updatedAt: ts };
        this.writeRecord(updated);

        if (this.economyEventLog && ownershipChanged) {
            try {
                // Map caller-supplied reason → event kind + summary verb so the digest +
                // Storyteller never have to second-guess whether money changed hands.
                const kind = reasonToEventKind(reason);
                const verb = reasonToVerb(reason);
                const saleNoteSuffix =
                    reason === 'sale'
                        ? ` for ${sale?.apPrice ?? '?'} AP${typeof sale?.gpRedemptionCost === 'number' ? ` (redeem ${sale.gpRedemptionCost} GP)` : ''}`
                        : '';
                this.economyEventLog.append({
                    kind,
                    ncriId: updated.id,
                    refId: sale?.refId ?? updated.id,
                    residentName: record.sourceResidentName ?? residentOwner(record.owner),
                    cityUserId: sale?.cityUserId ?? updated.owner,
                    ...(reason === 'sale' && typeof sale?.apPrice === 'number' ? { apDelta: sale.apPrice } : {}),
                    ts: updated.updatedAt,
                    note: `NCRI ${updated.displayName} (${updated.id}) ${verb} to ${updated.owner}${saleNoteSuffix}`,
                });
            } catch (error) {
                // Roll back owner/sale-state mutation if audit event write fails.
                this.writeRecord(record);
                const reasonText = error instanceof Error ? error.message : String(error);
                throw new NcriRegistryError('event_append_failed', `failed to append NCRI transfer event: ${reasonText}`);
            }
        }
        return updated;
    }

    /**
     * Mark the NCRI as redeemed. Idempotent — if already redeemed, returns
     * the existing record without error.
     */
    redeem(id: string): NcriRecord {
        const record = this.requireRecord(id);
        if (record.redemptionStatus === 'redeemed') {
            return record;
        }
        const ts = this.now().toISOString();
        const updated: NcriRecord = { ...record, redemptionStatus: 'redeemed', redeemedAt: ts, updatedAt: ts };
        this.writeRecord(updated);

        if (this.economyEventLog) {
            this.economyEventLog.append({
                kind: 'ncri_redemption',
                ncriId: updated.id,
                refId: updated.id,
                residentName: updated.sourceResidentName ?? residentOwner(updated.owner),
                cityUserId: updated.owner,
                ts: updated.redeemedAt ?? updated.updatedAt,
                note: `NCRI ${updated.displayName} (${updated.id}) redeemed by ${updated.owner}`,
            });
        }
        return updated;
    }

    get(id: string): NcriRecord | undefined {
        const filePath = this.recordPath(id);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        return ncriRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }

    list(): NcriRecord[] {
        const dir = this.ncriDir();
        if (!fs.existsSync(dir)) {
            return [];
        }
        const records: NcriRecord[] = [];
        for (const fname of fs.readdirSync(dir)) {
            if (!fname.endsWith('.json')) continue;
            try {
                const raw = fs.readFileSync(path.join(dir, fname), 'utf8');
                records.push(ncriRecordSchema.parse(JSON.parse(raw)));
            } catch {
                // Skip malformed records
            }
        }
        return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    private requireRecord(id: string): NcriRecord {
        const record = this.get(id);
        if (!record) {
            throw new NcriRegistryError('not_found', `NCRI '${id}' not found`);
        }
        return record;
    }

    private writeRecord(record: NcriRecord): void {
        const filePath = this.recordPath(record.id);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
        fs.renameSync(tmp, filePath);
    }

    private recordPath(id: string): string {
        const safe = id.replace(/[^a-z0-9_-]/gi, '-');
        return path.join(this.ncriDir(), `${safe}.json`);
    }

    private ncriDir(): string {
        return path.join(this.memoryRoot, 'city-integration', 'ncri');
    }
}

function residentOwner(owner: string): string | undefined {
    return /^res:[a-z0-9_-]{1,20}$/.test(owner) ? owner : undefined;
}

function reasonToEventKind(reason: NcriTransferReason): 'ncri_sale' | 'ncri_gift' | 'ncri_admin_transfer' {
    switch (reason) {
        case 'gift':
            return 'ncri_gift';
        case 'admin_transfer':
            return 'ncri_admin_transfer';
        case 'sale':
        default:
            return 'ncri_sale';
    }
}

function reasonToVerb(reason: NcriTransferReason): string {
    switch (reason) {
        case 'gift':
            return 'gifted';
        case 'admin_transfer':
            return 'admin-transferred';
        case 'sale':
        default:
            return 'transferred';
    }
}
