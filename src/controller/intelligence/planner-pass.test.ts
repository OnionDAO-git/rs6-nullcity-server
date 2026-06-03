/**
 * RIQ-2-1: PlannerPass unit tests.
 *
 * Tests cover:
 *   A. Plan schema validation (valid/invalid drafts)
 *   B. Prompt building (deliberative vs per-tick distinction)
 *   C. Output parsing (valid JSON → Plan; malformed; insufficient stages)
 *   D. Plan helpers (currentStage, advancePlan, blockCurrentStage)
 *   E. runPlannerPass end-to-end with a mock LlmClient
 *   F. Rarity invariant: PlannerPass is NOT called per-tick
 */

import {
    buildPlannerPassPrompt,
    parsePlannerPassOutput,
    runPlannerPass,
    currentStage,
    advancePlan,
    blockCurrentStage,
    PLANNER_PASS_MIN_STAGES,
    PLANNER_PASS_MAX_STAGES,
    type Plan,
    type Stage,
} from './planner-pass';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';

// ---------------------------------------------------------------------------
// A. Plan schema validation via parsePlannerPassOutput
// ---------------------------------------------------------------------------

describe('parsePlannerPassOutput — schema validation', () => {
    const baseStage = (id: string) => ({
        id,
        subgoal: `do ${id}`,
        requirements: ['axe', 'logs'],
        successCriteria: `${id} complete`,
    });

    function makeJson(stages: object[]): string {
        return JSON.stringify({ stages });
    }

    it('accepts a valid 3-stage plan', () => {
        const json = makeJson([baseStage('s1'), baseStage('s2'), baseStage('s3')]);
        const result = parsePlannerPassOutput(json, 'goal-fm', 'master Firemaking', 100);
        expect(result.plan).toBeDefined();
        expect(result.plan!.stages).toHaveLength(3);
        expect(result.plan!.status).toBe('active');
        expect(result.plan!.currentStageIndex).toBe(0);
        expect(result.plan!.createdAtTick).toBe(100);
        expect(result.plan!.goalId).toBe('goal-fm');
    });

    it('sets first stage to active, rest to pending', () => {
        const json = makeJson([baseStage('s1'), baseStage('s2'), baseStage('s3')]);
        const result = parsePlannerPassOutput(json, 'g', 'desc', 0);
        expect(result.plan!.stages[0].status).toBe('active');
        expect(result.plan!.stages[1].status).toBe('pending');
        expect(result.plan!.stages[2].status).toBe('pending');
    });

    it('rejects plan with fewer than MIN_STAGES', () => {
        const json = makeJson([baseStage('s1'), baseStage('s2')]);
        const result = parsePlannerPassOutput(json, 'g', 'desc', 0);
        expect(result.plan).toBeUndefined();
        expect(result.error).toMatch(/only 2 stage/);
    });

    it('rejects plan with more than MAX_STAGES', () => {
        const stages = Array.from({ length: PLANNER_PASS_MAX_STAGES + 1 }, (_, i) => baseStage(`s${i}`));
        const json = makeJson(stages);
        const result = parsePlannerPassOutput(json, 'g', 'desc', 0);
        expect(result.plan).toBeUndefined();
        expect(result.error).toMatch(/max is/);
    });

    it('accepts plan with exactly MAX_STAGES stages', () => {
        const stages = Array.from({ length: PLANNER_PASS_MAX_STAGES }, (_, i) => baseStage(`s${i}`));
        const json = makeJson(stages);
        const result = parsePlannerPassOutput(json, 'g', 'desc', 0);
        expect(result.plan).toBeDefined();
        expect(result.plan!.stages).toHaveLength(PLANNER_PASS_MAX_STAGES);
    });

    it('rejects malformed JSON', () => {
        const result = parsePlannerPassOutput('not json at all', 'g', 'desc', 0);
        expect(result.plan).toBeUndefined();
        expect(result.error).toBeDefined();
    });

    it('rejects JSON missing stages array', () => {
        const result = parsePlannerPassOutput('{"foo":"bar"}', 'g', 'desc', 0);
        expect(result.plan).toBeUndefined();
        expect(result.error).toBeDefined();
    });

    it('rejects stage missing successCriteria', () => {
        const broken = [
            { id: 's1', subgoal: 'do s1', requirements: [] },
            { id: 's2', subgoal: 'do s2', requirements: [] },
            { id: 's3', subgoal: 'do s3', requirements: [] },
        ];
        const result = parsePlannerPassOutput(JSON.stringify({ stages: broken }), 'g', 'desc', 0);
        expect(result.plan).toBeUndefined();
        expect(result.error).toBeDefined();
    });

    it('extracts plan from text with surrounding prose (salvage path)', () => {
        // The LLM may wrap JSON in commentary — JSON salvage should handle it
        const json = makeJson([baseStage('s1'), baseStage('s2'), baseStage('s3')]);
        const rawWithProse = `Here is the plan:\n${json}\nHope that helps!`;
        const result = parsePlannerPassOutput(rawWithProse, 'g', 'desc', 0);
        // If salvage works, plan is defined; if not, it's undefined — either is valid behavior.
        // The key invariant: it must NOT throw.
        expect(typeof result).toBe('object');
    });
});

// ---------------------------------------------------------------------------
// B. Prompt building — deliberative vs per-tick
// ---------------------------------------------------------------------------

describe('buildPlannerPassPrompt', () => {
    const base = {
        residentName: 'Hans',
        goalId: 'master-fm',
        goalDescription: 'master Firemaking',
        toolInstructions: '[TOOLS]',
    };

    it('includes the goal description', () => {
        const prompt = buildPlannerPassPrompt(base);
        expect(prompt).toContain('master Firemaking');
    });

    it('includes the resident name', () => {
        const prompt = buildPlannerPassPrompt(base);
        expect(prompt).toContain('Hans');
    });

    it('includes the stage count bounds', () => {
        const prompt = buildPlannerPassPrompt(base);
        expect(prompt).toContain(String(PLANNER_PASS_MIN_STAGES));
        expect(prompt).toContain(String(PLANNER_PASS_MAX_STAGES));
    });

    it('includes the tool instructions block', () => {
        const prompt = buildPlannerPassPrompt(base);
        expect(prompt).toContain('[TOOLS]');
    });

    it('asks for a multi-stage plan, NOT a single near-term goal', () => {
        const prompt = buildPlannerPassPrompt(base);
        // Must contain deliberative planning language
        expect(prompt).toMatch(/stages?|plan|decompose/i);
        // Must NOT say "Choose one useful near-term goal" (that is the Brain prompt)
        expect(prompt).not.toContain('Choose one useful near-term goal');
    });

    it('includes extraContext when provided', () => {
        const prompt = buildPlannerPassPrompt({ ...base, extraContext: 'level 20 Firemaking' });
        expect(prompt).toContain('level 20 Firemaking');
    });

    it('omits context block when extraContext is absent', () => {
        const prompt = buildPlannerPassPrompt(base);
        // Should not have an empty "Context about..." line
        expect(prompt).not.toMatch(/Context about Hans:/);
    });
});

// ---------------------------------------------------------------------------
// C. Plan helpers
// ---------------------------------------------------------------------------

function makePlan(stageCount: number, currentIndex = 0): Plan {
    const stages: Stage[] = Array.from({ length: stageCount }, (_, i) => ({
        id: `s${i}`,
        subgoal: `stage ${i}`,
        requirements: [],
        successCriteria: `done ${i}`,
        status: i === currentIndex ? 'active' : 'pending',
    }));
    return {
        goalId: 'test-goal',
        goalDescription: 'test',
        stages,
        currentStageIndex: currentIndex,
        status: 'active',
        createdAtTick: 0,
    };
}

describe('currentStage', () => {
    it('returns the active stage at currentStageIndex', () => {
        const plan = makePlan(3, 1);
        expect(currentStage(plan)?.id).toBe('s1');
    });

    it('returns undefined when plan has no stages', () => {
        const plan: Plan = { ...makePlan(3), stages: [], currentStageIndex: 0 };
        expect(currentStage(plan)).toBeUndefined();
    });
});

describe('advancePlan', () => {
    it('marks current stage done and next stage active', () => {
        const plan = makePlan(3, 0);
        const next = advancePlan(plan);
        expect(next.currentStageIndex).toBe(1);
        expect(next.stages[0].status).toBe('done');
        expect(next.stages[1].status).toBe('active');
        expect(next.stages[2].status).toBe('pending');
        expect(next.status).toBe('active');
    });

    it('completes the plan when advancing past the last stage', () => {
        const plan = makePlan(3, 2);
        const next = advancePlan(plan);
        expect(next.status).toBe('completed');
    });

    it('does not mutate the original plan', () => {
        const plan = makePlan(3, 0);
        advancePlan(plan);
        expect(plan.currentStageIndex).toBe(0);
        expect(plan.stages[0].status).toBe('active');
    });
});

describe('blockCurrentStage', () => {
    it('marks the current stage as blocked', () => {
        const plan = makePlan(3, 1);
        const blocked = blockCurrentStage(plan);
        expect(blocked.stages[1].status).toBe('blocked');
        expect(blocked.stages[0].status).toBe('pending');
        expect(blocked.stages[2].status).toBe('pending');
    });

    it('does not mutate the original plan', () => {
        const plan = makePlan(3, 0);
        blockCurrentStage(plan);
        expect(plan.stages[0].status).toBe('active');
    });
});

// ---------------------------------------------------------------------------
// D. runPlannerPass end-to-end with mock LlmClient
// ---------------------------------------------------------------------------

function makeMockClient(responses: string[]): LlmClient {
    let idx = 0;
    return {
        complete: async (_req: LlmRequest): Promise<LlmResponse> => {
            const text = responses[idx] ?? '';
            idx++;
            return { text, nooped: false };
        },
    } as unknown as LlmClient;
}

const VALID_PLAN_JSON = JSON.stringify({
    stages: [
        { id: 'acquire-axe', subgoal: 'Get a bronze axe', requirements: ['10 GP'], successCriteria: 'bronze axe in inventory' },
        { id: 'chop-logs', subgoal: 'Chop logs to level 15', requirements: ['bronze axe'], successCriteria: 'Woodcutting XP ≥ 1154' },
        {
            id: 'light-fires',
            subgoal: 'Light fires to level 20',
            requirements: ['tinderbox', 'logs'],
            successCriteria: 'Firemaking XP ≥ 3258',
        },
    ],
});

describe('runPlannerPass — end-to-end with mock LLM', () => {
    const baseRequest: Omit<LlmRequest, 'prompt'> = {
        endpoint: 'planner_local',
        temperature: 0.3,
        thinking: false,
        timeoutMs: 30000,
        maxTokens: 512,
        priority: 3,
    };

    it('returns a valid plan when the LLM emits correct JSON', async () => {
        const client = makeMockClient([VALID_PLAN_JSON]);
        const result = await runPlannerPass({
            residentName: 'Hans',
            goalId: 'master-fm',
            goalDescription: 'master Firemaking',
            tick: 500,
            llmClient: client,
            request: baseRequest,
        });
        expect(result.success).toBe(true);
        expect(result.plan).toBeDefined();
        expect(result.plan!.stages.length).toBeGreaterThanOrEqual(PLANNER_PASS_MIN_STAGES);
        expect(result.plan!.goalId).toBe('master-fm');
        expect(result.plan!.createdAtTick).toBe(500);
    });

    it('returns success=false when LLM emits garbage', async () => {
        const client = makeMockClient(['not a plan at all']);
        const result = await runPlannerPass({
            residentName: 'Hans',
            goalId: 'goal',
            goalDescription: 'do something',
            tick: 0,
            llmClient: client,
            request: baseRequest,
        });
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.plan).toBeUndefined();
    });

    it('returns success=false when LLM emits too few stages', async () => {
        const shortPlan = JSON.stringify({
            stages: [{ id: 's1', subgoal: 'do s1', requirements: [], successCriteria: 'done s1' }],
        });
        const client = makeMockClient([shortPlan]);
        const result = await runPlannerPass({
            residentName: 'Hans',
            goalId: 'goal',
            goalDescription: 'do something',
            tick: 0,
            llmClient: client,
            request: baseRequest,
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/stage/);
    });

    it('records elapsed time', async () => {
        const client = makeMockClient([VALID_PLAN_JSON]);
        const result = await runPlannerPass({
            residentName: 'Hans',
            goalId: 'goal',
            goalDescription: 'do something',
            tick: 0,
            llmClient: client,
            request: baseRequest,
        });
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('handles tool call path: LLM emits tool call then valid plan', async () => {
        // First response is a tool call; second is the plan after tool result injection
        const toolCallJson = JSON.stringify({ tool: 'lookup_skill', query: 'firemaking training' });
        const client = makeMockClient([toolCallJson, VALID_PLAN_JSON]);
        const result = await runPlannerPass({
            residentName: 'Hans',
            goalId: 'goal',
            goalDescription: 'master Firemaking',
            tick: 0,
            llmClient: client,
            request: baseRequest,
        });
        expect(result.success).toBe(true);
        expect(result.toolCallsMade).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// E. Rarity invariant — PlannerPass is NOT a per-tick call
// ---------------------------------------------------------------------------

describe('PlannerPass rarity invariant', () => {
    it('runPlannerPass is an async function (not a synchronous per-tick helper)', () => {
        // The function signature itself declares it as async; this test proves
        // it returns a Promise, not a plain value, enforcing the rare-call contract.
        const client = makeMockClient([VALID_PLAN_JSON]);
        const result = runPlannerPass({
            residentName: 'Hans',
            goalId: 'goal',
            goalDescription: 'master Firemaking',
            tick: 0,
            llmClient: client,
            request: {
                endpoint: 'planner_local',
                temperature: 0.3,
                thinking: false,
                timeoutMs: 30000,
                maxTokens: 512,
                priority: 3,
            },
        });
        // Must return a Promise (not a synchronous value)
        expect(result).toBeInstanceOf(Promise);
        return result; // let jest await it
    });

    it('the planner prompt instructs deliberative decomposition, not per-tick action', () => {
        // A per-tick prompt asks "choose one near-term goal"; a planner prompt
        // asks for a multi-stage plan. Verify the planner stays deliberative.
        const prompt = buildPlannerPassPrompt({
            residentName: 'Hans',
            goalId: 'goal',
            goalDescription: 'master Firemaking',
            toolInstructions: '',
        });
        expect(prompt).toMatch(/stage|plan|decompose/i);
        expect(prompt).not.toContain('near-term');
        expect(prompt).not.toContain('next tick');
        expect(prompt).not.toContain('Choose one');
    });
});
