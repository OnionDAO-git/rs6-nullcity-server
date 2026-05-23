import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_EMBASSY_EVENT_SCHEDULE } from './embassy-schedule';
import {
    CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV,
    DEFAULT_EMBASSY_SCHEDULE_PATH,
    currentEmbassySchedule,
    resetEmbassyScheduleForTests,
} from './embassy-schedule-host';

describe('embassy-schedule-host (EVENT-D1c-wire-host)', () => {
    let tmp: string;
    const originalEnv = process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV];

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'embassy-schedule-host-'));
        delete process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV];
        resetEmbassyScheduleForTests();
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV];
        } else {
            process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV] = originalEnv;
        }
        resetEmbassyScheduleForTests();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    describe('DEFAULT_EMBASSY_SCHEDULE_PATH', () => {
        it('points to data/controller/embassy-schedule.json relative to cwd', () => {
            expect(DEFAULT_EMBASSY_SCHEDULE_PATH).toBe('data/controller/embassy-schedule.json');
        });
    });

    describe('currentEmbassySchedule (env-override path)', () => {
        it('loads from CONTROLLER_EMBASSY_SCHEDULE_PATH when set + file exists', () => {
            const file = path.join(tmp, 'sched.json');
            fs.writeFileSync(
                file,
                JSON.stringify({
                    activeWindows: [
                        { startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'Chicago' },
                    ],
                }),
            );
            process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV] = file;
            const sched = currentEmbassySchedule();
            expect(sched.activeWindows).toHaveLength(1);
            expect(sched.activeWindows[0].label).toBe('Chicago');
        });

        it('returns DEFAULT_EMBASSY_EVENT_SCHEDULE when the env path points to a missing file', () => {
            process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV] = path.join(tmp, 'missing.json');
            const sched = currentEmbassySchedule();
            expect(sched).toEqual(DEFAULT_EMBASSY_EVENT_SCHEDULE);
        });

        it('returns DEFAULT_EMBASSY_EVENT_SCHEDULE on malformed JSON (no throw)', () => {
            const file = path.join(tmp, 'bad.json');
            fs.writeFileSync(file, '{ not valid json');
            process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV] = file;
            const sched = currentEmbassySchedule();
            expect(sched).toEqual(DEFAULT_EMBASSY_EVENT_SCHEDULE);
        });
    });

    describe('caching', () => {
        it('caches the loaded schedule across calls (no re-read on second call)', () => {
            const file = path.join(tmp, 'sched.json');
            fs.writeFileSync(
                file,
                JSON.stringify({
                    activeWindows: [{ startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'v1' }],
                }),
            );
            process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV] = file;
            expect(currentEmbassySchedule().activeWindows[0].label).toBe('v1');

            // Mutate the file — cached value should NOT reflect the change.
            fs.writeFileSync(
                file,
                JSON.stringify({
                    activeWindows: [{ startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'v2' }],
                }),
            );
            expect(currentEmbassySchedule().activeWindows[0].label).toBe('v1');
        });

        it('resetEmbassyScheduleForTests() clears the cache so the next call re-reads', () => {
            const file = path.join(tmp, 'sched.json');
            fs.writeFileSync(
                file,
                JSON.stringify({
                    activeWindows: [{ startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'v1' }],
                }),
            );
            process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV] = file;
            expect(currentEmbassySchedule().activeWindows[0].label).toBe('v1');

            fs.writeFileSync(
                file,
                JSON.stringify({
                    activeWindows: [{ startsAt: '2026-06-01T18:00:00.000Z', endsAt: '2026-06-02T03:00:00.000Z', label: 'v2' }],
                }),
            );
            resetEmbassyScheduleForTests();
            expect(currentEmbassySchedule().activeWindows[0].label).toBe('v2');
        });
    });

    describe('default-path fallback', () => {
        it('returns DEFAULT_EMBASSY_EVENT_SCHEDULE when neither env nor default-path file exists', () => {
            // env unset (cleared in beforeEach). Point default away from real cwd by
            // chdir-ing into a temp directory that has no data/controller/embassy-schedule.json.
            const originalCwd = process.cwd();
            try {
                process.chdir(tmp);
                resetEmbassyScheduleForTests();
                const sched = currentEmbassySchedule();
                expect(sched).toEqual(DEFAULT_EMBASSY_EVENT_SCHEDULE);
            } finally {
                process.chdir(originalCwd);
            }
        });
    });
});
