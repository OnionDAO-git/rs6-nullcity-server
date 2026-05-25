import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import { residentSlug } from '../memory/runtime-state';

export type LiveSmokeStatus = 'ok' | 'warn' | 'missing';

export interface LiveSmokeCliOptions {
    configPath: string;
    memoryDir?: string;
    residents: string[];
    windowTicks: number;
    maxStuckTicks: number;
    json: boolean;
    failOnWarn: boolean;
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
    issues: string[];
}

export interface SummarizeLiveResidentsOptions {
    memoryDir: string;
    residents?: string[];
    windowTicks?: number;
    maxStuckTicks?: number;
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
    action?: string | { kind?: string };
    status?: string;
    cause?: string;
    reason?: string;
    text?: string;
}

const DEFAULT_WINDOW_TICKS = 120;
const DEFAULT_MAX_STUCK_TICKS = 90;

export function parseLiveSmokeCliArgs(argv: string[]): LiveSmokeCliOptions {
    const options: LiveSmokeCliOptions = {
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        residents: [],
        windowTicks: DEFAULT_WINDOW_TICKS,
        maxStuckTicks: DEFAULT_MAX_STUCK_TICKS,
        json: false,
        failOnWarn: false,
    };

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
            options.residents.push(next);
            i += 1;
        } else if (arg.startsWith('--resident=')) {
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

export async function runLiveSmokeCli(argv: string[]): Promise<number> {
    try {
        const options = parseLiveSmokeCliArgs(argv);
        const config = !options.memoryDir || options.residents.length === 0 ? loadControllerConfig(options.configPath) : undefined;
        const memoryDir = options.memoryDir || config?.memory.dir || 'data/controller/memory';
        const residents = options.residents.length > 0 ? options.residents : options.memoryDir ? undefined : config?.residents;
        const summaries = summarizeLiveResidents({
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
        if (options.failOnWarn && summaries.some(summary => summary.status !== 'ok')) {
            return 1;
        }
        return 0;
    } catch (error) {
        console.error(`[controller:smoke] ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

export function formatLiveSmokeSummary(memoryDir: string, summaries: LiveSmokeSummary[]): string {
    const lines = [`[controller:smoke] memory=${memoryDir} residents=${summaries.length}`];
    for (const summary of summaries) {
        const issueText = summary.issues.length ? ` issues=${summary.issues.join(',')}` : '';
        const lastAction = summary.lastAction ? ` lastAction=${summary.lastAction}` : '';
        const lastResult = summary.lastResult ? ` lastResult=${summary.lastResult}` : '';
        const lastSay = summary.lastSay ? ` lastSay="${truncate(summary.lastSay, 90)}"` : '';
        lines.push(
            `${summary.status.toUpperCase()} ${summary.resident} tick=${summary.tick ?? '?'} actions=${summary.recent.actions} results=${summary.recent.results} success=${summary.recent.successes} timeout=${summary.recent.timeouts} fail=${summary.recent.failures} says=${summary.recent.says}${lastAction}${lastResult}${lastSay}${issueText}`,
        );
    }
    return lines.join('\n');
}

function summarizeResident(memoryDir: string, resident: string, windowTicks: number, maxStuckTicks: number): LiveSmokeSummary {
    const residentDir = path.join(memoryDir, residentSlug(resident));
    const state = readJson<RuntimeStateSnapshot>(path.join(residentDir, 'runtime-state.json'));
    const entries = readLatestTrajectoryEntries(residentDir);
    const lastTrajectoryTick = latestTick(entries);
    const tick = numberOrUndefined(state?.tick) ?? lastTrajectoryTick;
    const referenceTick = Math.max(tick ?? 0, lastTrajectoryTick ?? 0);
    const recentEntries = entries.filter(entry => typeof entry.tick !== 'number' || entry.tick >= referenceTick - windowTicks);
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
    if (summary.stuckSince !== undefined && referenceTick - summary.stuckSince >= maxStuckTicks) {
        summary.issues.push(`stuck_for_${referenceTick - summary.stuckSince}_ticks`);
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

function readLatestTrajectoryEntries(residentDir: string): TrajectoryEntry[] {
    const trajectoryDir = path.join(residentDir, 'evidence', 'trajectory');
    if (!fs.existsSync(trajectoryDir)) {
        return [];
    }
    const latest = fs
        .readdirSync(trajectoryDir)
        .filter(file => file.endsWith('.jsonl'))
        .sort()
        .at(-1);
    if (!latest) {
        return [];
    }
    return fs
        .readFileSync(path.join(trajectoryDir, latest), 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap(line => {
            try {
                return [JSON.parse(line) as TrajectoryEntry];
            } catch {
                return [];
            }
        });
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

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

if (require.main === module) {
    runLiveSmokeCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
