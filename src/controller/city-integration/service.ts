import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { type RuntimeState, residentSlug } from '../memory/runtime-state';
import { validateSoulFrontmatter } from '../soul/soul-schema';
import type { InitialContainerItem, PerceptionEvent } from '../transport/message-codecs';
import { CityIntegrationStore } from './store';
import {
    ApGpExchangeStore,
    apGpExchangeRequestSchema,
    deriveExchangeStatus,
    makeExchangeId,
    type ApGpExchangeRecord,
} from './ap-gp-exchange';
import { buildCityEventDigest, type CityEventDigest } from './city-event-digest';
import { EconomyEventLog } from './economy-event';
import { GoalContractStore } from './goal-contract';
import { createSoulProposalSchema, SoulProposalError, SoulProposalStore, type SoulProposal } from './soul-proposals';
import { NcriRegistry, NcriRegistryError, type NcriRecord, createNcriSchema } from '../ncri/ncri-registry';
import { buildLiveEconomySnapshot, type LiveEconomyQuery, type LiveEconomySnapshot } from './live-economy';
import { LibraryUpdater } from '../evidence';
import { GoalContractError, createGoalContractSchema, type GoalContract } from './goal-contract';

const reviewNcriSchema = z.object({ adminNotes: z.string().max(1000).optional() }).strict();
// `reason` distinguishes a sale (money/AP changed hands) from a gift or admin
// transfer so the Storyteller substrate never narrates a giveaway as a sale.
// See F1 in `docs/audit/2026-05-30-substrate-burst-audit.md` /
// issue `QA-20260530-011`. Optional + defaults to `'sale'` only to preserve
// HTTP back-compat; new clients should pass an explicit reason.
const transferNcriSchema = z
    .object({
        newOwner: z.string().min(1),
        reason: z.enum(['sale', 'gift', 'admin_transfer']).optional(),
    })
    .strict();
const markGoalAchievedSchema = z
    .object({
        evidence: z.string().min(1),
        tick: z.number().int().nonnegative().optional(),
        apAtCompletion: z.number().nonnegative().optional(),
        gpAtCompletion: z.number().nonnegative().int().optional(),
    })
    .strict();

const residentNameSchema = z.string().regex(/^res:[a-z0-9_-]{1,20}$/);
const idempotencyKeySchema = z.string().min(1).max(200);
const positionSchema = z.object({ x: z.number().int(), y: z.number().int(), level: z.number().int().min(0).optional() });
const initialItemSchema = z.union([
    z.number().int().positive(),
    z.string().min(1),
    z.object({ itemId: z.number().int().positive(), amount: z.number().int().positive().optional() }),
    z.null(),
]);

export class CityIntegrationError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message = code,
    ) {
        super(message);
    }
}

export interface CityRuntime {
    incrementAttention(amount: number): void;
    getState(): RuntimeState;
    getPosition?(): { x: number; y: number; level: number } | undefined;
    onEvent(event: PerceptionEvent): void;
}

export interface CityIntegrationInventoryAuthority {
    inspectResidentGold(resident: string): Promise<{ resident: string; itemId: 995; amount: number }>;
    burnResidentGold(
        resident: string,
        amount: number,
    ): Promise<{ resident: string; itemId: 995; burnedAmount: number; remainingAmount: number }>;
}

export interface CityIntegrationBirthAuthority {
    birthResident(input: BirthResidentRequest): Promise<{ resident: string; created: boolean; connected: boolean }>;
}

export interface CityIntegrationOptions {
    memoryRoot: string;
    getRuntime(resident: string): CityRuntime | undefined;
    inventory: CityIntegrationInventoryAuthority;
    birth: CityIntegrationBirthAuthority;
    now?: () => Date;
    economyEventLog?: EconomyEventLog;
}

export interface CityStorytellerDispatchSummary {
    dispatchId: string;
    generatedAt?: string;
    modelProfile?: string;
    needsReview: boolean;
    warningCount: number;
    publicTitle?: string;
    publicBody?: string;
    publicBullets: string[];
    operatorSummary?: string;
    operatorWarnings: string[];
    reviewReasons: string[];
    eventRefCount: number;
    eventRefsUsed: string[];
    estimatedCostUsd?: number | null;
}

export interface CityStorytellerLatestSummary {
    ok: true;
    runId: string;
    digestId: string;
    builtAt?: string;
    windowStart?: string;
    windowEnd?: string;
    topEventCount: number;
    residentCount: number;
    summary?: string;
    dispatch?: CityStorytellerDispatchSummary;
}

export const birthResidentRequestSchema = z
    .object({
        proposalId: z.string().min(1),
        idempotencyKey: idempotencyKeySchema.optional(),
        residentName: residentNameSchema,
        soulMarkdown: z.string().min(1),
        appearance: z.unknown().optional(),
        spawnPosition: positionSchema.optional(),
        startingInventory: z.array(initialItemSchema).max(28).optional(),
        initialEquipment: z.array(initialItemSchema).max(14).optional(),
        startingLevels: z.record(z.string(), z.number().int().min(1).max(99)).optional(),
        fundedAttention: z.number().int().positive(),
    })
    .strict();

export type BirthResidentRequest = z.infer<typeof birthResidentRequestSchema>;

const attentionGrantRequestSchema = z
    .object({
        idempotencyKey: idempotencyKeySchema,
        amount: z.number().int().positive(),
        cityUserId: z.string().min(1).optional(),
        sourceType: z.string().min(1).optional(),
        sourceId: z.string().min(1).optional(),
        note: z.string().max(500).optional(),
    })
    .strict();

const goldBurnRequestSchema = z
    .object({
        idempotencyKey: idempotencyKeySchema,
        amount: z.number().int().positive(),
        cityUserId: z.string().min(1).optional(),
        sourceType: z.string().min(1).optional(),
        sourceId: z.string().min(1).optional(),
    })
    .strict();

const messageDeliveryRequestSchema = z
    .object({
        idempotencyKey: idempotencyKeySchema.optional(),
        messageId: z.string().min(1),
        threadId: z.string().min(1),
        cityUserId: z.string().min(1),
        senderDisplayName: z.string().min(1).max(120).optional(),
        body: z.string().min(1).max(2000),
    })
    .strict();

const fundSoulProposalRequestSchema = z
    .object({
        amount: z.number().int().positive(),
        cityUserId: z.string().min(1),
    })
    .strict();

const reviewSoulProposalRequestSchema = z
    .object({
        adminNotes: z.string().max(1000).optional(),
    })
    .strict();

export type AttentionGrantRequest = z.infer<typeof attentionGrantRequestSchema>;
export type GoldBurnRequest = z.infer<typeof goldBurnRequestSchema>;
export type MessageDeliveryRequest = z.infer<typeof messageDeliveryRequestSchema>;

export class CityIntegrationService {
    private readonly store: CityIntegrationStore;
    private readonly exchangeStore: ApGpExchangeStore;
    private readonly proposalStore: SoulProposalStore;
    private readonly ncriRegistry: NcriRegistry;
    private readonly economyEventLog: EconomyEventLog;
    private readonly now: () => Date;

    constructor(private readonly options: CityIntegrationOptions) {
        this.now = options.now ?? (() => new Date());
        this.economyEventLog = options.economyEventLog ?? new EconomyEventLog(options.memoryRoot, this.now);
        this.store = new CityIntegrationStore(options.memoryRoot);
        this.exchangeStore = new ApGpExchangeStore(options.memoryRoot, this.economyEventLog);
        this.proposalStore = new SoulProposalStore(options.memoryRoot, this.now);
        this.ncriRegistry = new NcriRegistry(options.memoryRoot, this.now, this.economyEventLog);
    }

    /**
     * Expose the shared {@link EconomyEventLog} so the {@link ControllerHost}
     * can pass the *same* log into per-resident {@link ApLedger} instances
     * (via `attachEconomyEventLog`) and other future emitters. One file per
     * `memoryRoot` keeps grant/exchange/sale events ordered in a single
     * append-only stream the (gated) Storyteller can narrate. Packet
     * S-HOST-WIRE.
     */
    getEconomyEventLog(): EconomyEventLog {
        return this.economyEventLog;
    }

    /**
     * AP-for-GP exchange: burns real GP (coin item 995) from the resident's
     * RuneScape inventory and credits AP to the resident's life-force.
     *
     * Status is `complete` only when both sides succeed.
     * A failed GP burn produces `failed_gp` and never credits AP.
     * A failed AP credit after a successful GP burn produces `failed_ap`.
     * The exchange record is idempotent: the same key returns the cached result
     * without re-debiting either side.
     */
    async exchangeApForGp(resident: string, input: unknown): Promise<ApGpExchangeRecord> {
        const residentName = parseResident(resident);
        const request = parseOrThrow(apGpExchangeRequestSchema, input);
        const exchangeId = makeExchangeId(residentName, request.idempotencyKey);
        const createdAt = this.now().toISOString();

        // Idempotency: return the cached record if this key was already processed.
        const existing = this.exchangeStore.read(request.idempotencyKey);
        if (existing) {
            return existing;
        }

        // Step 1: burn GP from the resident's game inventory.
        let gpEvidence: ApGpExchangeRecord['gpEvidence'];
        try {
            const burned = await this.options.inventory.burnResidentGold(residentName, request.gpAmount);
            gpEvidence = {
                itemId: burned.itemId,
                burnedAmount: burned.burnedAmount,
                remainingAmount: burned.remainingAmount,
            };
        } catch (error) {
            const failureReason =
                error instanceof Error && error.message.includes('EINSUFFICIENT_GOLD')
                    ? 'insufficient_gold'
                    : error instanceof Error
                      ? error.message
                      : String(error);
            const record: ApGpExchangeRecord = {
                schemaVersion: 1,
                exchangeId,
                idempotencyKey: request.idempotencyKey,
                resident: residentName,
                apAmount: request.apAmount,
                gpAmount: request.gpAmount,
                cityUserId: request.cityUserId,
                sourceType: request.sourceType,
                sourceId: request.sourceId,
                status: 'failed_gp',
                failureReason,
                createdAt,
            };
            this.exchangeStore.write(record);
            this.appendLibraryEvent(residentName, {
                schemaVersion: 1,
                ts: createdAt,
                tick: this.options.getRuntime(residentName)?.getState().tick ?? 0,
                sessionId: 'external',
                kind: 'city_ap_gp_exchange',
                exchangeId,
                status: 'failed_gp',
                apAmount: request.apAmount,
                gpAmount: request.gpAmount,
                failureReason,
                cityUserId: request.cityUserId,
                lifeIndex: this.readLifeIndex(residentName),
                significanceReasons: ['city:ap_gp_exchange_failed_gp'],
            });
            this.audit('exchange_ap_for_gp', request.idempotencyKey, residentName, 'failed_gp', undefined, undefined, {
                error: failureReason,
            });
            return record;
        }

        // Step 2: credit AP to the resident's life-force runtime.
        let apEvidence: ApGpExchangeRecord['apEvidence'];
        let apFailureReason: string | undefined;
        try {
            const runtime = this.requireRuntime(residentName);
            const before = runtime.getState().attention;
            runtime.incrementAttention(request.apAmount);
            const after = runtime.getState().attention;
            apEvidence = {
                creditedAmount: request.apAmount,
                attentionBefore: before,
                attentionAfter: after,
            };
        } catch (error) {
            apFailureReason = error instanceof Error ? error.message : String(error);
        }

        // After a successful GP burn (gpEvidence is present at this point in
        // the flow), only an AP-side failure can reach deriveExchangeStatus —
        // so attribute explicitly to 'ap' to satisfy the tightened helper
        // contract (S-AUDIT-FIX-2 / F2). When apEvidence is also present and
        // no failure occurred, deriveExchangeStatus returns 'complete' and the
        // failureContext is ignored.
        const status = deriveExchangeStatus(
            apEvidence,
            gpEvidence,
            apFailureReason !== undefined ? { failedSide: 'ap', failureReason: apFailureReason } : undefined,
        );
        const completedAt = status === 'complete' ? this.now().toISOString() : undefined;

        const record: ApGpExchangeRecord = {
            schemaVersion: 1,
            exchangeId,
            idempotencyKey: request.idempotencyKey,
            resident: residentName,
            apAmount: request.apAmount,
            gpAmount: request.gpAmount,
            cityUserId: request.cityUserId,
            sourceType: request.sourceType,
            sourceId: request.sourceId,
            status,
            apEvidence,
            gpEvidence,
            failureReason: apFailureReason,
            createdAt,
            completedAt,
        };

        this.exchangeStore.write(record);
        this.appendLibraryEvent(residentName, {
            schemaVersion: 1,
            ts: createdAt,
            tick: this.options.getRuntime(residentName)?.getState().tick ?? 0,
            sessionId: 'external',
            kind: 'city_ap_gp_exchange',
            exchangeId,
            status,
            apAmount: request.apAmount,
            gpAmount: request.gpAmount,
            cityUserId: request.cityUserId,
            lifeIndex: this.readLifeIndex(residentName),
            significanceReasons: ['city:ap_gp_exchange'],
        });
        this.audit('exchange_ap_for_gp', request.idempotencyKey, residentName, status);
        return record;
    }

    async birthResident(input: unknown): Promise<unknown> {
        const request = parseOrThrow(birthResidentRequestSchema, input);
        validateSoulMarkdown(request.residentName, request.soulMarkdown);
        const idempotencyKey = request.idempotencyKey || `birth:${request.proposalId}`;
        return this.idempotent('birth_resident', idempotencyKey, request, async () => {
            const born = await this.options.birth.birthResident(request);
            const result = {
                ok: true,
                proposalId: request.proposalId,
                resident: born.resident,
                created: born.created,
                connected: born.connected,
                fundedAttention: request.fundedAttention,
            };
            this.appendLibraryEvent(request.residentName, {
                schemaVersion: 1,
                ts: this.now().toISOString(),
                tick: 0,
                sessionId: 'external',
                kind: 'city_birth',
                proposalId: request.proposalId,
                fundedAttention: request.fundedAttention,
                lifeIndex: 1,
                significanceReasons: ['city:birth'],
            });
            return result;
        });
    }

    async createSoulProposal(input: unknown): Promise<SoulProposal> {
        const request = parseOrThrow(createSoulProposalSchema, input);
        validateSoulMarkdown(request.residentName, request.soulMarkdown);
        return this.withSoulProposalErrors(() => this.proposalStore.create(request));
    }

    async listSoulProposals(): Promise<SoulProposal[]> {
        return this.withSoulProposalErrors(() => this.proposalStore.list());
    }

    async getSoulProposal(proposalId: string): Promise<SoulProposal> {
        return this.withSoulProposalErrors(() => {
            const proposal = this.proposalStore.get(proposalId);
            if (!proposal) {
                throw new SoulProposalError('not_found', `proposal '${proposalId}' not found`);
            }
            return proposal;
        });
    }

    async fundSoulProposal(proposalId: string, input: unknown): Promise<SoulProposal> {
        const request = parseOrThrow(fundSoulProposalRequestSchema, input);
        return this.withSoulProposalErrors(() => this.proposalStore.fund(proposalId, request.amount, request.cityUserId));
    }

    async approveSoulProposal(proposalId: string, input: unknown): Promise<SoulProposal> {
        const request = parseOrThrow(reviewSoulProposalRequestSchema, input);
        return this.withSoulProposalErrors(() => this.proposalStore.approve(proposalId, request.adminNotes));
    }

    async rejectSoulProposal(proposalId: string, input: unknown): Promise<SoulProposal> {
        const request = parseOrThrow(reviewSoulProposalRequestSchema, input);
        return this.withSoulProposalErrors(() => this.proposalStore.reject(proposalId, request.adminNotes));
    }

    // -------------------------------------------------------------------------
    // GoalContract routes (S9a) — resident binary goal completion → Library.
    // -------------------------------------------------------------------------

    createGoalContract(input: unknown): GoalContract {
        const parsed = parseOrThrow(createGoalContractSchema, input);
        return this.withGoalErrors(() => new GoalContractStore(this.options.memoryRoot).create(parsed));
    }

    listGoalContracts(): GoalContract[] {
        return new GoalContractStore(this.options.memoryRoot).list();
    }

    getGoalContract(id: string): GoalContract {
        return this.withGoalErrors(() => {
            const goal = new GoalContractStore(this.options.memoryRoot).get(id);
            if (!goal) throw new GoalContractError('not_found', `goal '${id}' not found`);
            return goal;
        });
    }

    /**
     * Mark a GoalContract achieved and write a saved-state Library moment.
     *
     * Idempotent: if the goal is already `achieved`, returns it without
     * writing a duplicate Library event. Only fires `goal_achieved` on the
     * first transition from `active` → `achieved`, per S9a requirements.
     */
    markGoalAchieved(id: string, input: unknown): GoalContract {
        const body = parseOrThrow(markGoalAchievedSchema, input);
        const store = new GoalContractStore(this.options.memoryRoot, this.now);
        return this.withGoalErrors(() => {
            const existing = store.get(id);
            if (!existing) throw new GoalContractError('not_found', `goal '${id}' not found`);

            const wasAlreadyAchieved = existing.status === 'achieved';
            const goal = store.markAchieved(id, body.evidence);

            if (!wasAlreadyAchieved) {
                const library = new LibraryUpdater(goal.residentName, this.options.memoryRoot, { now: this.now });
                library.observeGoalAchieved({
                    kind: 'goal_achieved',
                    ts: goal.achievedAt ?? this.now().toISOString(),
                    tick: body.tick ?? 0,
                    goalId: goal.id,
                    goalText: goal.goalText,
                    evidence: body.evidence,
                    apAtCompletion: body.apAtCompletion,
                    gpAtCompletion: body.gpAtCompletion,
                });
            }

            return goal;
        });
    }

    private withGoalErrors<T>(fn: () => T): T {
        try {
            return fn();
        } catch (error) {
            if (error instanceof GoalContractError) {
                const status = error.code === 'not_found' ? 404 : 409;
                throw new CityIntegrationError(status, error.code, error.message);
            }
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // NCRI routes (S11b) — admin-approved Null City RuneScape Items.
    // -------------------------------------------------------------------------

    createNcri(input: unknown): NcriRecord {
        const parsed = parseOrThrow(createNcriSchema, input);
        return this.withNcriErrors(() => this.ncriRegistry.create(parsed));
    }

    listNcri(): NcriRecord[] {
        return this.ncriRegistry.list();
    }

    getNcri(id: string): NcriRecord {
        return this.withNcriErrors(() => {
            const record = this.ncriRegistry.get(id);
            if (!record) throw new NcriRegistryError('not_found', `NCRI '${id}' not found`);
            return record;
        });
    }

    approveNcri(id: string, input: unknown): NcriRecord {
        const parsed = parseOrThrow(reviewNcriSchema, input);
        return this.withNcriErrors(() => this.ncriRegistry.approve(id, parsed.adminNotes));
    }

    transferNcri(id: string, input: unknown): NcriRecord {
        const parsed = parseOrThrow(transferNcriSchema, input);
        // Default to `'sale'` for HTTP back-compat; the registry default applies the
        // same fallback. Callers SHOULD pass `reason` explicitly so the digest
        // distinguishes sales from gifts / admin transfers.
        return this.withNcriErrors(() => this.ncriRegistry.transfer(id, parsed.newOwner, { reason: parsed.reason ?? 'sale' }));
    }

    redeemNcri(id: string): NcriRecord {
        return this.withNcriErrors(() => this.ncriRegistry.redeem(id));
    }

    /**
     * Birth a resident from an approved SoulProposal.
     *
     * Only proposals in `approved` status can be birthed. The method is
     * idempotent: a proposal that is already `born` returns the cached birth
     * record without calling the birth authority again. The proposal status
     * transitions from `approved` to `born` after a successful birth.
     */
    async birthFromProposal(proposalId: string): Promise<unknown> {
        const proposal = this.proposalStore.get(proposalId);
        if (!proposal) {
            throw new CityIntegrationError(404, 'proposal_not_found');
        }
        if (proposal.status !== 'approved' && proposal.status !== 'born') {
            throw new CityIntegrationError(
                409,
                'proposal_not_approved',
                `proposal '${proposalId}' has status '${proposal.status}'; must be 'approved'`,
            );
        }

        const request: BirthResidentRequest = {
            proposalId: proposal.id,
            residentName: proposal.residentName,
            soulMarkdown: proposal.soulMarkdown,
            fundedAttention: proposal.apFunded,
        };

        const result = await this.birthResident(request);

        // Mark born after successful birth (idempotent — safe to call if already born).
        this.proposalStore.markBorn(proposalId);

        return result;
    }

    async creditAttention(resident: string, input: unknown): Promise<unknown> {
        const residentName = parseResident(resident);
        const request = parseOrThrow(attentionGrantRequestSchema, input);
        return this.idempotent('credit_attention', request.idempotencyKey, { residentName, ...request }, async () => {
            const runtime = this.requireRuntime(residentName);
            const ts = this.now().toISOString();
            const before = runtime.getState().attention;
            runtime.incrementAttention(request.amount);
            const after = runtime.getState().attention;
            const result = {
                ok: true,
                resident: residentName,
                attentionBefore: before,
                attentionAfter: after,
                creditedAmount: request.amount,
            };
            this.appendLibraryEvent(residentName, {
                schemaVersion: 1,
                ts,
                tick: runtime.getState().tick,
                sessionId: 'external',
                kind: 'city_attention_credit',
                amount: request.amount,
                attentionBefore: before,
                attentionAfter: after,
                cityUserId: request.cityUserId,
                sourceType: request.sourceType,
                sourceId: request.sourceId,
                note: request.note,
                lifeIndex: this.readLifeIndex(residentName),
                significanceReasons: ['city:attention_credit'],
            });
            this.economyEventLog.append({
                ts,
                kind: 'ap_topup',
                residentName,
                cityUserId: request.cityUserId,
                apDelta: request.amount,
                refId: request.sourceId ?? request.idempotencyKey,
                note: request.note ?? `credited ${request.amount} AP from ${request.sourceType ?? 'city_attention_credit'}`,
            });
            return result;
        });
    }

    async inspectGold(resident: string): Promise<unknown> {
        const residentName = parseResident(resident);
        const result = await this.options.inventory.inspectResidentGold(residentName);
        const ts = this.now().toISOString();
        this.appendLibraryEvent(residentName, {
            schemaVersion: 1,
            ts,
            tick: this.options.getRuntime(residentName)?.getState().tick ?? 0,
            sessionId: 'external',
            kind: 'city_gold_observed',
            itemId: result.itemId,
            amount: result.amount,
            lifeIndex: this.readLifeIndex(residentName),
            significanceReasons: ['city:gold_observed'],
        });
        this.economyEventLog.append({
            ts,
            kind: 'gp_observed',
            residentName,
            gpDelta: 0,
            refId: `inspect:${residentName}:${ts}`,
            note: `observed ${result.amount} GP in item ${result.itemId}`,
        });
        this.audit('inspect_gold', undefined, residentName, 'completed', undefined, result);
        return { ok: true, ...result };
    }

    async burnGold(resident: string, input: unknown): Promise<unknown> {
        const residentName = parseResident(resident);
        const request = parseOrThrow(goldBurnRequestSchema, input);
        return this.idempotent('burn_gold', request.idempotencyKey, { residentName, ...request }, async () => {
            try {
                const ts = this.now().toISOString();
                const burned = await this.options.inventory.burnResidentGold(residentName, request.amount);
                const result = {
                    ok: true,
                    resident: burned.resident,
                    itemId: burned.itemId,
                    burnedAmount: burned.burnedAmount,
                    remainingAmount: burned.remainingAmount,
                };
                this.appendLibraryEvent(residentName, {
                    schemaVersion: 1,
                    ts,
                    tick: this.options.getRuntime(residentName)?.getState().tick ?? 0,
                    sessionId: 'external',
                    kind: 'city_gold_burn',
                    itemId: burned.itemId,
                    amount: burned.burnedAmount,
                    cityUserId: request.cityUserId,
                    sourceType: request.sourceType,
                    sourceId: request.sourceId,
                    lifeIndex: this.readLifeIndex(residentName),
                    significanceReasons: ['city:gold_burn'],
                });
                this.economyEventLog.append({
                    ts,
                    kind: 'gp_traded',
                    residentName,
                    cityUserId: request.cityUserId,
                    gpDelta: -burned.burnedAmount,
                    refId: request.sourceId ?? request.idempotencyKey,
                    note: `burned ${burned.burnedAmount} GP from item ${burned.itemId}`,
                });
                return result;
            } catch (error) {
                if (error instanceof Error && error.message.includes('EINSUFFICIENT_GOLD')) {
                    const result = {
                        ok: false,
                        resident: residentName,
                        itemId: 995,
                        error: 'insufficient_gold',
                        requestedAmount: request.amount,
                    };
                    return result;
                }
                throw error;
            }
        });
    }

    async deliverMessage(resident: string, input: unknown): Promise<unknown> {
        const residentName = parseResident(resident);
        const request = parseOrThrow(messageDeliveryRequestSchema, input);
        const key = request.idempotencyKey || `message:${request.messageId}`;
        return this.idempotent('deliver_message', key, { residentName, ...request }, async () => {
            const runtime = this.requireRuntime(residentName);
            const ts = this.now().toISOString();
            const text = normalizeMessage(request.body);
            const event: PerceptionEvent = {
                kind: 'human_inbox_message',
                ts,
                text,
                threadId: request.threadId,
                messageId: request.messageId,
                from: {
                    id: `city-user:${request.cityUserId}`,
                    kind: 'human',
                    name: request.senderDisplayName || request.cityUserId,
                },
            };
            runtime.onEvent(event);
            this.appendLibraryEvent(residentName, {
                schemaVersion: 1,
                ts,
                tick: runtime.getState().tick,
                sessionId: 'external',
                kind: 'city_inbox_message',
                cityUserId: request.cityUserId,
                senderDisplayName: request.senderDisplayName,
                threadId: request.threadId,
                messageId: request.messageId,
                text,
                lifeIndex: this.readLifeIndex(residentName),
                significanceReasons: ['city:inbox_message'],
            });
            return { ok: true, resident: residentName, delivered: true, event };
        });
    }

    publicSnapshot(resident: string): unknown {
        const residentName = parseResident(resident);
        const runtime = this.options.getRuntime(residentName);
        const library = this.readLibrary(residentName);
        return {
            ok: true,
            resident: residentName,
            online: Boolean(runtime),
            state: runtime?.getState(),
            position: runtime?.getPosition?.(),
            library: library.index,
            portrait: library.portrait,
            recentLibraryEvents: library.timeline.slice(-50),
            deceased: runtime?.getState().deceased || library.index?.currentState === 'ended',
        };
    }

    residentLog(resident: string): unknown {
        const residentName = parseResident(resident);
        const library = this.readLibrary(residentName);
        return { ok: true, resident: residentName, events: library.timeline.slice(-200) };
    }

    residentDeath(resident: string): unknown {
        const residentName = parseResident(resident);
        const runtime = this.options.getRuntime(residentName);
        const index = this.readLibrary(residentName).index;
        return { ok: true, resident: residentName, deceased: runtime?.getState().deceased, libraryState: index?.currentState };
    }

    economyDigest(options: { since?: string; until?: string } = {}): CityEventDigest {
        const goals = new GoalContractStore(this.options.memoryRoot);
        return buildCityEventDigest(this.economyEventLog.readAll(), {
            generatedAt: this.now().toISOString(),
            ...(options.since !== undefined ? { windowStart: options.since } : {}),
            ...(options.until !== undefined ? { windowEnd: options.until } : {}),
            goals: goals.list(),
        });
    }

    economyLive(query: LiveEconomyQuery = {}): LiveEconomySnapshot {
        return buildLiveEconomySnapshot({
            memoryRoot: this.options.memoryRoot,
            now: this.now,
            events: this.economyEventLog.readAll(),
            proposals: this.proposalStore.list(),
            query,
            isResidentOnline: residentName => Boolean(this.options.getRuntime(residentName)),
            getOnlineAttention: residentName => this.options.getRuntime(residentName)?.getState().attention,
        });
    }

    economyTotals(
        query: LiveEconomyQuery = {},
    ): Pick<LiveEconomySnapshot, 'asOf' | 'window' | 'city' | 'countsByKind' | 'topResidentsByAttention' | 'pendingProposals'> {
        const live = this.economyLive(query);
        return {
            asOf: live.asOf,
            window: live.window,
            city: live.city,
            countsByKind: live.countsByKind,
            topResidentsByAttention: live.topResidentsByAttention,
            pendingProposals: live.pendingProposals,
        };
    }

    economyEvents(query: LiveEconomyQuery = {}): Pick<LiveEconomySnapshot, 'asOf' | 'window' | 'countsByKind' | 'recentEvents'> {
        const live = this.economyLive(query);
        return {
            asOf: live.asOf,
            window: live.window,
            countsByKind: live.countsByKind,
            recentEvents: live.recentEvents,
        };
    }

    economyResidents(
        query: LiveEconomyQuery = {},
    ): Pick<LiveEconomySnapshot, 'asOf' | 'window' | 'city' | 'residents' | 'topResidentsByAttention'> {
        const live = this.economyLive(query);
        return {
            asOf: live.asOf,
            window: live.window,
            city: live.city,
            residents: live.residents,
            topResidentsByAttention: live.topResidentsByAttention,
        };
    }

    storytellerLatest(): CityStorytellerLatestSummary {
        const storytellerRoot = path.join(path.dirname(this.options.memoryRoot), 'storyteller');
        if (!fs.existsSync(storytellerRoot)) {
            throw new CityIntegrationError(404, 'storyteller_not_found');
        }

        const runs = fs
            .readdirSync(storytellerRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => this.readStorytellerRun(path.join(storytellerRoot, entry.name), entry.name))
            .filter((run): run is CityStorytellerLatestSummary => Boolean(run));

        if (!runs.length) {
            throw new CityIntegrationError(404, 'storyteller_not_found');
        }

        runs.sort((left, right) => storytellerLatestStampMs(right) - storytellerLatestStampMs(left));
        return runs[0];
    }

    private readStorytellerRun(runRoot: string, runId: string): CityStorytellerLatestSummary | undefined {
        const digest = asObject(readJson(path.join(runRoot, 'digest.json')));
        if (!digest) return undefined;

        const digestId = asNonEmptyString(digest['digestId']) || runId;
        const topEvents = asArray(digest['topEvents']);
        const residents = asArray(digest['residents']);
        const dispatch = asObject(readJson(path.join(runRoot, 'dispatch.json')));

        return {
            ok: true,
            runId,
            digestId,
            builtAt: asOptionalString(digest['builtAt']),
            windowStart: asOptionalString(digest['windowStart']),
            windowEnd: asOptionalString(digest['windowEnd']),
            topEventCount: topEvents.length,
            residentCount: residents.length,
            summary: asOptionalString(digest['summary']),
            ...(dispatch ? { dispatch: storytellerDispatchSummary(dispatch, runId) } : {}),
        };
    }

    private async idempotent<TResult extends Record<string, unknown>>(
        command: string,
        idempotencyKey: string,
        payload: unknown,
        execute: () => Promise<TResult>,
    ): Promise<TResult & { idempotent?: boolean }> {
        const payloadHash = this.store.payloadHash(payload);
        const existing = this.store.read<TResult>(command, idempotencyKey);
        if (existing) {
            if (existing.payloadHash !== payloadHash) {
                this.audit(command, idempotencyKey, residentFromPayload(payload), 'conflict', payloadHash, undefined, {
                    error: 'idempotency_payload_mismatch',
                });
                throw new CityIntegrationError(409, 'idempotency_payload_mismatch');
            }
            return { ...(existing.result as TResult), idempotent: true };
        }

        const createdAt = this.now().toISOString();
        try {
            const result = await execute();
            this.store.write({
                schemaVersion: 1,
                command,
                idempotencyKey,
                payloadHash,
                status: 'completed',
                createdAt,
                completedAt: this.now().toISOString(),
                result,
            });
            this.audit(command, idempotencyKey, residentFromPayload(payload), 'completed', payloadHash, result);
            return result;
        } catch (error) {
            this.audit(command, idempotencyKey, residentFromPayload(payload), 'error', payloadHash, undefined, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    private requireRuntime(residentName: string): CityRuntime {
        const runtime = this.options.getRuntime(residentName);
        if (!runtime) {
            throw new CityIntegrationError(404, 'resident_not_found');
        }
        return runtime;
    }

    private appendLibraryEvent(residentName: string, event: Record<string, unknown>): void {
        const libraryDir = path.join(this.options.memoryRoot, 'library', residentSlug(residentName));
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.appendFileSync(path.join(libraryDir, 'timeline.jsonl'), `${JSON.stringify(pruneUndefined(event))}\n`);
    }

    private readLibrary(residentName: string): {
        index?: Record<string, unknown>;
        portrait?: unknown;
        timeline: Array<Record<string, unknown>>;
    } {
        const libraryDir = path.join(this.options.memoryRoot, 'library', residentSlug(residentName));
        return {
            index: readJson(path.join(libraryDir, 'index.json')) as Record<string, unknown> | undefined,
            portrait: readJson(path.join(libraryDir, 'portrait.json')),
            timeline: readJsonLines(path.join(libraryDir, 'timeline.jsonl')),
        };
    }

    private readLifeIndex(residentName: string): number {
        const index = this.readLibrary(residentName).index;
        return typeof index?.lives === 'number' && Number.isFinite(index.lives) ? index.lives : 1;
    }

    private audit(
        command: string,
        idempotencyKey: string | undefined,
        resident: string | undefined,
        status: string,
        payloadHash?: string,
        result?: unknown,
        error?: unknown,
    ): void {
        this.store.appendAudit({
            schemaVersion: 1,
            ts: this.now().toISOString(),
            command,
            idempotencyKey,
            resident,
            status,
            payloadHash,
            result,
            error,
        });
    }

    private async withSoulProposalErrors<T>(fn: () => T): Promise<T> {
        try {
            return fn();
        } catch (error) {
            if (error instanceof SoulProposalError) {
                throw mapSoulProposalError(error);
            }
            throw error;
        }
    }

    private withNcriErrors<T>(fn: () => T): T {
        try {
            return fn();
        } catch (error) {
            if (error instanceof NcriRegistryError) {
                throw mapNcriError(error);
            }
            throw error;
        }
    }
}

function parseResident(value: string): string {
    return parseOrThrow(residentNameSchema, value);
}

function mapSoulProposalError(error: SoulProposalError): CityIntegrationError {
    if (error.code === 'not_found') {
        return new CityIntegrationError(404, 'proposal_not_found', error.message);
    }
    if (error.code === 'invalid_amount') {
        return new CityIntegrationError(400, error.code, error.message);
    }
    return new CityIntegrationError(409, error.code, error.message);
}

function mapNcriError(error: NcriRegistryError): CityIntegrationError {
    if (error.code === 'not_found') return new CityIntegrationError(404, 'ncri_not_found', error.message);
    if (error.code === 'invalid_owner') return new CityIntegrationError(400, error.code, error.message);
    return new CityIntegrationError(409, error.code, error.message);
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new CityIntegrationError(
            400,
            'invalid_payload',
            parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        );
    }
    return parsed.data;
}

function validateSoulMarkdown(residentName: string, soulMarkdown: string): void {
    const parsed = parseSoulMarkdown(soulMarkdown);
    if (!parsed.frontmatter) {
        throw new CityIntegrationError(400, 'invalid_soul_markdown', 'soulMarkdown must include YAML frontmatter');
    }
    validateSoulFrontmatter(parsed.frontmatter, `city-birth:${residentName}`);
    if ((parsed.frontmatter as { name?: unknown }).name !== residentName) {
        throw new CityIntegrationError(400, 'resident_name_mismatch');
    }
}

function parseSoulMarkdown(raw: string): { frontmatter?: unknown; body: string } {
    if (!raw.startsWith('---')) {
        return { body: raw };
    }
    const end = raw.indexOf('\n---', 3);
    if (end === -1) {
        throw new CityIntegrationError(400, 'invalid_soul_markdown', 'unclosed soulMarkdown frontmatter');
    }
    return {
        frontmatter: yaml.load(raw.slice(3, end).trim()) || {},
        body: raw.slice(end + 4).replace(/^\r?\n/, ''),
    };
}

function normalizeMessage(value: string): string {
    return Array.from(value)
        .map(char => {
            const code = char.charCodeAt(0);
            return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127 ? ' ' : char;
        })
        .join('')
        .trim()
        .slice(0, 2000);
}

function residentFromPayload(payload: unknown): string | undefined {
    return payload && typeof payload === 'object' && typeof (payload as { residentName?: unknown }).residentName === 'string'
        ? (payload as { residentName: string }).residentName
        : undefined;
}

function readJson(filePath: string): unknown | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return undefined;
    }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
    return asArray(value).flatMap(item => (typeof item === 'string' ? [item] : []));
}

function asOptionalNumber(value: unknown): number | null | undefined {
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function storytellerDispatchSummary(digest: Record<string, unknown>, runId: string): CityStorytellerDispatchSummary {
    const operatorWarnings = asStringArray(digest['operatorWarnings']);
    const reviewReasons = asStringArray(digest['reviewReasons']);
    const eventRefsUsed = asStringArray(digest['eventRefsUsed']);
    return {
        dispatchId: asNonEmptyString(digest['dispatchId']) || `${runId}:dispatch`,
        generatedAt: asOptionalString(digest['generatedAt']),
        modelProfile: asOptionalString(digest['modelProfile']),
        needsReview: Boolean(digest['needsReview']),
        warningCount: operatorWarnings.length + reviewReasons.length,
        publicTitle: asOptionalString(digest['publicTitle']),
        publicBody: asOptionalString(digest['publicBody']),
        publicBullets: asStringArray(digest['publicBullets']),
        operatorSummary: asOptionalString(digest['operatorSummary']),
        operatorWarnings,
        reviewReasons,
        eventRefCount: eventRefsUsed.length,
        eventRefsUsed,
        estimatedCostUsd: asOptionalNumber(digest['estimatedCostUsd']),
    };
}

function storytellerLatestStampMs(run: Pick<CityStorytellerLatestSummary, 'dispatch' | 'builtAt' | 'windowEnd' | 'windowStart'>): number {
    const candidates = [run.dispatch?.generatedAt, run.builtAt, run.windowEnd, run.windowStart];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const parsed = Date.parse(candidate);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Number.NEGATIVE_INFINITY;
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    return fs
        .readFileSync(filePath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .flatMap(line => {
            try {
                const parsed = JSON.parse(line);
                return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : [];
            } catch {
                return [];
            }
        });
}

function pruneUndefined(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export function writeBirthSoulFile(soulsDir: string, request: Pick<BirthResidentRequest, 'residentName' | 'soulMarkdown'>): string {
    validateSoulMarkdown(request.residentName, request.soulMarkdown);
    const filePath = path.join(soulsDir, `${request.residentName.replace(/^res:/, '')}.md`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, request.soulMarkdown.endsWith('\n') ? request.soulMarkdown : `${request.soulMarkdown}\n`);
    fs.renameSync(tmpPath, filePath);
    return filePath;
}

export function cityInitialInventory(request: BirthResidentRequest): InitialContainerItem[] | undefined {
    return request.startingInventory as InitialContainerItem[] | undefined;
}
