import { z } from 'zod';
import { parseJsonWithSalvage, type SalvageClassification } from './json-salvage';
import { type HookDefinition, clampHookPriority } from '../spark/hooks';
import { type Plan, planSchema } from '../spark/plan';
import { type NervousRule, clampNervousRulePriority } from '../nervous-system/rules';
import type { AgentAction } from '../transport/message-codecs';
import { agentActionSchema, hookConditionSchema } from '../transport/message-codecs';

export interface MemoWrite {
    path: string;
    text: string;
    mode?: 'append' | 'replace';
}

export interface RememberFactWrite {
    topic: string;
    fact: string;
    reason?: string;
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
    /**
     * S-INFER-1: how the raw completion text was parsed/salvaged. Lets the
     * SPARK orchestrator record WHY an empty completion was empty
     * (think_only_no_answer / schema_mismatch / truly_empty / a recovery)
     * instead of the historical blanket `empty_completion`.
     */
    parseClass?: SalvageClassification;
    plan?: Plan | null;
    memo?: MemoWrite[];
    rememberFact?: RememberFactWrite[];
    indexPatch?: IndexPatch;
    proposeHook?: HookDefinition[];
    retireHook?: string[];
    proposeNervousRule?: NervousRule[];
    retireNervousRule?: string[];
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

const rememberSchema = z.object({
    topic: z.string().min(1).max(80).refine(isSafeRememberTopic, 'remember topic must be a simple memory topic'),
    fact: z.string().min(1).max(500),
    reason: z.string().min(1).max(160).optional(),
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

const nervousRuleSchema = z.object({
    id: z.string().min(1).max(80),
    priority: z.number().int(),
    cooldownTicks: z.number().int().nonnegative().optional(),
    condition: hookConditionSchema,
    action: agentActionSchema,
    interruptThinking: z.boolean().optional(),
    suppressThinking: z.boolean().optional(),
    contextHint: z.string().max(500).optional(),
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
    rememberFact: z.union([rememberSchema, z.array(rememberSchema).max(8)]).optional(),
    indexPatch: z.object({ append: z.array(z.string().min(1).max(300)).max(12).optional() }).optional(),
    proposeHook: z.union([hookSchema, z.array(hookSchema).max(8)]).optional(),
    retireHook: z.union([z.string().min(1).max(80), z.array(z.string().min(1).max(80)).max(8)]).optional(),
    proposeNervousRule: z.union([nervousRuleSchema, z.array(nervousRuleSchema).max(8)]).optional(),
    retireNervousRule: z.union([z.string().min(1).max(80), z.array(z.string().min(1).max(80)).max(8)]).optional(),
    proposeVariables: z.array(variableSchema).max(8).optional(),
});

export function parseCompletion(text: string): ParsedCompletion {
    if (!text.trim()) {
        return { ok: true, actions: [], parseClass: 'truly_empty' };
    }

    try {
        // S-INFER-1: robust salvage replaces the greedy first-{-to-last-}
        // slice. It strips <think> blocks, extracts code fences, walks
        // balanced braces, and tolerates trailing commas — recovering the
        // Qwen3 thinking-mode output the old path silently discarded.
        const salvage = parseJsonWithSalvage(text, completionSchema);
        if (!salvage.value) {
            if (salvage.classification === 'schema_mismatch') {
                // Valid JSON of the wrong shape: a genuine parse failure
                // (e.g. path-traversal memo). Preserve the historical
                // `completion_parse_failed` contract for callers/telemetry.
                return {
                    ok: false,
                    actions: [],
                    cause: 'completion_parse_failed',
                    parseClass: salvage.classification,
                    error: describeSchemaMismatch(salvage.candidates),
                };
            }
            // No usable JSON at all (think-only / empty). Treat as a benign
            // empty completion (actions default to []), tagging the reason.
            return { ok: true, actions: [], parseClass: salvage.classification };
        }

        const data = salvage.value;
        const hooks = data.proposeHook ? (Array.isArray(data.proposeHook) ? data.proposeHook : [data.proposeHook]) : undefined;
        const nervousRules = data.proposeNervousRule
            ? Array.isArray(data.proposeNervousRule)
                ? data.proposeNervousRule
                : [data.proposeNervousRule]
            : undefined;
        const memos = data.memo ? (Array.isArray(data.memo) ? data.memo : [data.memo]) : undefined;
        const rememberFact = data.rememberFact ? (Array.isArray(data.rememberFact) ? data.rememberFact : [data.rememberFact]) : undefined;
        const retireHook = data.retireHook ? (Array.isArray(data.retireHook) ? data.retireHook : [data.retireHook]) : undefined;
        const retireNervousRule = data.retireNervousRule
            ? Array.isArray(data.retireNervousRule)
                ? data.retireNervousRule
                : [data.retireNervousRule]
            : undefined;
        return {
            ok: true,
            actions: data.actions,
            cause: data.cause,
            parseClass: salvage.classification,
            plan: data.plan,
            memo: memos,
            rememberFact,
            indexPatch: data.indexPatch,
            proposeHook: hooks?.map(hook => clampHookPriority({ ...hook, source: 'memory' } as HookDefinition, 80)),
            retireHook,
            proposeNervousRule: nervousRules?.map(rule => clampNervousRulePriority({ ...rule, source: 'memory' } as NervousRule, 100)),
            retireNervousRule,
            proposeVariables: data.proposeVariables,
        };
    } catch (error) {
        return { ok: false, actions: [], cause: 'completion_parse_failed', error: error instanceof Error ? error.message : String(error) };
    }
}

function isSafeRememberTopic(value: string): boolean {
    const topic = value.trim();
    return (
        topic.length > 0 &&
        topic !== '.' &&
        topic !== '..' &&
        !topic.includes('/') &&
        !topic.includes('\\') &&
        !topic.includes('\0') &&
        !topic.includes('..') &&
        !topic.startsWith('.')
    );
}

/**
 * Build a human-readable parse-failure message from the salvaged candidate
 * object strings (those that parsed as JSON but failed the schema). Mirrors
 * the historical `parsed.error.issues` summary so telemetry/logs keep their
 * descriptive shape after the move to balanced-brace salvage.
 */
function describeSchemaMismatch(candidates: string[]): string {
    for (let i = candidates.length - 1; i >= 0; i--) {
        let json: unknown;
        try {
            json = JSON.parse(candidates[i]);
        } catch {
            continue;
        }
        const result = completionSchema.safeParse(json);
        if (!result.success) {
            return result.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
        }
    }
    return 'completion did not match schema';
}
