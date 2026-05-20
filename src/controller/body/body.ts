import type { ActionLog } from '../logging/action-log';
import type { SparkModuleIdentity } from '../spark/modules';
import type { GatewayClient } from '../transport/gateway-client';
import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';
import type { BodyObservation, BodyObservationPredicate, BodyWaitOptions, BodyWaitResult } from './body-events';

export interface SubmittedActionAck {
    requestId: string;
    ackResult: ActionResult;
}

export interface BodyGateway {
    submitAction(name: string, action: AgentAction): Promise<ActionResult>;
    submitActionWithRequestId?(name: string, action: AgentAction): Promise<SubmittedActionAck>;
}

export interface BodyActionLogEntry {
    tick: number;
    action: AgentAction;
    result: ActionResult;
    attention_after?: number;
    source?: 'thinking' | 'nervous-system' | 'body';
    ruleId?: string;
    sparkModule?: SparkModuleIdentity;
}

export interface ResidentBodyOptions {
    resident: string;
    gateway: BodyGateway;
    actionLog: ActionLog;
}

export class ResidentBody {
    private latestPerception?: Perception;
    private latestPerceptionAt = 0;
    private latestPerceptionObservation?: BodyObservation<Perception>;
    private perceptionSeq = 0;
    private eventSeq = 0;
    private readonly recentEvents: Array<BodyObservation<PerceptionEvent>> = [];
    private readonly perceptionWaiters: Array<PendingWaiter<Perception>> = [];
    private readonly eventWaiters: Array<PendingWaiter<PerceptionEvent>> = [];

    constructor(private readonly options: ResidentBodyOptions) {}

    observePerception(perception: Perception): void {
        const observation = {
            seq: ++this.perceptionSeq,
            observedAt: Date.now(),
            value: perception,
        };
        this.latestPerception = perception;
        this.latestPerceptionAt = observation.observedAt;
        this.latestPerceptionObservation = observation;
        this.resolveMatchingWaiters(this.perceptionWaiters, observation);
    }

    observeEvent(event: PerceptionEvent): void {
        const observation = {
            seq: ++this.eventSeq,
            observedAt: Date.now(),
            value: event,
        };
        this.recentEvents.push(observation);
        if (this.recentEvents.length > 100) {
            this.recentEvents.splice(0, this.recentEvents.length - 100);
        }
        this.resolveMatchingWaiters(this.eventWaiters, observation);
    }

    getLatestPerception(): Perception | undefined {
        return this.latestPerception;
    }

    getLatestPerceptionSeq(): number {
        return this.perceptionSeq;
    }

    getLatestEventSeq(): number {
        return this.eventSeq;
    }

    getPerceptionAgeMs(now = Date.now()): number | undefined {
        return this.latestPerceptionAt > 0 ? now - this.latestPerceptionAt : undefined;
    }

    getRecentEvents(kinds: string[] = []): PerceptionEvent[] {
        if (kinds.length === 0) {
            return this.recentEvents.map(event => event.value);
        }
        return this.recentEvents.map(event => event.value).filter(event => event.kind && kinds.includes(event.kind));
    }

    getPendingWaiterCount(): number {
        return this.perceptionWaiters.length + this.eventWaiters.length;
    }

    waitForPerception(predicate: BodyObservationPredicate<Perception>, options: BodyWaitOptions): Promise<BodyWaitResult<Perception>> {
        const current = this.latestPerceptionObservation;
        if (this.matchesCurrent(current, predicate, options)) {
            return Promise.resolve({ ok: true, observation: current });
        }
        return this.addWaiter(this.perceptionWaiters, predicate, options);
    }

    waitForEvent(predicate: BodyObservationPredicate<PerceptionEvent>, options: BodyWaitOptions): Promise<BodyWaitResult<PerceptionEvent>> {
        const current = this.recentEvents.find(event => this.matchesCurrent(event, predicate, options));
        if (current) {
            return Promise.resolve({ ok: true, observation: current });
        }
        return this.addWaiter(this.eventWaiters, predicate, options);
    }

    async submit(action: AgentAction, metadata: Omit<BodyActionLogEntry, 'action' | 'result'>): Promise<ActionResult> {
        const result = await this.submitToGateway(action);
        this.options.actionLog.append(this.options.resident, {
            ...metadata,
            action,
            result,
        });
        return result;
    }

    private async submitToGateway(action: AgentAction): Promise<ActionResult> {
        if (this.options.gateway.submitActionWithRequestId) {
            const submitted = await this.options.gateway.submitActionWithRequestId(this.options.resident, action);
            return { ...submitted.ackResult, requestId: submitted.requestId };
        }
        return this.options.gateway.submitAction(this.options.resident, action);
    }

    private matchesCurrent<TValue>(
        observation: BodyObservation<TValue> | undefined,
        predicate: BodyObservationPredicate<TValue>,
        options: BodyWaitOptions,
    ): observation is BodyObservation<TValue> {
        if (!observation || options.includeCurrent === false || observation.seq <= (options.afterSeq || 0)) {
            return false;
        }
        return predicate(observation.value, observation);
    }

    private addWaiter<TValue>(
        waiters: Array<PendingWaiter<TValue>>,
        predicate: BodyObservationPredicate<TValue>,
        options: BodyWaitOptions,
    ): Promise<BodyWaitResult<TValue>> {
        if (options.signal?.aborted) {
            return Promise.resolve({ ok: false, reason: 'aborted' });
        }

        return new Promise(resolve => {
            const waiter: PendingWaiter<TValue> = {
                afterSeq: options.afterSeq || 0,
                predicate,
                resolve,
                timer: setTimeout(() => this.finishWaiter(waiters, waiter, { ok: false, reason: 'timeout' }), options.timeoutMs),
            };
            if (options.signal) {
                waiter.abort = () => this.finishWaiter(waiters, waiter, { ok: false, reason: 'aborted' });
                options.signal.addEventListener('abort', waiter.abort, { once: true });
                waiter.signal = options.signal;
            }
            waiters.push(waiter);
        });
    }

    private resolveMatchingWaiters<TValue>(waiters: Array<PendingWaiter<TValue>>, observation: BodyObservation<TValue>): void {
        for (const waiter of waiters.slice()) {
            if (observation.seq <= waiter.afterSeq || !waiter.predicate(observation.value, observation)) {
                continue;
            }
            this.finishWaiter(waiters, waiter, { ok: true, observation });
        }
    }

    private finishWaiter<TValue>(
        waiters: Array<PendingWaiter<TValue>>,
        waiter: PendingWaiter<TValue>,
        result: BodyWaitResult<TValue>,
    ): void {
        const index = waiters.indexOf(waiter);
        if (index === -1) {
            return;
        }
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        if (waiter.signal && waiter.abort) {
            waiter.signal.removeEventListener('abort', waiter.abort);
        }
        waiter.resolve(result);
    }
}

export function createGatewayBody(resident: string, gateway: GatewayClient, actionLog: ActionLog): ResidentBody {
    return new ResidentBody({ resident, gateway, actionLog });
}

interface PendingWaiter<TValue> {
    afterSeq: number;
    predicate: BodyObservationPredicate<TValue>;
    resolve(result: BodyWaitResult<TValue>): void;
    timer: NodeJS.Timeout;
    signal?: AbortSignal;
    abort?: () => void;
}
