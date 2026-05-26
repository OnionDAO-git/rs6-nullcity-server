import type { AgentAction } from '../transport/message-codecs';
import type { AdvanceCondition, Plan } from './plan';
import { matchEventKind } from '../perception/event-matcher';

export interface PlanExecutorInput {
    tick: number;
    perception: unknown;
    lastActionResult?: unknown;
}

export interface PlanExecutorResult {
    action?: AgentAction;
    complete: boolean;
    abandoned?: boolean;
    cause?: string;
}

export class PlanExecutor {
    nextAction(plan: Plan | undefined, input?: PlanExecutorInput): AgentAction | undefined {
        return this.tick(plan, input || { tick: 0, perception: undefined }).action;
    }

    tick(plan: Plan | undefined, input: PlanExecutorInput): PlanExecutorResult {
        if (!plan) {
            return { complete: true };
        }

        if (plan.maxTicks && plan.installedAtTick !== undefined && input.tick - plan.installedAtTick >= plan.maxTicks) {
            return { complete: true, abandoned: true, cause: 'plan_max_ticks' };
        }

        const step = plan.steps[plan.currentStep];
        if (!step) {
            return { complete: true };
        }

        if (step.maxTicks && step.submittedAtTick !== undefined && input.tick - step.submittedAtTick >= step.maxTicks) {
            step.state = 'complete';
            plan.currentStep += 1;
            return { complete: plan.currentStep >= plan.steps.length, abandoned: true, cause: `step_max_ticks:${step.id}` };
        }

        if (step.abandonIf && conditionMet(step.abandonIf, input, step)) {
            return { complete: true, abandoned: true, cause: `step_abandon:${step.id}` };
        }

        if (step.state === 'submitted') {
            if (conditionMet(step.advanceWhen, input, step)) {
                step.state = 'complete';
                plan.currentStep += 1;
                return this.tick(plan, input);
            }

            return { complete: false };
        }

        step.state = 'submitted';
        step.submittedAtTick = input.tick;
        return { action: step.action, complete: false };
    }
}

function conditionMet(condition: AdvanceCondition, input: PlanExecutorInput, step: { submittedAtTick?: number }): boolean {
    switch (condition.kind) {
        case 'next_tick':
            return step.submittedAtTick !== undefined && input.tick > step.submittedAtTick;
        case 'action_result':
            return Boolean(input.lastActionResult);
        case 'ticks_elapsed':
            return step.submittedAtTick !== undefined && input.tick - step.submittedAtTick >= Number(condition.value || 0);
        case 'event_kind':
            return hasEventKind(input.perception, String(condition.value || ''));
        case 'perception_path_equals': {
            const expected = isRecord(condition.value) ? condition.value : {};
            const path = typeof expected.path === 'string' ? expected.path : '';
            return readPath(input.perception, path) === expected.value;
        }
        case 'never':
            return false;
        default:
            return false;
    }
}

function hasEventKind(value: unknown, kind: string): boolean {
    if (!kind) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(item => hasEventKind(item, kind));
    }
    if (!isRecord(value)) {
        return false;
    }
    const actualKind = String(value.kind || value.type || '');
    if (actualKind && matchEventKind(actualKind, kind)) {
        return true;
    }
    return Object.values(value).some(item => Array.isArray(item) && item.some(child => hasEventKind(child, kind)));
}

function readPath(value: unknown, dottedPath: string): unknown {
    let current = value;
    for (const part of dottedPath.split('.').filter(Boolean)) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
