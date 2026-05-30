import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
import { runStorytellerDryRun } from './cli';
import { StorytellerStore, buildOperatorSummary } from './store';
import type { CityEventDigest, DigestEvent } from './types';

export type StorytellerOverseerSource = 'fixture' | 'latest' | 'digest-id' | 'memory-root';

export type StorytellerOverseerDecision = 'dry_run' | 'held_duplicate' | 'held_no_delta' | 'held_unresolved_refs';

export interface StorytellerOverseerLedgerRow {
    schemaVersion: 1;
    rowId: string;
    createdAt: string;
    digestId: string;
    fingerprint: string;
    decision: StorytellerOverseerDecision;
    reason: string;
    eventRefs: string[];
    artifactDir: string | null;
    duplicateOfRowId?: string;
}

export interface StorytellerOverseerTickArgs {
    source: StorytellerOverseerSource;
    outputDir: string;
    digestId?: string;
    memoryRoot?: string;
    since?: string;
    until?: string;
    dedupWindowMs?: number;
    now?: () => Date;
}

export interface StorytellerOverseerCliArgs extends StorytellerOverseerTickArgs {
    tick: boolean;
}

export interface StorytellerOverseerTickResult {
    row: StorytellerOverseerLedgerRow;
    digest: CityEventDigest | null;
}

const DEFAULT_DEDUP_WINDOW_MS = 30 * 60_000;

export class StorytellerOverseerCliError extends Error {
    constructor(
        public readonly code: string,
        message = code,
    ) {
        super(message);
        this.name = 'StorytellerOverseerCliError';
    }
}

export class OverseerLedger {
    private readonly filePath: string;

    constructor(private readonly outputDir: string) {
        this.filePath = path.join(outputDir, 'overseer-ledger.jsonl');
    }

    append(row: StorytellerOverseerLedgerRow): void {
        fs.mkdirSync(this.outputDir, { recursive: true });
        fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, 'utf-8');
    }

    readAll(): StorytellerOverseerLedgerRow[] {
        if (!fs.existsSync(this.filePath)) {
            return [];
        }
        return fs
            .readFileSync(this.filePath, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => JSON.parse(line) as StorytellerOverseerLedgerRow);
    }
}

export function parseStorytellerOverseerArgs(argv: string[]): StorytellerOverseerCliArgs {
    let tick = false;
    let source: StorytellerOverseerSource | undefined;
    let outputDir = path.join('data', 'controller', 'storyteller');
    let digestId: string | undefined;
    let memoryRoot: string | undefined;
    let since: string | undefined;
    let until: string | undefined;
    let dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS;

    const claimSource = (nextSource: StorytellerOverseerSource): void => {
        if (source !== undefined) {
            throw new StorytellerOverseerCliError(
                'conflicting_sources',
                'use exactly one source: --fixture, --latest, --digest-id, or --memory-root',
            );
        }
        source = nextSource;
    };

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const next = argv[i + 1];
        if (flag === '--tick') {
            tick = true;
        } else if (flag === '--watch') {
            throw new StorytellerOverseerCliError(
                'watch_not_enabled',
                '--watch is blocked until S-STORY-3 adds cost-capped paid-model watch mode',
            );
        } else if (flag === '--fixture') {
            claimSource('fixture');
        } else if (flag === '--latest') {
            claimSource('latest');
        } else if (flag === '--digest-id') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--digest-id requires a value');
            claimSource('digest-id');
            digestId = next;
            i++;
        } else if (flag === '--memory-root') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--memory-root requires a path');
            claimSource('memory-root');
            memoryRoot = next;
            i++;
        } else if (flag === '--since') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--since requires an ISO timestamp');
            since = next;
            i++;
        } else if (flag === '--until') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--until requires an ISO timestamp');
            until = next;
            i++;
        } else if (flag === '--output-dir') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--output-dir requires a path');
            outputDir = next;
            i++;
        } else if (flag === '--dedup-window-ms') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--dedup-window-ms requires a number');
            dedupWindowMs = Number.parseInt(next, 10);
            if (!Number.isFinite(dedupWindowMs) || dedupWindowMs < 0) {
                throw new StorytellerOverseerCliError('invalid_dedup_window', '--dedup-window-ms must be a non-negative integer');
            }
            i++;
        } else if (flag === '--help' || flag === '-h') {
            throw new StorytellerOverseerCliError('help', usage());
        } else {
            throw new StorytellerOverseerCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    if (source === undefined) {
        throw new StorytellerOverseerCliError('missing_source', 'use one source: --fixture, --latest, --digest-id, or --memory-root');
    }

    const parsed: StorytellerOverseerCliArgs = { tick, source, outputDir, dedupWindowMs };
    if (digestId !== undefined) parsed.digestId = digestId;
    if (memoryRoot !== undefined) parsed.memoryRoot = memoryRoot;
    if (since !== undefined) parsed.since = since;
    if (until !== undefined) parsed.until = until;
    return parsed;
}

export function runStorytellerOverseerTick(args: StorytellerOverseerTickArgs): StorytellerOverseerTickResult {
    const now = args.now ? args.now() : new Date();
    const createdAt = now.toISOString();
    const dedupWindowMs = args.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
    const store = new StorytellerStore(args.outputDir);
    const ledger = new OverseerLedger(args.outputDir);
    const digest = readDigest(args, store, now);
    const eventRefs = digestEventRefs(digest);
    const fingerprint = topEventFingerprint(digest);

    let row: StorytellerOverseerLedgerRow;
    if (eventRefs.length === 0) {
        row = makeRow({
            createdAt,
            digest,
            fingerprint,
            decision: 'held_no_delta',
            reason: 'digest had no AP/GP/NCRI/goal/stuck events; skipped quiet filler',
            eventRefs,
            artifactDir: null,
        });
    } else {
        const unresolvedRefs = unresolvedTopEventRefs(digest);
        if (unresolvedRefs.length > 0) {
            row = makeRow({
                createdAt,
                digest,
                fingerprint,
                decision: 'held_unresolved_refs',
                reason: `top event refs did not resolve in digest evidence: ${unresolvedRefs.join(', ')}`,
                eventRefs: digest.topEvents.map(event => event.ref),
                artifactDir: null,
            });
        } else {
            const duplicate = findRecentDuplicate(ledger.readAll(), fingerprint, now, dedupWindowMs);
            if (duplicate) {
                row = makeRow({
                    createdAt,
                    digest,
                    fingerprint,
                    decision: 'held_duplicate',
                    reason: `same top-event fingerprint narrated within ${dedupWindowMs}ms`,
                    eventRefs: fingerprintRefs(digest),
                    artifactDir: null,
                    duplicateOfRowId: duplicate.rowId,
                });
            } else {
                store.writeDigest(digest);
                store.writeSummary(digest.digestId, buildOperatorSummary(digest));
                row = makeRow({
                    createdAt,
                    digest,
                    fingerprint,
                    decision: 'dry_run',
                    reason: 'dry-run Storyteller digest recorded without a model call',
                    eventRefs: fingerprintRefs(digest),
                    artifactDir: path.join(args.outputDir, digest.digestId),
                });
            }
        }
    }

    ledger.append(row);
    return { row, digest };
}

export function usage(): string {
    return [
        'Usage:',
        '  npm run storyteller:overseer -- --tick --fixture [--output-dir <path>]',
        '  npm run storyteller:overseer -- --tick --latest [--output-dir <path>]',
        '  npm run storyteller:overseer -- --tick --digest-id <id> [--output-dir <path>]',
        '  npm run storyteller:overseer -- --tick --memory-root <path> [--since <iso>] [--until <iso>]',
        '',
        'Runs one no-paid-call Storyteller Overseer tick with dedupe and an append-only ledger.',
    ].join('\n');
}

function readDigest(args: StorytellerOverseerTickArgs, store: StorytellerStore, now: Date): CityEventDigest {
    if (args.source === 'fixture') {
        return buildFixtureDigest().digest;
    }
    if (args.source === 'latest') {
        const digest = store.readLatestDigest();
        if (!digest) {
            throw new StorytellerOverseerCliError('digest_not_found', `no digest.json files found in ${args.outputDir}`);
        }
        return digest;
    }
    if (args.source === 'digest-id') {
        if (!args.digestId) {
            throw new StorytellerOverseerCliError('missing_value', '--digest-id requires a value');
        }
        const digest = store.readDigest(args.digestId);
        if (!digest) {
            throw new StorytellerOverseerCliError('digest_not_found', `digest '${args.digestId}' not found in ${args.outputDir}`);
        }
        return digest;
    }
    if (args.source === 'memory-root') {
        if (!args.memoryRoot) {
            throw new StorytellerOverseerCliError('missing_value', '--memory-root requires a path');
        }
        return runStorytellerDryRun(
            {
                fixture: false,
                outputDir: args.outputDir,
                memoryRoot: args.memoryRoot,
                ...(args.since !== undefined ? { since: args.since } : {}),
                ...(args.until !== undefined ? { until: args.until } : {}),
                ...(args.digestId !== undefined ? { digestId: args.digestId } : {}),
            },
            { now: () => now },
        ).digest;
    }
    throw new StorytellerOverseerCliError('missing_source', 'use one source: --fixture, --latest, --digest-id, or --memory-root');
}

function makeRow(input: {
    createdAt: string;
    digest: CityEventDigest;
    fingerprint: string;
    decision: StorytellerOverseerDecision;
    reason: string;
    eventRefs: string[];
    artifactDir: string | null;
    duplicateOfRowId?: string;
}): StorytellerOverseerLedgerRow {
    const row: StorytellerOverseerLedgerRow = {
        schemaVersion: 1,
        rowId: `overseer-${crypto.randomUUID()}`,
        createdAt: input.createdAt,
        digestId: input.digest.digestId,
        fingerprint: input.fingerprint,
        decision: input.decision,
        reason: input.reason,
        eventRefs: input.eventRefs,
        artifactDir: input.artifactDir,
    };
    if (input.duplicateOfRowId !== undefined) {
        row.duplicateOfRowId = input.duplicateOfRowId;
    }
    return row;
}

function allDigestEventGroups(digest: CityEventDigest): DigestEvent[][] {
    return [
        digest.apEvents,
        digest.gpEvents,
        digest.exchangeEvents,
        digest.ncriEvents,
        digest.goalEvents,
        digest.stuckEvents,
        digest.miscEvents,
    ];
}

function digestEventRefs(digest: CityEventDigest): string[] {
    return [...new Set(allDigestEventGroups(digest).flatMap(events => events.map(event => event.ref)))].sort();
}

function fingerprintRefs(digest: CityEventDigest): string[] {
    const topRefs = digest.topEvents
        .map(event => event.ref)
        .filter(Boolean)
        .slice(0, 3);
    if (topRefs.length > 0) {
        return [...topRefs].sort();
    }
    return digestEventRefs(digest).slice(0, 3);
}

function topEventFingerprint(digest: CityEventDigest): string {
    const refs = fingerprintRefs(digest);
    const raw = refs.length > 0 ? refs.join('|') : 'no-delta';
    return `sha256:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

function unresolvedTopEventRefs(digest: CityEventDigest): string[] {
    const knownRefs = new Set(digestEventRefs(digest));
    return [...new Set(digest.topEvents.map(event => event.ref).filter(ref => !knownRefs.has(ref)))].sort();
}

function findRecentDuplicate(
    rows: StorytellerOverseerLedgerRow[],
    fingerprint: string,
    now: Date,
    dedupWindowMs: number,
): StorytellerOverseerLedgerRow | undefined {
    return [...rows].reverse().find(row => {
        if (row.decision !== 'dry_run' || row.fingerprint !== fingerprint) {
            return false;
        }
        const createdAt = new Date(row.createdAt).getTime();
        const ageMs = now.getTime() - createdAt;
        return ageMs >= 0 && ageMs <= dedupWindowMs;
    });
}
