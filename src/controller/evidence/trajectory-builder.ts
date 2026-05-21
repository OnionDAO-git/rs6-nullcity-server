import { createHash } from 'crypto';
import type { BudgetDecision } from '../llm/budgets';
import type { AgentAction, Perception } from '../transport/message-codecs';
import type { FiredHook } from '../spark/hook-evaluator';
import type { EvidenceStore } from './evidence-store';
import { EVIDENCE_SCHEMA_VERSION, type TrajectoryLine } from './schemas';

export type EndTickReason =
    | 'legacy_complete'
    | 'attention_exhausted'
    | 'plan_continuation'
    | 'hook_noop'
    | `budget_exhausted:${string}`
    | 'parse_failed'
    | 'legacy_complete_post_action'
    | 'tick_complete';

export interface DecisionRecord {
    cause?: string;
    moduleId?: string;
    moduleVersion?: string;
    promptHash?: string;
    completionHash?: string;
    promptTokens?: number;
    completionTokens?: number;
    actionKinds?: string[];
    memoUpdates?: number;
    planChange?: unknown;
}

export interface ActionEffectOutcome {
    status: string;
    reason?: string;
    evidence?: unknown[];
}

export interface TrajectoryBuilderOptions {
    now?: () => Date;
}

export class TrajectoryBuilder {
    private readonly now: () => Date;
    private currentTick = 0;

    constructor(
        private readonly store: EvidenceStore,
        options: TrajectoryBuilderOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
    }

    beginTick(tick: number, perception: Perception): void {
        this.currentTick = tick;
        const encoded = stableEncode(perception);
        this.append('begin_tick', {
            perceptionHash: sha256(encoded),
            perceptionBytes: Buffer.byteLength(encoded, 'utf8'),
        });
    }

    recordHook(winner: FiredHook | null): void {
        this.append('hook', {
            winnerId: winner?.id ?? null,
            priority: winner?.priority ?? null,
            cause: winner?.cause ?? null,
            hookSource: winner?.hook.source ?? null,
        });
    }

    recordBudget(budget: BudgetDecision): void {
        this.append('budget', {
            ok: budget.ok,
            window: budget.window,
            retryAt: budget.retryAt?.toISOString(),
        });
    }

    recordPlan(plan: unknown): void {
        this.append('plan', { plan });
    }

    recordDecision(decision: DecisionRecord): void {
        this.append('decision', decision as Record<string, unknown>);
    }

    recordAction(action: AgentAction, requestId: string): void {
        const actionKind = action.kind;
        this.append(actionKind === 'say' ? 'say' : 'action', {
            requestId,
            actionKind,
            action,
            text: actionKind === 'say' ? action.text : undefined,
            cause: action.cause,
        });
    }

    recordActionResult(requestId: string, outcome: ActionEffectOutcome): void {
        this.append('action_result', {
            requestId,
            status: outcome.status,
            reason: outcome.reason,
            evidence: outcome.evidence,
        });
    }

    recordLegacy(event: unknown): void {
        this.append('legacy_event', { event });
    }

    endTick(reason: EndTickReason): void {
        this.append('end_tick', { reason });
    }

    private append(kind: TrajectoryLine['kind'], fields: Record<string, unknown>): void {
        const session = this.store.currentSession();
        if (!session) {
            throw new Error('Evidence session has not started');
        }
        this.store.appendTrajectory({
            schemaVersion: EVIDENCE_SCHEMA_VERSION,
            ts: this.now().toISOString(),
            tick: this.currentTick,
            sessionId: session.sessionId,
            kind,
            ...fields,
        });
    }
}

function stableEncode(value: unknown): string {
    return JSON.stringify(value);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
