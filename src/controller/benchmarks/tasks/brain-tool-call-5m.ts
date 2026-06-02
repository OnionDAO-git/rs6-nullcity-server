/**
 * RIQ-1-1-A: Brain tool-call benchmark (5-minute window).
 *
 * Proves the Brain can issue a `lookup_skill` tool call for a goal whose
 * answer is NOT in the default RAG top-4 injection, receive the wiki/skill
 * result, and use it in its next decision.
 *
 * Pass conditions (score 1):
 *   - At least one tool call record is found in the brain's output for the
 *     target goal during the window.
 *   - The follow-up Brain decision cites or uses knowledge from the tool
 *     result (evidenced by goal description or steps mentioning a term from
 *     the result).
 *   - Loop never exceeded the `PLANNER_TOOL_MAX_TURNS` cap.
 *
 * Live-verify: PENDING — requires the PlannerToolLoop to be wired into
 * `runBrain` (RIQ-1-1-B) and a live controller restart.
 *
 * Run: npm run controller:bench -- --task brain-tool-call-5m --mode autonomous
 */

import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const BRAIN_TOOL_CALL_5M_TASK_ID = 'brain-tool-call-5m';
export const BRAIN_TOOL_CALL_5M_TASK_VERSION = '0.1.0';
export const BRAIN_TOOL_CALL_5M_TIMEOUT_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3222, y: 3218, level: 0 };

export interface BrainToolCall5mMetrics extends Record<string, number> {
    toolCallsObserved: number;
    toolCallsFellBackToRag: number;
    toolCallsCompleted: number;
    followUpGoalCitedToolResult: number;
    maxTurnsViolations: number;
    actionsTotal: number;
    elapsedMs: number;
}

export function verifyBrainToolCall5m(metrics: BrainToolCall5mMetrics): BenchmarkTaskOutcome {
    if (metrics.elapsedMs > BRAIN_TOOL_CALL_5M_TIMEOUT_MS) {
        return {
            status: 'timeout',
            score: 0,
            failureReason: 'brain-tool-call-5m exceeded the 5-minute budget',
            metrics,
        };
    }

    if (metrics.maxTurnsViolations > 0) {
        return {
            status: 'failed',
            score: 0,
            failureReason: `Loop exceeded PLANNER_TOOL_MAX_TURNS on ${metrics.maxTurnsViolations} invocation(s)`,
            metrics,
        };
    }

    if (metrics.toolCallsObserved === 0) {
        return {
            status: 'failed',
            score: 0,
            failureReason:
                'No tool calls were observed during the benchmark window. ' +
                'Ensure PlannerToolLoop is wired into runBrain (RIQ-1-1-B) and the goal ' +
                'targets a topic not in the default RAG top-4.',
            metrics,
        };
    }

    if (metrics.toolCallsFellBackToRag === metrics.toolCallsObserved) {
        return {
            status: 'failed',
            score: 0.25,
            failureReason:
                'Tool calls were detected but all fell back to RAG ' + '(tool execution or follow-up completion failed every time).',
            metrics,
        };
    }

    if (metrics.followUpGoalCitedToolResult === 0) {
        return {
            status: 'failed',
            score: 0.5,
            failureReason: 'Tool was called and completed but the follow-up goal did not ' + 'cite or use knowledge from the tool result.',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            `brain-tool-call-5m: ${metrics.toolCallsCompleted} tool call(s) completed; ` +
                `${metrics.followUpGoalCitedToolResult} follow-up goal(s) cited the tool result.`,
        ],
    };
}

export function makeBrainToolCall5mBenchmarkTask(): BenchmarkTask {
    return {
        id: BRAIN_TOOL_CALL_5M_TASK_ID,
        version: BRAIN_TOOL_CALL_5M_TASK_VERSION,
        timeoutMs: BRAIN_TOOL_CALL_5M_TIMEOUT_MS,
        autonomousRequiresSelectedModuleAction: false,
        resident: {
            spawnPosition: START_POSITION,
            // No inventory needed — this is a brain-decision benchmark
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'brain-tool-call-5m requires autonomous mode with a live controller. ' +
                'Run with --mode autonomous and ensure PlannerToolLoop is wired into runBrain (RIQ-1-1-B).',
            metrics: {
                toolCallsObserved: 0,
                toolCallsFellBackToRag: 0,
                toolCallsCompleted: 0,
                followUpGoalCitedToolResult: 0,
                maxTurnsViolations: 0,
                actionsTotal: 0,
                elapsedMs: 0,
            } satisfies BrainToolCall5mMetrics,
        }),
        runAutonomous: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'brain-tool-call-5m autonomous mode is not yet implemented. ' +
                'Wiring PlannerToolLoop into runBrain is tracked as RIQ-1-1-B. ' +
                'Live-verify PENDING.',
            metrics: {
                toolCallsObserved: 0,
                toolCallsFellBackToRag: 0,
                toolCallsCompleted: 0,
                followUpGoalCitedToolResult: 0,
                maxTurnsViolations: 0,
                actionsTotal: 0,
                elapsedMs: 0,
            } satisfies BrainToolCall5mMetrics,
        }),
    };
}
