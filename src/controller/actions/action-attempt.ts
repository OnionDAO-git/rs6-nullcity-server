import type { ActionResult, AgentAction } from '../transport/message-codecs';

export type ActionProducer = 'nervous-system' | 'manual-admin' | 'active-routine' | 'body';

export type ActionFinalStatus =
    | 'accepted'
    | 'success'
    | 'failure'
    | 'blocked'
    | 'timeout'
    | 'cancelled_before_submit'
    | 'interrupted_after_submit';

export interface ActionEvidence {
    source: 'perception' | 'event' | 'action_result' | 'derived' | 'heuristic';
    detail: unknown;
}

export interface ActionAttempt {
    attemptId: string;
    resident: string;
    producer: ActionProducer;
    action: AgentAction;
    submittedAt: string;
    goalId?: string;
    routineRunId?: string;
    traceId?: string;
    requestId?: string;
    cause?: string;
    metadata?: unknown;
    ackResult?: ActionResult;
    evidence: ActionEvidence[];
    finalStatus: ActionFinalStatus;
    finalReason?: string;
}

export type EffectWaitResult =
    | { ok: true; evidence?: ActionEvidence[] }
    | { ok: false; reason: 'timeout' | 'aborted' | 'blocked' | 'failure'; finalReason?: string; evidence?: ActionEvidence[] };

export type EffectFailureReason = Extract<EffectWaitResult, { ok: false }>['reason'];
