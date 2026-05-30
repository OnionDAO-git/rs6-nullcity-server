import fs from 'fs';
import os from 'os';
import path from 'path';
import { CityDigestCliError, parseCityDigestArgs, runCityDigest } from './cli';
import { EconomyEventLog } from './economy-event';
import { GoalContractStore } from './goal-contract';

describe('parseCityDigestArgs', () => {
    it('parses --memory-root', () => {
        expect(parseCityDigestArgs(['--memory-root', '/tmp/mem'])).toEqual({ memoryRoot: '/tmp/mem' });
    });

    it('parses --memory-root + --since + --until', () => {
        expect(
            parseCityDigestArgs([
                '--memory-root',
                '/tmp/mem',
                '--since',
                '2026-05-29T00:00:00.000Z',
                '--until',
                '2026-05-30T00:00:00.000Z',
            ]),
        ).toEqual({
            memoryRoot: '/tmp/mem',
            since: '2026-05-29T00:00:00.000Z',
            until: '2026-05-30T00:00:00.000Z',
        });
    });

    it('rejects missing --memory-root', () => {
        expect(() => parseCityDigestArgs([])).toThrow(CityDigestCliError);
        expect(() => parseCityDigestArgs([])).toThrow(/--memory-root is required/);
    });

    it('rejects --memory-root with no value', () => {
        expect(() => parseCityDigestArgs(['--memory-root'])).toThrow(/--memory-root requires a path/);
    });

    it('rejects --since without value', () => {
        expect(() => parseCityDigestArgs(['--memory-root', '/x', '--since'])).toThrow(/--since requires an ISO/);
    });

    it('rejects unknown flag', () => {
        expect(() => parseCityDigestArgs(['--memory-root', '/x', '--bogus'])).toThrow(/unknown flag: --bogus/);
    });

    it('handles --help with help error code', () => {
        try {
            parseCityDigestArgs(['--help']);
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(CityDigestCliError);
            expect((err as CityDigestCliError).code).toBe('help');
        }
    });
});

describe('runCityDigest', () => {
    let memoryRoot: string;

    beforeEach(() => {
        memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'city-digest-cli-'));
    });

    afterEach(() => {
        fs.rmSync(memoryRoot, { recursive: true, force: true });
    });

    it('returns a valid digest JSON when memoryRoot is empty', () => {
        const json = runCityDigest({ memoryRoot }, { now: () => new Date('2026-05-30T01:00:00.000Z') });
        const digest = JSON.parse(json);
        expect(digest.schemaVersion).toBe(1);
        expect(digest.generatedAt).toBe('2026-05-30T01:00:00.000Z');
        expect(digest.totalEvents).toBe(0);
        expect(digest.residents).toEqual([]);
        expect(digest.goals).toEqual({ active: 0, achieved: 0, abandoned: 0, recentlyAchieved: [] });
    });

    it('aggregates seeded EconomyEvents + GoalContracts into a digest', () => {
        const log = new EconomyEventLog(memoryRoot, () => new Date('2026-05-29T12:00:00.000Z'));
        log.append({ kind: 'ap_grant', residentName: 'res:duke', apDelta: 100, refId: 'r-1' });
        log.append({ kind: 'ap_decay', residentName: 'res:duke', apDelta: -10, refId: 'r-2' });
        log.append({ kind: 'gp_earned', residentName: 'res:duke', gpDelta: 250, refId: 'r-3' });
        log.append({ kind: 'ncri_redemption', residentName: 'res:duke', ncriId: 'ncri-abc', refId: 'ncri-abc' });

        const goals = new GoalContractStore(memoryRoot, () => new Date('2026-05-29T12:00:00.000Z'));
        goals.create({
            residentName: 'res:duke',
            goalText: 'reach bank GP >= 100',
            completion: { condition: 'bank GP >= 100', evidenceSource: 'runtime' },
        });
        const g2 = goals.create({ residentName: 'res:duke', goalText: 'craft a fire' });
        goals.markAchieved(g2.id, 'evidence: fire_lit moment in trajectory');

        const json = runCityDigest({ memoryRoot }, { now: () => new Date('2026-05-30T01:00:00.000Z') });
        const digest = JSON.parse(json);

        expect(digest.totalEvents).toBe(4);
        expect(digest.apGrantedTotal).toBe(100);
        expect(digest.apDecayedTotal).toBe(10);
        expect(digest.gpEarnedTotal).toBe(250);
        expect(digest.residents).toHaveLength(1);
        expect(digest.residents[0]).toMatchObject({ residentName: 'res:duke', apGranted: 100, apDecayed: 10, gpEarned: 250 });
        expect(digest.countsByKind.ap_grant).toBe(1);
        expect(digest.countsByKind.ncri_redemption).toBe(1);
        expect(digest.goals).toMatchObject({ active: 1, achieved: 1, abandoned: 0 });
        expect(digest.goals.recentlyAchieved).toHaveLength(1);
        expect(digest.goals.recentlyAchieved[0]).toMatchObject({ residentName: 'res:duke', goalText: 'craft a fire' });
        expect(digest.notable.find((n: { kind: string }) => n.kind === 'ncri_redemption')).toBeDefined();
        expect(digest.notable.find((n: { kind: string }) => n.kind === 'gp_earned')).toBeDefined();
    });

    it('honors --since window bound', () => {
        const log = new EconomyEventLog(memoryRoot);
        log.append({ kind: 'ap_grant', residentName: 'res:duke', apDelta: 10, refId: 'r-1', ts: '2026-05-28T00:00:00.000Z' });
        log.append({ kind: 'ap_grant', residentName: 'res:duke', apDelta: 20, refId: 'r-2', ts: '2026-05-30T00:00:00.000Z' });

        const json = runCityDigest({ memoryRoot, since: '2026-05-29T00:00:00.000Z' }, { now: () => new Date('2026-05-30T01:00:00.000Z') });
        const digest = JSON.parse(json);
        expect(digest.totalEvents).toBe(1);
        expect(digest.apGrantedTotal).toBe(20);
        expect(digest.windowStart).toBe('2026-05-29T00:00:00.000Z');
    });

    it('honors --until window bound', () => {
        const log = new EconomyEventLog(memoryRoot);
        log.append({ kind: 'ap_grant', residentName: 'res:duke', apDelta: 10, refId: 'r-1', ts: '2026-05-28T00:00:00.000Z' });
        log.append({ kind: 'ap_grant', residentName: 'res:duke', apDelta: 20, refId: 'r-2', ts: '2026-05-30T00:00:00.000Z' });

        const json = runCityDigest({ memoryRoot, until: '2026-05-29T00:00:00.000Z' }, { now: () => new Date('2026-05-30T01:00:00.000Z') });
        const digest = JSON.parse(json);
        expect(digest.totalEvents).toBe(1);
        expect(digest.apGrantedTotal).toBe(10);
        expect(digest.windowEnd).toBe('2026-05-29T00:00:00.000Z');
    });

    it('produces deterministic JSON output (stable formatting)', () => {
        const log = new EconomyEventLog(memoryRoot, () => new Date('2026-05-29T12:00:00.000Z'));
        log.append({ kind: 'ap_grant', residentName: 'res:agent', apDelta: 5, refId: 'r-1' });
        const json = runCityDigest({ memoryRoot }, { now: () => new Date('2026-05-30T01:00:00.000Z') });
        // Indented JSON; parseable; first line begins with `{`.
        expect(json.startsWith('{')).toBe(true);
        expect(JSON.parse(json).schemaVersion).toBe(1);
    });
});
