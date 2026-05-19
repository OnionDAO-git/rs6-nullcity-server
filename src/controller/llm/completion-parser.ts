import { z } from 'zod';
import { type HookDefinition, clampHookPriority } from '../spark/hooks';
import { type Plan, planSchema } from '../spark/plan';
import type { AgentAction } from '../transport/message-codecs';
import { agentActionSchema, hookConditionSchema } from '../transport/message-codecs';

export interface MemoWrite {
    path: string;
    text: string;
    mode?: 'append' | 'replace';
}

export interface IndexPatch {
    append?: string[];
}

export interface ProposedVariable {
    id: string;
    initial?: number;
    expression?: string;
    increment?: string | number;
    decrement?: string | number;
    decay?: string | number;
    min?: number;
    max?: number;
}

export interface ParsedCompletion {
    ok: boolean;
    actions: AgentAction[];
    cause?: string;
    plan?: Plan | null;
    memo?: MemoWrite[];
    indexPatch?: IndexPatch;
    proposeHook?: HookDefinition[];
    retireHook?: string[];
    proposeVariables?: ProposedVariable[];
    error?: string;
}

const memoSchema = z.object({
    path: z
        .string()
        .min(1)
        .max(180)
        .refine(value => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'), 'memo path must stay inside memory dir'),
    text: z.string().min(1).max(4000),
    mode: z.enum(['append', 'replace']).optional(),
});

const hookSchema = z.object({
    id: z.string().min(1).max(80),
    priority: z.number().int(),
    cooldownTicks: z.number().int().nonnegative().optional(),
    condition: hookConditionSchema,
    contextHint: z.string().max(500).optional(),
    interrupt: z.boolean().optional(),
    source: z.enum(['system', 'soul', 'memory']).optional(),
});

const variableSchema = z.object({
    id: z.string().min(1).max(80),
    initial: z.number().optional(),
    expression: z.string().max(200).optional(),
    increment: z.union([z.string(), z.number()]).optional(),
    decrement: z.union([z.string(), z.number()]).optional(),
    decay: z.union([z.string(), z.number()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
});

export const completionSchema = z.object({
    cause: z.string().optional(),
    actions: z.array(agentActionSchema).max(8).default([]),
    plan: planSchema.nullable().optional(),
    memo: z.union([memoSchema, z.array(memoSchema).max(8)]).optional(),
    indexPatch: z.object({ append: z.array(z.string().min(1).max(300)).max(12).optional() }).optional(),
    proposeHook: z.union([hookSchema, z.array(hookSchema).max(8)]).optional(),
    retireHook: z.union([z.string().min(1).max(80), z.array(z.string().min(1).max(80)).max(8)]).optional(),
    proposeVariables: z.array(variableSchema).max(8).optional(),
});

export function parseCompletion(text: string): ParsedCompletion {
    if (!text.trim()) {
        return { ok: true, actions: [] };
    }

    try {
        const parsed = completionSchema.safeParse(extractJson(text));
        if (!parsed.success) {
            return {
                ok: false,
                actions: [],
                cause: 'completion_parse_failed',
                error: parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; '),
            };
        }

        const data = parsed.data;
        const hooks = data.proposeHook ? (Array.isArray(data.proposeHook) ? data.proposeHook : [data.proposeHook]) : undefined;
        const memos = data.memo ? (Array.isArray(data.memo) ? data.memo : [data.memo]) : undefined;
        const retireHook = data.retireHook ? (Array.isArray(data.retireHook) ? data.retireHook : [data.retireHook]) : undefined;
        return {
            ok: true,
            actions: data.actions,
            cause: data.cause,
            plan: data.plan,
            memo: memos,
            indexPatch: data.indexPatch,
            proposeHook: hooks?.map(hook => clampHookPriority({ ...hook, source: 'memory' } as HookDefinition, 80)),
            retireHook,
            proposeVariables: data.proposeVariables,
        };
    } catch (error) {
        return { ok: false, actions: [], cause: 'completion_parse_failed', error: error instanceof Error ? error.message : String(error) };
    }
}

function extractJson(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
    }

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
        return JSON.parse(trimmed.slice(first, last + 1));
    }

    return JSON.parse(trimmed);
}
