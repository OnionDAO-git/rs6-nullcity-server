import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomyEventLog } from '../city-integration/economy-event';
import { GoalContractStore } from '../city-integration/goal-contract';
import { parseStorytellerDryRunArgs, runStorytellerDryRun, StorytellerDryRunCliError } from './cli';

describe('storyteller:dry-run CLI live source', () => {
    let memoryRoot: string;
    let outputDir: string;

    beforeEach(() => {
        memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-live-memory-'));
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-live-output-'));
    });

    afterEach(() => {
        fs.rmSync(memoryRoot, { recursive: true, force: true });
        fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it('parses memory-root dry-run args without requiring fixture mode', () => {
        expect(
            parseStorytellerDryRunArgs([
                '--memory-root',
                '/tmp/null-city-memory',
                '--output-dir',
                '/tmp/storyteller',
                '--since',
                '2026-05-30T00:00:00.000Z',
                '--until',
                '2026-05-30T00:10:00.000Z',
                '--digest-id',
                'live-test-digest',
            ]),
        ).toEqual({
            fixture: false,
            memoryRoot: '/tmp/null-city-memory',
            outputDir: '/tmp/storyteller',
            since: '2026-05-30T00:00:00.000Z',
            until: '2026-05-30T00:10:00.000Z',
            digestId: 'live-test-digest',
        });
    });

    it('rejects runs without --fixture or --memory-root', () => {
        expect(() => runStorytellerDryRun({ fixture: false, outputDir })).toThrow(StorytellerDryRunCliError);
    });

    it('writes digest and summary artifacts from EconomyEventLog and GoalContractStore', () => {
        const log = new EconomyEventLog(memoryRoot, () => new Date('2026-05-30T00:01:00.000Z'));
        log.append({
            kind: 'ap_topup',
            residentName: 'res:duke',
            apDelta: 50,
            note: 'Duke received 50 AP from a patron top-up.',
        });
        log.append({
            kind: 'gp_earned',
            residentName: 'res:duke',
            gpDelta: 200,
            note: 'Duke earned 200 GP from real RuneScape coin item 995.',
        });
        log.append({
            kind: 'ap_gp_exchange',
            residentName: 'res:duke',
            cityUserId: 'patron:demo',
            apDelta: 25,
            gpDelta: -100,
            note: 'Duke exchanged 100 GP for 25 AP.',
        });
        log.append({
            kind: 'ncri_redemption',
            residentName: 'res:duke',
            ncriId: 'ncri:brass-lantern',
            note: 'Duke redeemed NCRI brass lantern.',
        });

        const goals = new GoalContractStore(memoryRoot, () => new Date('2026-05-30T00:02:00.000Z'));
        const goal = goals.create({
            residentName: 'res:duke',
            goalText: 'earn 200 GP for the Library',
            completion: { condition: 'bank GP >= 200', evidenceSource: 'runtime:coin-995' },
        });
        goals.markAchieved(goal.id, 'runtime observed 200 GP coin item 995 in inventory');

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T00:00:00.000Z',
                until: '2026-05-30T00:10:00.000Z',
                digestId: 'live-test-digest',
            },
            { now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.digestId).toBe('live-test-digest');
        expect(result.digest.apEvents).toHaveLength(1);
        expect(result.digest.gpEvents.map(event => event.kind)).toEqual(['gp_earned']);
        expect(result.digest.exchangeEvents).toHaveLength(1);
        expect(result.digest.ncriEvents).toHaveLength(1);
        expect(result.digest.goalEvents).toHaveLength(1);
        expect(result.digest.residents[0]).toMatchObject({
            residentName: 'res:duke',
            attention: 75,
            gpObserved: 100,
            goalText: 'earn 200 GP for the Library',
        });
        expect(result.summary).toContain('GP events');
        expect(result.summary).toContain('Goal events');
        expect(fs.existsSync(path.join(outputDir, 'live-test-digest', 'digest.json'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'live-test-digest', 'summary.txt'))).toBe(true);
    });
});
