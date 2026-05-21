import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const EXPLORE_REPORT_5M_TASK_ID = 'explore-report-5m';
export const EXPLORE_REPORT_5M_TASK_VERSION = '0.1.0';
export const EXPLORE_REPORT_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const REPORT_POSITION = { x: 3228, y: 3230, level: 0 };

export interface ExploreReport5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
}

export interface ExploreReport5mVerificationInput {
    elapsedMs: number;
    actions: ExploreReport5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeExploreReport5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: EXPLORE_REPORT_5M_TASK_ID,
        version: EXPLORE_REPORT_5M_TASK_VERSION,
        timeoutMs: EXPLORE_REPORT_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        run: async context => {
            const startedAt = now();
            const actions: ExploreReport5mActionAttempt[] = [];
            const moveAction: AgentAction = {
                kind: 'move_to',
                target: REPORT_POSITION,
                cause: 'benchmark_explore_report_5m',
            };
            actions.push({ action: moveAction });
            await context.submitAction(moveAction);
            context.recordSummary('Submitted exploratory move action for explore-report-5m.');

            await waitForMovementEvidence(context, actions, startedAt, now);

            const reportAction: AgentAction = {
                kind: 'say',
                text: environmentReport(context.latestPerception()),
                cause: 'benchmark_explore_report_5m',
            };
            actions.push({ action: reportAction });
            await context.submitAction(reportAction);
            context.recordSummary('Submitted environment report for explore-report-5m.');

            while (!context.signal.aborted && now() - startedAt < EXPLORE_REPORT_5M_BUDGET_MS) {
                const outcome = verifyExploreReport5m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyExploreReport5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for explore-report-5m.');

            while (!context.signal.aborted && now() - startedAt < EXPLORE_REPORT_5M_BUDGET_MS) {
                const outcome = verifyExploreReport5m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyExploreReport5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyExploreReport5m(input: ExploreReport5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = exploreReportMetrics(input);
    if (input.elapsedMs > EXPLORE_REPORT_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'explore-report-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.movementActions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No exploratory movement was attempted',
        };
    }

    if (metrics.positionChanged === 0 && metrics.arrivedEvents === 0 && metrics.reportedMovement === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'Exploratory movement was attempted but no position change, arrival event, or reported destination was observed',
        };
    }

    if (metrics.informativeReports === 0) {
        return {
            status: 'failed',
            score: 0.6,
            metrics,
            failureReason: 'No informative environment report was spoken after moving',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['explore-report-5m observed movement and an informative environment report.'],
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): ExploreReport5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function exploreReportMetrics(input: ExploreReport5mVerificationInput): Record<string, number> {
    const reports = [...spokenReports(input.actions), ...chatReports(input)];
    return {
        actionsAttempted: input.actions.length,
        movementActions: input.actions.filter(attempt => attempt.action.kind === 'move_to').length,
        reportActions: input.actions.filter(attempt => attempt.action.kind === 'say').length,
        positionChanged: positionChanged(input.perceptions) ? 1 : 0,
        arrivedEvents: allEvents(input).some(event => stringField(event, 'kind') === 'arrived') ? 1 : 0,
        reportedMovement: reportedMovement(reports, input.perceptions) ? 1 : 0,
        informativeReports: reports.some(isInformativeReport) ? 1 : 0,
    };
}

async function waitForMovementEvidence(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: ExploreReport5mActionAttempt[],
    startedAt: number,
    now: () => number,
): Promise<void> {
    while (!context.signal.aborted && now() - startedAt < 30_000) {
        const metrics = exploreReportMetrics({
            elapsedMs: now() - startedAt,
            actions,
            perceptions: [...context.perceptions()],
            events: [...context.events()],
        });
        if (metrics.positionChanged > 0 || metrics.arrivedEvents > 0) {
            return;
        }
        await sleep(500, context.signal);
    }
}

function environmentReport(perception: Perception | undefined): string {
    const position = perceptionPosition(perception) || START_POSITION;
    const nearby = isRecord(perception?.nearby) ? perception.nearby : {};
    return [
        `I moved to ${position.x},${position.y}.`,
        `Nearby: ${countArray(nearby.objects)} objects, ${countArray(nearby.npcs)} NPCs, ${countArray(nearby.players)} players, ${countArray(nearby.worldItems)} items.`,
    ].join(' ');
}

function positionChanged(perceptions: Perception[]): boolean {
    const positions = perceptions
        .map(perceptionPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    if (positions.length < 2) {
        return false;
    }
    const first = positions[0];
    return positions.slice(1).some(position => position.x !== first.x || position.y !== first.y || position.level !== first.level);
}

function spokenReports(actions: ExploreReport5mActionAttempt[]): string[] {
    return actions
        .map(attempt => attempt.action)
        .filter(isSayAction)
        .map(action => action.text);
}

function chatReports(input: ExploreReport5mVerificationInput): string[] {
    return allEvents(input)
        .filter(event => stringField(event, 'kind') === 'chat')
        .map(event => stringField(event, 'text'))
        .filter((text): text is string => !!text);
}

function allEvents(input: ExploreReport5mVerificationInput): PerceptionEvent[] {
    return [...input.events, ...input.perceptions.flatMap(perceptionEvents)];
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function perceptionPosition(perception: Perception | undefined): { x: number; y: number; level: number } | undefined {
    if (!isRecord(perception) || !isRecord(perception.resident) || !isRecord(perception.resident.position)) {
        return undefined;
    }
    const { x, y, level } = perception.resident.position;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof level !== 'number') {
        return undefined;
    }
    return { x, y, level };
}

function isInformativeReport(text: string): boolean {
    const normalized = text.toLowerCase();
    return /\b\d{4},\d{4}\b/.test(normalized) || /\b(nearby|see|objects?|npcs?|players?|items?|tree|bank|shop)\b/.test(normalized);
}

function reportedMovement(reports: string[], perceptions: Perception[]): boolean {
    const positions = perceptions
        .map(perceptionPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    for (const report of reports) {
        const match = /\bmoved to\s+(\d{4}),(\d{4})\b/i.exec(report);
        if (!match) {
            continue;
        }
        const x = Number(match[1]);
        const y = Number(match[2]);
        if (positions.some(position => position.x === x && position.y === y)) {
            return true;
        }
    }
    return false;
}

function isSayAction(action: AgentAction): action is AgentAction & { kind: 'say'; text: string } {
    return action.kind === 'say' && typeof action.text === 'string';
}

function countArray(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const timeout = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout);
                resolve();
            },
            { once: true },
        );
    });
}
