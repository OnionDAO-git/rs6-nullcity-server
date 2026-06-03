import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
import { runStorytellerDryRun } from './cli';
import { buildProjectorStoryFrame } from './public-frame';
import { StorytellerStore, buildOperatorSummary } from './store';
import type { CityEventDigest, DigestEvent, StorytellerDispatch } from './types';

export type StorytellerOverseerSource = 'fixture' | 'latest' | 'digest-id' | 'memory-root';

export type StorytellerOverseerDecision =
    | 'dry_run'
    | 'published_canon'
    | 'queued_review'
    | 'held_budget'
    | 'held_duplicate'
    | 'held_no_delta'
    | 'held_unresolved_refs';

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
    estimatedCostUsd?: number | null;
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
    dailyCostCapUsd?: number;
    autoPublishOnZeroWarnings?: boolean;
    now?: () => Date;
}

export interface StorytellerOverseerCliArgs extends StorytellerOverseerTickArgs {
    tick: boolean;
}

export interface StorytellerOverseerTickResult {
    row: StorytellerOverseerLedgerRow;
    digest: CityEventDigest | null;
}

export interface StorytellerPaidBudgetPreflightArgs {
    outputDir: string;
    dailyCostCapUsd?: number;
    now?: Date | (() => Date);
}

export interface StorytellerPaidBudgetPreflightResult {
    capUsd: number;
    spentTodayUsd: number;
    remainingUsd: number;
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
    let dailyCostCapUsd: number | undefined;
    let autoPublishOnZeroWarnings = true;

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
        } else if (flag === '--daily-cost-cap-usd') {
            if (!next) throw new StorytellerOverseerCliError('missing_value', '--daily-cost-cap-usd requires a number');
            dailyCostCapUsd = Number.parseFloat(next);
            if (!Number.isFinite(dailyCostCapUsd) || dailyCostCapUsd < 0) {
                throw new StorytellerOverseerCliError('invalid_cost_cap', '--daily-cost-cap-usd must be a non-negative number');
            }
            i++;
        } else if (flag === '--no-auto-publish-on-zero-warnings') {
            autoPublishOnZeroWarnings = false;
        } else if (flag === '--help' || flag === '-h') {
            throw new StorytellerOverseerCliError('help', usage());
        } else {
            throw new StorytellerOverseerCliError('unknown_flag', `unknown flag: ${flag}`);
        }
    }

    if (source === undefined) {
        throw new StorytellerOverseerCliError('missing_source', 'use one source: --fixture, --latest, --digest-id, or --memory-root');
    }

    const parsed: StorytellerOverseerCliArgs = { tick, source, outputDir, dedupWindowMs, autoPublishOnZeroWarnings };
    if (dailyCostCapUsd !== undefined) parsed.dailyCostCapUsd = dailyCostCapUsd;
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
    const autoPublishOnZeroWarnings = args.autoPublishOnZeroWarnings ?? true;
    const store = new StorytellerStore(args.outputDir);
    const ledger = new OverseerLedger(args.outputDir);
    const rows = ledger.readAll();
    const digest = readDigest(args, store, now);
    const eventRefs = digestEventRefs(digest);
    const fingerprint = topEventFingerprint(digest);

    let row: StorytellerOverseerLedgerRow;
    let frameDispatch: StorytellerDispatch | null = null;
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
            const duplicate = findRecentDuplicate(rows, fingerprint, now, dedupWindowMs);
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
                const dispatch = store.readDispatch(digest.digestId);
                if (!dispatch) {
                    row = makeRow({
                        createdAt,
                        digest,
                        fingerprint,
                        decision: 'dry_run',
                        reason: 'dry-run Storyteller digest recorded without a model call',
                        eventRefs: fingerprintRefs(digest),
                        artifactDir: path.join(args.outputDir, digest.digestId),
                    });
                } else {
                    const costUsd = asFiniteNonNegativeNumber(dispatch.estimatedCostUsd);
                    const capUsd = asFiniteNonNegativeNumber(args.dailyCostCapUsd);
                    if (capUsd !== undefined && costUsd !== undefined) {
                        const spentToday = dailySpentUsd(rows, now);
                        if (spentToday + costUsd > capUsd) {
                            row = makeRow({
                                createdAt,
                                digest,
                                fingerprint,
                                decision: 'held_budget',
                                reason: `daily cost cap exceeded (${(spentToday + costUsd).toFixed(6)} > ${capUsd.toFixed(6)})`,
                                eventRefs: dispatch.eventRefsUsed.length ? [...dispatch.eventRefsUsed] : fingerprintRefs(digest),
                                artifactDir: null,
                                estimatedCostUsd: costUsd,
                            });
                            ledger.append(row);
                            store.writeLatestProjectorFrame(buildProjectorStoryFrame(digest, { now }));
                            return { row, digest };
                        }
                    }

                    frameDispatch = dispatch;
                    const shouldPublishCanon = autoPublishOnZeroWarnings && canAutoPublishDispatch(dispatch);
                    const queue = shouldPublishCanon ? 'canon' : 'review';
                    const queueDir = writeDispatchQueueArtifact(args.outputDir, queue, digest, dispatch);
                    row = makeRow({
                        createdAt,
                        digest,
                        fingerprint,
                        decision: shouldPublishCanon ? 'published_canon' : 'queued_review',
                        reason: shouldPublishCanon
                            ? 'dispatch has no review warnings and was auto-published to canon'
                            : 'dispatch requires review or auto-publish is disabled',
                        eventRefs: dispatch.eventRefsUsed.length ? [...dispatch.eventRefsUsed] : fingerprintRefs(digest),
                        artifactDir: queueDir,
                        estimatedCostUsd: costUsd ?? null,
                    });
                }
            }
        }
    }

    ledger.append(row);
    if (row.decision !== 'held_duplicate') {
        store.writeLatestProjectorFrame(buildProjectorStoryFrame(digest, { dispatch: frameDispatch, now }));
    }
    return { row, digest };
}

export function preflightStorytellerPaidModelBudget(args: StorytellerPaidBudgetPreflightArgs): StorytellerPaidBudgetPreflightResult {
    const capUsd = asFiniteNonNegativeNumber(args.dailyCostCapUsd);
    if (capUsd === undefined) {
        throw new StorytellerOverseerCliError(
            'missing_cost_cap',
            'paid Storyteller model runs require --daily-cost-cap-usd or STORYTELLER_DAILY_COST_CAP_USD',
        );
    }

    const now = resolvePreflightNow(args.now);
    const spentTodayUsd = dailySpentUsd(new OverseerLedger(args.outputDir).readAll(), now);
    if (spentTodayUsd >= capUsd) {
        throw new StorytellerOverseerCliError(
            'daily_cost_cap_exceeded',
            `daily Storyteller cost cap already spent (${spentTodayUsd.toFixed(6)} >= ${capUsd.toFixed(6)})`,
        );
    }

    return {
        capUsd,
        remainingUsd: capUsd - spentTodayUsd,
        spentTodayUsd,
    };
}

export function usage(): string {
    return [
        'Usage:',
        '  npm run storyteller:overseer -- --tick --fixture [--output-dir <path>]',
        '  npm run storyteller:overseer -- --tick --latest [--output-dir <path>]',
        '  npm run storyteller:overseer -- --tick --digest-id <id> [--output-dir <path>]',
        '  npm run storyteller:overseer -- --tick --memory-root <path> [--since <iso>] [--until <iso>]',
        '                                     [--daily-cost-cap-usd <usd>] [--no-auto-publish-on-zero-warnings]',
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
    estimatedCostUsd?: number | null;
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
        ...(input.estimatedCostUsd !== undefined ? { estimatedCostUsd: input.estimatedCostUsd } : {}),
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
        if (!isNarrationDecision(row.decision) || row.fingerprint !== fingerprint) {
            return false;
        }
        const createdAt = new Date(row.createdAt).getTime();
        const ageMs = now.getTime() - createdAt;
        return ageMs >= 0 && ageMs <= dedupWindowMs;
    });
}

function isNarrationDecision(decision: StorytellerOverseerDecision): boolean {
    return decision === 'dry_run' || decision === 'published_canon' || decision === 'queued_review';
}

function canAutoPublishDispatch(dispatch: StorytellerDispatch): boolean {
    const warningCount = dispatch.operatorWarnings.length + (dispatch.reviewReasons?.length ?? 0);
    return !dispatch.needsReview && warningCount === 0;
}

function writeDispatchQueueArtifact(
    outputDir: string,
    queue: 'canon' | 'review',
    digest: CityEventDigest,
    dispatch: StorytellerDispatch,
): string {
    const queueDir = path.join(outputDir, queue, digest.digestId);
    fs.mkdirSync(queueDir, { recursive: true });
    fs.writeFileSync(path.join(queueDir, 'digest.json'), JSON.stringify(digest, null, 2), 'utf-8');
    fs.writeFileSync(path.join(queueDir, 'dispatch.json'), JSON.stringify(dispatch, null, 2), 'utf-8');
    return queueDir;
}

function asFiniteNonNegativeNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function resolvePreflightNow(now: Date | (() => Date) | undefined): Date {
    if (now instanceof Date) {
        return now;
    }
    if (typeof now === 'function') {
        return now();
    }
    return new Date();
}

function dailySpentUsd(rows: StorytellerOverseerLedgerRow[], now: Date): number {
    const dayPrefix = now.toISOString().slice(0, 10);
    return rows.reduce((total, row) => {
        if (!isNarrationDecision(row.decision)) return total;
        if (!row.createdAt.startsWith(dayPrefix)) return total;
        const usd = asFiniteNonNegativeNumber(row.estimatedCostUsd);
        return total + (usd ?? 0);
    }, 0);
}
