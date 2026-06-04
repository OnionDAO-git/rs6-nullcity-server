import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomyEventLog } from '../city-integration/economy-event';
import { GoalContractStore } from '../city-integration/goal-contract';
import { NcriRegistry } from '../ncri/ncri-registry';
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

    it('filters stale runtime-state-only residents but preserves faded residents in CLI dry-runs', () => {
        writeRuntimeState(memoryRoot, 'res:hans', {
            resident: 'res:hans',
            attention: 4_950,
            tick: 120,
            cognition: {
                activeGoal: {
                    id: 'greet-patrons',
                    description: 'Greet patrons in the Lumbridge courtyard.',
                    createdAtTick: 100,
                },
            },
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        writeRuntimeState(memoryRoot, 'res:faded', {
            resident: 'res:faded',
            attention: 0,
            tick: 9,
            deceased: { date: '2026-05-30T00:05:00.000Z', tick: 9, cause: 'attention_exhausted' },
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T00:00:00.000Z',
                until: '2026-05-30T00:10:00.000Z',
                digestId: 'runtime-resident-digest',
            },
            { now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.systemHealth).toMatchObject({
            totalResidents: 1,
            activeResidents: 0,
            fadedResidents: 1,
            lowApResidents: 0,
        });
        expect(result.digest.residents).toEqual([
            expect.objectContaining({
                residentName: 'res:faded',
                attention: 0,
                isFaded: true,
            }),
        ]);
        expect(result.summary).toContain('System health: 1 residents total, 0 active, 1 faded, 0 low-AP');
        expect(result.summary).not.toContain('res:hans');
    });

    it('adds grounded Library activity events when the economy window is quiet', () => {
        writeRuntimeState(memoryRoot, 'res-hans', {
            resident: 'res:hans',
            attention: 5_000,
            tick: 140,
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        writeLibraryEvents(memoryRoot, 'res-hans', [
            {
                schemaVersion: 1,
                ts: '2026-05-30T00:03:00.000Z',
                tick: 10,
                kind: 'say',
                text: 'Still here as Hans; watching the area.',
            },
            {
                schemaVersion: 1,
                ts: '2026-05-30T00:04:00.000Z',
                tick: 20,
                kind: 'stuck_recovered',
                reasons: ['position_changed'],
            },
        ]);

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T00:00:00.000Z',
                until: '2026-05-30T00:10:00.000Z',
                digestId: 'library-activity-digest',
            },
            { now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.miscEvents).toContainEqual(
            expect.objectContaining({
                kind: 'library_writeback',
                residentName: 'res:hans',
                note: 'res:hans said: "Still here as Hans; watching the area."',
            }),
        );
        expect(result.digest.stuckEvents).toContainEqual(
            expect.objectContaining({
                kind: 'stuck_recovered',
                residentName: 'res:hans',
                note: 'res:hans recovered from being stuck.',
            }),
        );
        expect(result.digest.systemHealth).toMatchObject({
            totalResidents: 1,
            activeResidents: 1,
            fadedResidents: 0,
            lowApResidents: 0,
        });
        expect(result.digest.residents).toEqual([
            expect.objectContaining({
                residentName: 'res:hans',
                attention: 5_000,
                isFaded: false,
            }),
        ]);
        expect(result.digest.topEvents.map(event => event.kind)).toEqual(['stuck_recovered', 'library_writeback']);
        expect(result.summary).toContain('Stuck/recovered events: 1');
        expect(result.summary).toContain('Misc events: 1');
    });

    it('filters synthetic QA and benchmark residents from public-canon live digests', () => {
        writeRuntimeState(memoryRoot, 'res-hans', {
            resident: 'res:hans',
            attention: 5_000,
            tick: 140,
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        writeRuntimeState(memoryRoot, 'res-qa-cook', {
            resident: 'res:qa-cook',
            attention: 5_000,
            tick: 141,
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        writeRuntimeState(memoryRoot, 'res-bmk_fire_5m_deadbeef', {
            resident: 'res:bmk_fire_5m_deadbeef',
            attention: 5_000,
            tick: 142,
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        writeLibraryEvents(memoryRoot, 'res-hans', [
            { schemaVersion: 1, ts: '2026-05-30T00:03:00.000Z', tick: 10, kind: 'say', text: 'The courtyard is awake.' },
        ]);
        writeLibraryEvents(memoryRoot, 'res-qa-cook', [
            { schemaVersion: 1, ts: '2026-05-30T00:04:00.000Z', tick: 20, kind: 'say', text: 'QA fixture should stay private.' },
        ]);
        writeLibraryEvents(memoryRoot, 'res-bmk_fire_5m_deadbeef', [
            { schemaVersion: 1, ts: '2026-05-30T00:05:00.000Z', tick: 30, kind: 'stuck_recovered' },
        ]);

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T00:00:00.000Z',
                until: '2026-05-30T00:10:00.000Z',
                digestId: 'public-canon-digest',
            },
            { now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.systemHealth.totalResidents).toBe(1);
        expect(result.digest.residents.map(resident => resident.residentName)).toEqual(['res:hans']);
        expect(result.digest.miscEvents.map(event => event.residentName)).toEqual(['res:hans']);
        expect(result.digest.stuckEvents).toHaveLength(0);
        expect(result.summary).not.toContain('res:qa-cook');
        expect(result.summary).not.toContain('res:bmk_fire_5m_deadbeef');
    });

    it('attributes resident-owned NCRI transfers to the selling resident in dry-run artifacts', () => {
        let nowMs = Date.parse('2026-05-30T00:01:00.000Z');
        const now = () => new Date(nowMs);
        const log = new EconomyEventLog(memoryRoot, now);
        const registry = new NcriRegistry(memoryRoot, now, log);
        const record = registry.create({
            itemId: 590,
            displayName: 'Kindling Relic',
            lore: 'A starter spark carried out of Lumbridge.',
            owner: 'res:duke',
            printable: true,
            propertyTags: ['kindling', 'printable'],
            printAssetRef: 'prints/kindling-relic.3mf',
        });

        nowMs = Date.parse('2026-05-30T00:02:00.000Z');
        registry.approve(record.id, 'approved for S5b dry-run proof');
        nowMs = Date.parse('2026-05-30T00:03:00.000Z');
        registry.transfer(record.id, 'human:event-demo');
        nowMs = Date.parse('2026-05-30T00:04:00.000Z');
        registry.redeem(record.id);

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T00:00:00.000Z',
                until: '2026-05-30T00:10:00.000Z',
                digestId: 'live-ncri-digest',
            },
            { now: () => new Date('2026-05-30T00:10:00.000Z') },
        );

        expect(result.digest.residents.map(resident => resident.residentName)).toContain('res:duke');
        expect(result.digest.ncriEvents).toHaveLength(2);
        expect(result.digest.ncriEvents[0]).toMatchObject({
            kind: 'ncri_created',
            residentName: 'res:duke',
            evidence: { ncriId: record.id, cityUserId: 'human:event-demo' },
        });
        expect(result.digest.ncriEvents[1]).toMatchObject({
            kind: 'ncri_redeemed',
            residentName: 'res:duke',
            evidence: { ncriId: record.id, cityUserId: 'human:event-demo' },
        });
        expect(result.digest.topEvents.map(event => event.ref)).toEqual(result.digest.ncriEvents.map(event => event.ref));
        expect(result.summary).toContain('NCRI events: 2');
    });

    it('enriches resident snapshot with most recent speech from Library timeline within 1 hour', () => {
        const now = new Date('2026-05-30T00:10:00.000Z');
        writeRuntimeState(memoryRoot, 'res-hans', {
            resident: 'res:hans',
            attention: 4_000,
            tick: 50,
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T00:00:00.000Z',
                dayStartedAt: '2026-05-30T00:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        writeLibraryEvents(memoryRoot, 'res-hans', [
            { kind: 'say', ts: '2026-05-30T00:01:00.000Z', tick: 10, text: 'Guarding the gate.' },
            { kind: 'say', ts: '2026-05-30T00:05:00.000Z', tick: 30, text: 'The square is quiet tonight.' },
        ]);

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T00:00:00.000Z',
                until: '2026-05-30T00:10:00.000Z',
                digestId: 'speech-enrich-test',
            },
            { now: () => now },
        );

        const hans = result.digest.residents.find(r => r.residentName === 'res:hans');
        expect(hans).toBeDefined();
        expect((hans as any).recentSpeech).toBe('The square is quiet tonight.');
    });

    it('excludes speech older than 1 hour from resident snapshot', () => {
        const now = new Date('2026-05-30T02:00:00.000Z');
        writeRuntimeState(memoryRoot, 'res-pip', {
            resident: 'res:pip',
            attention: 3_000,
            tick: 200,
            legacy: { kind: 'runescape', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: '2026-05-30T02:00:00.000Z',
                dayStartedAt: '2026-05-30T02:00:00.000Z',
                requestsThisMinute: 0,
                requestsToday: 0,
            },
        });
        // Economy event within the window ensures res:pip appears in the digest.
        const log = new EconomyEventLog(memoryRoot, () => new Date('2026-05-30T01:55:00.000Z'));
        log.append({ kind: 'ap_topup', residentName: 'res:pip', apDelta: 10, note: 'Pip received AP.' });
        // Say event older than 1 hour before now — should be excluded from recentSpeech.
        writeLibraryEvents(memoryRoot, 'res-pip', [
            { kind: 'say', ts: '2026-05-29T23:00:00.000Z', tick: 5, text: 'Old speech, more than an hour ago.' },
        ]);

        const result = runStorytellerDryRun(
            {
                fixture: false,
                memoryRoot,
                outputDir,
                since: '2026-05-30T01:50:00.000Z',
                until: '2026-05-30T02:00:00.000Z',
                digestId: 'speech-exclude-test',
            },
            { now: () => now },
        );

        const pip = result.digest.residents.find(r => r.residentName === 'res:pip');
        expect(pip).toBeDefined();
        expect((pip as any).recentSpeech).toBeUndefined();
    });
});

function writeRuntimeState(memoryRoot: string, slug: string, state: Record<string, unknown>): void {
    const dir = path.join(memoryRoot, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'runtime-state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function writeLibraryEvents(memoryRoot: string, slug: string, events: Record<string, unknown>[]): void {
    const dir = path.join(memoryRoot, 'library', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'timeline.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
}
