import type { ActionResult, AgentAction } from '../transport/message-codecs';
import type { ActionAttempt, ActionFinalStatus, ActionProducer, EffectFailureReason, EffectWaitResult } from './action-attempt';

export interface ActionSubmitter {
    submit(action: AgentAction, metadata?: unknown): Promise<ActionResult>;
}

export interface ActionCoordinatorOptions {
    resident: string;
    submitter: ActionSubmitter;
}

export interface ActionCoordinatorSubmitInput {
    producer: ActionProducer;
    action: AgentAction;
    cause?: string;
    goalId?: string;
    routineRunId?: string;
    traceId?: string;
    metadata?: unknown;
    waitForEffect?: (signal: AbortSignal, attempt: ActionAttempt) => Promise<EffectWaitResult>;
    onAckReady?: (attempt: ActionAttempt) => void;
    onEffectResolved?: (attempt: ActionAttempt) => void;
}

const PRODUCER_PRIORITY: Record<ActionProducer, number> = {
    'nervous-system': 4,
    'manual-admin': 3,
    'active-routine': 2,
    body: 1,
};

export class ActionCoordinator {
    private active?: ActiveAction;
    private seq = 0;

    constructor(private readonly options: ActionCoordinatorOptions) {}

    currentActivity(): ActionAttempt | undefined {
        return this.active?.attempt;
    }

    async submit(input: ActionCoordinatorSubmitInput): Promise<ActionAttempt> {
        const blocked = this.resolveActiveConflict(input);
        if (blocked) {
            return blocked;
        }

        const attempt = this.createAttempt(input);
        const active: ActiveAction = { attempt, abort: new AbortController(), onEffectResolved: input.onEffectResolved };
        this.active = active;
        try {
            attempt.ackResult = await this.options.submitter.submit(input.action, input.metadata);
            if (typeof attempt.ackResult.requestId === 'string') {
                attempt.requestId = attempt.ackResult.requestId;
            }
            this.safeNotifyAck(input.onAckReady, attempt);
            if (attempt.finalStatus === 'interrupted_after_submit') {
                this.notifyEffectResolved(active);
                return attempt;
            }
            if (!attempt.ackResult.ok) {
                attempt.finalStatus = 'failure';
                attempt.finalReason = typeof attempt.ackResult.reason === 'string' ? attempt.ackResult.reason : 'ack_failed';
                this.notifyEffectResolved(active);
                return attempt;
            }
            if (input.waitForEffect) {
                const effectResult = await input.waitForEffect(active.abort.signal, attempt);
                if (finalStatus(attempt) === 'interrupted_after_submit') {
                    this.notifyEffectResolved(active);
                    return attempt;
                }
                this.applyEffectResult(attempt, effectResult);
                this.notifyEffectResolved(active);
                return attempt;
            }
            if (finalStatus(attempt) === 'interrupted_after_submit') {
                this.notifyEffectResolved(active);
                return attempt;
            }
            attempt.finalStatus = 'success';
            this.notifyEffectResolved(active);
            return attempt;
        } finally {
            if (this.active === active) {
                this.active = undefined;
            }
        }
    }

    cancelCurrent(cause = 'cancelled'): ActionAttempt | undefined {
        const active = this.active;
        if (!active) {
            return undefined;
        }
        active.attempt.finalStatus = active.attempt.ackResult ? 'interrupted_after_submit' : 'cancelled_before_submit';
        active.attempt.finalReason = cause;
        active.abort.abort();
        this.active = undefined;
        this.notifyEffectResolved(active);
        return active.attempt;
    }

    private resolveActiveConflict(input: ActionCoordinatorSubmitInput): ActionAttempt | undefined {
        const active = this.active;
        if (!active) {
            return undefined;
        }
        if (PRODUCER_PRIORITY[input.producer] <= PRODUCER_PRIORITY[active.attempt.producer]) {
            return {
                ...this.createAttempt(input),
                finalStatus: 'blocked',
                finalReason: `body_owned_by:${active.attempt.producer}`,
            };
        }
        active.attempt.finalStatus = 'interrupted_after_submit';
        active.attempt.finalReason = `interrupted_by:${input.producer}`;
        active.abort.abort();
        this.active = undefined;
        this.notifyEffectResolved(active);
        return undefined;
    }

    private createAttempt(input: ActionCoordinatorSubmitInput): ActionAttempt {
        return {
            attemptId: `attempt-${Date.now()}-${++this.seq}`,
            resident: this.options.resident,
            producer: input.producer,
            action: input.action,
            submittedAt: new Date().toISOString(),
            cause: input.cause,
            goalId: input.goalId,
            routineRunId: input.routineRunId,
            traceId: input.traceId,
            evidence: [],
            finalStatus: 'accepted',
            metadata: input.metadata,
        };
    }

    private applyEffectResult(attempt: ActionAttempt, result: EffectWaitResult): void {
        attempt.evidence = [...attempt.evidence, ...(result.evidence || [])];
        if (result.ok) {
            attempt.finalStatus = 'success';
            return;
        }
        attempt.finalStatus = effectReasonToStatus(result.reason);
        attempt.finalReason = result.finalReason || result.reason;
    }

    private notifyEffectResolved(active: ActiveAction): void {
        if (active.effectResolvedNotified) {
            return;
        }
        active.effectResolvedNotified = true;
        const callback = active.onEffectResolved;
        if (!callback) {
            return;
        }
        // Evidence-layer errors must not crash the action loop. Per spec
        // (docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md):
        // "evidence loss is preferred over agent loss." Swallow + log.
        try {
            callback(active.attempt);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[action-coordinator] onEffectResolved callback threw; suppressing to protect action loop', error);
        }
    }

    private safeNotifyAck(callback: ((attempt: ActionAttempt) => void) | undefined, attempt: ActionAttempt): void {
        if (!callback) {
            return;
        }
        // Evidence-layer errors must not crash the action loop.
        try {
            callback(attempt);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[action-coordinator] onAckReady callback threw; suppressing to protect action loop', error);
        }
    }
}

interface ActiveAction {
    attempt: ActionAttempt;
    abort: AbortController;
    onEffectResolved?: (attempt: ActionAttempt) => void;
    effectResolvedNotified?: boolean;
}

function effectReasonToStatus(reason: EffectFailureReason): ActionFinalStatus {
    if (reason === 'timeout') {
        return 'timeout';
    }
    if (reason === 'aborted') {
        return 'interrupted_after_submit';
    }
    if (reason === 'blocked') {
        return 'blocked';
    }
    return 'failure';
}

function finalStatus(attempt: ActionAttempt): ActionFinalStatus {
    return attempt.finalStatus;
}
