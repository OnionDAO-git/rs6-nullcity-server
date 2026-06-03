import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
import { StorytellerStore } from './store';
import {
    OverseerLedger,
    parseStorytellerOverseerArgs,
    preflightStorytellerPaidModelBudget,
    runStorytellerOverseerTick,
    StorytellerOverseerCliError,
} from './overseer';
import type { CityEventDigest, StorytellerDispatch } from './types';

function tempOutputDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-overseer-'));
}

function emptyDigest(digestId = 'empty-digest'): CityEventDigest {
    const digest = buildFixtureDigest().digest;
    return {
        ...digest,
        digestId,
        apEvents: [],
        gpEvents: [],
        exchangeEvents: [],
        ncriEvents: [],
        goalEvents: [],
        stuckEvents: [],
        miscEvents: [],
        topEvents: [],
        residents: [],
        systemHealth: {
            totalResidents: 0,
            activeResidents: 0,
            fadedResidents: 0,
            lowApResidents: 0,
        },
    };
}

function fixtureDispatch(overrides: Partial<StorytellerDispatch> = {}): StorytellerDispatch {
    return {
        schemaVersion: 1,
        dispatchId: 'dispatch-fixture',
        digestId: 'fixture-digest-001',
        generatedAt: '2026-05-30T20:00:00.000Z',
        modelProfile: 'storyteller-v1',
        latencyMs: 1200,
        estimatedCostUsd: 0.1,
        inputTokens: 800,
        outputTokens: 240,
        publicTitle: 'Null City Dispatch',
        publicBody: 'Grounded update.',
        publicBullets: ['bullet-1'],
        operatorSummary: 'summary',
        operatorWarnings: [],
        eventRefsUsed: ['ap:001'],
        needsReview: false,
        ...overrides,
    };
}

describe('StorytellerOverseerLedger', () => {
    it('appends and reads jsonl rows newest last', () => {
        const outputDir = tempOutputDir();
        const ledger = new OverseerLedger(outputDir);

        ledger.append({
            schemaVersion: 1,
            rowId: 'row-1',
            createdAt: '2026-05-30T20:00:00.000Z',
            digestId: 'digest-a',
            fingerprint: 'fp-a',
            decision: 'dry_run',
            reason: 'dry run completed',
            eventRefs: ['event-a'],
            artifactDir: path.join(outputDir, 'digest-a'),
        });
        ledger.append({
            schemaVersion: 1,
            rowId: 'row-2',
            createdAt: '2026-05-30T20:01:00.000Z',
            digestId: 'digest-b',
            fingerprint: 'fp-b',
            decision: 'held_no_delta',
            reason: 'digest had no events',
            eventRefs: [],
            artifactDir: null,
        });

        expect(ledger.readAll().map(row => row.rowId)).toEqual(['row-1', 'row-2']);
    });
});

describe('runStorytellerOverseerTick', () => {
    it('writes fixture digest, summary, and a dry-run ledger row without a model call', () => {
        const outputDir = tempOutputDir();
        const result = runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
        });

        expect(result.row.decision).toBe('dry_run');
        expect(result.row.digestId).toBe(result.digest?.digestId);
        expect(result.row.eventRefs.length).toBeGreaterThan(0);
        expect(result.row.artifactDir).toBe(path.join(outputDir, result.row.digestId));
        expect(fs.existsSync(path.join(outputDir, result.row.digestId, 'digest.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, result.row.digestId, 'summary.txt'))).toBe(true);
        expect(new OverseerLedger(outputDir).readAll()).toHaveLength(1);
    });

    it('holds duplicate top-event fingerprints inside the dedup window', () => {
        const outputDir = tempOutputDir();
        const now = new Date('2026-05-30T20:00:00.000Z');

        const first = runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => now,
            dedupWindowMs: 30 * 60_000,
        });
        const second = runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => new Date(now.getTime() + 60_000),
            dedupWindowMs: 30 * 60_000,
        });

        expect(first.row.decision).toBe('dry_run');
        expect(second.row.decision).toBe('held_duplicate');
        expect(second.row.fingerprint).toBe(first.row.fingerprint);
        expect(new OverseerLedger(outputDir).readAll().map(row => row.decision)).toEqual(['dry_run', 'held_duplicate']);
    });

    it('allows the same fingerprint after the dedup window expires', () => {
        const outputDir = tempOutputDir();
        const firstTime = new Date('2026-05-30T20:00:00.000Z');

        runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => firstTime,
            dedupWindowMs: 60_000,
        });
        const second = runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => new Date(firstTime.getTime() + 120_000),
            dedupWindowMs: 60_000,
        });

        expect(second.row.decision).toBe('dry_run');
    });

    it('holds empty digests instead of generating quiet filler', () => {
        const outputDir = tempOutputDir();
        new StorytellerStore(outputDir).writeDigest(emptyDigest());

        const result = runStorytellerOverseerTick({
            source: 'latest',
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
        });

        expect(result.row.decision).toBe('held_no_delta');
        expect(result.row.eventRefs).toEqual([]);
        expect(result.row.artifactDir).toBeNull();
    });

    it('holds digests whose top event refs do not resolve inside the digest', () => {
        const outputDir = tempOutputDir();
        const digest = buildFixtureDigest().digest;
        new StorytellerStore(outputDir).writeDigest({
            ...digest,
            digestId: 'bad-ref',
            topEvents: [{ ...digest.topEvents[0], ref: 'missing-ref' }],
        });

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: 'bad-ref',
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
        });

        expect(result.row.decision).toBe('held_unresolved_refs');
        expect(result.row.reason).toContain('missing-ref');
        expect(result.row.artifactDir).toBeNull();
    });

    it('publishes zero-warning dispatches to canon when auto-publish is enabled', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const digest = buildFixtureDigest().digest;
        store.writeDigest(digest);
        store.writeDispatch(fixtureDispatch({ digestId: digest.digestId }));

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
            autoPublishOnZeroWarnings: true,
        });

        expect(result.row.decision).toBe('published_canon');
        expect(fs.existsSync(path.join(outputDir, 'canon', digest.digestId, 'digest.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'canon', digest.digestId, 'dispatch.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'review', digest.digestId, 'dispatch.json'))).toBe(false);
    });

    it('queues dispatches with review flags in the review surface', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const digest = buildFixtureDigest().digest;
        store.writeDigest(digest);
        store.writeDispatch(
            fixtureDispatch({
                digestId: digest.digestId,
                needsReview: true,
                reviewReasons: ['missing event ref'],
            }),
        );

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
        });

        expect(result.row.decision).toBe('queued_review');
        expect(fs.existsSync(path.join(outputDir, 'review', digest.digestId, 'digest.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'review', digest.digestId, 'dispatch.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'canon', digest.digestId, 'dispatch.json'))).toBe(false);
    });

    it('keeps clean but review-queued dispatch text out of latest-frame.json when auto-publish is disabled', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const { digest, refs } = buildFixtureDigest();
        const dispatch = fixtureDispatch({
            digestId: digest.digestId,
            eventRefsUsed: [refs.apLow],
            publicTitle: 'A clean candidate title should stay private',
            needsReview: false,
            reviewReasons: undefined,
        });
        store.writeDigest(digest);
        store.writeDispatch(dispatch);

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
            autoPublishOnZeroWarnings: false,
        });

        expect(result.row.decision).toBe('queued_review');
        const frame = JSON.parse(fs.readFileSync(path.join(outputDir, 'latest-frame.json'), 'utf-8'));
        expect(frame.narration.source).toBe('deterministic_fallback');
        expect(frame.narration.title).not.toBe(dispatch.publicTitle);
        expect(frame.source.dispatchId).toBeUndefined();
    });

    it('holds dispatch publishing when the daily cost cap is exceeded', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const digest = buildFixtureDigest().digest;
        store.writeDigest(digest);
        store.writeDispatch(fixtureDispatch({ digestId: digest.digestId, estimatedCostUsd: 0.11 }));

        const ledger = new OverseerLedger(outputDir);
        ledger.append({
            schemaVersion: 1,
            rowId: 'prior-row',
            createdAt: '2026-05-30T19:40:00.000Z',
            digestId: 'prior-digest',
            fingerprint: 'fp-prior',
            decision: 'published_canon',
            reason: 'published',
            eventRefs: ['gp:1'],
            artifactDir: path.join(outputDir, 'canon', 'prior-digest'),
            estimatedCostUsd: 0.15,
        });

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
            dailyCostCapUsd: 0.2,
        });

        expect(result.row.decision).toBe('held_budget');
        expect(result.row.reason).toContain('daily cost cap');
        expect(fs.existsSync(path.join(outputDir, 'canon', digest.digestId, 'dispatch.json'))).toBe(false);
        expect(fs.existsSync(path.join(outputDir, 'review', digest.digestId, 'dispatch.json'))).toBe(false);
    });

    it('dry_run tick writes latest-frame.json with deterministic fallback narration', () => {
        const outputDir = tempOutputDir();
        const result = runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
        });

        expect(result.row.decision).toBe('dry_run');
        const framePath = path.join(outputDir, 'latest-frame.json');
        expect(fs.existsSync(framePath)).toBe(true);
        const frame = JSON.parse(fs.readFileSync(framePath, 'utf-8'));
        expect(frame.ok).toBe(true);
        expect(frame.schemaVersion).toBe(1);
        expect(frame.narration.source).toBe('deterministic_fallback');
    });

    it('held_no_delta tick writes latest-frame.json with quiet-city fallback', () => {
        const outputDir = tempOutputDir();
        new StorytellerStore(outputDir).writeDigest(emptyDigest());

        const result = runStorytellerOverseerTick({
            source: 'latest',
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
        });

        expect(result.row.decision).toBe('held_no_delta');
        const framePath = path.join(outputDir, 'latest-frame.json');
        expect(fs.existsSync(framePath)).toBe(true);
        const frame = JSON.parse(fs.readFileSync(framePath, 'utf-8'));
        expect(frame.ok).toBe(true);
        expect(frame.narration.source).toBe('deterministic_fallback');
    });

    it('held_duplicate tick does NOT overwrite the latest-frame.json written by the prior tick', () => {
        const outputDir = tempOutputDir();
        const now = new Date('2026-05-30T20:00:00.000Z');

        runStorytellerOverseerTick({ source: 'fixture', outputDir, now: () => now });
        const firstFrame = JSON.parse(fs.readFileSync(path.join(outputDir, 'latest-frame.json'), 'utf-8'));

        runStorytellerOverseerTick({
            source: 'fixture',
            outputDir,
            now: () => new Date(now.getTime() + 60_000),
            dedupWindowMs: 30 * 60_000,
        });
        const secondRead = JSON.parse(fs.readFileSync(path.join(outputDir, 'latest-frame.json'), 'utf-8'));

        expect(secondRead.frameId).toBe(firstFrame.frameId);
    });

    it('published_canon tick writes latest-frame.json with verified dispatch narration', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const { digest, refs } = buildFixtureDigest();
        const dispatch = fixtureDispatch({ digestId: digest.digestId, eventRefsUsed: [refs.apLow] });
        store.writeDigest(digest);
        store.writeDispatch(dispatch);

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
            autoPublishOnZeroWarnings: true,
        });

        expect(result.row.decision).toBe('published_canon');
        const framePath = path.join(outputDir, 'latest-frame.json');
        expect(fs.existsSync(framePath)).toBe(true);
        const frame = JSON.parse(fs.readFileSync(framePath, 'utf-8'));
        expect(frame.ok).toBe(true);
        expect(frame.narration.source).toBe('verified_dispatch');
        expect(frame.narration.title).toBe(dispatch.publicTitle);
    });

    it('held_budget tick writes latest-frame.json with fallback before returning early', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const digest = buildFixtureDigest().digest;
        store.writeDigest(digest);
        store.writeDispatch(fixtureDispatch({ digestId: digest.digestId, estimatedCostUsd: 0.11 }));

        const ledger = new OverseerLedger(outputDir);
        ledger.append({
            schemaVersion: 1,
            rowId: 'prior-row',
            createdAt: '2026-05-30T19:40:00.000Z',
            digestId: 'prior-digest',
            fingerprint: 'fp-prior',
            decision: 'published_canon',
            reason: 'published',
            eventRefs: ['gp:1'],
            artifactDir: path.join(outputDir, 'canon', 'prior-digest'),
            estimatedCostUsd: 0.15,
        });

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
            dailyCostCapUsd: 0.2,
        });

        expect(result.row.decision).toBe('held_budget');
        const framePath = path.join(outputDir, 'latest-frame.json');
        expect(fs.existsSync(framePath)).toBe(true);
        const frame = JSON.parse(fs.readFileSync(framePath, 'utf-8'));
        expect(frame.ok).toBe(true);
        expect(frame.narration.source).toBe('deterministic_fallback');
    });

    it('holds unknown-cost model dispatches under a daily cap and keeps latest-frame fallback-only', () => {
        const outputDir = tempOutputDir();
        const store = new StorytellerStore(outputDir);
        const { digest, refs } = buildFixtureDigest();
        store.writeDigest(digest);
        store.writeDispatch(
            fixtureDispatch({
                digestId: digest.digestId,
                eventRefsUsed: [refs.apLow],
                estimatedCostUsd: null,
                needsReview: false,
                reviewReasons: undefined,
            }),
        );

        const result = runStorytellerOverseerTick({
            source: 'digest-id',
            digestId: digest.digestId,
            outputDir,
            now: () => new Date('2026-05-30T20:00:00.000Z'),
            dailyCostCapUsd: 0.2,
        });

        expect(result.row.decision).toBe('held_unknown_cost');
        expect(result.row.reason).toContain('unknown model cost');
        expect(fs.existsSync(path.join(outputDir, 'canon', digest.digestId, 'dispatch.json'))).toBe(false);
        expect(fs.existsSync(path.join(outputDir, 'review', digest.digestId, 'dispatch.json'))).toBe(false);
        const frame = JSON.parse(fs.readFileSync(path.join(outputDir, 'latest-frame.json'), 'utf-8'));
        expect(frame.narration.source).toBe('deterministic_fallback');
        expect(frame.source.dispatchId).toBeUndefined();
    });
});

describe('preflightStorytellerPaidModelBudget', () => {
    it('blocks paid model runs before dispatch generation when cap is missing or already spent', () => {
        const outputDir = tempOutputDir();
        new OverseerLedger(outputDir).append({
            schemaVersion: 1,
            rowId: 'prior-row',
            createdAt: '2026-05-30T19:40:00.000Z',
            digestId: 'prior-digest',
            fingerprint: 'fp-prior',
            decision: 'published_canon',
            reason: 'published',
            eventRefs: ['gp:1'],
            artifactDir: path.join(outputDir, 'canon', 'prior-digest'),
            estimatedCostUsd: 0.25,
        });

        expect(() =>
            preflightStorytellerPaidModelBudget({
                outputDir,
                now: new Date('2026-05-30T20:00:00.000Z'),
            }),
        ).toThrow(StorytellerOverseerCliError);

        expect(() =>
            preflightStorytellerPaidModelBudget({
                outputDir,
                dailyCostCapUsd: 0.25,
                now: new Date('2026-05-30T20:00:00.000Z'),
            }),
        ).toThrow(StorytellerOverseerCliError);

        expect(
            preflightStorytellerPaidModelBudget({
                outputDir,
                dailyCostCapUsd: 0.3,
                now: new Date('2026-05-30T20:00:00.000Z'),
            }),
        ).toEqual({
            capUsd: 0.3,
            remainingUsd: 0.04999999999999999,
            spentTodayUsd: 0.25,
        });
    });
});

describe('parseStorytellerOverseerArgs', () => {
    it('parses one tick over the latest digest with a custom dedup window', () => {
        expect(
            parseStorytellerOverseerArgs(['--tick', '--latest', '--output-dir', '/tmp/storyteller', '--dedup-window-ms', '60000']),
        ).toEqual({
            tick: true,
            source: 'latest',
            outputDir: '/tmp/storyteller',
            dedupWindowMs: 60_000,
            autoPublishOnZeroWarnings: true,
        });
    });

    it('rejects watch mode until the cost-capped packet lands', () => {
        expect(() => parseStorytellerOverseerArgs(['--watch', '--fixture'])).toThrow(StorytellerOverseerCliError);
    });

    it('parses daily cost cap and disables auto-publish when requested', () => {
        expect(
            parseStorytellerOverseerArgs(['--tick', '--latest', '--daily-cost-cap-usd', '0.5', '--no-auto-publish-on-zero-warnings']),
        ).toMatchObject({
            tick: true,
            source: 'latest',
            dailyCostCapUsd: 0.5,
            autoPublishOnZeroWarnings: false,
        });
    });
});
