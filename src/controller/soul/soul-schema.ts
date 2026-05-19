import { z } from 'zod';

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
    startingBeliefs?: string[];
    spawnPosition?: unknown;
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

export const soulFrontmatterSchema = z.object({
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
    startingBeliefs: z.array(z.string()).optional(),
    spawnPosition: z.unknown().optional(),
});

export function validateSoulFrontmatter(value: unknown, sourcePath: string): SoulFrontmatter {
    const parsed = soulFrontmatterSchema.safeParse(value);
    if (!parsed.success) {
        const message = parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
        throw new Error(`Invalid soul frontmatter in ${sourcePath}: ${message}`);
    }

    const frontmatter = parsed.data;
    return {
        ...frontmatter,
        legacy: frontmatter.legacy || { kind: frontmatter.archetype, parameters: {} },
    };
}
