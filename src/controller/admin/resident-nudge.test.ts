import fs from 'fs';
import os from 'os';
import path from 'path';
import { nudgeResident, parseNudgeCliArgs } from './resident-nudge';

describe('parseNudgeCliArgs', () => {
    it('parses --resident and --text flags', () => {
        const opts = parseNudgeCliArgs(['--resident', 'res:hans', '--text', 'try fishing near the bridge']);
        expect(opts.residentName).toBe('res:hans');
        expect(opts.text).toBe('try fishing near the bridge');
        expect(opts.configPath).toBe('controller.yml');
    });

    it('parses = forms', () => {
        const opts = parseNudgeCliArgs(['--resident=qa-woodcutter', '--text=focus on woodcutting today']);
        expect(opts.residentName).toBe('qa-woodcutter');
        expect(opts.text).toBe('focus on woodcutting today');
    });

    it('parses --config flag', () => {
        const opts = parseNudgeCliArgs(['--resident=r', '--text=t', '--config', '/tmp/c.yml']);
        expect(opts.configPath).toBe('/tmp/c.yml');
    });

    it('throws on unknown flag', () => {
        expect(() => parseNudgeCliArgs(['--resident=r', '--text=t', '--unknown'])).toThrow('Unknown argument: --unknown');
    });

    it('throws when --resident is missing', () => {
        expect(() => parseNudgeCliArgs(['--text=t'])).toThrow('--resident <name> is required');
    });

    it('throws when --text is missing', () => {
        expect(() => parseNudgeCliArgs(['--resident=r'])).toThrow('--text <nudge> is required');
    });

    it('throws when --resident has no value', () => {
        expect(() => parseNudgeCliArgs(['--resident'])).toThrow('--resident requires a value');
    });
});

describe('nudgeResident', () => {
    let tempDir: string;
    let memoryDir: string;
    const fixedNow = new Date('2026-05-31T14:00:00.000Z');

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-nudge-test-'));
        memoryDir = path.join(tempDir, 'memory');
        fs.mkdirSync(memoryDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function readTimeline(residentName: string): Array<Record<string, unknown>> {
        const slug = residentName.replace(/^res:/, 'res-');
        const p = path.join(memoryDir, 'library', slug, 'timeline.jsonl');
        if (!fs.existsSync(p)) return [];
        return fs
            .readFileSync(p, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as Record<string, unknown>);
    }

    it('writes an orientation_nudge timeline event with correct fields', () => {
        const result = nudgeResident({
            residentName: 'res:hans',
            text: 'focus on fishing near the riverside',
            memoryDir,
            tick: 42,
            now: () => fixedNow,
        });

        expect(result.residentName).toBe('res:hans');
        expect(result.text).toBe('focus on fishing near the riverside');
        expect(result.ts).toBe('2026-05-31T14:00:00.000Z');
        expect(result.tick).toBe(42);

        const events = readTimeline('res:hans');
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe('orientation_nudge');
        expect(events[0].text).toBe('focus on fishing near the riverside');
        expect(events[0].ts).toBe('2026-05-31T14:00:00.000Z');
        expect(events[0].tick).toBe(42);
        expect(events[0].sessionId).toBe('external');
        expect(events[0].significanceReasons).toEqual(['orientation:nudge']);
    });

    it('normalizes resident name without res: prefix', () => {
        const result = nudgeResident({
            residentName: 'hans',
            text: 'visit the bank',
            memoryDir,
            now: () => fixedNow,
        });
        expect(result.residentName).toBe('res:hans');
        const events = readTimeline('res:hans');
        expect(events).toHaveLength(1);
    });

    it('trims whitespace from nudge text', () => {
        const result = nudgeResident({
            residentName: 'res:pip',
            text: '  visit the furnace  ',
            memoryDir,
            now: () => fixedNow,
        });
        expect(result.text).toBe('visit the furnace');
        const events = readTimeline('res:pip');
        expect(events[0].text).toBe('visit the furnace');
    });

    it('defaults tick to 0 when not provided', () => {
        nudgeResident({ residentName: 'res:pip', text: 'go fish', memoryDir, now: () => fixedNow });
        const events = readTimeline('res:pip');
        expect(events[0].tick).toBe(0);
    });

    it('throws when text is empty', () => {
        expect(() => nudgeResident({ residentName: 'res:hans', text: '', memoryDir, now: () => fixedNow })).toThrow(
            'nudge text must be non-empty',
        );
    });

    it('throws when text is only whitespace', () => {
        expect(() => nudgeResident({ residentName: 'res:hans', text: '   ', memoryDir, now: () => fixedNow })).toThrow(
            'nudge text must be non-empty',
        );
    });

    it('throws when residentName is empty', () => {
        expect(() => nudgeResident({ residentName: '', text: 'some text', memoryDir, now: () => fixedNow })).toThrow(
            'residentName is required',
        );
    });

    it('appends multiple nudges to the same timeline', () => {
        nudgeResident({ residentName: 'res:hans', text: 'nudge one', memoryDir, tick: 1, now: () => fixedNow });
        nudgeResident({ residentName: 'res:hans', text: 'nudge two', memoryDir, tick: 2, now: () => fixedNow });
        const events = readTimeline('res:hans');
        expect(events).toHaveLength(2);
        expect(events[0].text).toBe('nudge one');
        expect(events[1].text).toBe('nudge two');
    });
});
