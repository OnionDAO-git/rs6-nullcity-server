import { createHash } from 'crypto';
import type { BudgetDecision } from '../llm/budgets';
import type { AgentAction, Perception } from '../transport/message-codecs';
import type { FiredHook } from '../spark/hook-evaluator';
import type { EvidenceStore } from './evidence-store';
import { EVIDENCE_SCHEMA_VERSION, type EndTickReason, type TrajectoryLine } from './schemas';

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

    beginTick(tick: number, perception: Perception): TrajectoryLine {
        this.currentTick = tick;
        const encoded = stableEncode(perception);
        return this.append('begin_tick', {
            perceptionHash: sha256(encoded),
            perceptionBytes: Buffer.byteLength(encoded, 'utf8'),
        });
    }

    recordHook(winner: FiredHook | null): TrajectoryLine {
        return this.append('hook', {
            winnerId: winner?.id ?? null,
            priority: winner?.priority ?? null,
            cause: winner?.cause ?? null,
            hookSource: winner?.hook.source ?? null,
        });
    }

    recordBudget(budget: BudgetDecision): TrajectoryLine {
        return this.append('budget', {
            ok: budget.ok,
            window: budget.window,
            retryAt: budget.retryAt?.toISOString(),
        });
    }

    recordPlan(plan: unknown): TrajectoryLine {
        return this.append('plan', { plan });
    }

    recordDecision(decision: DecisionRecord): TrajectoryLine {
        return this.append('decision', decision as Record<string, unknown>);
    }

    recordAction(action: AgentAction, requestId: string): TrajectoryLine {
        const actionKind = action.kind;
        return this.append(actionKind === 'say' ? 'say' : 'action', {
            requestId,
            actionKind,
            action,
            text: actionKind === 'say' ? action.text : undefined,
            cause: action.cause,
        });
    }

    recordActionResult(requestId: string, outcome: ActionEffectOutcome): TrajectoryLine {
        return this.append('action_result', {
            requestId,
            status: outcome.status,
            reason: outcome.reason,
            evidence: outcome.evidence,
        });
    }

    /**
     * Record a legacy event. The payload is intentionally nested under `event:`
     * so the line shape is `{ kind: 'legacy_event', event: {...} }`. Downstream
     * consumers (`library-updater.ts`, `significance.ts`, `portrait-template.ts`)
     * read `line.event.*`, not flat fields. Preserve this nesting convention
     * to avoid breaking those consumers.
     */
    recordLegacy(event: unknown): TrajectoryLine {
        return this.append('legacy_event', { event });
    }

    recordPatron(fields: {
        patronKind: 'patron_gift' | 'patron_witness' | 'patron_sponsor';
        patronHandle: string;
        artifact?: string;
        note?: string;
    }): TrajectoryLine {
        return this.append('patron', fields);
    }

    endTick(reason: EndTickReason): TrajectoryLine {
        return this.append('end_tick', { reason });
    }

    public append(kind: TrajectoryLine['kind'], fields: Record<string, unknown>): TrajectoryLine {
        const session = this.store.currentSession();
        if (!session) {
            throw new Error('Evidence session has not started');
        }
        const line: TrajectoryLine = {
            schemaVersion: EVIDENCE_SCHEMA_VERSION,
            ts: this.now().toISOString(),
            tick: this.currentTick,
            sessionId: session.sessionId,
            kind,
            ...fields,
        };
        this.store.appendTrajectory(line);
        return line;
    }
}

function stableEncode(value: unknown): string {
    return JSON.stringify(value);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
