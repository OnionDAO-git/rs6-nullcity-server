import type { ActionLog } from '../logging/action-log';
import type { GatewayClient } from '../transport/gateway-client';
import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';

export interface BodyGateway {
    submitAction(name: string, action: AgentAction): Promise<ActionResult>;
}

export interface BodyActionLogEntry {
    tick: number;
    action: AgentAction;
    result: ActionResult;
    attention_after?: number;
    source?: 'thinking' | 'nervous-system' | 'body';
    ruleId?: string;
}

export interface ResidentBodyOptions {
    resident: string;
    gateway: BodyGateway;
    actionLog: ActionLog;
}

export class ResidentBody {
    private latestPerception?: Perception;
    private latestPerceptionAt = 0;
    private readonly recentEvents: PerceptionEvent[] = [];

    constructor(private readonly options: ResidentBodyOptions) {}

    observePerception(perception: Perception): void {
        this.latestPerception = perception;
        this.latestPerceptionAt = Date.now();
    }

    observeEvent(event: PerceptionEvent): void {
        this.recentEvents.push(event);
        if (this.recentEvents.length > 100) {
            this.recentEvents.splice(0, this.recentEvents.length - 100);
        }
    }

    getLatestPerception(): Perception | undefined {
        return this.latestPerception;
    }

    getPerceptionAgeMs(now = Date.now()): number | undefined {
        return this.latestPerceptionAt > 0 ? now - this.latestPerceptionAt : undefined;
    }

    getRecentEvents(kinds: string[] = []): PerceptionEvent[] {
        if (kinds.length === 0) {
            return [...this.recentEvents];
        }
        return this.recentEvents.filter(event => event.kind && kinds.includes(event.kind));
    }

    async submit(action: AgentAction, metadata: Omit<BodyActionLogEntry, 'action' | 'result'>): Promise<ActionResult> {
        const result = await this.options.gateway.submitAction(this.options.resident, action);
        this.options.actionLog.append(this.options.resident, {
            ...metadata,
            action,
            result,
        });
        return result;
    }
}

export function createGatewayBody(resident: string, gateway: GatewayClient, actionLog: ActionLog): ResidentBody {
    return new ResidentBody({ resident, gateway, actionLog });
}
