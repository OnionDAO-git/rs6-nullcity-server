import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildFixtureDigest } from './digest-builder';
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
});
