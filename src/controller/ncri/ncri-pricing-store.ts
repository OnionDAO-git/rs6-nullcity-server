import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/**
 * Persistent pricing record for a listed NCRI.
 *
 * Each call to `setPrice` appends a new row; the last row for a given
 * `ncriId` is the effective price (audit trail is kept forever).
 */
export interface NcriPricing {
    ncriId: string;
    /** How the price is set. Admin-fixed is the default for the weekend demo. */
    pricingMode: 'admin-fixed' | 'resident-quoted';
    /** AP the human pays to acquire ownership. */
    apPrice: number;
    /** Real RuneScape GP (coin item 995) the human later pays to redeem the print. */
    gpRedemptionCost: number;
    /** Who set this price (admin id or resident slug). */
    setBy?: string;
    /** ISO timestamp of this pricing row. */
    setAt: string;
    /** Resident-quoted only: admin-enforced minimum AP price. */
    floor?: number;
    /** Resident-quoted only: admin-enforced maximum AP price. */
    ceiling?: number;
}

const ncriPricingSchema = z.object({
    ncriId: z.string().min(1),
    pricingMode: z.enum(['admin-fixed', 'resident-quoted']),
    apPrice: z.number().nonnegative().int(),
    gpRedemptionCost: z.number().nonnegative().int(),
    setBy: z.string().min(1).optional(),
    setAt: z.string().min(1),
    floor: z.number().nonnegative().int().optional(),
    ceiling: z.number().nonnegative().int().optional(),
});

export const setPricingSchema = z.object({
    pricingMode: z.enum(['admin-fixed', 'resident-quoted']).default('admin-fixed'),
    apPrice: z.number().nonnegative().int('apPrice must be a non-negative integer'),
    gpRedemptionCost: z.number().nonnegative().int('gpRedemptionCost must be a non-negative integer'),
    setBy: z.string().min(1).optional(),
    floor: z.number().nonnegative().int().optional(),
    ceiling: z.number().nonnegative().int().optional(),
});

export type SetPricingInput = z.input<typeof setPricingSchema>;

export class NcriPricingStore {
    constructor(
        private readonly memoryRoot: string,
        private readonly now: () => Date = () => new Date(),
    ) {}

    /** Append a new pricing row for `ncriId`. Last row wins. */
    setPrice(ncriId: string, input: SetPricingInput): NcriPricing {
        if (!ncriId || ncriId.trim().length === 0) {
            throw new Error('ncriId must be a non-empty string');
        }
        const parsed = setPricingSchema.parse(input);
        const record: NcriPricing = {
            ncriId,
            pricingMode: parsed.pricingMode,
            apPrice: parsed.apPrice,
            gpRedemptionCost: parsed.gpRedemptionCost,
            setBy: parsed.setBy,
            setAt: this.now().toISOString(),
            floor: parsed.floor,
            ceiling: parsed.ceiling,
        };
        this.appendRow(record);
        return record;
    }

    /** Latest pricing for a given NCRI id, or `undefined` if never priced. */
    latestPrice(ncriId: string): NcriPricing | undefined {
        const rows = this.readAll();
        let latest: NcriPricing | undefined;
        for (const row of rows) {
            if (row.ncriId === ncriId) {
                latest = row;
            }
        }
        return latest;
    }

    /** Map of ncriId → latest pricing row. Efficient single-pass over the file. */
    allLatest(): Map<string, NcriPricing> {
        const rows = this.readAll();
        const map = new Map<string, NcriPricing>();
        for (const row of rows) {
            map.set(row.ncriId, row);
        }
        return map;
    }

    private appendRow(record: NcriPricing): void {
        const filePath = this.pricingPath();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    }

    private readAll(): NcriPricing[] {
        const filePath = this.pricingPath();
        if (!fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf8');
        const records: NcriPricing[] = [];
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                records.push(ncriPricingSchema.parse(JSON.parse(line)));
            } catch {
                // Skip malformed rows silently — don't crash the server.
            }
        }
        return records;
    }

    private pricingPath(): string {
        return path.join(this.memoryRoot, 'city-integration', 'ncri', 'pricing.jsonl');
    }
}
