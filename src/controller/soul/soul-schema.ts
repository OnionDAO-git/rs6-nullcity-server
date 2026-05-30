import { z } from 'zod';
import type { SoulSparkModuleSelection } from '../spark/modules';
import type { InitialContainerItem } from '../transport/message-codecs';
import type { AgentAction } from '../transport/message-codecs';
import { agentActionSchema } from '../transport/message-codecs';

export type SoulArchetype = 'mentor' | 'achiever' | 'endurer';
export type DecayCurve = 'gentle' | 'standard' | 'steep';
export type RespawnPolicy = 'on_restart' | 'manual' | 'never';
export type HeroTier = 'hero' | 'novice' | 'background';

/**
 * Optional designation of a resident as a public-facing named character
 * ("hero"), a learning resident ("novice"), or unnamed scenery
 * ("background"). Hero residents are anchored to specific places, receive
 * patron interactions preferentially, and route epitaph letters through
 * sibling flagships in the same faction when they die (J-δ-3).
 *
 * See `docs/superpowers/specs/2026-05-22-hero-residents-design.md` and
 * `docs/null-city-foundation-audit.md` § M-α.
 */
/**
 * Optional faction-affinity scores per major RuneScape religious / political
 * faction, each 0..100. The dominant affinity (highest non-zero value) is
 * surfaced in Brain prompts as a flavor directive: a Saradomin-aligned
 * resident speaks of justice and protection; Guthix of balance; Zamorak of
 * power and risk. `unaligned` is the explicit "no faction" choice.
 *
 * Per the DRIFT-reconciled K spec, this is currently the only mechanical
 * faction signal — combat-permission tables and territory shifts are
 * deferred to post-event K work. See
 * `docs/superpowers/specs/2026-05-22-rs6-factions-design.md`.
 */
export interface FactionAffinity {
    saradomin?: number;
    guthix?: number;
    zamorak?: number;
    unaligned?: number;
}

export type FactionName = keyof FactionAffinity;

/**
 * Pick the faction with the highest affinity score, with `unaligned` used
 * as a tie-breaker only when no other faction is strictly higher. Returns
 * `null` if every score is undefined or zero.
 */
export function dominantFaction(affinity: FactionAffinity | undefined): FactionName | null {
    if (!affinity) {
        return null;
    }
    let best: FactionName | null = null;
    let bestScore = 0;
    for (const faction of ['saradomin', 'guthix', 'zamorak', 'unaligned'] as const) {
        const score = affinity[faction];
        if (typeof score !== 'number' || score <= 0) {
            continue;
        }
        if (score > bestScore) {
            best = faction;
            bestScore = score;
        }
    }
    return best;
}

/**
 * Soul-level "north star" goal that biases the needs-hierarchy ranker
 * beyond just survive-tier (S-GOAL-1; see
 * `docs/superpowers/specs/2026-05-30-goal-as-orientation-design.md`).
 *
 * The orientation goal never overrides survival — when the resident's AP
 * is in the SURVIVE band the ranker still picks survive-aligned candidates.
 * At higher tiers, candidates whose tag set matches `tier` (or whose `id`
 * matches the orientation `id`) receive a small ORIENTATION-aligned bonus
 * that lets the soul's long-term direction win otherwise-flat ties.
 *
 * The bonus is intentionally smaller than the tier-alignment bonus so a
 * misaligned-but-survive-tagged goal still beats an orientation-tagged one
 * during a survive band. See `ORIENTATION_ALIGNED_SCORE` in
 * `src/controller/spark/needs-hierarchy.ts`.
 *
 * Tier may be omitted; when present it must be one of the non-survive
 * tiers — orientation is not a survive override.
 */
export interface SoulOrientationGoal {
    /** Stable identifier matched against candidate goal ids. */
    id: string;
    /** Free-text description; surfaced to prompts + dashboards. */
    description: string;
    /** Optional tier hint to bias same-tier candidates beyond survive. */
    tier?: 'earn' | 'pursue' | 'reflect';
}

export interface HeroProfile {
    tier: HeroTier;
    /** Human-recognisable name shown in dashboard + portrait + letters. */
    publicName: string;
    /**
     * A short canonical phrase the resident does/says memorably, used by
     * the dashboard ticker and the in-portrait blurb. e.g. "advises on
     * quests with a sigh", "always carries a tinderbox".
     */
    signatureAction: string;
    /**
     * Optional anchor coord the resident gravitates back to between
     * autonomous goals. Format `[x, y, level]` matching engine convention.
     */
    anchor?: [number, number, number];
}

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
    /**
     * Authored long-term ambitions for this resident, in priority order.
     * The Brain uses these to bias goal selection toward what the resident
     * actually cares about beyond the immediate tick. Plain language: "become
     * a master of fire", "find a lost friend", "earn 100 shards".
     */
    goals?: string[];
    /**
     * Moral or behavioral alignment in plain language. Free-form, not a D&D
     * grid. Shapes how the resident treats other residents and humans:
     * "loyal to Codex but suspicious of strangers", "lawful, protective of
     * younger residents", "trickster, never holds a grudge".
     */
    alignment?: string;
    /**
     * Visual / sensory aesthetic the resident embodies, used by the LLM to
     * colour chat and say-actions: "rust and cold iron", "smoke and lantern
     * light", "wet stone on the riverbank". Not visual rendering — vibe.
     */
    aesthetic?: string;
    model?: {
        endpoint?: string;
        model?: string;
        temperature?: number;
        thinking?: boolean;
        timeoutMs?: number;
    };
    attentionProfile?: {
        startingAttention?: number;
        decayCurve?: DecayCurve;
        /**
         * Optional lower bound for accrual spend (idle decay + per-action
         * + per-LLM-call) so the resident's attention never drops below
         * this value from normal play. See `src/controller/spark/attention.ts`
         * for the policy. Filed in E30 / HD-008 — heroes need to stay on
         * post through the IRL event without manual top-up.
         */
        floor?: number;
    };
    respawnPolicy?: RespawnPolicy;
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
    heroProfile?: HeroProfile;
    factionAffinity?: FactionAffinity;
    /** Null City organizational faction (foundry / bureau-of-continuity / ledger / veil). */
    factionId?: string;
    /**
     * Ordered list of resident names who speak for this resident in their
     * epitaph letter when they die (J-δ-3 / HD-012). The first living sibling
     * at death-time becomes the senderResident on the dispatched epitaph
     * letters, so patrons receive "a letter from Hans" rather than from the
     * deceased. Falls back to the deceased themselves when none are alive.
     */
    siblings?: string[];
    /**
     * Optional "north star" orientation that biases candidate ranking
     * (S-GOAL-1). See `SoulOrientationGoal` for semantics.
     */
    orientationGoal?: SoulOrientationGoal;
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
    timeoutMs?: number;
}

const soulArchetypeSchema = z.enum(['mentor', 'achiever', 'endurer']);
const decayCurveSchema = z.enum(['gentle', 'standard', 'steep']);
const respawnPolicySchema = z.enum(['on_restart', 'manual', 'never']);
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
    timeoutMs: z.number().int().positive().optional(),
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
const runtimeResidentNameSchema = z.string().regex(/^res:[a-z0-9_-]{1,20}$/, 'name must match live resident pattern res:[a-z0-9_-]{1,20}');

export const soulFrontmatterSchema = z
    .object({
        name: runtimeResidentNameSchema,
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
        goals: z.array(z.string().min(1)).optional(),
        alignment: z.string().min(1).optional(),
        aesthetic: z.string().min(1).optional(),
        model: z
            .object({
                endpoint: z.string().optional(),
                model: z.string().min(1).optional(),
                temperature: z.number().min(0).max(2).optional(),
                thinking: z.boolean().optional(),
                timeoutMs: z.number().int().positive().optional(),
            })
            .optional(),
        attentionProfile: z
            .object({
                startingAttention: z.number().positive().optional(),
                decayCurve: decayCurveSchema.default('standard'),
                // E30 / HD-008: optional accrual floor. See attention.ts.
                floor: z.number().nonnegative().optional(),
            })
            .default({ decayCurve: 'standard' }),
        respawnPolicy: respawnPolicySchema.optional(),
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
        heroProfile: z
            .object({
                tier: z.enum(['hero', 'novice', 'background']),
                publicName: z.string().min(1),
                signatureAction: z.string().min(1),
                anchor: z.tuple([z.number().int(), z.number().int(), z.number().int().min(0)]).optional(),
            })
            .optional(),
        factionAffinity: z
            .object({
                saradomin: z.number().min(0).max(100).optional(),
                guthix: z.number().min(0).max(100).optional(),
                zamorak: z.number().min(0).max(100).optional(),
                unaligned: z.number().min(0).max(100).optional(),
            })
            .optional(),
        factionId: z.string().min(1).optional(),
        siblings: z.array(z.string().min(1)).optional(),
        // S-GOAL-1: optional soul-level "north star" orientation goal.
        orientationGoal: z
            .object({
                id: z.string().min(1),
                description: z.string().min(1),
                // Survive is deliberately rejected: orientation never
                // overrides survival. The needs-hierarchy ranker handles
                // survive separately via currentTier(needsContext).
                tier: z.enum(['earn', 'pursue', 'reflect']).optional(),
            })
            .strict()
            .optional(),
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
