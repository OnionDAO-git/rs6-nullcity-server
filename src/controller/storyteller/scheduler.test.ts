import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomyEventLog } from '../city-integration/economy-event';
import { OverseerLedger } from './overseer';
import {
    StorytellerSchedulerCliError,
    parseStorytellerSchedulerArgs,
    runStorytellerSchedulerTick,
    storytellerSchedulerLockPath,
} from './scheduler';

function tempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('storyteller scheduler', () => {
    let memoryRoot: string;
    let outputDir: string;

    beforeEach(() => {
        memoryRoot = tempDir('storyteller-scheduler-memory-');
        outputDir = tempDir('storyteller-scheduler-output-');
    });

    afterEach(() => {
        fs.rmSync(memoryRoot, { recursive: true, force: true });
        fs.rmSync(outputDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    it('parses a 30-minute watch loop with explicit cost cap', () => {
        expect(
            parseStorytellerSchedulerArgs(
                [
                    '--watch',
                    '--memory-root',
                    '/tmp/null-city-memory',
                    '--output-dir',
                    '/tmp/storyteller',
                    '--daily-cost-cap-usd',
                    '5',
                    '--model-profile',
                    'openrouter_storyteller',
                ],
                {},
            ),
        ).toEqual({
            mode: 'watch',
            intervalMs: 30 * 60_000,
            memoryRoot: '/tmp/null-city-memory',
            outputDir: '/tmp/storyteller',
            modelProfile: 'openrouter_storyteller',
            dailyCostCapUsd: 5,
            lockTtlMs: 90 * 60_000,
            autoPublishOnZeroWarnings: true,
        });
    });

    it('requires either --once or --watch so a daemon is deliberate', () => {
        expect(() => parseStorytellerSchedulerArgs([], {})).toThrow(StorytellerSchedulerCliError);
        expect(() => parseStorytellerSchedulerArgs(['--once', '--watch'], {})).toThrow(StorytellerSchedulerCliError);
    });

    it('records a held no-delta tick without calling the paid model', async () => {
        const fetchSpy = jest.spyOn(globalThis, 'fetch');

        const result = await runStorytellerSchedulerTick(
            {
                mode: 'once',
                intervalMs: 30 * 60_000,
                memoryRoot,
                outputDir,
                modelProfile: 'storyteller-test',
                dailyCostCapUsd: 1,
                lockTtlMs: 90 * 60_000,
                autoPublishOnZeroWarnings: true,
            },
            {
                env: {
                    STORYTELLER_LLM_BASE_URL: 'http://paid-model.invalid',
                    STORYTELLER_LLM_MODEL: 'paid-storyteller',
                },
                now: () => new Date('2026-06-02T20:30:00.000Z'),
            },
        );

        expect(result.modelCalled).toBe(false);
        expect(result.row.decision).toBe('held_no_delta');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(new OverseerLedger(outputDir).readAll().map(row => row.decision)).toEqual(['held_no_delta']);
    });

    it('runs the paid Storyteller and publishes canon when a window has narratable evidence', async () => {
        new EconomyEventLog(memoryRoot, () => new Date('2026-06-02T20:05:00.000Z')).append({
            kind: 'gp_earned',
            residentName: 'res:duke',
            gpDelta: 25,
            note: 'Duke earned 25 GP from real RuneScape coin item 995.',
        });
        const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    publicTitle: 'Duke made a visible move',
                                    publicBody: 'Duke made a visible move in Null City.',
                                    publicBullets: ['Duke made a visible move.'],
                                    operatorSummary: 'Scheduler test dispatch.',
                                    operatorWarnings: [],
                                    eventRefsUsed: [],
                                }),
                            },
                        },
                    ],
                    usage: { prompt_tokens: 100, completion_tokens: 60, cost: 0.01 },
                }),
                { status: 200 },
            ),
        );

        const result = await runStorytellerSchedulerTick(
            {
                mode: 'once',
                intervalMs: 30 * 60_000,
                memoryRoot,
                outputDir,
                modelProfile: 'storyteller-test',
                dailyCostCapUsd: 1,
                lockTtlMs: 90 * 60_000,
                autoPublishOnZeroWarnings: true,
            },
            {
                env: {
                    STORYTELLER_LLM_BASE_URL: 'http://paid-model.invalid',
                    STORYTELLER_LLM_MODEL: 'paid-storyteller',
                },
                now: () => new Date('2026-06-02T20:30:00.000Z'),
            },
        );

        expect(result.modelCalled).toBe(true);
        expect(result.row.decision).toBe('published_canon');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(outputDir, 'canon', result.row.digestId, 'dispatch.json'))).toBe(true);
        const latestFrame = JSON.parse(fs.readFileSync(path.join(outputDir, 'latest-frame.json'), 'utf-8')) as {
            digestId?: string;
            narration?: { source?: string; title?: string };
        };
        expect(latestFrame.digestId).toBe(result.row.digestId);
        expect(latestFrame.narration?.source).toBe('verified_dispatch');
        expect(latestFrame.narration?.title).toBe('Duke made a visible move');
    });

    it('writes latest-frame.json with deterministic fallback when the scheduled model output needs review', async () => {
        new EconomyEventLog(memoryRoot, () => new Date('2026-06-02T20:05:00.000Z')).append({
            kind: 'gp_earned',
            residentName: 'res:duke',
            gpDelta: 25,
            note: 'Duke earned 25 GP from real RuneScape coin item 995.',
        });
        const fetchSpy = jest.spyOn(globalThis, 'fetch');

        const result = await runStorytellerSchedulerTick(
            {
                mode: 'once',
                intervalMs: 30 * 60_000,
                memoryRoot,
                outputDir,
                modelProfile: 'storyteller-test',
                dailyCostCapUsd: 1,
                lockTtlMs: 90 * 60_000,
                autoPublishOnZeroWarnings: true,
            },
            {
                env: {},
                now: () => new Date('2026-06-02T20:30:00.000Z'),
            },
        );

        expect(result.modelCalled).toBe(true);
        expect(result.row.decision).toBe('queued_review');
        expect(fetchSpy).not.toHaveBeenCalled();
        const latestFrame = JSON.parse(fs.readFileSync(path.join(outputDir, 'latest-frame.json'), 'utf-8')) as {
            digestId?: string;
            source?: { excludedDispatchId?: string };
            narration?: { source?: string };
            publicHealth?: { warnings?: string[] };
        };
        expect(latestFrame.digestId).toBe(result.row.digestId);
        expect(latestFrame.narration?.source).toBe('deterministic_fallback');
        expect(latestFrame.source?.excludedDispatchId).toBeDefined();
        expect(latestFrame.publicHealth?.warnings).toEqual(expect.arrayContaining([expect.stringContaining('nooped')]));
    });

    it('skips a tick when another scheduler process owns the lock', async () => {
        fs.writeFileSync(storytellerSchedulerLockPath(outputDir), JSON.stringify({ pid: 123, createdAt: '2026-06-02T20:29:00.000Z' }));

        const result = await runStorytellerSchedulerTick(
            {
                mode: 'once',
                intervalMs: 30 * 60_000,
                memoryRoot,
                outputDir,
                modelProfile: 'storyteller-test',
                lockTtlMs: 90 * 60_000,
                autoPublishOnZeroWarnings: true,
            },
            { now: () => new Date('2026-06-02T20:30:00.000Z') },
        );

        expect(result.modelCalled).toBe(false);
        expect(result.row.decision).toBe('skipped_locked');
        expect(new OverseerLedger(outputDir).readAll()).toHaveLength(0);
    });
});
