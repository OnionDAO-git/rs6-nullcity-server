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
import fs from 'fs';
import type { EconomyEvent } from '../city-integration/economy-event';
import { EconomyEventLog } from '../city-integration/economy-event';
import type { GoalContract } from '../city-integration/goal-contract';
import { GoalContractStore } from '../city-integration/goal-contract';
import type { RuntimeState } from '../memory/runtime-state';
import { residentSlug } from '../memory/runtime-state';
import { buildDigest, buildFixtureDigest, economyEventsToDigestBuckets, goalContractsToDigestGoalEvents } from './digest-builder';
import { StorytellerStore, buildOperatorSummary } from './store';
import type { CityEventDigest, ResidentSnapshot } from './types';
import type { DigestEvent } from './types';
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

function buildResidentSnapshots(
    memoryRoot: string,
    events: EconomyEvent[],
    goals: GoalContract[],
    windowStart: Date,
    windowEnd: Date,
    evidenceResidentNames: ReadonlySet<string>,
): ResidentSnapshot[] {
    const residents = new Map<string, ResidentSnapshot>();
    const runtimeBackedResidents = new Set<string>();

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

    for (const runtimeResident of readRuntimeResidentSnapshots(memoryRoot)) {
        if (!runtimeResident.isFaded && !evidenceResidentNames.has(runtimeResident.residentName)) {
            continue;
        }
        residents.set(runtimeResident.residentName, runtimeResident);
        runtimeBackedResidents.add(runtimeResident.residentName);
    }

    for (const event of events.filter(event => inWindow(event, windowStart, windowEnd))) {
        if (!event.residentName) {
            continue;
        }
        if (isSyntheticResidentName(event.residentName)) {
            continue;
        }
        const resident = ensure(event.residentName);
        if (typeof event.apDelta === 'number' && !runtimeBackedResidents.has(event.residentName)) {
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
        if (isSyntheticResidentName(goal.residentName)) {
            continue;
        }
        if (!evidenceResidentNames.has(goal.residentName)) {
            continue;
        }
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

function readRuntimeResidentSnapshots(memoryRoot: string): ResidentSnapshot[] {
    if (!fs.existsSync(memoryRoot)) {
        return [];
    }

    const snapshots: ResidentSnapshot[] = [];
    for (const entry of fs.readdirSync(memoryRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const statePath = path.join(memoryRoot, entry.name, 'runtime-state.json');
        if (!fs.existsSync(statePath)) {
            continue;
        }
        const state = readRuntimeState(statePath);
        if (!state) {
            continue;
        }
        const residentName =
            typeof state.resident === 'string' && state.resident.length > 0 ? state.resident : inferResidentFromSlug(entry.name);
        if (!residentName) {
            continue;
        }
        if (isSyntheticResidentName(residentName)) {
            continue;
        }
        const attention = typeof state.attention === 'number' && Number.isFinite(state.attention) ? state.attention : 0;
        const isFaded = Boolean(state.deceased);
        snapshots.push({
            residentName,
            attention,
            isLowAp: !isFaded && attention > 0 && attention < 100,
            isFaded,
            gpObserved: null,
            ...(typeof state.cognition?.activeGoal?.description === 'string' && state.cognition.activeGoal.description.length > 0
                ? { goalText: state.cognition.activeGoal.description }
                : {}),
        });
    }

    return snapshots.sort((a, b) => a.residentName.localeCompare(b.residentName));
}

function readRuntimeState(statePath: string): Partial<RuntimeState> | undefined {
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<RuntimeState>;
    } catch {
        return undefined;
    }
}

function inferResidentFromSlug(slug: string): string | undefined {
    const candidate = slug.startsWith('res-') ? `res:${slug.slice(4)}` : `res:${slug}`;
    return residentSlug(candidate) === slug ? candidate : undefined;
}

function isSyntheticResidentName(residentName: string): boolean {
    return /^res-(qa-|bmk_)/.test(residentSlug(residentName));
}

function readLibraryDigestEvents(
    memoryRoot: string,
    windowStart: Date,
    windowEnd: Date,
): Pick<DigestBuilderEventBuckets, 'stuckEvents' | 'miscEvents'> {
    const libraryRoot = path.join(memoryRoot, 'library');
    if (!fs.existsSync(libraryRoot)) {
        return { stuckEvents: [], miscEvents: [] };
    }

    const stuckEvents: DigestEvent[] = [];
    const miscEvents: DigestEvent[] = [];
    const start = windowStart.toISOString();
    const end = windowEnd.toISOString();

    for (const entry of fs.readdirSync(libraryRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const residentName = inferResidentFromSlug(entry.name);
        if (!residentName) {
            continue;
        }
        if (isSyntheticResidentName(residentName)) {
            continue;
        }
        const timelinePath = path.join(libraryRoot, entry.name, 'timeline.jsonl');
        if (!fs.existsSync(timelinePath)) {
            continue;
        }
        for (const event of readJsonLines(timelinePath)) {
            const ts = typeof event['ts'] === 'string' ? event['ts'] : undefined;
            if (!ts || ts < start || ts > end) {
                continue;
            }
            const kind = typeof event['kind'] === 'string' ? event['kind'] : undefined;
            const tick = typeof event['tick'] === 'number' && Number.isFinite(event['tick']) ? event['tick'] : undefined;
            if (kind === 'stuck_recovered') {
                stuckEvents.push({
                    ref: `library:${residentSlug(residentName)}:${ts}:stuck_recovered:${tick ?? 'unknown'}`,
                    kind: 'stuck_recovered',
                    residentName,
                    ts,
                    note: `${residentName} recovered from being stuck.`,
                    importance: 'medium',
                    evidence: {
                        source: 'library.timeline',
                        ...(tick !== undefined ? { tick } : {}),
                        reasons: Array.isArray(event['reasons']) ? event['reasons'] : undefined,
                    },
                });
            } else if (kind === 'say') {
                const text = typeof event['text'] === 'string' ? event['text'].trim() : '';
                if (!text) {
                    continue;
                }
                miscEvents.push({
                    ref: `library:${residentSlug(residentName)}:${ts}:say:${hashRef(text)}`,
                    kind: 'library_writeback',
                    residentName,
                    ts,
                    note: `${residentName} said: "${truncateText(text, 140)}"`,
                    importance: 'low',
                    evidence: {
                        source: 'library.timeline',
                        ...(tick !== undefined ? { tick } : {}),
                    },
                });
            }
        }
    }

    return {
        stuckEvents: latestByResidentKind(stuckEvents),
        miscEvents: latestByResidentKind(miscEvents),
    };
}

interface DigestBuilderEventBuckets {
    stuckEvents: DigestEvent[];
    miscEvents: DigestEvent[];
}

function readJsonLines(filePath: string): Record<string, unknown>[] {
    try {
        return fs
            .readFileSync(filePath, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
                try {
                    const parsed = JSON.parse(line);
                    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
                        ? [parsed as Record<string, unknown>]
                        : [];
                } catch {
                    return [];
                }
            });
    } catch {
        return [];
    }
}

function latestByResidentKind(events: DigestEvent[]): DigestEvent[] {
    const byKey = new Map<string, DigestEvent>();
    for (const event of events) {
        const key = `${event.residentName}:${event.kind}`;
        const existing = byKey.get(key);
        if (!existing || event.ts > existing.ts) {
            byKey.set(key, event);
        }
    }
    return [...byKey.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function hashRef(text: string): string {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
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
    const libraryEvents = readLibraryDigestEvents(args.memoryRoot, windowStart, windowEnd);
    const evidenceResidentNames = buildEvidenceResidentNames(events, goalEvents, libraryEvents, windowStart, windowEnd);

    return buildDigest({
        digestId: args.digestId ?? defaultLiveDigestId(windowEnd),
        windowStart,
        windowEnd,
        now,
        residents: buildResidentSnapshots(args.memoryRoot, events, goals, windowStart, windowEnd, evidenceResidentNames),
        apEvents: economyBuckets.apEvents,
        gpEvents: economyBuckets.gpEvents,
        exchangeEvents: economyBuckets.exchangeEvents,
        ncriEvents: economyBuckets.ncriEvents,
        goalEvents,
        stuckEvents: libraryEvents.stuckEvents,
        miscEvents: libraryEvents.miscEvents,
    });
}

function buildEvidenceResidentNames(
    events: EconomyEvent[],
    goalEvents: DigestEvent[],
    libraryEvents: DigestBuilderEventBuckets,
    windowStart: Date,
    windowEnd: Date,
): Set<string> {
    const names = new Set<string>();
    for (const event of events.filter(event => inWindow(event, windowStart, windowEnd))) {
        if (event.residentName && !isSyntheticResidentName(event.residentName)) {
            names.add(event.residentName);
        }
    }
    for (const event of [...goalEvents, ...libraryEvents.stuckEvents, ...libraryEvents.miscEvents]) {
        if (event.ts < windowStart.toISOString() || event.ts > windowEnd.toISOString()) {
            continue;
        }
        if (!isSyntheticResidentName(event.residentName)) {
            names.add(event.residentName);
        }
    }
    return names;
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
