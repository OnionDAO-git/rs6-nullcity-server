import { z } from 'zod';
import type { AgentAction } from '../transport/message-codecs';
import { agentActionSchema } from '../transport/message-codecs';

export interface AdvanceCondition {
    kind: 'next_tick' | 'action_result' | 'ticks_elapsed' | 'event_kind' | 'perception_path_equals' | 'never';
    value?: unknown;
}

export interface PlanStep {
    id: string;
    action: AgentAction;
    advanceWhen: AdvanceCondition;
    state?: 'not_started' | 'submitted' | 'complete';
    submittedAtTick?: number;
    maxTicks?: number;
    abandonIf?: AdvanceCondition;
}

export interface Plan {
    id: string;
    steps: PlanStep[];
    currentStep: number;
    cause?: string;
    previousIntent?: PlanIntent;
    maxTicks?: number;
    installedAtTick?: number;
}

export interface PlanIntent {
    planId: string;
    cause?: string;
    remainingSteps: Array<Pick<PlanStep, 'id' | 'action' | 'advanceWhen'>>;
}

export const advanceConditionSchema = z.object({
    kind: z.enum(['next_tick', 'action_result', 'ticks_elapsed', 'event_kind', 'perception_path_equals', 'never']),
    value: z.unknown().optional(),
});

export const planStepSchema = z.object({
    id: z.string().min(1),
    action: agentActionSchema,
    advanceWhen: advanceConditionSchema.default({ kind: 'action_result' }),
    state: z.enum(['not_started', 'submitted', 'complete']).optional(),
    submittedAtTick: z.number().int().optional(),
    maxTicks: z.number().int().positive().optional(),
    abandonIf: advanceConditionSchema.optional(),
});

export const planSchema = z.object({
    id: z.string().min(1),
    steps: z.array(planStepSchema).max(32),
    currentStep: z.number().int().nonnegative().default(0),
    cause: z.string().optional(),
    previousIntent: z
        .object({
            planId: z.string(),
            cause: z.string().optional(),
            remainingSteps: z.array(
                z.object({
                    id: z.string(),
                    action: agentActionSchema,
                    advanceWhen: advanceConditionSchema,
                }),
            ),
        })
        .optional(),
    maxTicks: z.number().int().positive().optional(),
    installedAtTick: z.number().int().optional(),
});

export function installPlan(
    plan: Omit<Plan, 'currentStep'> & Partial<Pick<Plan, 'currentStep'>>,
    tick: number,
    previousIntent?: PlanIntent,
): Plan {
    return {
        ...plan,
        currentStep: plan.currentStep ?? 0,
        installedAtTick: tick,
        previousIntent,
        steps: plan.steps.map(step => ({
            ...step,
            state: step.state || 'not_started',
        })),
    };
}

export function remainingIntent(plan: Plan | undefined): PlanIntent | undefined {
    if (!plan) {
        return undefined;
    }

    return {
        planId: plan.id,
        cause: plan.cause,
        remainingSteps: plan.steps.slice(plan.currentStep).map(step => ({
            id: step.id,
            action: step.action,
            advanceWhen: step.advanceWhen,
        })),
    };
}
