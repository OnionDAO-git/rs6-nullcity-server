import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { EconomyEventLog } from './economy-event';

/**
 * AP-for-GP exchange event model.
 *
 * An exchange links two real evidences:
 *   - AP credited to a resident's life-force (from a human patron)
 *   - GP burned from the resident's RuneScape inventory (coin item 995)
 *
 * Status is `complete` only when BOTH sides have been confirmed.
 * One-sided records are `failed_gp`, `failed_ap`, or `incomplete` so the
 * Storyteller can never narrate "AP traded for GP" without real evidence.
 *
 * Exchange id format: `apgp:<resident>:<idempotencyKey>`
 * No GP ledger is created; GP evidence is always coin item 995 game state.
 */

export type ApGpExchangeStatus = 'complete' | 'failed_gp' | 'failed_ap' | 'incomplete';

export interface ApGpApEvidence {
    creditedAmount: number;
    attentionBefore: number;
    attentionAfter: number;
}

export interface ApGpGpEvidence {
    itemId: 995;
    burnedAmount: number;
    remainingAmount: number;
}

const apEvidenceSchema = z.object({
    creditedAmount: z.number().int().positive(),
    attentionBefore: z.number().int().min(0),
    attentionAfter: z.number().int().min(0),
});

const gpEvidenceSchema = z.object({
    itemId: z.literal(995),
    burnedAmount: z.number().int().positive(),
    remainingAmount: z.number().int().min(0),
});

export const apGpExchangeRecordSchema = z
    .object({
        schemaVersion: z.literal(1),
        exchangeId: z.string().min(1),
        idempotencyKey: z.string().min(1),
        resident: z.string().min(1),
        apAmount: z.number().int().positive(),
        gpAmount: z.number().int().positive(),
        cityUserId: z.string().optional(),
        sourceType: z.string().optional(),
        sourceId: z.string().optional(),
        status: z.enum(['complete', 'failed_gp', 'failed_ap', 'incomplete']),
        apEvidence: apEvidenceSchema.optional(),
        gpEvidence: gpEvidenceSchema.optional(),
        failureReason: z.string().optional(),
        createdAt: z.string().min(1),
        completedAt: z.string().optional(),
    })
    .superRefine((record, ctx) => {
        if (record.status === 'complete') {
            if (!record.apEvidence) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['apEvidence'],
                    message: 'complete exchanges require AP evidence',
                });
            }
            if (!record.gpEvidence) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['gpEvidence'],
                    message: 'complete exchanges require GP evidence',
                });
            }
        }

        if (record.status === 'failed_ap' && !record.gpEvidence) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['gpEvidence'],
                message: 'failed_ap exchanges require GP evidence',
            });
        }
    });

export type ApGpExchangeRecord = z.infer<typeof apGpExchangeRecordSchema>;

export const apGpExchangeRequestSchema = z
    .object({
        idempotencyKey: z.string().min(1).max(200),
        apAmount: z.number().int().positive(),
        gpAmount: z.number().int().positive(),
        cityUserId: z.string().min(1).optional(),
        sourceType: z.string().min(1).optional(),
        sourceId: z.string().min(1).optional(),
    })
    .strict();

export type ApGpExchangeRequest = z.infer<typeof apGpExchangeRequestSchema>;

export function makeExchangeId(resident: string, idempotencyKey: string): string {
    return `apgp:${resident}:${idempotencyKey}`;
}

export function deriveExchangeStatus(
    apEvidence: ApGpApEvidence | undefined,
    gpEvidence: ApGpGpEvidence | undefined,
    failureReason?: string,
): ApGpExchangeStatus {
    if (failureReason === 'insufficient_gold' || (gpEvidence === undefined && apEvidence === undefined && failureReason)) {
        return 'failed_gp';
    }
    if (apEvidence === undefined && gpEvidence !== undefined) {
        return 'failed_ap';
    }
    if (apEvidence !== undefined && gpEvidence === undefined) {
        return 'incomplete';
    }
    if (apEvidence !== undefined && gpEvidence !== undefined) {
        return 'complete';
    }
    return 'incomplete';
}

export class ApGpExchangeStore {
    constructor(
        private readonly memoryRoot: string,
        private readonly economyEventLog?: EconomyEventLog,
    ) {}

    read(idempotencyKey: string): ApGpExchangeRecord | undefined {
        const filePath = this.recordPath(idempotencyKey);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        return apGpExchangeRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }

    write(record: ApGpExchangeRecord): void {
        const normalized = apGpExchangeRecordSchema.parse(record);
        const filePath = this.recordPath(record.idempotencyKey);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`);
        fs.renameSync(tmpPath, filePath);

        if (this.economyEventLog && normalized.status === 'complete') {
            // The exchange burns GP from the resident and credits AP to them, so
            // from the resident's economic perspective: AP increases, GP decreases.
            const apDelta = normalized.apEvidence?.creditedAmount ?? normalized.apAmount;
            const gpDelta = -(normalized.gpEvidence?.burnedAmount ?? normalized.gpAmount);
            const looksLikeRes = /^res:[a-z0-9_-]{1,20}$/.test(normalized.resident);
            this.economyEventLog.append({
                kind: 'ap_gp_exchange',
                ...(looksLikeRes ? { residentName: normalized.resident } : {}),
                apDelta,
                gpDelta,
                refId: normalized.exchangeId,
                ...(normalized.completedAt !== undefined ? { ts: normalized.completedAt } : {}),
                ...(normalized.cityUserId !== undefined ? { cityUserId: normalized.cityUserId } : {}),
                note: `exchanged ${Math.abs(gpDelta)} GP for ${apDelta} AP`,
            });
        }
    }

    private recordPath(idempotencyKey: string): string {
        const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
        return path.join(this.memoryRoot, 'city-integration', 'exchanges', `${digest}.json`);
    }
}
