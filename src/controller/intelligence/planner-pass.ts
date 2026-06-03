/**
 * RIQ-2-1: Phase 2 PlannerPass — deliberative multi-stage planner.
 *
 * This is a RARE, infrequent call (on goal-set or plan-exhaustion only —
 * NOT per tick). It uses a strong planner model (Haiku or local qwopus
 * fallback) to decompose a resident's Soul goal into a durable multi-stage
 * plan the Body can execute stage-by-stage.
 *
 * Contrast with `runBrain` (per-tick near-term goal picker): PlannerPass
 * produces a full multi-stage plan with requirements + success criteria for
 * each stage. The Body will track the current stage and report done/blocked
 * back; the Planner is only re-invoked when a stage boundary is crossed or
 * the plan is exhausted (Phase 3 wiring).
 *
 * Architecture:
 *   Soul goal → PlannerPass (uses tools to research) → Plan { stages[] }
 *                                                          ↓
 *                                                   Body executes currentStage
 *                                                          ↓
 *                                                   stage done/blocked → re-plan
 */

import { z } from 'zod';
import type { LlmClient, LlmRequest } from '../llm/llm-client';
import { parseJsonWithSalvage } from '../llm/json-salvage';
import { runPlannerToolLoop, LOOKUP_SKILL_TOOL, defaultToolRegistry, buildToolInstructions } from './planner-tool-loop';

// ---------------------------------------------------------------------------
// Plan schema
// ---------------------------------------------------------------------------

export type StageStatus = 'pending' | 'active' | 'done' | 'blocked';
export type PlanStatus = 'active' | 'completed' | 'abandoned';

export interface Stage {
    id: string;
    subgoal: string;
    requirements: string[];
    successCriteria: string;
    status: StageStatus;
}

export interface Plan {
    goalId: string;
    goalDescription: string;
    stages: Stage[];
    currentStageIndex: number;
    status: PlanStatus;
    createdAtTick: number;
}

// Zod validators for the LLM output (stages only — status/index added by us)
const stageDraftSchema = z.object({
    id: z.string().min(1),
    subgoal: z.string().min(1),
    requirements: z.array(z.string()),
    successCriteria: z.string().min(1),
});

const planDraftSchema = z.object({
    stages: z.array(stageDraftSchema).min(1),
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

/**
 * Build the deliberative planning prompt.
 *
 * This is intentionally DIFFERENT from the per-tick brain prompt
 * ("Choose one useful near-term goal"). This prompt asks for a multi-stage
 * plan, not a single next action.
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
        `\n\nAfter any research, output ONLY valid JSON matching this schema:\n` +
        `{\n` +
        `  "stages": [\n` +
        `    {\n` +
        `      "id": "short-kebab-id",\n` +
        `      "subgoal": "one-sentence description of this stage",\n` +
        `      "requirements": ["item or level or resource needed"],\n` +
        `      "successCriteria": "observable condition that proves this stage is done"\n` +
        `    }\n` +
        `  ]\n` +
        `}\n` +
        `\nRules:\n` +
        `- Include ${PLANNER_PASS_MIN_STAGES}–${PLANNER_PASS_MAX_STAGES} stages ordered from first to last.\n` +
        `- The first stage must be achievable from a standing start.\n` +
        `- Each stage must have at least one successCriteria.\n` +
        `- Keep requirements concrete (item names, XP levels, GP amounts).\n` +
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
 * Fills in `status: 'pending'` for all stages and sets `currentStageIndex: 0`.
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

    const stages: Stage[] = draft.stages.map((s, idx) => ({
        id: s.id,
        subgoal: s.subgoal,
        requirements: s.requirements,
        successCriteria: s.successCriteria,
        status: idx === 0 ? 'active' : 'pending',
    }));

    return {
        plan: {
            goalId,
            goalDescription,
            stages,
            currentStageIndex: 0,
            status: 'active',
            createdAtTick: tick,
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
 * This is called INFREQUENTLY: on goal-set, plan-exhaustion, or plan-blocked.
 * It is NOT called every tick — that invariant is enforced by the caller
 * (Phase 3 wiring) and tested below.
 *
 * On failure it returns `success: false` with an error string. The caller
 * should retain the previous plan or fall back to the per-tick goal picker.
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
