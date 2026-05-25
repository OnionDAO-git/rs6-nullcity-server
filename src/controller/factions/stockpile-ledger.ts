import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { ActionAttempt } from '../actions/action-attempt';
import { type FactionId, lookupFaction } from './factions';

export type FactionStockpileResource =
    | 'audit_marks'
    | 'bone_records'
    | 'door_reports'
    | 'found_objects'
    | 'kindling'
    | 'oral_records'
    | 'public_notices'
    | 'raw_materials'
    | 'shadow_reports'
    | 'supply_runs'
    | 'witness_accounts'
    | 'witness_rounds'
    | 'work_orders';

export interface FactionContribution {
    schemaVersion: 1;
    factionId: FactionId;
    resident: string;
    resource: FactionStockpileResource;
    amount: number;
    actionKind: string;
    cause: string;
    attemptId: string;
    ts: string;
    tick?: number;
}

export interface FactionStockpileSnapshot {
    schemaVersion: 1;
    totals: Partial<Record<FactionId, Record<string, number>>>;
    history: FactionContribution[];
}

export interface FactionStockpileLedgerOptions {
    now?: () => Date;
    maxHistory?: number;
}

export interface RecordFactionAttemptInput {
    resident: string;
    factionId?: string;
    attempt: ActionAttempt;
}

const contributionSchema = z.object({
    schemaVersion: z.literal(1),
    factionId: z.enum(['foundry', 'bureau-of-continuity', 'ledger', 'veil']),
    resident: z.string().min(1),
    resource: z.enum([
        'audit_marks',
        'bone_records',
        'door_reports',
        'found_objects',
        'kindling',
        'oral_records',
        'public_notices',
        'raw_materials',
        'shadow_reports',
        'supply_runs',
        'witness_accounts',
        'witness_rounds',
        'work_orders',
    ]),
    amount: z.number().int().positive(),
    actionKind: z.string().min(1),
    cause: z.string().min(1),
    attemptId: z.string().min(1),
    ts: z.string().datetime(),
    tick: z.number().int().nonnegative().optional(),
});

export const factionStockpileSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    totals: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
    history: z.array(contributionSchema),
});

export class FactionStockpileLedger {
    private snapshotData: FactionStockpileSnapshot;
    private readonly now: () => Date;
    private readonly maxHistory: number;
    private readonly filePath: string;

    constructor(
        private readonly memoryRoot: string,
        options: FactionStockpileLedgerOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.maxHistory = options.maxHistory ?? 400;
        this.filePath = path.join(memoryRoot, 'faction-stockpile.json');
        this.snapshotData = readFactionStockpileSnapshot(memoryRoot);
    }

    static load(memoryRoot: string, options: FactionStockpileLedgerOptions = {}): FactionStockpileLedger {
        return new FactionStockpileLedger(memoryRoot, options);
    }

    recordAttempt(input: RecordFactionAttemptInput): FactionContribution | undefined {
        const classified = classifyFactionContribution(input.factionId, input.attempt);
        if (!classified) {
            return undefined;
        }
        const contribution: FactionContribution = {
            schemaVersion: 1,
            resident: input.resident,
            ts: this.now().toISOString(),
            ...classified,
        };
        this.recordContribution(contribution);
        return contribution;
    }

    recordContribution(contribution: FactionContribution): void {
        const parsed = contributionSchema.parse(contribution);
        const totals = this.snapshotData.totals[parsed.factionId] || {};
        totals[parsed.resource] = (totals[parsed.resource] || 0) + parsed.amount;
        this.snapshotData.totals[parsed.factionId] = totals;
        this.snapshotData.history = [...this.snapshotData.history, parsed].slice(-this.maxHistory);
        this.persist();
    }

    snapshot(): FactionStockpileSnapshot {
        return factionStockpileSnapshotSchema.parse({
            schemaVersion: 1,
            totals: this.snapshotData.totals,
            history: this.snapshotData.history,
        });
    }

    private persist(): void {
        fs.mkdirSync(this.memoryRoot, { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tempPath, `${JSON.stringify(this.snapshot(), null, 2)}\n`, 'utf8');
        fs.renameSync(tempPath, this.filePath);
    }
}

export function readFactionStockpileSnapshot(memoryRoot: string): FactionStockpileSnapshot {
    const filePath = path.join(memoryRoot, 'faction-stockpile.json');
    if (!fs.existsSync(filePath)) {
        return emptySnapshot();
    }
    try {
        return factionStockpileSnapshotSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return emptySnapshot();
    }
}

export function classifyFactionContribution(
    factionId: string | undefined,
    attempt: ActionAttempt,
): Omit<FactionContribution, 'resident' | 'ts' | 'schemaVersion'> | undefined {
    const faction = factionId ? lookupFaction(factionId) : undefined;
    if (!faction || attempt.finalStatus !== 'success') {
        return undefined;
    }
    const cause = actionCause(attempt);
    if (!cause || cause === 'faction_landmark_return') {
        return undefined;
    }
    const actionKind = attempt.action.kind;
    const resource = classifyResource(faction.id, cause, actionKind);
    if (!resource) {
        return undefined;
    }
    const tick = metadataTick(attempt.metadata);
    return {
        factionId: faction.id,
        resource,
        amount: 1,
        actionKind,
        cause,
        attemptId: attempt.attemptId,
        ...(tick === undefined ? {} : { tick }),
    };
}

function classifyResource(factionId: FactionId, cause: string, actionKind: string): FactionStockpileResource | undefined {
    if (!cause.startsWith('faction_')) {
        return undefined;
    }
    if (factionId === 'foundry' && cause === 'faction_foundry_fuel_work') {
        if (actionKind === 'use_item_on_item') {
            return 'kindling';
        }
        if (actionKind === 'interact') {
            return 'raw_materials';
        }
        if (actionKind === 'move_to') {
            return 'supply_runs';
        }
        if (actionKind === 'say') {
            return 'work_orders';
        }
    }
    if (factionId === 'bureau-of-continuity' && cause === 'faction_bureau_witness_work') {
        if (actionKind === 'item_action') {
            return 'bone_records';
        }
        if (actionKind === 'attack') {
            return 'witness_accounts';
        }
        if (actionKind === 'move_to') {
            return 'witness_rounds';
        }
        if (actionKind === 'say') {
            return 'oral_records';
        }
    }
    if (factionId === 'ledger' && cause === 'faction_ledger_audit_work') {
        return actionKind === 'say' ? 'public_notices' : 'audit_marks';
    }
    if (factionId === 'veil' && cause === 'faction_veil_shadow_work') {
        if (actionKind === 'interact') {
            return 'door_reports';
        }
        if (actionKind === 'pickup' || actionKind === 'item_action') {
            return 'found_objects';
        }
        return 'shadow_reports';
    }
    return undefined;
}

function actionCause(attempt: ActionAttempt): string | undefined {
    const direct = attempt.action.cause;
    return typeof direct === 'string' && direct.length > 0 ? direct : attempt.cause;
}

function metadataTick(metadata: unknown): number | undefined {
    if (!metadata || typeof metadata !== 'object' || !('tick' in metadata)) {
        return undefined;
    }
    const tick = (metadata as { tick?: unknown }).tick;
    return typeof tick === 'number' && Number.isInteger(tick) && tick >= 0 ? tick : undefined;
}

function emptySnapshot(): FactionStockpileSnapshot {
    return { schemaVersion: 1, totals: {}, history: [] };
}
