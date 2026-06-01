import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
import { OverseerLedger } from './overseer';
import { StorytellerStore } from './store';
import { parseStorytellerRunArgs, runStoryteller, StorytellerRunCliError } from './run-cli';

describe('storyteller:run CLI digest sources', () => {
    let outputDir: string;

    beforeEach(() => {
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-run-cli-'));
    });

    afterEach(() => {
        fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('parses latest and digest-id sources without fixture mode', () => {
        expect(parseStorytellerRunArgs(['--latest', '--output-dir', '/tmp/storyteller', '--model-profile', 'storyteller-smart'])).toEqual({
            source: 'latest',
            modelProfile: 'storyteller-smart',
            outputDir: '/tmp/storyteller',
        });

        expect(parseStorytellerRunArgs(['--digest-id', 'live-20260530060000'])).toEqual({
            source: 'digest-id',
            digestId: 'live-20260530060000',
            modelProfile: 'default',
            outputDir: path.join('data', 'controller', 'storyteller'),
        });
    });

    it('parses daily cost caps from flag and environment for paid Storyteller runs', () => {
        expect(
            parseStorytellerRunArgs(['--latest'], {
                STORYTELLER_DAILY_COST_CAP_USD: '0.25',
            }),
        ).toMatchObject({
            source: 'latest',
            dailyCostCapUsd: 0.25,
        });

        expect(
            parseStorytellerRunArgs(['--latest', '--daily-cost-cap-usd', '0.10'], {
                STORYTELLER_DAILY_COST_CAP_USD: '0.25',
            }),
        ).toMatchObject({
            source: 'latest',
            dailyCostCapUsd: 0.1,
        });
    });

    it('rejects missing or conflicting digest sources', async () => {
        await expect(runStoryteller({ source: 'none', outputDir, modelProfile: 'default' })).rejects.toThrow(StorytellerRunCliError);
        expect(() => parseStorytellerRunArgs(['--fixture', '--latest'])).toThrow(StorytellerRunCliError);
    });

    it('runs over latest persisted digest and writes dispatch without requiring a model endpoint', async () => {
        const store = new StorytellerStore(outputDir);
        const { digest } = buildFixtureDigest();
        const older = { ...digest, digestId: 'older-digest', builtAt: '2026-05-30T00:00:00.000Z' };
        const newer = { ...digest, digestId: 'newer-digest', builtAt: '2026-05-30T00:05:00.000Z' };
        store.writeDigest(older);
        store.writeDigest(newer);

        const result = await runStoryteller(
            { source: 'latest', outputDir, modelProfile: 'default' },
            { env: {}, now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.digestId).toBe('newer-digest');
        expect(result.dispatch.digestId).toBe('newer-digest');
        expect(result.dispatch.modelProfile).toBe('default');
        expect(result.dispatch.needsReview).toBe(true);
        expect(result.dispatch.reviewReasons?.some(reason => reason.includes('nooped'))).toBe(true);
        expect(result.dispatch.publicTitle).not.toBe('(no title generated)');
        expect(result.dispatch.publicBody).not.toBe('(no body generated)');
        expect(result.dispatch.publicBullets.length).toBeGreaterThan(0);
        expect(result.dispatch.eventRefsUsed.length).toBeGreaterThan(0);

        const dispatchPath = path.join(outputDir, 'newer-digest', 'dispatch.json');
        expect(fs.existsSync(dispatchPath)).toBe(true);
        const written = JSON.parse(fs.readFileSync(dispatchPath, 'utf-8')) as { publicTitle: string; publicBody: string };
        expect(written.publicTitle).toBe(result.dispatch.publicTitle);
        expect(written.publicBody).toBe(result.dispatch.publicBody);
    });

    it('runs over a named persisted digest id', async () => {
        const store = new StorytellerStore(outputDir);
        const { digest } = buildFixtureDigest();
        store.writeDigest({ ...digest, digestId: 'named-live-digest' });

        const result = await runStoryteller(
            { source: 'digest-id', digestId: 'named-live-digest', outputDir, modelProfile: 'default' },
            { env: {}, now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.digestId).toBe('named-live-digest');
        expect(result.dispatch.digestId).toBe('named-live-digest');
        expect(fs.existsSync(path.join(outputDir, 'named-live-digest', 'dispatch.json'))).toBe(true);
    });

    it('blocks configured model endpoints when daily cost cap is missing', async () => {
        const store = new StorytellerStore(outputDir);
        const { digest } = buildFixtureDigest();
        store.writeDigest({ ...digest, digestId: 'paid-digest' });
        const fetchSpy = jest.spyOn(globalThis, 'fetch');

        await expect(
            runStoryteller(
                { source: 'digest-id', digestId: 'paid-digest', outputDir, modelProfile: 'storyteller-smart' },
                {
                    env: {
                        STORYTELLER_LLM_BASE_URL: 'http://paid-model.invalid',
                        STORYTELLER_LLM_MODEL: 'paid-storyteller',
                    },
                    now: () => new Date('2026-05-30T20:30:00.000Z'),
                },
            ),
        ).rejects.toMatchObject({ code: 'missing_cost_cap' });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(outputDir, 'paid-digest', 'dispatch.json'))).toBe(false);
        fetchSpy.mockRestore();
    });

    it('blocks configured model endpoints before fetch when daily cost cap is already spent', async () => {
        const store = new StorytellerStore(outputDir);
        const { digest } = buildFixtureDigest();
        store.writeDigest({ ...digest, digestId: 'spent-digest' });
        new OverseerLedger(outputDir).append({
            schemaVersion: 1,
            rowId: 'prior-paid-row',
            createdAt: '2026-05-30T19:40:00.000Z',
            digestId: 'prior-digest',
            fingerprint: 'fp-prior',
            decision: 'published_canon',
            reason: 'published',
            eventRefs: ['gp:1'],
            artifactDir: path.join(outputDir, 'canon', 'prior-digest'),
            estimatedCostUsd: 0.25,
        });
        const fetchSpy = jest.spyOn(globalThis, 'fetch');

        await expect(
            runStoryteller(
                {
                    source: 'digest-id',
                    digestId: 'spent-digest',
                    outputDir,
                    modelProfile: 'storyteller-smart',
                    dailyCostCapUsd: 0.25,
                },
                {
                    env: {
                        STORYTELLER_LLM_BASE_URL: 'http://paid-model.invalid',
                        STORYTELLER_LLM_MODEL: 'paid-storyteller',
                    },
                    now: () => new Date('2026-05-30T20:30:00.000Z'),
                },
            ),
        ).rejects.toMatchObject({ code: 'daily_cost_cap_exceeded' });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(outputDir, 'spent-digest', 'dispatch.json'))).toBe(false);
        fetchSpy.mockRestore();
    });

    it('uses text response format for configured Storyteller endpoints', async () => {
        const store = new StorytellerStore(outputDir);
        const { digest, refs } = buildFixtureDigest();
        store.writeDigest({ ...digest, digestId: 'text-format-digest' });
        const modelPayload = {
            publicTitle: 'AP Alarm in the Dungeon Stack',
            publicBody:
                'Alice is low on AP while Bob moved real RuneScape GP. The city has a live resource problem, not a bedtime bulletin.',
            publicBullets: ['Alice is below the AP survival threshold.', 'Bob has real RuneScape GP evidence.'],
            operatorSummary: 'Paid Storyteller text-mode JSON response.',
            operatorWarnings: [],
            eventRefsUsed: [refs.apLow, refs.gpEarned],
        };
        const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: JSON.stringify(modelPayload) } }],
                    usage: { prompt_tokens: 100, completion_tokens: 60, cost: 0.01 },
                }),
                { status: 200 },
            ),
        );

        await runStoryteller(
            {
                source: 'digest-id',
                digestId: 'text-format-digest',
                outputDir,
                modelProfile: 'storyteller-smart',
                dailyCostCapUsd: 1,
            },
            {
                env: {
                    STORYTELLER_LLM_BASE_URL: 'http://paid-model.invalid',
                    STORYTELLER_LLM_MODEL: 'paid-storyteller',
                },
                now: () => new Date('2026-05-30T20:30:00.000Z'),
            },
        );

        const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
        const body = JSON.parse(String(requestInit.body)) as { response_format?: unknown };
        expect(body.response_format).toEqual({ type: 'text' });
        fetchSpy.mockRestore();
    });
});
