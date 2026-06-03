import fs from 'fs';
import path from 'path';
import { runStorytellerDryRun } from './cli';
import { type StorytellerOverseerLedgerRow, runStorytellerOverseerTick } from './overseer';
import { runStoryteller } from './run-cli';
import type { CityEventDigest, StorytellerDispatch } from './types';

export type StorytellerSchedulerMode = 'once' | 'watch';
export type StorytellerSchedulerModelStatus = 'skipped' | 'called' | 'nooped';

export interface StorytellerSchedulerArgs {
    mode: StorytellerSchedulerMode;
    intervalMs: number;
    memoryRoot: string;
    outputDir: string;
    modelProfile: string;
    controllerConfigPath?: string;
    dailyCostCapUsd?: number;
    lockTtlMs: number;
    autoPublishOnZeroWarnings: boolean;
}

export interface StorytellerSchedulerOptions {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
    logger?: Pick<Console, 'log' | 'error'>;
    shouldContinue?: (iteration: number, result: StorytellerSchedulerTickResult) => boolean;
}

export interface StorytellerSchedulerTickResult {
    startedAt: string;
    windowStart: string;
    windowEnd: string;
    digestId: string;
    modelCalled: boolean;
    modelStatus: StorytellerSchedulerModelStatus;
    row: StorytellerOverseerLedgerRow | StorytellerSchedulerSkippedLockedRow;
}

export interface StorytellerSchedulerSkippedLockedRow {
    schemaVersion: 1;
    rowId: string;
    createdAt: string;
    digestId: string;
    fingerprint: string;
    decision: 'skipped_locked';
    reason: string;
    eventRefs: string[];
    artifactDir: null;
}

export class StorytellerSchedulerCliError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'StorytellerSchedulerCliError';
    }
}

const DEFAULT_INTERVAL_MS = 30 * 60_000;
const DEFAULT_LOCK_TTL_MS = 90 * 60_000;

export function parseStorytellerSchedulerArgs(
    argv: string[],
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): StorytellerSchedulerArgs {
    let mode: StorytellerSchedulerMode | undefined;
    let intervalMs = DEFAULT_INTERVAL_MS;
    let lockTtlMs = DEFAULT_LOCK_TTL_MS;
    let memoryRoot = path.join('data', 'controller', 'memory');
    let outputDir = path.join('data', 'controller', 'storyteller');
    let modelProfile = env.STORYTELLER_MODEL_PROFILE ?? 'storyteller';
    let controllerConfigPath = readOptionalEnvPath(env.STORYTELLER_CONTROLLER_CONFIG) ?? readOptionalEnvPath(env.CONTROLLER_CONFIG);
    let dailyCostCapUsd = parseOptionalNumber(env.STORYTELLER_DAILY_COST_CAP_USD, 'STORYTELLER_DAILY_COST_CAP_USD');
    let autoPublishOnZeroWarnings = true;

    const claimMode = (nextMode: StorytellerSchedulerMode): void => {
        if (mode !== undefined) {
            throw new StorytellerSchedulerCliError('conflicting_modes', 'use exactly one mode: --once or --watch');
        }
        mode = nextMode;
    };

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = argv[i + 1];
        if (flag === '--once') {
            claimMode('once');
        } else if (flag === '--watch') {
            claimMode('watch');
        } else if (flag === '--interval-minutes') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--interval-minutes requires a number');
            intervalMs = parseMinutes(next, '--interval-minutes');
            i++;
        } else if (flag === '--lock-ttl-minutes') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--lock-ttl-minutes requires a number');
            lockTtlMs = parseMinutes(next, '--lock-ttl-minutes');
            i++;
        } else if (flag === '--memory-root') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--memory-root requires a path');
            memoryRoot = next;
            i++;
        } else if (flag === '--output-dir') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--output-dir requires a path');
            outputDir = next;
            i++;
        } else if (flag === '--model-profile') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--model-profile requires a value');
            modelProfile = next;
            i++;
        } else if (flag === '--controller-config') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--controller-config requires a path');
            controllerConfigPath = next;
            i++;
        } else if (flag === '--daily-cost-cap-usd') {
            if (!next) throw new StorytellerSchedulerCliError('missing_value', '--daily-cost-cap-usd requires a number');
            dailyCostCapUsd = parseOptionalNumber(next, '--daily-cost-cap-usd');
            i++;
        } else if (flag === '--no-auto-publish-on-zero-warnings') {
            autoPublishOnZeroWarnings = false;
        } else if (flag === '--help' || flag === '-h') {
            throw new StorytellerSchedulerCliError('help', usage());
        } else {
            throw new StorytellerSchedulerCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    if (mode === undefined) {
        throw new StorytellerSchedulerCliError('missing_mode', 'use exactly one mode: --once or --watch');
    }

    const parsed: StorytellerSchedulerArgs = {
        mode,
        intervalMs,
        memoryRoot,
        outputDir,
        modelProfile,
        lockTtlMs,
        autoPublishOnZeroWarnings,
    };
    if (controllerConfigPath !== undefined) parsed.controllerConfigPath = controllerConfigPath;
    if (dailyCostCapUsd !== undefined) parsed.dailyCostCapUsd = dailyCostCapUsd;
    return parsed;
}

export async function runStorytellerSchedulerTick(
    args: StorytellerSchedulerArgs,
    options: StorytellerSchedulerOptions = {},
): Promise<StorytellerSchedulerTickResult> {
    const now = options.now ? options.now() : new Date();
    const startedAt = now.toISOString();
    const windowEnd = startedAt;
    const windowStart = new Date(now.getTime() - args.intervalMs).toISOString();
    const lock = acquireSchedulerLock(args.outputDir, now, args.lockTtlMs);
    if (!lock.acquired) {
        return {
            startedAt,
            windowStart,
            windowEnd,
            digestId: 'locked',
            modelCalled: false,
            modelStatus: 'skipped',
            row: {
                schemaVersion: 1,
                rowId: `scheduler-skip-${now.getTime()}`,
                createdAt: startedAt,
                digestId: 'locked',
                fingerprint: 'locked',
                decision: 'skipped_locked',
                reason: lock.reason || 'another Storyteller scheduler tick is running',
                eventRefs: [],
                artifactDir: null,
            },
        };
    }

    try {
        const dryRun = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot: args.memoryRoot,
                outputDir: args.outputDir,
                since: windowStart,
                until: windowEnd,
            },
            { now: () => now },
        );
        const digest = dryRun.digest;

        if (digestEventCount(digest) === 0) {
            const held = runStorytellerOverseerTick({
                source: 'digest-id',
                digestId: digest.digestId,
                outputDir: args.outputDir,
                dailyCostCapUsd: args.dailyCostCapUsd,
                autoPublishOnZeroWarnings: args.autoPublishOnZeroWarnings,
                now: () => now,
            });
            return {
                startedAt,
                windowStart,
                windowEnd,
                digestId: digest.digestId,
                modelCalled: false,
                modelStatus: 'skipped',
                row: held.row,
            };
        }

        const run = await runStoryteller(
            {
                source: 'digest-id',
                digestId: digest.digestId,
                outputDir: args.outputDir,
                modelProfile: args.modelProfile,
                ...(args.controllerConfigPath !== undefined ? { controllerConfigPath: args.controllerConfigPath } : {}),
                dailyCostCapUsd: args.dailyCostCapUsd,
            },
            { env: options.env, now: () => now },
        );
        const modelStatus: StorytellerSchedulerModelStatus = dispatchWasNooped(run.dispatch) ? 'nooped' : 'called';
        const published = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir: args.outputDir,
            dailyCostCapUsd: args.dailyCostCapUsd,
            autoPublishOnZeroWarnings: args.autoPublishOnZeroWarnings,
            now: () => now,
        });

        return {
            startedAt,
            windowStart,
            windowEnd,
            digestId: digest.digestId,
            modelCalled: true,
            modelStatus,
            row: published.row,
        };
    } finally {
        lock.release?.();
    }
}

export async function runStorytellerSchedulerWatch(
    args: StorytellerSchedulerArgs,
    options: StorytellerSchedulerOptions = {},
): Promise<void> {
    const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const logger = options.logger ?? console;
    let iteration = 0;
    while (true) {
        const result = await runStorytellerSchedulerTick(args, options);
        logger.log(
            `[storyteller:scheduler] ${result.row.decision} digest=${result.digestId} model=${result.modelStatus} reason="${result.row.reason}"`,
        );
        iteration++;
        if (options.shouldContinue && !options.shouldContinue(iteration, result)) {
            return;
        }
        await sleep(args.intervalMs);
    }
}

export function storytellerSchedulerLockPath(outputDir: string): string {
    return path.join(outputDir, 'storyteller-scheduler.lock');
}

export function usage(): string {
    return [
        'Usage:',
        '  npm run storyteller:scheduler -- --once [--interval-minutes 30] [--memory-root <path>] [--output-dir <path>]',
        '  npm run storyteller:scheduler -- --watch [--interval-minutes 30] [--memory-root <path>] [--output-dir <path>]',
        '                                      [--model-profile <name>] [--controller-config <path>] [--daily-cost-cap-usd <usd>]',
        '',
        'Builds a live digest, skips quiet/no-delta windows, runs the Storyteller model when evidence exists,',
        'then publishes or queues the dispatch through the existing overseer. Paid model endpoints require a daily cap.',
    ].join('\n');
}

function parseMinutes(value: string, label: string): number {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new StorytellerSchedulerCliError('invalid_minutes', `${label} must be a positive number`);
    }
    return Math.round(parsed * 60_000);
}

function parseOptionalNumber(value: string | undefined, label: string): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new StorytellerSchedulerCliError('invalid_number', `${label} must be a non-negative number`);
    }
    return parsed;
}

function readOptionalEnvPath(value: string | undefined): string | undefined {
    return value && value.trim() ? value : undefined;
}

function digestEventCount(digest: CityEventDigest): number {
    return [
        digest.apEvents,
        digest.gpEvents,
        digest.exchangeEvents,
        digest.ncriEvents,
        digest.goalEvents,
        digest.stuckEvents,
        digest.miscEvents,
    ].reduce((sum, events) => sum + events.length, 0);
}

function dispatchWasNooped(dispatch: StorytellerDispatch): boolean {
    return (dispatch.reviewReasons ?? []).some(reason => reason.toLowerCase().includes('nooped'));
}

function acquireSchedulerLock(
    outputDir: string,
    now: Date,
    lockTtlMs: number,
): { acquired: boolean; reason?: string; release?: () => void } {
    fs.mkdirSync(outputDir, { recursive: true });
    const lockPath = storytellerSchedulerLockPath(outputDir);
    const payload = `${JSON.stringify({ pid: process.pid, createdAt: now.toISOString() })}\n`;
    try {
        fs.writeFileSync(lockPath, payload, { flag: 'wx' });
        return { acquired: true, release: () => fs.rmSync(lockPath, { force: true }) };
    } catch (err) {
        if (!isFileExistsError(err)) throw err;
    }

    const createdAt = readLockCreatedAt(lockPath);
    if (createdAt && now.getTime() - createdAt.getTime() > lockTtlMs) {
        fs.rmSync(lockPath, { force: true });
        fs.writeFileSync(lockPath, payload, { flag: 'wx' });
        return { acquired: true, release: () => fs.rmSync(lockPath, { force: true }) };
    }

    return { acquired: false, reason: `active scheduler lock at ${lockPath}` };
}

function readLockCreatedAt(lockPath: string): Date | undefined {
    try {
        const raw = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { createdAt?: unknown };
        if (typeof raw.createdAt !== 'string') return undefined;
        const parsed = new Date(raw.createdAt);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    } catch {
        return undefined;
    }
}

function isFileExistsError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'EEXIST';
}
