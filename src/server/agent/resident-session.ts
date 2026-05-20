import { activeWorld } from '@engine/world';
import type { ActionResult, AgentAction, PerceptionEvent } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Resident } from '@engine/world/actor/resident/resident';
import type { ActionLog } from './protocol/action-log';

export interface ResidentActionResult {
    requestId?: string | number;
    result: ActionResult;
}

export interface ResidentObserver {
    id: string;
    sendPerception(resident: Resident, perception: Perception): void;
    sendActionResults?(resident: Resident, results: ReadonlyArray<ResidentActionResult>): void;
    sendEvents?(resident: Resident, events: ReadonlyArray<PerceptionEvent>): void;
}

export interface ResidentSessionOptions {
    autosaveTicks?: number;
    logFullPerceptions?: boolean;
}

export class ResidentSession {
    private readonly observers = new Map<string, ResidentObserver>();
    private readonly resultWaiters: ResultWaiter[] = [];
    private readonly eventWaiters: EventWaiter[] = [];
    private readonly pendingRequestIds: Array<string | number | undefined> = [];
    private readonly tickSubscription;
    private latestPerception: Perception | null = null;
    private closed = false;

    public constructor(
        public readonly resident: Resident,
        private readonly actionLog: ActionLog,
        private readonly options: ResidentSessionOptions = {},
    ) {
        this.tickSubscription = activeWorld.tickComplete.subscribe(() => this.publishTick());
    }

    public get isClosed(): boolean {
        return this.closed;
    }

    public attach(observer: ResidentObserver): void {
        if (this.closed) {
            throw new Error('ESESSION_CLOSED');
        }
        this.observers.set(observer.id, observer);
        if (this.latestPerception) {
            observer.sendPerception(this.resident, this.latestPerception);
        }
    }

    public detach(observerId: string): void {
        this.observers.delete(observerId);
    }

    public submitAction(action: AgentAction, requestId?: string | number): void {
        if (this.closed) {
            throw new Error('ESESSION_CLOSED');
        }
        this.resident.enqueueActions([action]);
        this.pendingRequestIds.push(requestId);
        this.actionLog.append(this.resident.username, { type: 'action', requestId, action });
    }

    public submitActionAndWait(action: AgentAction, requestId?: string | number, timeoutMs = 3000): Promise<ActionResult> {
        if (this.closed) {
            return Promise.resolve({ ok: false, reason: 'session_closed' });
        }
        this.submitAction(action, requestId);
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.removeResultWaiter(resolve);
                resolve({ ok: false, reason: 'action_result_timeout' });
            }, timeoutMs);
            this.resultWaiters.push({ resolve, timer });
        });
    }

    public waitForEvent(kinds: string[] = [], timeoutMs = 30000): Promise<PerceptionEvent | null> {
        if (this.closed) {
            return Promise.resolve(null);
        }
        const matches = (event: PerceptionEvent): boolean => kinds.length === 0 || kinds.includes(event.kind);
        for (const event of this.latestPerception?.events || []) {
            if (matches(event)) {
                return Promise.resolve(event);
            }
        }

        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.removeEventWaiter(resolve);
                resolve(null);
            }, timeoutMs);
            this.eventWaiters.push({ kinds, resolve, timer });
        });
    }

    public close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.tickSubscription.unsubscribe();
        this.resolveAllResultWaiters({ ok: false, reason: 'session_closed' });
        this.resolveEventWaiters(null);
        this.observers.clear();
    }

    private publishTick(): void {
        if (this.closed) {
            return;
        }
        if (!this.resident.isActive) {
            this.close();
            return;
        }

        const perception = this.resident.publishPerception();
        this.latestPerception = perception;
        this.actionLog.append(
            this.resident.username,
            this.options.logFullPerceptions ? { type: 'perception', perception } : { type: 'perception', tick: perception.tick },
        );
        for (const event of perception.events) {
            this.actionLog.append(this.resident.username, { type: 'event', tick: perception.tick, event });
        }
        const actionResults = this.correlateActionResults(this.resident.drainActionResults());
        if (actionResults.length) {
            this.resolveResultWaiters(actionResults.map(actionResult => actionResult.result));
        }
        if (perception.events.length) {
            this.resolveMatchingEventWaiters(perception.events);
        }
        if (this.options.autosaveTicks && perception.tick > 0 && perception.tick % this.options.autosaveTicks === 0) {
            this.resident.save();
        }
        for (const observer of this.observers.values()) {
            observer.sendPerception(this.resident, perception);
            observer.sendEvents?.(this.resident, perception.events);
            observer.sendActionResults?.(this.resident, actionResults);
        }
    }

    private correlateActionResults(results: ReadonlyArray<ActionResult>): ResidentActionResult[] {
        return results.map(result => ({
            requestId: this.pendingRequestIds.shift(),
            result,
        }));
    }

    private resolveResultWaiters(results: ReadonlyArray<ActionResult>): void {
        const waiters = this.resultWaiters.splice(0, results.length);
        for (const [index, waiter] of waiters.entries()) {
            clearTimeout(waiter.timer);
            waiter.resolve(results[index] || results[results.length - 1]);
        }
    }

    private resolveAllResultWaiters(result: ActionResult): void {
        const waiters = this.resultWaiters.splice(0, this.resultWaiters.length);
        for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(result);
        }
    }

    private removeResultWaiter(resolve: ResultWaiter['resolve']): void {
        const index = this.resultWaiters.findIndex(waiter => waiter.resolve === resolve);
        if (index !== -1) {
            this.resultWaiters.splice(index, 1);
        }
    }

    private resolveMatchingEventWaiters(events: ReadonlyArray<PerceptionEvent>): void {
        for (const event of events) {
            for (let i = this.eventWaiters.length - 1; i >= 0; i--) {
                const waiter = this.eventWaiters[i];
                if (waiter.kinds.length === 0 || waiter.kinds.includes(event.kind)) {
                    this.eventWaiters.splice(i, 1);
                    clearTimeout(waiter.timer);
                    waiter.resolve(event);
                }
            }
        }
    }

    private resolveEventWaiters(event: PerceptionEvent | null): void {
        const waiters = this.eventWaiters.splice(0, this.eventWaiters.length);
        for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(event);
        }
    }

    private removeEventWaiter(resolve: EventWaiter['resolve']): void {
        const index = this.eventWaiters.findIndex(waiter => waiter.resolve === resolve);
        if (index !== -1) {
            this.eventWaiters.splice(index, 1);
        }
    }
}

interface ResultWaiter {
    resolve(result: ActionResult): void;
    timer: NodeJS.Timeout;
}

interface EventWaiter {
    kinds: string[];
    resolve(event: PerceptionEvent | null): void;
    timer: NodeJS.Timeout;
}
