import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    DEFAULT_EMBASSY_EVENT_SCHEDULE,
    type EmbassyEventSchedule,
    isEmbassyEventActiveAt,
    loadEmbassyEventSchedule,
    nextEmbassyEventStartAfter,
} from './embassy-schedule';

const at = (iso: string) => new Date(iso);

describe('isEmbassyEventActiveAt', () => {
    const schedule: EmbassyEventSchedule = {
        activeWindows: [
            { startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'OnionDAO Chicago 2026' },
            { startsAt: '2026-07-04T17:00:00.000Z', endsAt: '2026-07-04T23:00:00.000Z', label: 'Independence Day garden party' },
        ],
    };

    it('returns false before any window starts', () => {
        expect(isEmbassyEventActiveAt(schedule, at('2026-05-23T12:00:00.000Z'))).toBe(false);
    });

    it('returns true when now is inside a window (half-open: start inclusive)', () => {
        expect(isEmbassyEventActiveAt(schedule, at('2026-06-01T18:00:00.000Z'))).toBe(true);
        expect(isEmbassyEventActiveAt(schedule, at('2026-06-01T22:30:00.000Z'))).toBe(true);
    });

    it('returns false at the exact endsAt boundary (half-open: end exclusive)', () => {
        expect(isEmbassyEventActiveAt(schedule, at('2026-06-02T03:00:00.000Z'))).toBe(false);
    });

    it('returns true within a second, non-overlapping window', () => {
        expect(isEmbassyEventActiveAt(schedule, at('2026-07-04T20:00:00.000Z'))).toBe(true);
    });

    it('returns false in the gap between windows', () => {
        expect(isEmbassyEventActiveAt(schedule, at('2026-06-15T12:00:00.000Z'))).toBe(false);
    });

    it('returns false for an empty schedule', () => {
        expect(isEmbassyEventActiveAt({ activeWindows: [] }, at('2026-06-01T20:00:00.000Z'))).toBe(false);
    });

    it('returns false defensively when a window has startsAt >= endsAt (skips malformed windows)', () => {
        const bogus: EmbassyEventSchedule = {
            activeWindows: [
                { startsAt: '2026-06-01T20:00:00.000Z', endsAt: '2026-06-01T18:00:00.000Z', label: 'inverted' },
            ],
        };
        expect(isEmbassyEventActiveAt(bogus, at('2026-06-01T19:00:00.000Z'))).toBe(false);
    });
});

describe('nextEmbassyEventStartAfter', () => {
    const schedule: EmbassyEventSchedule = {
        activeWindows: [
            { startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'A' },
            { startsAt: '2026-07-04T17:00:00.000Z', endsAt: '2026-07-04T23:00:00.000Z', label: 'B' },
        ],
    };

    it('returns the earliest window starting strictly after now', () => {
        const next = nextEmbassyEventStartAfter(schedule, at('2026-05-23T12:00:00.000Z'));
        expect(next?.label).toBe('A');
        expect(next?.startsAt).toBe('2026-06-01T18:00:00.000Z');
    });

    it('skips past windows whose start has elapsed and returns the next one', () => {
        const next = nextEmbassyEventStartAfter(schedule, at('2026-06-03T00:00:00.000Z'));
        expect(next?.label).toBe('B');
    });

    it('returns null when no future window exists', () => {
        expect(nextEmbassyEventStartAfter(schedule, at('2030-01-01T00:00:00.000Z'))).toBeNull();
    });

    it('returns null for an empty schedule', () => {
        expect(nextEmbassyEventStartAfter({ activeWindows: [] }, at('2026-05-23T12:00:00.000Z'))).toBeNull();
    });

    it('ignores inverted (malformed) windows when picking the next future start', () => {
        const sched: EmbassyEventSchedule = {
            activeWindows: [
                { startsAt: '2026-06-10T20:00:00.000Z', endsAt: '2026-06-09T20:00:00.000Z', label: 'inverted' },
                { startsAt: '2026-06-15T17:00:00.000Z', endsAt: '2026-06-15T23:00:00.000Z', label: 'good' },
            ],
        };
        expect(nextEmbassyEventStartAfter(sched, at('2026-06-01T00:00:00.000Z'))?.label).toBe('good');
    });
});

describe('loadEmbassyEventSchedule', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'embassy-schedule-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('returns DEFAULT_EMBASSY_EVENT_SCHEDULE when the file does not exist', () => {
        const sched = loadEmbassyEventSchedule(path.join(tmp, 'missing.json'));
        expect(sched).toEqual(DEFAULT_EMBASSY_EVENT_SCHEDULE);
    });

    it('returns DEFAULT_EMBASSY_EVENT_SCHEDULE when JSON is malformed (no throw)', () => {
        const file = path.join(tmp, 'bad.json');
        fs.writeFileSync(file, '{ not valid json');
        const sched = loadEmbassyEventSchedule(file);
        expect(sched).toEqual(DEFAULT_EMBASSY_EVENT_SCHEDULE);
    });

    it('parses a valid schedule file and returns the windows', () => {
        const file = path.join(tmp, 'good.json');
        fs.writeFileSync(
            file,
            JSON.stringify({
                activeWindows: [
                    { startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'Chicago' },
                ],
            }),
        );
        const sched = loadEmbassyEventSchedule(file);
        expect(sched.activeWindows).toHaveLength(1);
        expect(sched.activeWindows[0]).toMatchObject({ label: 'Chicago' });
    });

    it('returns DEFAULT_EMBASSY_EVENT_SCHEDULE when the JSON is valid but the shape is wrong', () => {
        const file = path.join(tmp, 'wrong-shape.json');
        fs.writeFileSync(file, JSON.stringify({ activeWindows: 'not-an-array' }));
        const sched = loadEmbassyEventSchedule(file);
        expect(sched).toEqual(DEFAULT_EMBASSY_EVENT_SCHEDULE);
    });

    it('drops windows whose individual fields are missing or wrong type, keeping the rest', () => {
        const file = path.join(tmp, 'mixed.json');
        fs.writeFileSync(
            file,
            JSON.stringify({
                activeWindows: [
                    { startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'good' },
                    { startsAt: 12345, endsAt: '2026-06-02T03:00:00.000Z', label: 'bad-start-type' },
                    { startsAt: '2026-06-01T18:00:00.000Z', label: 'missing-end' },
                    { startsAt: 'not-a-date', endsAt: '2026-06-02T03:00:00.000Z', label: 'bad-date' },
                ],
            }),
        );
        const sched = loadEmbassyEventSchedule(file);
        expect(sched.activeWindows).toHaveLength(1);
        expect(sched.activeWindows[0].label).toBe('good');
    });
});

describe('DEFAULT_EMBASSY_EVENT_SCHEDULE', () => {
    it('is empty by default — event-day staff configure explicit windows', () => {
        expect(DEFAULT_EMBASSY_EVENT_SCHEDULE.activeWindows).toEqual([]);
    });
});
