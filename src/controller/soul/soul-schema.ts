import { z } from 'zod';
import type { SoulSparkModuleSelection } from '../spark/modules';
import type { InitialContainerItem } from '../transport/message-codecs';
import type { AgentAction } from '../transport/message-codecs';
import { agentActionSchema } from '../transport/message-codecs';

export type SoulArchetype = 'mentor' | 'achiever' | 'endurer';
export type DecayCurve = 'gentle' | 'standard' | 'steep';

export interface SoulFrontmatter {
    name: string;
    display?: string;
    archetype: SoulArchetype;
    voice?: {
        register?: string;
        quirks?: string[];
    };
    fears?: string[];
    loves?: string[];
    model?: {
        endpoint?: string;
        model?: string;
        temperature?: number;
    };
    attentionProfile?: {
        startingAttention?: number;
        decayCurve?: DecayCurve;
    };
    legacy?: {
        kind: SoulArchetype;
        parameters?: Record<string, unknown>;
    };
    variables?: SoulVariableDefinition[];
    hooks?: SoulHookDefinition[];
    nervousSystem?: SoulNervousRuleDefinition[];
    behavior?: SoulBehaviorDefinition;
    modules?: SoulSparkModuleSelection[];
    startingBeliefs?: string[];
    spawnPosition?: unknown;
    initialInventory?: InitialContainerItem[];
    initialEquipment?: InitialContainerItem[];
}

export interface Soul {
    frontmatter: SoulFrontmatter;
    body: string;
    sourcePath: string;
}

export interface SoulVariableDefinition {
    name: string;
    initial?: number;
    tick?: VariableOperation[];
}

export interface VariableOperation {
    op: 'set' | 'increment' | 'decrement' | 'decay' | 'clamp';
    value?: number | string;
    min?: number;
    max?: number;
}

export interface SoulHookDefinition {
    id: string;
    priority: number;
    cooldownTicks?: number;
    condition: {
        kind: string;
        value?: unknown;
        [key: string]: unknown;
    };
    contextHint?: string;
    interruptInflight?: boolean;
}

export interface SoulNervousRuleDefinition {
    id: string;
    priority: number;
    cooldownTicks?: number;
    condition: {
        kind: string;
        value?: unknown;
        [key: string]: unknown;
    };
    action: AgentAction;
    interruptThinking?: boolean;
    suppressThinking?: boolean;
    contextHint?: string;
}

export type SoulBehaviorDefinition = BasicAgentBehaviorDefinition | HybridAgentBehaviorDefinition;

export interface BasicAgentBehaviorDefinition {
    kind: 'basic-agent';
    followPlayer?: string;
    followRadius?: number;
    commandPrefix?: string;
    commentEveryTicks?: number;
}

export interface HybridAgentBehaviorDefinition {
    kind: 'hybrid-agent';
    followPlayer?: string;
    followRadius?: number;
    commandPrefix?: string;
    brainEveryTicks?: number;
    bodyEveryTicks?: number;
    shareGoalsEveryTicks?: number;
    returnToAnchorEveryTicks?: number;
    returnToAnchorRadius?: number;
    visibilityAnchor?: { x: number; y: number; level?: number };
    brain?: InferenceProfileDefinition;
    body?: InferenceProfileDefinition;
}

export interface InferenceProfileDefinition {
    endpoint?: string;
    model?: string;
    temperature?: number;
    thinking?: boolean;
}

const soulArchetypeSchema = z.enum(['mentor', 'achiever', 'endurer']);
const decayCurveSchema = z.enum(['gentle', 'standard', 'steep']);
const variableOperationSchema = z.object({
    op: z.enum(['set', 'increment', 'decrement', 'decay', 'clamp']),
    value: z.union([z.number(), z.string()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
});
const soulVariableSchema = z.object({
    name: z.string().min(1),
    initial: z.number().optional(),
    tick: z.array(variableOperationSchema).optional(),
});
const soulHookSchema = z.object({
    id: z.string().min(1),
    priority: z.number().int(),
    cooldownTicks: z.number().int().nonnegative().optional(),
    condition: z.object({ kind: z.string().min(1) }).passthrough(),
    contextHint: z.string().optional(),
    interruptInflight: z.boolean().optional(),
});
const soulNervousRuleSchema = z.object({
    id: z.string().min(1),
    priority: z.number().int(),
    cooldownTicks: z.number().int().nonnegative().optional(),
    condition: z.object({ kind: z.string().min(1) }).passthrough(),
    action: agentActionSchema,
    interruptThinking: z.boolean().optional(),
    suppressThinking: z.boolean().optional(),
    contextHint: z.string().optional(),
});
const behaviorPositionSchema = z.object({
    x: z.number(),
    y: z.number(),
    level: z.number().optional(),
});
const inferenceProfileSchema = z.object({
    endpoint: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    thinking: z.boolean().optional(),
});
const initialContainerItemSchema = z.union([
    z.number().int(),
    z.string().min(1),
    z.object({ itemId: z.number().int(), amount: z.number().int().positive().optional() }),
    z.null(),
]);
const basicAgentBehaviorSchema = z.object({
    kind: z.literal('basic-agent'),
    followPlayer: z.string().min(1).optional(),
    followRadius: z.number().int().nonnegative().optional(),
    commandPrefix: z.string().min(1).optional(),
    commentEveryTicks: z.number().int().nonnegative().optional(),
});
const hybridAgentBehaviorSchema = z.object({
    kind: z.literal('hybrid-agent'),
    followPlayer: z.string().min(1).optional(),
    followRadius: z.number().int().nonnegative().optional(),
    commandPrefix: z.string().min(1).optional(),
    brainEveryTicks: z.number().int().positive().optional(),
    bodyEveryTicks: z.number().int().positive().optional(),
    shareGoalsEveryTicks: z.number().int().nonnegative().optional(),
    returnToAnchorEveryTicks: z.number().int().nonnegative().optional(),
    returnToAnchorRadius: z.number().int().nonnegative().optional(),
    visibilityAnchor: behaviorPositionSchema.optional(),
    brain: inferenceProfileSchema.optional(),
    body: inferenceProfileSchema.optional(),
});
const soulBehaviorSchema = z.discriminatedUnion('kind', [basicAgentBehaviorSchema, hybridAgentBehaviorSchema]);
const soulSparkModuleSchema = z
    .object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export const soulFrontmatterSchema = z
    .object({
        name: z.string().min(1),
        display: z.string().optional(),
        archetype: soulArchetypeSchema,
        voice: z
            .object({
                register: z.string().optional(),
                quirks: z.array(z.string()).optional(),
            })
            .optional(),
        fears: z.array(z.string()).optional(),
        loves: z.array(z.string()).optional(),
        model: z
            .object({
                endpoint: z.string().optional(),
                model: z.string().min(1).optional(),
                temperature: z.number().min(0).max(2).optional(),
            })
            .optional(),
        attentionProfile: z
            .object({
                startingAttention: z.number().positive().optional(),
                decayCurve: decayCurveSchema.default('standard'),
            })
            .default({ decayCurve: 'standard' }),
        legacy: z
            .object({
                kind: soulArchetypeSchema,
                parameters: z.record(z.string(), z.unknown()).default({}),
            })
            .optional(),
        variables: z.array(soulVariableSchema).optional(),
        hooks: z.array(soulHookSchema).optional(),
        nervousSystem: z.array(soulNervousRuleSchema).optional(),
        behavior: soulBehaviorSchema.optional(),
        modules: z.array(soulSparkModuleSchema).optional(),
        startingBeliefs: z.array(z.string()).optional(),
        spawnPosition: z.unknown().optional(),
        initialInventory: z.array(initialContainerItemSchema).max(28).optional(),
        initialEquipment: z.array(initialContainerItemSchema).max(14).optional(),
    })
    .strict();

export function validateSoulFrontmatter(value: unknown, sourcePath: string): SoulFrontmatter {
    const parsed = soulFrontmatterSchema.safeParse(value);
    if (!parsed.success) {
        const message = parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
        throw new Error(`Invalid soul frontmatter in ${sourcePath}: ${message}`);
    }

    const frontmatter = parsed.data;
    validateUniqueModuleSelections(frontmatter.modules);
    return {
        ...frontmatter,
        legacy: frontmatter.legacy || { kind: frontmatter.archetype, parameters: {} },
    };
}

function validateUniqueModuleSelections(modules: SoulSparkModuleSelection[] | undefined): void {
    if (!modules) {
        return;
    }
    const seen = new Set<string>();
    for (const module of modules) {
        if (seen.has(module.id)) {
            throw new Error(`Duplicate SPARK module selection ${module.id}`);
        }
        seen.add(module.id);
    }
}
