#!/usr/bin/env node
/**
 * storyteller:dry-run CLI
 *
 * Builds a CityEventDigest and writes digest.json + summary.txt to disk.
 * Prints the operator summary to stdout.
 * Makes NO model calls — this is a deterministic dry-run gate.
 *
 * Usage:
 *   npm run storyteller:dry-run -- --fixture
 *   npm run storyteller:dry-run -- --fixture --output-dir data/controller/storyteller
 *   npm run storyteller:dry-run -- --memory-root data/controller/memory --since <iso> --until <iso>
 *
 * Flags:
 *   --fixture          Use the canonical fixture digest from digest-builder.ts
 *   --memory-root <d>  Build digest from live EconomyEventLog + GoalContractStore
 *   --since <iso>      Optional live-source window start (default: now - Storyteller window)
 *   --until <iso>      Optional live-source window end (default: now)
 *   --digest-id <id>   Optional digest id for live-source runs
 *   --output-dir <d>   Where to write run artifacts (default: data/controller/storyteller)
 */
import path from 'path';
import type { EconomyEvent } from '../city-integration/economy-event';
import { EconomyEventLog } from '../city-integration/economy-event';
import type { GoalContract } from '../city-integration/goal-contract';
import { GoalContractStore } from '../city-integration/goal-contract';
import { buildDigest, buildFixtureDigest, economyEventsToDigestBuckets, goalContractsToDigestGoalEvents } from './digest-builder';
import { StorytellerStore, buildOperatorSummary } from './store';
import type { CityEventDigest, ResidentSnapshot } from './types';
import { DEFAULT_STORYTELLER_CONFIG } from './types';

export interface StorytellerDryRunArgs {
    fixture: boolean;
    outputDir: string;
    memoryRoot?: string;
    since?: string;
    until?: string;
    digestId?: string;
}

export interface RunStorytellerDryRunOptions {
    now?: () => Date;
}

export interface StorytellerDryRunResult {
    digest: CityEventDigest;
    summary: string;
    digestPath: string;
    summaryPath: string;
}

export class StorytellerDryRunCliError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'StorytellerDryRunCliError';
    }
}

export function parseStorytellerDryRunArgs(argv: string[]): StorytellerDryRunArgs {
    let fixture = false;
    let outputDir = path.join('data', 'controller', 'storyteller');
    let memoryRoot: string | undefined;
    let since: string | undefined;
    let until: string | undefined;
    let digestId: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = argv[i + 1];
        if (flag === '--fixture') {
            fixture = true;
        } else if (flag === '--memory-root') {
            if (!next) throw new StorytellerDryRunCliError('missing_value', '--memory-root requires a path argument');
            memoryRoot = next;
            i++;
        } else if (flag === '--since') {
            if (!next) throw new StorytellerDryRunCliError('missing_value', '--since requires an ISO timestamp');
            since = next;
            i++;
        } else if (flag === '--until') {
            if (!next) throw new StorytellerDryRunCliError('missing_value', '--until requires an ISO timestamp');
            until = next;
            i++;
        } else if (flag === '--digest-id') {
            if (!next) throw new StorytellerDryRunCliError('missing_value', '--digest-id requires a value');
            digestId = next;
            i++;
        } else if (flag === '--output-dir') {
            if (!next) throw new StorytellerDryRunCliError('missing_value', '--output-dir requires a path argument');
            outputDir = next;
            i++;
        } else if (flag === '--help' || flag === '-h') {
            throw new StorytellerDryRunCliError('help', usage());
        } else {
            throw new StorytellerDryRunCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    const parsed: StorytellerDryRunArgs = { fixture, outputDir };
    if (memoryRoot !== undefined) parsed.memoryRoot = memoryRoot;
    if (since !== undefined) parsed.since = since;
    if (until !== undefined) parsed.until = until;
    if (digestId !== undefined) parsed.digestId = digestId;
    return parsed;
}

function parseWindow(args: StorytellerDryRunArgs, now: Date): { windowStart: Date; windowEnd: Date } {
    const windowEnd = args.until !== undefined ? new Date(args.until) : now;
    const windowStart =
        args.since !== undefined ? new Date(args.since) : new Date(windowEnd.getTime() - DEFAULT_STORYTELLER_CONFIG.maxDigestWindowMs);
    if (Number.isNaN(windowStart.getTime())) {
        throw new StorytellerDryRunCliError('invalid_since', '--since must be a valid ISO timestamp');
    }
    if (Number.isNaN(windowEnd.getTime())) {
        throw new StorytellerDryRunCliError('invalid_until', '--until must be a valid ISO timestamp');
    }
    if (windowStart.getTime() > windowEnd.getTime()) {
        throw new StorytellerDryRunCliError('invalid_window', '--since must be earlier than or equal to --until');
    }
    return { windowStart, windowEnd };
}

function inWindow(event: { ts: string }, windowStart: Date, windowEnd: Date): boolean {
    const start = windowStart.toISOString();
    const end = windowEnd.toISOString();
    return event.ts >= start && event.ts <= end;
}

function defaultLiveDigestId(windowEnd: Date): string {
    return `live-${windowEnd
        .toISOString()
        .replace(/[^0-9]/g, '')
        .slice(0, 14)}`;
}

function buildResidentSnapshots(events: EconomyEvent[], goals: GoalContract[], windowStart: Date, windowEnd: Date): ResidentSnapshot[] {
    const residents = new Map<string, ResidentSnapshot>();

    const ensure = (residentName: string): ResidentSnapshot => {
        const existing = residents.get(residentName);
        if (existing) {
            return existing;
        }
        const created: ResidentSnapshot = {
            residentName,
            attention: 0,
            isLowAp: false,
            isFaded: false,
            gpObserved: null,
        };
        residents.set(residentName, created);
        return created;
    };

    for (const event of events.filter(event => inWindow(event, windowStart, windowEnd))) {
        if (!event.residentName) {
            continue;
        }
        const resident = ensure(event.residentName);
        if (typeof event.apDelta === 'number') {
            resident.attention = Math.max(0, resident.attention + event.apDelta);
        }
        if (event.kind === 'ap_fade') {
            resident.isFaded = true;
            resident.attention = 0;
        }
        if (typeof event.gpDelta === 'number') {
            resident.gpObserved = Math.max(0, (resident.gpObserved ?? 0) + event.gpDelta);
        }
    }

    for (const goal of goals) {
        const resident = ensure(goal.residentName);
        if (resident.goalText === undefined || goal.status === 'active') {
            resident.goalText = goal.goalText;
        }
    }

    return [...residents.values()]
        .map(resident => ({
            ...resident,
            isLowAp: !resident.isFaded && resident.attention > 0 && resident.attention < 100,
        }))
        .sort((a, b) => a.residentName.localeCompare(b.residentName));
}

function buildLiveDigest(args: StorytellerDryRunArgs, options: Required<RunStorytellerDryRunOptions>): CityEventDigest {
    if (!args.memoryRoot) {
        throw new StorytellerDryRunCliError('missing_source', 'use --fixture or --memory-root');
    }

    const now = options.now();
    const { windowStart, windowEnd } = parseWindow(args, now);
    const events = new EconomyEventLog(args.memoryRoot).readAll();
    const goals = new GoalContractStore(args.memoryRoot).list();
    const economyBuckets = economyEventsToDigestBuckets(events);
    const goalEvents = goalContractsToDigestGoalEvents(goals);

    return buildDigest({
        digestId: args.digestId ?? defaultLiveDigestId(windowEnd),
        windowStart,
        windowEnd,
        now,
        residents: buildResidentSnapshots(events, goals, windowStart, windowEnd),
        apEvents: economyBuckets.apEvents,
        gpEvents: economyBuckets.gpEvents,
        exchangeEvents: economyBuckets.exchangeEvents,
        ncriEvents: economyBuckets.ncriEvents,
        goalEvents,
    });
}

export function runStorytellerDryRun(args: StorytellerDryRunArgs, options: RunStorytellerDryRunOptions = {}): StorytellerDryRunResult {
    if (args.fixture && args.memoryRoot) {
        throw new StorytellerDryRunCliError('conflicting_sources', 'use either --fixture or --memory-root, not both');
    }
    if (!args.fixture && !args.memoryRoot) {
        throw new StorytellerDryRunCliError('missing_source', 'use --fixture or --memory-root');
    }

    const now = options.now ?? (() => new Date());
    const digest = args.fixture ? buildFixtureDigest().digest : buildLiveDigest(args, { now });

    const store = new StorytellerStore(args.outputDir);
    store.writeDigest(digest);

    const summary = buildOperatorSummary(digest);
    store.writeSummary(digest.digestId, summary);

    return {
        digest,
        summary,
        digestPath: path.join(args.outputDir, digest.digestId, 'digest.json'),
        summaryPath: path.join(args.outputDir, digest.digestId, 'summary.txt'),
    };
}

function usage(): string {
    return [
        'Usage:',
        '  npm run storyteller:dry-run -- --fixture [--output-dir <path>]',
        '  npm run storyteller:dry-run -- --memory-root <path> [--since <iso>] [--until <iso>] [--digest-id <id>]',
        '',
        'Builds Storyteller digest.json + summary.txt without calling a model.',
    ].join('\n');
}

function main(): void {
    let args: StorytellerDryRunArgs;
    try {
        args = parseStorytellerDryRunArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof StorytellerDryRunCliError) {
            if (err.code === 'help') {
                process.stdout.write(`${err.message}\n`);
                process.exit(0);
            }
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }

    try {
        const source = args.fixture ? 'fixture' : `live memory root ${args.memoryRoot}`;
        console.log(`[storyteller:dry-run] Building ${source} digest...`);
        const result = runStorytellerDryRun(args);
        console.log(`[storyteller:dry-run] digest.json written to: ${result.digestPath}`);
        console.log(`[storyteller:dry-run] summary.txt written to: ${result.summaryPath}`);
        console.log('');
        console.log(result.summary);
    } catch (err) {
        if (err instanceof StorytellerDryRunCliError) {
            process.stderr.write(`Error: ${err.message}\n\n${usage()}\n`);
            process.exit(1);
        }
        throw err;
    }
}

if (require.main === module) {
    main();
}
