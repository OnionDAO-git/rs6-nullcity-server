/**
 * RIQ-2-1 / RIQ-4-1: Phase 2 PlannerPass — deliberative multi-stage planner.
 *
 * Phase 4 (RIQ-4-1) adds GoalClass, PrimitiveStep, and SuccessPredicate to
 * support open-ended goals ("spell ONIONDAO with onions", "become the best
 * poet") alongside the existing RuneScape skill goals.
 *
 * Architecture:
 *   Soul goal → PlannerPass (uses tools to research) → Plan { goalClass, stages[] }
 *                                                          ↓
 *                                                   Body executes currentStage
 *                                                     (RIQ-4-2: open-goal steps)
 *                                                          ↓
 *                                                   stage done/blocked → re-plan
 */

import { z } from 'zod';
import type { LlmClient, LlmRequest } from '../llm/llm-client';
import { parseJsonWithSalvage } from '../llm/json-salvage';
import { runPlannerToolLoop, LOOKUP_SKILL_TOOL, defaultToolRegistry, buildToolInstructions } from './planner-tool-loop';

// ---------------------------------------------------------------------------
// Plan schema — Phase 2 base types
// ---------------------------------------------------------------------------

export type StageStatus = 'pending' | 'active' | 'done' | 'blocked';
export type PlanStatus = 'active' | 'completed' | 'abandoned';

// ---------------------------------------------------------------------------
// Phase 4 (RIQ-4-1) additions
// ---------------------------------------------------------------------------

/** Goal classification drives which Body execution path handles this plan's stages. */
export type GoalClass = 'runescape_skill' | 'spatial' | 'creative' | 'social';

/**
 * A concrete game action authored by the planner for an open-goal stage step.
 * Loosely typed here; the executor (RIQ-4-2) validates and resolves to AgentAction.
 */
export interface PrimitiveAction {
    kind: string;
    [key: string]: unknown;
}

/** One authored step within an open-goal stage. */
export interface PrimitiveStep {
    action: PrimitiveAction;
    /** When to advance the step index: after the action produces a result, or on next tick. */
    advanceWhen: 'action_result' | 'next_tick';
}

/**
 * Predicate evaluated to decide whether an open-goal stage is complete.
 * `self_assessment` never auto-closes — it triggers a re-plan so the Brain judges.
 */
export type SuccessPredicate =
    | { kind: 'library_event_count'; eventPattern: string; threshold: number }
    | { kind: 'items_at_tiles'; objectIds: number[]; tileCount: number }
    | { kind: 'ticks_elapsed'; ticks: number }
    | { kind: 'self_assessment' };

// ---------------------------------------------------------------------------
// Stage and Plan interfaces (Phase 2 base + Phase 4 optional fields)
// ---------------------------------------------------------------------------

export interface Stage {
    id: string;
    subgoal: string;
    requirements: string[];
    successCriteria: string;
    status: StageStatus;
    /** Phase 4: authored steps for open-goal stages (max 8). Absent on runescape_skill stages. */
    steps?: PrimitiveStep[];
    /** Phase 4: predicate checked to detect stage completion for open-goal stages. */
    successPredicate?: SuccessPredicate;
}

export interface Plan {
    goalId: string;
    goalDescription: string;
    stages: Stage[];
    currentStageIndex: number;
    status: PlanStatus;
    createdAtTick: number;
    /** Phase 4: absent → 'runescape_skill' (Phase 2/3 plans unaffected). */
    goalClass?: GoalClass;
}

// ---------------------------------------------------------------------------
// Zod validators (Phase 2 base + Phase 4 optional fields)
// ---------------------------------------------------------------------------

const primitiveActionSchema = z.object({ kind: z.string() }).passthrough();

export const primitiveStepSchema = z.object({
    action: primitiveActionSchema,
    advanceWhen: z.enum(['action_result', 'next_tick']),
});

export const successPredicateSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('library_event_count'),
        eventPattern: z.string().min(1),
        threshold: z.number().int().positive(),
    }),
    z.object({
        kind: z.literal('items_at_tiles'),
        objectIds: z.array(z.number().int()),
        tileCount: z.number().int().positive(),
    }),
    z.object({
        kind: z.literal('ticks_elapsed'),
        ticks: z.number().int().positive(),
    }),
    z.object({ kind: z.literal('self_assessment') }),
]);

// Zod validators for LLM output (stages only — status/index added by parsePlannerPassOutput)
const stageDraftSchema = z.object({
    id: z.string().min(1),
    subgoal: z.string().min(1),
    requirements: z.array(z.string()),
    successCriteria: z.string().min(1),
    // Phase 4 optional fields
    steps: z.array(primitiveStepSchema).max(8).optional(),
    successPredicate: successPredicateSchema.optional(),
});

const planDraftSchema = z.object({
    stages: z.array(stageDraftSchema).min(1),
    // Phase 4 optional — absent defaults to 'runescape_skill' in parser
    goalClass: z.enum(['runescape_skill', 'spatial', 'creative', 'social']).optional(),
});

export type StageDraft = z.infer<typeof stageDraftSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;

export const PLANNER_PASS_MIN_STAGES = 3;
export const PLANNER_PASS_MAX_STAGES = 7;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface PlannerPassPromptInput {
    residentName: string;
    goalId: string;
    goalDescription: string;
    toolInstructions: string;
    extraContext?: string;
}

const GOAL_CLASSIFICATION_BLOCK = `
## GOAL CLASSIFICATION

Classify the goal into one of these goalClass values and include it in your JSON:

- "runescape_skill" — A measurable RuneScape skill or quest target (e.g. "master Firemaking",
  "reach 70 Woodcutting"). The Body uses engine-level skill routines; stages do NOT need steps[].
  Example successCriteria: "Firemaking XP ≥ 737627"

- "spatial" — A physical arrangement or exploration goal (e.g. "spell ONIONDAO with onions on
  the ground", "reach the top of Ice Mountain"). Stages MUST include steps[] — a sequence of up
  to 8 game actions (move_to, drop, interact, use_item_on, say, noop) the Body will execute.
  Example successPredicate: {"kind":"items_at_tiles","objectIds":[1957],"tileCount":7}

- "creative" — A self-expression or composition goal (e.g. "become the best poet", "write a
  ballad about the bank"). Stages MUST include steps[] and a successPredicate.
  Example successPredicate: {"kind":"library_event_count","eventPattern":"say","threshold":3}

- "social" — A relationship or community goal (e.g. "befriend every patron", "become the town
  crier"). Stages MUST include steps[]. Use successPredicate kind "self_assessment" for stages
  where only the Brain can judge progress.

steps[] format (for spatial/creative/social stages):
  {"action":{"kind":"move_to","target":{"x":3162,"y":3487}},"advanceWhen":"action_result"}
  {"action":{"kind":"drop","slot":0},"advanceWhen":"action_result"}
  {"action":{"kind":"say","text":"poem text here"},"advanceWhen":"next_tick"}

Rule: For non-runescape_skill goals, every stage MUST have steps[] with at least one step.
Rule: Include "goalClass" at the top level of your JSON output.
`;

/**
 * Build the deliberative planning prompt.
 *
 * Phase 4 adds a GOAL CLASSIFICATION block so the LLM can classify the goal
 * and author steps[] for open-ended stages.
 */
export function buildPlannerPassPrompt(input: PlannerPassPromptInput): string {
    const { residentName, goalDescription, toolInstructions, extraContext } = input;
    const contextBlock = extraContext ? `\nContext about ${residentName}: ${extraContext}\n` : '';
    return (
        `You are a strategic planner for a RuneScape resident named ${residentName}.\n` +
        `\nGoal: ${goalDescription}\n` +
        contextBlock +
        `\nYour task is to decompose this goal into a durable multi-stage plan.\n` +
        `Research using the available tools if needed, then output the plan.\n` +
        toolInstructions +
        GOAL_CLASSIFICATION_BLOCK +
        `\nAfter any research, output ONLY valid JSON matching this schema:\n` +
        `{\n` +
        `  "goalClass": "runescape_skill",\n` +
        `  "stages": [\n` +
        `    {\n` +
        `      "id": "short-kebab-id",\n` +
        `      "subgoal": "one-sentence description of this stage",\n` +
        `      "requirements": ["item or level or resource needed"],\n` +
        `      "successCriteria": "observable condition that proves this stage is done",\n` +
        `      "steps": [],\n` +
        `      "successPredicate": null\n` +
        `    }\n` +
        `  ]\n` +
        `}\n` +
        `\nRules:\n` +
        `- Include ${PLANNER_PASS_MIN_STAGES}–${PLANNER_PASS_MAX_STAGES} stages ordered from first to last.\n` +
        `- The first stage must be achievable from a standing start.\n` +
        `- Each stage must have at least one successCriteria.\n` +
        `- Keep requirements concrete (item names, XP levels, GP amounts).\n` +
        `- For spatial/creative/social goals: every stage must have steps[] with ≥1 action.\n` +
        `- Output ONLY the JSON object — no commentary before or after.`
    );
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface PlannerPassParseResult {
    plan?: Plan;
    error?: string;
}

/**
 * Parse the raw LLM text into a validated Plan.
 * Phase 4: extracts goalClass (default 'runescape_skill') and validates that
 * non-runescape_skill stages provide steps[] (rejects if missing/empty).
 */
export function parsePlannerPassOutput(raw: string, goalId: string, goalDescription: string, tick: number): PlannerPassParseResult {
    const parsed = parseJsonWithSalvage(raw, planDraftSchema);
    if (!parsed.value) {
        return { error: `plan JSON parse/validation failed (classification: ${parsed.classification})` };
    }

    const draft = parsed.value;

    if (draft.stages.length < PLANNER_PASS_MIN_STAGES) {
        return {
            error: `plan has only ${draft.stages.length} stage(s); need at least ${PLANNER_PASS_MIN_STAGES}`,
        };
    }

    if (draft.stages.length > PLANNER_PASS_MAX_STAGES) {
        return {
            error: `plan has ${draft.stages.length} stages; max is ${PLANNER_PASS_MAX_STAGES}`,
        };
    }

    const goalClass: GoalClass = draft.goalClass ?? 'runescape_skill';
    const isOpenGoal = goalClass !== 'runescape_skill';

    // Open-goal plans must supply authored steps[] for every stage
    if (isOpenGoal) {
        for (const stage of draft.stages) {
            if (!stage.steps || stage.steps.length === 0) {
                return {
                    error: `open-goal plan (goalClass: ${goalClass}) stage '${stage.id}' has no steps — steps[] required for non-runescape_skill goals`,
                };
            }
        }
    }

    const stages: Stage[] = draft.stages.map((s, idx) => {
        const base: Stage = {
            id: s.id,
            subgoal: s.subgoal,
            requirements: s.requirements,
            successCriteria: s.successCriteria,
            status: idx === 0 ? 'active' : 'pending',
        };
        if (s.steps) base.steps = s.steps as PrimitiveStep[];
        if (s.successPredicate) base.successPredicate = s.successPredicate as SuccessPredicate;
        return base;
    });

    return {
        plan: {
            goalId,
            goalDescription,
            stages,
            currentStageIndex: 0,
            status: 'active',
            createdAtTick: tick,
            goalClass,
        },
    };
}

// ---------------------------------------------------------------------------
// PlannerPass invocation
// ---------------------------------------------------------------------------

export interface PlannerPassOptions {
    residentName: string;
    goalId: string;
    goalDescription: string;
    tick: number;
    llmClient: LlmClient;
    request: Omit<LlmRequest, 'prompt'>;
    extraContext?: string;
}

export interface PlannerPassResult {
    plan?: Plan;
    /** True when the planner succeeded and produced a validated plan. */
    success: boolean;
    /** Human-readable error string when success=false. */
    error?: string;
    /** Whether tool calls were made during research. */
    toolCallsMade: number;
    /** Whether the loop fell back to RAG (tool call attempted but failed). */
    fellBackToRag: boolean;
    /** Elapsed time for the whole pass. */
    elapsedMs: number;
}

/**
 * Run a single PlannerPass for a resident goal.
 *
 * Called INFREQUENTLY: on goal-set, plan-exhaustion, or plan-blocked.
 * NOT called every tick — that invariant is enforced by the caller (Phase 3 wiring).
 *
 * On failure returns `success: false`. The caller should retain the previous plan
 * or fall back to the per-tick goal picker.
 */
export async function runPlannerPass(opts: PlannerPassOptions): Promise<PlannerPassResult> {
    const startMs = Date.now();
    const toolInstructions = buildToolInstructions([LOOKUP_SKILL_TOOL]);

    const prompt = buildPlannerPassPrompt({
        residentName: opts.residentName,
        goalId: opts.goalId,
        goalDescription: opts.goalDescription,
        toolInstructions,
        extraContext: opts.extraContext,
    });

    const request: LlmRequest = { ...opts.request, prompt };

    let toolLoopResult;
    try {
        toolLoopResult = await runPlannerToolLoop({
            llmClient: opts.llmClient,
            request,
            tools: [LOOKUP_SKILL_TOOL],
            toolRegistry: defaultToolRegistry(),
        });
    } catch (err) {
        return {
            success: false,
            error: `tool loop threw: ${err instanceof Error ? err.message : String(err)}`,
            toolCallsMade: 0,
            fellBackToRag: false,
            elapsedMs: Date.now() - startMs,
        };
    }

    const parseResult = parsePlannerPassOutput(toolLoopResult.finalText, opts.goalId, opts.goalDescription, opts.tick);

    if (!parseResult.plan) {
        return {
            success: false,
            error: parseResult.error,
            toolCallsMade: toolLoopResult.toolCallsMade.length,
            fellBackToRag: toolLoopResult.fellBackToRag,
            elapsedMs: Date.now() - startMs,
        };
    }

    return {
        plan: parseResult.plan,
        success: true,
        toolCallsMade: toolLoopResult.toolCallsMade.length,
        fellBackToRag: toolLoopResult.fellBackToRag,
        elapsedMs: Date.now() - startMs,
    };
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

/** Returns the active stage or undefined if the plan has no active stage. */
export function currentStage(plan: Plan): Stage | undefined {
    return plan.stages[plan.currentStageIndex];
}

/** Advance to the next stage. Returns the new plan (does not mutate). */
export function advancePlan(plan: Plan): Plan {
    const nextIndex = plan.currentStageIndex + 1;
    if (nextIndex >= plan.stages.length) {
        return { ...plan, status: 'completed' };
    }
    const stages = plan.stages.map((s, i) => {
        if (i === plan.currentStageIndex) return { ...s, status: 'done' as StageStatus };
        if (i === nextIndex) return { ...s, status: 'active' as StageStatus };
        return s;
    });
    return { ...plan, stages, currentStageIndex: nextIndex };
}

/** Mark the current stage as blocked. Returns the new plan (does not mutate). */
export function blockCurrentStage(plan: Plan): Plan {
    const stages = plan.stages.map((s, i) => (i === plan.currentStageIndex ? { ...s, status: 'blocked' as StageStatus } : s));
    return { ...plan, stages };
}
