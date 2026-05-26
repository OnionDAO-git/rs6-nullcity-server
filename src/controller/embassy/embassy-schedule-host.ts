import path from 'path';
import { DEFAULT_EMBASSY_EVENT_SCHEDULE, type EmbassyEventSchedule, loadEmbassyEventSchedule } from './embassy-schedule';

/**
 * Process-wide embassy schedule loader (workstream EVENT-D1c-wire-host).
 *
 * The prompt-envelope builder calls {@link currentEmbassySchedule} once
 * per perception build and threads the result into
 * {@link deriveEmbassyContext}, so the embassy directive flips to
 * event-active automatically during scheduled windows. The schedule
 * file ships at {@link DEFAULT_EMBASSY_SCHEDULE_PATH} (relative to the
 * process cwd, matching where the controller is launched from); event
 * operators can override the path via the
 * {@link CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV} env var.
 *
 * The schedule is cached in memory after the first call — restart the
 * controller to pick up a new schedule file (intentional: an active
 * event window should not silently change mid-event).
 *
 * Tests use {@link resetEmbassyScheduleForTests} to clear the cache
 * between cases.
 */
export const DEFAULT_EMBASSY_SCHEDULE_PATH = 'data/controller/embassy-schedule.json';
export const CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV = 'CONTROLLER_EMBASSY_SCHEDULE_PATH';

let cached: EmbassyEventSchedule | undefined;

/**
 * Returns the embassy schedule. On first call (and after
 * {@link resetEmbassyScheduleForTests}), loads from the env-override
 * path if {@link CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV} is set, otherwise
 * from {@link DEFAULT_EMBASSY_SCHEDULE_PATH} relative to cwd. Missing
 * file or malformed JSON ⇒ {@link DEFAULT_EMBASSY_EVENT_SCHEDULE} (empty
 * windows; safe default — event flag stays false).
 */
export function currentEmbassySchedule(): EmbassyEventSchedule {
    if (cached === undefined) {
        cached = loadFromConfiguredPath();
    }
    return cached;
}

/** Test hook: drop the cached schedule so the next call re-reads. */
export function resetEmbassyScheduleForTests(): void {
    cached = undefined;
}

function loadFromConfiguredPath(): EmbassyEventSchedule {
    const envPath = process.env[CONTROLLER_EMBASSY_SCHEDULE_PATH_ENV];
    const filePath = envPath && envPath.length > 0 ? envPath : path.resolve(process.cwd(), DEFAULT_EMBASSY_SCHEDULE_PATH);
    try {
        return loadEmbassyEventSchedule(filePath);
    } catch {
        // loadEmbassyEventSchedule is already defensive; this catch is
        // just an extra guard against future regressions where the
        // loader starts throwing on edge cases. Defaulting to empty
        // keeps the eventActive flag safely false.
        return DEFAULT_EMBASSY_EVENT_SCHEDULE;
    }
}
