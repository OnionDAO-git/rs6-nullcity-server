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
    waitForEffect?: () => Promise<EffectWaitResult>;
}

const PRODUCER_PRIORITY: Record<ActionProducer, number> = {
    'nervous-system': 4,
    'manual-admin': 3,
    'active-routine': 2,
    body: 1,
};

export class ActionCoordinator {
    private active?: ActionAttempt;
    private seq = 0;

    constructor(private readonly options: ActionCoordinatorOptions) {}

    currentActivity(): ActionAttempt | undefined {
        return this.active;
    }

    async submit(input: ActionCoordinatorSubmitInput): Promise<ActionAttempt> {
        const blocked = this.resolveActiveConflict(input);
        if (blocked) {
            return blocked;
        }

        const attempt = this.createAttempt(input);
        this.active = attempt;
        try {
            attempt.ackResult = await this.options.submitter.submit(input.action, input.metadata);
            if (typeof attempt.ackResult.requestId === 'string') {
                attempt.requestId = attempt.ackResult.requestId;
            }
            if (attempt.finalStatus === 'interrupted_after_submit') {
                return attempt;
            }
            if (!attempt.ackResult.ok) {
                attempt.finalStatus = 'failure';
                attempt.finalReason = typeof attempt.ackResult.reason === 'string' ? attempt.ackResult.reason : 'ack_failed';
                return attempt;
            }
            if (input.waitForEffect) {
                const effectResult = await input.waitForEffect();
                if (finalStatus(attempt) === 'interrupted_after_submit') {
                    return attempt;
                }
                this.applyEffectResult(attempt, effectResult);
                return attempt;
            }
            if (finalStatus(attempt) === 'interrupted_after_submit') {
                return attempt;
            }
            attempt.finalStatus = 'success';
            return attempt;
        } finally {
            if (this.active === attempt) {
                this.active = undefined;
            }
        }
    }

    cancelCurrent(cause = 'cancelled'): ActionAttempt | undefined {
        const active = this.active;
        if (!active) {
            return undefined;
        }
        active.finalStatus = active.ackResult ? 'interrupted_after_submit' : 'cancelled_before_submit';
        active.finalReason = cause;
        this.active = undefined;
        return active;
    }

    private resolveActiveConflict(input: ActionCoordinatorSubmitInput): ActionAttempt | undefined {
        const active = this.active;
        if (!active) {
            return undefined;
        }
        if (PRODUCER_PRIORITY[input.producer] <= PRODUCER_PRIORITY[active.producer]) {
            return {
                ...this.createAttempt(input),
                finalStatus: 'blocked',
                finalReason: `body_owned_by:${active.producer}`,
            };
        }
        active.finalStatus = 'interrupted_after_submit';
        active.finalReason = `interrupted_by:${input.producer}`;
        this.active = undefined;
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
        attempt.finalReason = result.reason;
    }
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
