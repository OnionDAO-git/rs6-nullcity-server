import {
    BRAIN_TOOL_CALL_5M_TASK_ID,
    BRAIN_TOOL_CALL_5M_TASK_VERSION,
    BRAIN_TOOL_CALL_5M_TIMEOUT_MS,
    makeBrainToolCall5mBenchmarkTask,
    verifyBrainToolCall5m,
    type BrainToolCall5mMetrics,
} from './brain-tool-call-5m';

const baseMetrics: BrainToolCall5mMetrics = {
    toolCallsObserved: 0,
    toolCallsFellBackToRag: 0,
    toolCallsCompleted: 0,
    followUpGoalCitedToolResult: 0,
    maxTurnsViolations: 0,
    actionsTotal: 0,
    elapsedMs: 0,
};

describe('makeBrainToolCall5mBenchmarkTask', () => {
    it('has the correct task id', () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        expect(task.id).toBe(BRAIN_TOOL_CALL_5M_TASK_ID);
    });

    it('has the correct version', () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        expect(task.version).toBe(BRAIN_TOOL_CALL_5M_TASK_VERSION);
    });

    it('has a 5-minute timeout', () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        expect(task.timeoutMs).toBe(BRAIN_TOOL_CALL_5M_TIMEOUT_MS);
        expect(task.timeoutMs).toBe(5 * 60 * 1000);
    });

    it('does not require selected-module body action (brain-only benchmark)', () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        expect(task.autonomousRequiresSelectedModuleAction).toBe(false);
    });

    it('spawns at a known start position', () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        expect(task.resident?.spawnPosition).toEqual({ x: 3222, y: 3218, level: 0 });
    });

    it('scripted run returns failed outcome (requires autonomous mode)', async () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        const outcome = await task.run({} as Parameters<typeof task.run>[0]);
        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('autonomous mode');
    });

    it('autonomous run returns failed outcome pending RIQ-1-1-B wiring', async () => {
        const task = makeBrainToolCall5mBenchmarkTask();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fn = task.runAutonomous!;
        const outcome = await fn({} as Parameters<typeof fn>[0]);
        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('RIQ-1-1-B');
    });
});

describe('verifyBrainToolCall5m', () => {
    it('returns timeout when elapsed exceeds the budget', () => {
        const outcome = verifyBrainToolCall5m({
            ...baseMetrics,
            elapsedMs: BRAIN_TOOL_CALL_5M_TIMEOUT_MS + 1000,
        });
        expect(outcome.status).toBe('timeout');
        expect(outcome.score).toBe(0);
    });

    it('returns failed when maxTurns was violated', () => {
        const outcome = verifyBrainToolCall5m({
            ...baseMetrics,
            maxTurnsViolations: 1,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('PLANNER_TOOL_MAX_TURNS');
    });

    it('returns failed with score 0 when no tool calls were observed', () => {
        const outcome = verifyBrainToolCall5m({ ...baseMetrics });
        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0);
        expect(outcome.failureReason).toContain('No tool calls');
    });

    it('returns failed with score 0.25 when all tool calls fell back to RAG', () => {
        const outcome = verifyBrainToolCall5m({
            ...baseMetrics,
            toolCallsObserved: 2,
            toolCallsFellBackToRag: 2,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.25);
        expect(outcome.failureReason).toContain('fell back to RAG');
    });

    it('returns failed with score 0.5 when tool completed but goal did not cite result', () => {
        const outcome = verifyBrainToolCall5m({
            ...baseMetrics,
            toolCallsObserved: 1,
            toolCallsCompleted: 1,
            followUpGoalCitedToolResult: 0,
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.5);
        expect(outcome.failureReason).toContain('did not cite');
    });

    it('returns passed with score 1 when tool completed and goal cited result', () => {
        const outcome = verifyBrainToolCall5m({
            ...baseMetrics,
            toolCallsObserved: 1,
            toolCallsCompleted: 1,
            followUpGoalCitedToolResult: 1,
        });
        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.summaries).toBeDefined();
        expect(outcome.summaries![0]).toContain('tool call');
    });
});
