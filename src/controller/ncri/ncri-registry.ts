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

    /** Transfer ownership to a new city user. Requires approved + available. */
    transfer(id: string, newOwner: string): NcriRecord {
        if (!newOwner || newOwner.trim().length === 0) {
            throw new NcriRegistryError('invalid_owner', 'newOwner must be a non-empty string');
        }
        const record = this.requireRecord(id);
        if (record.approvalStatus !== 'approved') {
            throw new NcriRegistryError('not_approved', `cannot transfer NCRI '${id}' with approvalStatus '${record.approvalStatus}'`);
        }
        if (record.redemptionStatus === 'redeemed') {
            throw new NcriRegistryError('already_redeemed', `cannot transfer NCRI '${id}' after redemption`);
        }
        const ts = this.now().toISOString();
        const updated: NcriRecord = { ...record, owner: newOwner, updatedAt: ts };
        this.writeRecord(updated);

        if (this.economyEventLog && updated.owner !== record.owner) {
            // Treat an ownership change on an approved+available NCRI as a sale
            // (the most common transfer path in Null City). cityUserId is the new
            // owner; residentName is not tracked on the NCRI record itself.
            this.economyEventLog.append({
                kind: 'ncri_sale',
                ncriId: updated.id,
                refId: updated.id,
                residentName: record.sourceResidentName ?? residentOwner(record.owner),
                cityUserId: updated.owner,
                ts: updated.updatedAt,
                note: `NCRI ${updated.displayName} (${updated.id}) transferred to ${updated.owner}`,
            });
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
