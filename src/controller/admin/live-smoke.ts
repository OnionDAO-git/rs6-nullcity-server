import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import { residentSlug } from '../memory/runtime-state';
import { SoulLoader } from '../soul/soul-loader';

export type LiveSmokeStatus = 'ok' | 'warn' | 'missing';

export interface LiveSmokeCliOptions {
    configPath: string;
    memoryDir?: string;
    residents: string[];
    windowTicks: number;
    maxStuckTicks: number;
    observeSeconds: number;
    pollMs: number;
    minObservedActions: number;
    minObservedSays: number;
    allowRecentVisible: boolean;
    json: boolean;
    failOnWarn: boolean;
}

export interface LiveSmokeObservedDelta {
    durationMs: number;
    startTick?: number;
    endTick?: number;
    tickDelta?: number;
    actions: number;
    results: number;
    successes: number;
    failures: number;
    timeouts: number;
    says: number;
    decisions: number;
    inertDecisions: number;
    dominantInertDecision?: string;
    dominantInertDecisionCount?: number;
    visibleEvents: number;
}

export interface LiveSmokeSummary {
    resident: string;
    status: LiveSmokeStatus;
    tick?: number;
    lastTrajectoryTick?: number;
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
    recent: {
        actions: number;
        results: number;
        successes: number;
        failures: number;
        timeouts: number;
        says: number;
        decisions: number;
    };
    lastSay?: string;
    lastAction?: string;
    lastResult?: string;
    observed?: LiveSmokeObservedDelta;
    issues: string[];
}

export interface SummarizeLiveResidentsOptions {
    memoryDir: string;
    residents?: string[];
    windowTicks?: number;
    maxStuckTicks?: number;
}

export interface ObserveLiveResidentsOptions extends SummarizeLiveResidentsOptions {
    observeMs: number;
    pollMs?: number;
    minObservedActions?: number;
    minObservedSays?: number;
    allowRecentVisible?: boolean;
    sleep?: (ms: number) => Promise<void>;
}

interface RuntimeStateSnapshot {
    resident?: string;
    tick?: number;
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
}

interface TrajectoryEntry {
    tick?: number;
    kind?: string;
    sessionId?: string;
    action?: string | { kind?: string };
    status?: string;
    cause?: string;
    reason?: string;
    text?: string;
}

interface ParsedTrajectoryEntry extends TrajectoryEntry {
    entryKey: string;
    sourceFile: string;
    sourceIndex: number;
    lineIndex: number;
}

const DEFAULT_WINDOW_TICKS = 120;
const DEFAULT_MAX_STUCK_TICKS = 90;
const DEFAULT_OBSERVE_SECONDS = 0;
const DEFAULT_POLL_MS = 1000;
const MAX_TRAJECTORY_FILES = 4;
const INERT_DECISION_CAUSES = new Set(['body_wait', 'hook_noop']);
const MIN_OBSERVED_INERT_DECISIONS = 20;

export function parseLiveSmokeCliArgs(argv: string[]): LiveSmokeCliOptions {
    const envResidents = process.env.CONTROLLER_SMOKE_RESIDENTS || process.env.CONTROLLER_SMOKE_RESIDENT;
    const envWindowTicks = process.env.CONTROLLER_SMOKE_WINDOW_TICKS;
    const envMaxStuckTicks = process.env.CONTROLLER_SMOKE_MAX_STUCK_TICKS;
    const envObserveSeconds = process.env.CONTROLLER_SMOKE_OBSERVE_SECONDS;
    const envPollMs = process.env.CONTROLLER_SMOKE_POLL_MS;
    const envMinObservedActions = process.env.CONTROLLER_SMOKE_MIN_OBSERVED_ACTIONS;
    const envMinObservedSays = process.env.CONTROLLER_SMOKE_MIN_OBSERVED_SAYS;
    const envAllowRecentVisible = process.env.CONTROLLER_SMOKE_ALLOW_RECENT_VISIBLE;
    const envJson = process.env.CONTROLLER_SMOKE_JSON;
    const envFailOnWarn = process.env.CONTROLLER_SMOKE_FAIL_ON_WARN;

    const options: LiveSmokeCliOptions = {
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        memoryDir: process.env.CONTROLLER_MEMORY_DIR,
        residents: envResidents
            ? envResidents
                  .split(',')
                  .map(r => r.trim())
                  .filter(Boolean)
            : [],
        windowTicks: envWindowTicks ? parsePositiveInteger(envWindowTicks, 'CONTROLLER_SMOKE_WINDOW_TICKS') : DEFAULT_WINDOW_TICKS,
        maxStuckTicks: envMaxStuckTicks
            ? parsePositiveInteger(envMaxStuckTicks, 'CONTROLLER_SMOKE_MAX_STUCK_TICKS')
            : DEFAULT_MAX_STUCK_TICKS,
        observeSeconds: envObserveSeconds
            ? parsePositiveInteger(envObserveSeconds, 'CONTROLLER_SMOKE_OBSERVE_SECONDS')
            : DEFAULT_OBSERVE_SECONDS,
        pollMs: envPollMs ? parsePositiveInteger(envPollMs, 'CONTROLLER_SMOKE_POLL_MS') : DEFAULT_POLL_MS,
        minObservedActions: envMinObservedActions
            ? parsePositiveInteger(envMinObservedActions, 'CONTROLLER_SMOKE_MIN_OBSERVED_ACTIONS')
            : 0,
        minObservedSays: envMinObservedSays ? parsePositiveInteger(envMinObservedSays, 'CONTROLLER_SMOKE_MIN_OBSERVED_SAYS') : 0,
        allowRecentVisible: envAllowRecentVisible === 'true' || envAllowRecentVisible === '1',
        json: envJson === 'true' || envJson === '1',
        failOnWarn: envFailOnWarn === 'true' || envFailOnWarn === '1',
    };

    let hasCliResident = false;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--config' || arg === '-c') {
            const next = argv[i + 1];
            if (!next) throw new Error(`${arg} requires a path`);
            options.configPath = next;
            i += 1;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--memory-dir') {
            const next = argv[i + 1];
            if (!next) throw new Error('--memory-dir requires a path');
            options.memoryDir = next;
            i += 1;
        } else if (arg.startsWith('--memory-dir=')) {
            options.memoryDir = arg.slice('--memory-dir='.length);
        } else if (arg === '--resident') {
            const next = argv[i + 1];
            if (!next) throw new Error('--resident requires a value');
            if (!hasCliResident) {
                options.residents = [];
                hasCliResident = true;
            }
            options.residents.push(next);
            i += 1;
        } else if (arg.startsWith('--resident=')) {
            if (!hasCliResident) {
                options.residents = [];
                hasCliResident = true;
            }
            options.residents.push(arg.slice('--resident='.length));
        } else if (arg === '--window-ticks') {
            const next = argv[i + 1];
            if (!next) throw new Error('--window-ticks requires a value');
            options.windowTicks = parsePositiveInteger(next, '--window-ticks');
            i += 1;
        } else if (arg.startsWith('--window-ticks=')) {
            options.windowTicks = parsePositiveInteger(arg.slice('--window-ticks='.length), '--window-ticks');
        } else if (arg === '--max-stuck-ticks') {
            const next = argv[i + 1];
            if (!next) throw new Error('--max-stuck-ticks requires a value');
            options.maxStuckTicks = parsePositiveInteger(next, '--max-stuck-ticks');
            i += 1;
        } else if (arg.startsWith('--max-stuck-ticks=')) {
            options.maxStuckTicks = parsePositiveInteger(arg.slice('--max-stuck-ticks='.length), '--max-stuck-ticks');
        } else if (arg === '--observe-seconds') {
            const next = argv[i + 1];
            if (!next) throw new Error('--observe-seconds requires a value');
            options.observeSeconds = parsePositiveInteger(next, '--observe-seconds');
            i += 1;
        } else if (arg.startsWith('--observe-seconds=')) {
            options.observeSeconds = parsePositiveInteger(arg.slice('--observe-seconds='.length), '--observe-seconds');
        } else if (arg === '--poll-ms') {
            const next = argv[i + 1];
            if (!next) throw new Error('--poll-ms requires a value');
            options.pollMs = parsePositiveInteger(next, '--poll-ms');
            i += 1;
        } else if (arg.startsWith('--poll-ms=')) {
            options.pollMs = parsePositiveInteger(arg.slice('--poll-ms='.length), '--poll-ms');
        } else if (arg === '--min-observed-actions') {
            const next = argv[i + 1];
            if (!next) throw new Error('--min-observed-actions requires a value');
            options.minObservedActions = parsePositiveInteger(next, '--min-observed-actions');
            i += 1;
        } else if (arg.startsWith('--min-observed-actions=')) {
            options.minObservedActions = parsePositiveInteger(arg.slice('--min-observed-actions='.length), '--min-observed-actions');
        } else if (arg === '--min-observed-says') {
            const next = argv[i + 1];
            if (!next) throw new Error('--min-observed-says requires a value');
            options.minObservedSays = parsePositiveInteger(next, '--min-observed-says');
            i += 1;
        } else if (arg.startsWith('--min-observed-says=')) {
            options.minObservedSays = parsePositiveInteger(arg.slice('--min-observed-says='.length), '--min-observed-says');
        } else if (arg === '--allow-recent-visible') {
            options.allowRecentVisible = true;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--fail-on-warn') {
            options.failOnWarn = true;
        } else {
            throw new Error(`Unknown argument ${arg}`);
        }
    }

    return options;
}

export function summarizeLiveResidents(options: SummarizeLiveResidentsOptions): LiveSmokeSummary[] {
    const windowTicks = options.windowTicks ?? DEFAULT_WINDOW_TICKS;
    const maxStuckTicks = options.maxStuckTicks ?? DEFAULT_MAX_STUCK_TICKS;
    const residents = options.residents?.length ? options.residents : discoverResidents(options.memoryDir);

    return residents.map(resident => summarizeResident(options.memoryDir, resident, windowTicks, maxStuckTicks));
}

export async function observeLiveResidents(options: ObserveLiveResidentsOptions): Promise<LiveSmokeSummary[]> {
    const windowTicks = options.windowTicks ?? DEFAULT_WINDOW_TICKS;
    const maxStuckTicks = options.maxStuckTicks ?? DEFAULT_MAX_STUCK_TICKS;
    const residents = options.residents?.length ? options.residents : discoverResidents(options.memoryDir);
    const startSnapshots = new Map(residents.map(resident => [resident, readResidentObservationSnapshot(options.memoryDir, resident)]));

    await sleepForDuration(options.observeMs, options.pollMs ?? DEFAULT_POLL_MS, options.sleep ?? defaultSleep);

    return residents.map(requestedResident => {
        const summary = summarizeResident(options.memoryDir, requestedResident, windowTicks, maxStuckTicks);
        const observed = diffObservationSnapshots(
            startSnapshots.get(requestedResident),
            readResidentObservationSnapshot(options.memoryDir, requestedResident),
            options.observeMs,
        );
        summary.observed = observed;
        if (
            observed.visibleEvents === 0 &&
            (!options.allowRecentVisible || summary.recent.actions + summary.recent.results + summary.recent.says === 0)
        ) {
            summary.issues.push('no_observed_visible_activity');
        }
        if ((observed.tickDelta ?? 0) <= 0) {
            summary.issues.push('no_observed_tick_progress');
        }
        if (options.minObservedActions && observed.actions < options.minObservedActions) {
            summary.issues.push(`observed_actions_below_${options.minObservedActions}`);
        }
        if (options.minObservedSays && observed.says < options.minObservedSays) {
            summary.issues.push(`observed_says_below_${options.minObservedSays}`);
        }
        if (observed.timeouts > 0 && observed.successes === 0 && observed.actions + observed.says === 0) {
            summary.issues.push('observed_only_timeouts');
        }
        if (
            observed.dominantInertDecision &&
            observed.inertDecisions >= MIN_OBSERVED_INERT_DECISIONS &&
            observed.visibleEvents <= Math.max(3, Math.floor(observed.inertDecisions / 8))
        ) {
            summary.issues.push(`observed_inert_decision_loop:${observed.dominantInertDecision}`);
        }
        if (observed.actions + observed.says > 0) {
            summary.issues = summary.issues.filter(issue => issue !== 'no_recent_visible_activity');
        }
        if (summary.issues.length) {
            summary.status = summary.status === 'missing' ? 'missing' : 'warn';
        } else {
            summary.status = 'ok';
        }
        return summary;
    });
}

export async function runLiveSmokeCli(argv: string[]): Promise<number> {
    try {
        const options = parseLiveSmokeCliArgs(argv);
        const config = !options.memoryDir || options.residents.length === 0 ? loadControllerConfig(options.configPath) : undefined;
        const memoryDir = options.memoryDir || config?.memory.dir || 'data/controller/memory';
        const residents =
            options.residents.length > 0
                ? options.residents
                : options.memoryDir
                  ? undefined
                  : config
                    ? desiredResidentsFromConfig(config)
                    : undefined;
        const summaries =
            options.observeSeconds > 0
                ? await observeLiveResidents({
                      memoryDir,
                      residents,
                      windowTicks: options.windowTicks,
                      maxStuckTicks: options.maxStuckTicks,
                      observeMs: options.observeSeconds * 1000,
                      pollMs: options.pollMs,
                      minObservedActions: options.minObservedActions,
                      minObservedSays: options.minObservedSays,
                      allowRecentVisible: options.allowRecentVisible,
                  })
                : summarizeLiveResidents({
                      memoryDir,
                      residents,
                      windowTicks: options.windowTicks,
                      maxStuckTicks: options.maxStuckTicks,
                  });

        if (options.json) {
            console.log(JSON.stringify({ memoryDir, summaries }, null, 2));
        } else {
            console.log(formatLiveSmokeSummary(memoryDir, summaries));
        }

        if (summaries.length === 0 || summaries.some(summary => summary.status === 'missing')) {
            return 1;
        }
        if ((options.failOnWarn || options.observeSeconds > 0) && summaries.some(summary => summary.status !== 'ok')) {
            return 1;
        }
        return 0;
    } catch (error) {
        console.error(`[controller:smoke] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

function desiredResidentsFromConfig(config: ReturnType<typeof loadControllerConfig>): string[] {
    const residents = new Set(config.residents);
    try {
        for (const name of new SoulLoader(config.souls.dir).listResidentNames()) {
            residents.add(name);
        }
    } catch {
        // Fall back to configured residents; smoke should still run if an
        // operator points at an older config without a readable SOUL dir.
    }
    return [...residents];
}

export function formatLiveSmokeSummary(memoryDir: string, summaries: LiveSmokeSummary[]): string {
    const lines = [`[controller:smoke] memory=${memoryDir} residents=${summaries.length}`];
    for (const summary of summaries) {
        const issueText = summary.issues.length ? ` issues=${summary.issues.join(',')}` : '';
        const observed = summary.observed
            ? ` observed=${summary.observed.durationMs}ms/+${summary.observed.tickDelta ?? 0}t actions=${summary.observed.actions} results=${summary.observed.results} success=${summary.observed.successes} timeout=${summary.observed.timeouts} fail=${summary.observed.failures} says=${summary.observed.says}${summary.observed.inertDecisions ? ` inert=${summary.observed.inertDecisions}:${summary.observed.dominantInertDecision || 'unknown'}` : ''}`
            : '';
        const lastAction = summary.lastAction ? ` lastAction=${summary.lastAction}` : '';
        const lastResult = summary.lastResult ? ` lastResult=${summary.lastResult}` : '';
        const lastSay = summary.lastSay ? ` lastSay="${truncate(summary.lastSay, 90)}"` : '';
        lines.push(
            `${summary.status.toUpperCase()} ${summary.resident} tick=${summary.tick ?? '?'} actions=${summary.recent.actions} results=${summary.recent.results} success=${summary.recent.successes} timeout=${summary.recent.timeouts} fail=${summary.recent.failures} says=${summary.recent.says}${observed}${lastAction}${lastResult}${lastSay}${issueText}`,
        );
    }
    return lines.join('\n');
}

function summarizeResident(memoryDir: string, resident: string, windowTicks: number, maxStuckTicks: number): LiveSmokeSummary {
    const residentDir = path.join(memoryDir, residentSlug(resident));
    const state = readJson<RuntimeStateSnapshot>(path.join(residentDir, 'runtime-state.json'));
    const stateTick = numberOrUndefined(state?.tick);
    const entries = currentSessionEntries(readTrajectoryEntries(residentDir), stateTick);
    const lastTrajectoryTick = latestTick(entries);
    const tick = stateTick ?? lastTrajectoryTick;
    const trajectoryReferenceTick = lastTrajectoryTick ?? tick ?? 0;
    const stateReferenceTick = tick ?? trajectoryReferenceTick;
    const recentEntries = entries.filter(entry => typeof entry.tick !== 'number' || entry.tick >= trajectoryReferenceTick - windowTicks);
    const decisionCauses = new Map<string, number>();
    const summary: LiveSmokeSummary = {
        resident: state?.resident || resident,
        status: state ? 'ok' : 'missing',
        tick,
        lastTrajectoryTick,
        lastMeaningfulProgressAt: numberOrUndefined(state?.lastMeaningfulProgressAt),
        stuckSince: numberOrUndefined(state?.stuckSince),
        recent: {
            actions: 0,
            results: 0,
            successes: 0,
            failures: 0,
            timeouts: 0,
            says: 0,
            decisions: 0,
        },
        issues: [],
    };

    for (const entry of recentEntries) {
        if (entry.kind === 'decision') {
            summary.recent.decisions += 1;
            if (entry.cause) {
                decisionCauses.set(entry.cause, (decisionCauses.get(entry.cause) || 0) + 1);
            }
        }
        if (entry.kind === 'say') {
            summary.recent.says += 1;
            if (entry.text) summary.lastSay = entry.text;
        }
        if (entry.kind === 'action') {
            summary.recent.actions += 1;
            summary.lastAction = actionKind(entry);
        }
        if (entry.kind === 'action_result') {
            summary.recent.results += 1;
            if (entry.status === 'success') summary.recent.successes += 1;
            if (entry.status === 'failure') summary.recent.failures += 1;
            if (entry.status === 'timeout') summary.recent.timeouts += 1;
            summary.lastResult = entry.reason ? `${entry.status}:${entry.reason}` : entry.status;
        }
    }

    if (!state) {
        summary.issues.push('missing_runtime_state');
    }
    if (entries.length === 0) {
        summary.issues.push('missing_trajectory');
    }
    if (summary.recent.actions + summary.recent.results + summary.recent.says === 0) {
        summary.issues.push('no_recent_visible_activity');
    }
    if (summary.stuckSince !== undefined && stateReferenceTick - summary.stuckSince >= maxStuckTicks) {
        summary.issues.push(`stuck_for_${stateReferenceTick - summary.stuckSince}_ticks`);
    }
    if (summary.recent.results >= 3 && summary.recent.successes === 0) {
        summary.issues.push('recent_actions_not_succeeding');
    }
    const dominantDecision = dominantDecisionCause(decisionCauses, summary.recent.decisions);
    if (summary.recent.actions === 0 && dominantDecision && dominantDecision.count >= 20 && dominantDecision.share >= 0.75) {
        summary.issues.push(`decision_loop_without_actions:${dominantDecision.cause}`);
    }
    summary.status = summary.issues.length ? (state ? 'warn' : 'missing') : 'ok';
    return summary;
}

function dominantDecisionCause(
    causes: ReadonlyMap<string, number>,
    decisionCount: number,
): { cause: string; count: number; share: number } | undefined {
    if (decisionCount <= 0 || causes.size === 0) {
        return undefined;
    }

    let dominant: { cause: string; count: number } | undefined;
    for (const [cause, count] of causes) {
        if (!dominant || count > dominant.count) {
            dominant = { cause, count };
        }
    }

    return dominant ? { ...dominant, share: dominant.count / decisionCount } : undefined;
}

interface ObservationSnapshot {
    tick?: number;
    runtimeTick?: number;
    trajectoryTick?: number;
    entries: ParsedTrajectoryEntry[];
    entryKeys: Set<string>;
}

interface ObservationCounts {
    actions: number;
    results: number;
    successes: number;
    failures: number;
    timeouts: number;
    says: number;
    decisions: number;
    inertDecisions: number;
    dominantInertDecision?: string;
    dominantInertDecisionCount?: number;
}

function readResidentObservationSnapshot(memoryDir: string, resident: string): ObservationSnapshot {
    const residentDir = path.join(memoryDir, residentSlug(resident));
    const state = readJson<RuntimeStateSnapshot>(path.join(residentDir, 'runtime-state.json'));
    const stateTick = numberOrUndefined(state?.tick);
    const entries = currentSessionEntries(readTrajectoryEntries(residentDir), stateTick);
    const trajectoryTick = latestTick(entries);
    return {
        tick: stateTick ?? trajectoryTick,
        runtimeTick: stateTick,
        trajectoryTick,
        entries,
        entryKeys: new Set(entries.map(entry => entry.entryKey)),
    };
}

function diffObservationSnapshots(
    start: ObservationSnapshot | undefined,
    end: ObservationSnapshot,
    durationMs: number,
): LiveSmokeObservedDelta {
    const counts = countTrajectoryEntries(end.entries.filter(entry => !start?.entryKeys.has(entry.entryKey)));
    const progress = observationProgress(start, end);
    return {
        durationMs,
        startTick: progress.startTick,
        endTick: progress.endTick,
        tickDelta: progress.tickDelta,
        ...counts,
        visibleEvents: counts.actions + counts.results + counts.says,
    };
}

function observationProgress(
    start: ObservationSnapshot | undefined,
    end: ObservationSnapshot,
): { startTick?: number; endTick?: number; tickDelta?: number } {
    let runtimeProgress: { startTick: number; endTick: number; tickDelta: number } | undefined;
    let trajectoryProgress: { startTick: number; endTick: number; tickDelta: number } | undefined;
    if (start?.runtimeTick !== undefined && end.runtimeTick !== undefined) {
        runtimeProgress = {
            startTick: start.runtimeTick,
            endTick: end.runtimeTick,
            tickDelta: Math.max(0, end.runtimeTick - start.runtimeTick),
        };
    }
    if (start?.trajectoryTick !== undefined && end.trajectoryTick !== undefined) {
        trajectoryProgress = {
            startTick: start.trajectoryTick,
            endTick: end.trajectoryTick,
            tickDelta: Math.max(0, end.trajectoryTick - start.trajectoryTick),
        };
    }
    if (runtimeProgress && runtimeProgress.tickDelta > 0) {
        return runtimeProgress;
    }
    if (
        trajectoryProgress &&
        (!runtimeProgress || end.runtimeTick === undefined || end.runtimeTick !== end.trajectoryTick || trajectoryProgress.tickDelta === 0)
    ) {
        return trajectoryProgress;
    }
    if (runtimeProgress) {
        return runtimeProgress;
    }
    return { startTick: start?.tick, endTick: end.tick };
}

function countTrajectoryEntries(entries: TrajectoryEntry[]): ObservationCounts {
    const counts: ObservationCounts = {
        actions: 0,
        results: 0,
        successes: 0,
        failures: 0,
        timeouts: 0,
        says: 0,
        decisions: 0,
        inertDecisions: 0,
    };
    const inertCauses = new Map<string, number>();
    for (const entry of entries) {
        if (entry.kind === 'action') counts.actions += 1;
        if (entry.kind === 'say') counts.says += 1;
        if (entry.kind === 'decision') {
            counts.decisions += 1;
            if (isInertDecisionCause(entry.cause)) {
                counts.inertDecisions += 1;
                inertCauses.set(entry.cause as string, (inertCauses.get(entry.cause as string) || 0) + 1);
            }
        }
        if (entry.kind === 'action_result') {
            counts.results += 1;
            if (entry.status === 'success') counts.successes += 1;
            if (entry.status === 'failure') counts.failures += 1;
            if (entry.status === 'timeout') counts.timeouts += 1;
        }
    }
    const dominantInert = dominantDecisionCause(inertCauses, counts.inertDecisions);
    if (dominantInert) {
        counts.dominantInertDecision = dominantInert.cause;
        counts.dominantInertDecisionCount = dominantInert.count;
    }
    return counts;
}

function isInertDecisionCause(cause: string | undefined): boolean {
    return Boolean(cause && (INERT_DECISION_CAUSES.has(cause) || cause.startsWith('budget_exhausted')));
}

function discoverResidents(memoryDir: string): string[] {
    if (!fs.existsSync(memoryDir)) {
        return [];
    }
    return fs
        .readdirSync(memoryDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => {
            const state = readJson<RuntimeStateSnapshot>(path.join(memoryDir, entry.name, 'runtime-state.json'));
            return state ? [state.resident || entry.name] : [];
        })
        .sort();
}

function readTrajectoryEntries(residentDir: string): ParsedTrajectoryEntry[] {
    const trajectoryDir = path.join(residentDir, 'evidence', 'trajectory');
    if (!fs.existsSync(trajectoryDir)) {
        return [];
    }
    const files = fs
        .readdirSync(trajectoryDir)
        .filter(file => file.endsWith('.jsonl'))
        .sort()
        .slice(-MAX_TRAJECTORY_FILES);
    if (files.length === 0) {
        return [];
    }
    return files.flatMap((file, sourceIndex) =>
        fs
            .readFileSync(path.join(trajectoryDir, file), 'utf8')
            .split('\n')
            .filter(Boolean)
            .flatMap((line, lineIndex) => {
                try {
                    return [
                        {
                            ...(JSON.parse(line) as TrajectoryEntry),
                            entryKey: `${file}:${lineIndex}`,
                            sourceFile: file,
                            sourceIndex,
                            lineIndex,
                        },
                    ];
                } catch {
                    return [];
                }
            }),
    );
}

function currentSessionEntries(entries: ParsedTrajectoryEntry[], runtimeTick: number | undefined): ParsedTrajectoryEntry[] {
    const boundedEntries =
        runtimeTick === undefined ? entries : entries.filter(entry => typeof entry.tick !== 'number' || entry.tick <= runtimeTick);
    const latestSessionId = [...boundedEntries].reverse().find(entry => typeof entry.sessionId === 'string')?.sessionId;
    if (latestSessionId) {
        return boundedEntries.filter(entry => entry.sessionId === latestSessionId);
    }
    const latestSourceFile = boundedEntries.at(-1)?.sourceFile;
    return latestSourceFile ? boundedEntries.filter(entry => entry.sourceFile === latestSourceFile) : boundedEntries;
}

function readJson<T>(file: string): T | undefined {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return undefined;
    }
}

function latestTick(entries: TrajectoryEntry[]): number | undefined {
    let latest: number | undefined;
    for (const entry of entries) {
        if (typeof entry.tick === 'number' && (latest === undefined || entry.tick > latest)) {
            latest = entry.tick;
        }
    }
    return latest;
}

function actionKind(entry: TrajectoryEntry): string | undefined {
    if (typeof entry.action === 'string') {
        return entry.action;
    }
    return typeof entry.action?.kind === 'string' ? entry.action.kind : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePositiveInteger(value: string, flag: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer.`);
    }
    return parsed;
}

async function sleepForDuration(totalMs: number, pollMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
    let remainingMs = totalMs;
    while (remainingMs > 0) {
        const stepMs = Math.min(remainingMs, pollMs);
        await sleep(stepMs);
        remainingMs -= stepMs;
    }
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

if (require.main === module) {
    runLiveSmokeCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
