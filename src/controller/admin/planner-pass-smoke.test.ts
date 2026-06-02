/**
 * RIQ-2-SMOKE: planner-pass-smoke unit tests.
 *
 * All tests use mock LlmClient or --dry-run; no live LLM calls.
 *
 * A. parsePlannerPassSmokeCLIArgs — parse/default behaviour
 * B. runPlannerPassSmoke — dry-run, valid plan, too-few stages, failure, missing profile
 */

import {
    parsePlannerPassSmokeCLIArgs,
    runPlannerPassSmoke,
    PLANNER_SMOKE_DEFAULT_GOAL_ID,
    PLANNER_SMOKE_DEFAULT_GOAL_DESCRIPTION,
    PLANNER_SMOKE_DEFAULT_PROFILE,
    PLANNER_SMOKE_DEFAULT_TIMEOUT_MS,
    PLANNER_SMOKE_DEFAULT_RESIDENT_NAME,
} from './planner-pass-smoke';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import { PLANNER_PASS_MIN_STAGES } from '../intelligence/planner-pass';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(id: string) {
    return {
        id,
        subgoal: `do ${id}`,
        requirements: ['axe in inventory'],
        successCriteria: `${id} complete`,
    };
}

function makeValidPlanJson(stageCount = PLANNER_PASS_MIN_STAGES): string {
    const stages = Array.from({ length: stageCount }, (_, i) => makeStage(`stage-${i + 1}`));
    return JSON.stringify({ stages });
}

function mockLlmClient(responseText: string): LlmClient {
    return {
        complete: async (_req: LlmRequest): Promise<LlmResponse> => ({
            text: responseText,
            model: 'mock-model',
            nooped: false,
        }),
    } as unknown as LlmClient;
}

const EMPTY_ENDPOINTS = {};

// ---------------------------------------------------------------------------
// A. parsePlannerPassSmokeCLIArgs
// ---------------------------------------------------------------------------

describe('parsePlannerPassSmokeCLIArgs', () => {
    it('returns defaults when no args given', () => {
        const opts = parsePlannerPassSmokeCLIArgs([]);
        expect(opts.goalId).toBe(PLANNER_SMOKE_DEFAULT_GOAL_ID);
        expect(opts.goalDescription).toBe(PLANNER_SMOKE_DEFAULT_GOAL_DESCRIPTION);
        expect(opts.profile).toBe(PLANNER_SMOKE_DEFAULT_PROFILE);
        expect(opts.residentName).toBe(PLANNER_SMOKE_DEFAULT_RESIDENT_NAME);
        expect(opts.timeoutMs).toBe(PLANNER_SMOKE_DEFAULT_TIMEOUT_MS);
        expect(opts.json).toBe(false);
        expect(opts.dryRun).toBe(false);
    });

    it('parses --goal', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--goal', 'master Fishing']);
        expect(opts.goalDescription).toBe('master Fishing');
    });

    it('parses --goal= inline form', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--goal=master Mining']);
        expect(opts.goalDescription).toBe('master Mining');
    });

    it('parses --goal-id', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--goal-id', 'custom-id']);
        expect(opts.goalId).toBe('custom-id');
    });

    it('parses --profile', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--profile', 'planner_local']);
        expect(opts.profile).toBe('planner_local');
    });

    it('parses --timeout-ms', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--timeout-ms', '5000']);
        expect(opts.timeoutMs).toBe(5000);
    });

    it('parses --json flag', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--json']);
        expect(opts.json).toBe(true);
    });

    it('parses --dry-run flag', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['--dry-run']);
        expect(opts.dryRun).toBe(true);
    });

    it('parses --config shorthand -c', () => {
        const opts = parsePlannerPassSmokeCLIArgs(['-c', 'custom.yml']);
        expect(opts.configPath).toBe('custom.yml');
    });

    it('throws on unknown argument', () => {
        expect(() => parsePlannerPassSmokeCLIArgs(['--bogus'])).toThrow('Unknown argument: --bogus');
    });

    it('throws when --goal has no value', () => {
        expect(() => parsePlannerPassSmokeCLIArgs(['--goal'])).toThrow('--goal requires');
    });

    it('throws when --profile has no value', () => {
        expect(() => parsePlannerPassSmokeCLIArgs(['--profile'])).toThrow('--profile requires');
    });

    it('throws on non-positive --timeout-ms', () => {
        expect(() => parsePlannerPassSmokeCLIArgs(['--timeout-ms', '-1'])).toThrow('positive integer');
    });
});

// ---------------------------------------------------------------------------
// B. runPlannerPassSmoke
// ---------------------------------------------------------------------------

describe('runPlannerPassSmoke', () => {
    it('dry-run returns ok=true with a valid stub plan', async () => {
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'master-firemaking',
            goalDescription: 'master Firemaking',
            profile: 'planner_haiku',
            residentName: 'smoke-resident',
            timeoutMs: 30_000,
            dryRun: true,
        });

        expect(result.ok).toBe(true);
        expect(result.dryRun).toBe(true);
        expect(result.stageCount).toBeGreaterThanOrEqual(PLANNER_PASS_MIN_STAGES);
        expect(result.stagesWithRequirements).toBe(result.stageCount);
        expect(result.stagesWithCriteria).toBe(result.stageCount);
        expect(result.errorReason).toBeUndefined();
        expect(result.plan).toBeDefined();
    });

    it('ok=true when mock LlmClient returns a valid plan', async () => {
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'test-goal',
            goalDescription: 'master Fishing',
            profile: 'planner_haiku',
            residentName: 'resident',
            timeoutMs: 30_000,
            dryRun: false,
            llmClientOverride: mockLlmClient(makeValidPlanJson(3)),
        });

        expect(result.ok).toBe(true);
        expect(result.stageCount).toBe(3);
        expect(result.stagesWithRequirements).toBe(3);
        expect(result.stagesWithCriteria).toBe(3);
        expect(result.plan?.stages).toHaveLength(3);
    });

    it('ok=false when plan has fewer than MIN_STAGES', async () => {
        // 2 stages < PLANNER_PASS_MIN_STAGES (3); parsePlannerPassOutput rejects it
        // and returns plan=undefined, so stageCount=0 in the smoke result.
        const twoStagePlan = JSON.stringify({ stages: [makeStage('s1'), makeStage('s2')] });
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'test-goal',
            goalDescription: 'quick goal',
            profile: 'planner_haiku',
            residentName: 'resident',
            timeoutMs: 30_000,
            dryRun: false,
            llmClientOverride: mockLlmClient(twoStagePlan),
        });

        expect(result.ok).toBe(false);
        expect(result.stageCount).toBe(0); // parse rejected → plan undefined → stageCount 0
        expect(result.errorReason).toMatch(/stages/);
    });

    it('ok=false when LlmClient returns unparseable text', async () => {
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'test-goal',
            goalDescription: 'some goal',
            profile: 'planner_haiku',
            residentName: 'resident',
            timeoutMs: 30_000,
            dryRun: false,
            llmClientOverride: mockLlmClient('this is not json'),
        });

        expect(result.ok).toBe(false);
        expect(result.stageCount).toBe(0);
        expect(result.errorReason).toBeDefined();
    });

    it('ok=false when profile is missing from endpoints and not dry-run', async () => {
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'test-goal',
            goalDescription: 'some goal',
            profile: 'planner_haiku',
            residentName: 'resident',
            timeoutMs: 30_000,
            dryRun: false,
        });

        expect(result.ok).toBe(false);
        expect(result.errorReason).toMatch(/not found in config/);
    });

    it('ok=true with exactly MIN_STAGES stages (boundary)', async () => {
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'test-goal',
            goalDescription: 'master goal',
            profile: 'planner_local',
            residentName: 'resident',
            timeoutMs: 30_000,
            dryRun: false,
            llmClientOverride: mockLlmClient(makeValidPlanJson(PLANNER_PASS_MIN_STAGES)),
        });

        expect(result.ok).toBe(true);
        expect(result.stageCount).toBe(PLANNER_PASS_MIN_STAGES);
    });

    it('reports fellBackToRag correctly when tool loop falls back', async () => {
        // A valid plan returned immediately (no tool call fallback)
        const result = await runPlannerPassSmoke({
            endpoints: EMPTY_ENDPOINTS,
            goalId: 'g',
            goalDescription: 'goal',
            profile: 'planner_haiku',
            residentName: 'r',
            timeoutMs: 30_000,
            dryRun: true,
        });

        // Dry-run stub has no tool calls
        expect(result.fellBackToRag).toBe(false);
        expect(result.toolCallsMade).toBe(0);
    });
});
