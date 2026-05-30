import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
import { StorytellerStore } from './store';
import { OverseerLedger, parseStorytellerOverseerArgs, runStorytellerOverseerTick, StorytellerOverseerCliError } from './overseer';
import type { CityEventDigest } from './types';

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
        });
    });

    it('rejects watch mode until the cost-capped packet lands', () => {
        expect(() => parseStorytellerOverseerArgs(['--watch', '--fixture'])).toThrow(StorytellerOverseerCliError);
    });
});
