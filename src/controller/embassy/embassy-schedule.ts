import fs from 'fs';

/**
 * Embassy event-day schedule (workstream N-α-3).
 *
 * The N spec describes an `eventActive` boolean attached to perception so
 * the Brain knows when real humans are visiting and adjusts its civic
 * greeting behavior accordingly (see {@link buildPromptEnvelope}'s
 * `embassy` section, N-α-2). This module is the upstream substrate that
 * tells the runtime *when* to flip the flag based on a pre-configured
 * schedule (e.g. OnionDAO Chicago 2026-06-01 18:00–02:00 UTC).
 *
 * Schedule shape is intentionally minimal: a list of half-open
 * `[startsAt, endsAt)` windows with human-readable labels. Loaded from a
 * JSON file via {@link loadEmbassyEventSchedule}; missing/malformed files
 * fall back to {@link DEFAULT_EMBASSY_EVENT_SCHEDULE} (empty — eventActive
 * never trips unless an operator writes the file).
 *
 * Pure substrate. The runtime-perception wiring slice (later, when the
 * resident-runtime soft-lock clears) calls {@link isEmbassyEventActiveAt}
 * each tick and OR-merges the result into perception.embassyEventActive.
 */
export interface EmbassyEventWindow {
    /** ISO timestamp at-or-after which the event is active. Half-open: inclusive. */
    startsAt: string;
    /** ISO timestamp at which the event becomes inactive. Half-open: exclusive. */
    endsAt: string;
    /** Human-readable label, surfaced in dashboards + logs. */
    label: string;
}

export interface EmbassyEventSchedule {
    activeWindows: EmbassyEventWindow[];
}

/** Default = no scheduled events. Operators add windows by writing the config file. */
export const DEFAULT_EMBASSY_EVENT_SCHEDULE: EmbassyEventSchedule = {
    activeWindows: [],
};

/**
 * True when `now` falls inside any non-malformed window of the schedule.
 * Windows with startsAt >= endsAt are silently skipped (defensive).
 */
export function isEmbassyEventActiveAt(schedule: EmbassyEventSchedule, now: Date): boolean {
    const nowMs = now.getTime();
    for (const window of schedule.activeWindows) {
        const start = Date.parse(window.startsAt);
        const end = Date.parse(window.endsAt);
        if (Number.isNaN(start) || Number.isNaN(end)) {
            continue;
        }
        if (start >= end) {
            continue;
        }
        if (nowMs >= start && nowMs < end) {
            return true;
        }
    }
    return false;
}

/**
 * Returns the earliest window with `startsAt > now`, or `null` if none.
 * Useful for dashboards that surface "next event in X hours". Malformed
 * windows are skipped.
 */
export function nextEmbassyEventStartAfter(schedule: EmbassyEventSchedule, now: Date): EmbassyEventWindow | null {
    const nowMs = now.getTime();
    let best: EmbassyEventWindow | null = null;
    let bestMs = Number.POSITIVE_INFINITY;
    for (const window of schedule.activeWindows) {
        const start = Date.parse(window.startsAt);
        const end = Date.parse(window.endsAt);
        if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
            continue;
        }
        if (start > nowMs && start < bestMs) {
            best = window;
            bestMs = start;
        }
    }
    return best;
}

/**
 * Load an embassy event schedule from a JSON file. Returns
 * {@link DEFAULT_EMBASSY_EVENT_SCHEDULE} on:
 *   - file does not exist
 *   - JSON parse error
 *   - wrong top-level shape (activeWindows missing or not an array)
 *
 * Per-window field validation: drops individual windows that lack
 * string `startsAt`/`endsAt`/`label`, or whose dates fail Date.parse.
 * Other valid windows in the same file are preserved.
 */
export function loadEmbassyEventSchedule(filePath: string): EmbassyEventSchedule {
    if (!fs.existsSync(filePath)) {
        return DEFAULT_EMBASSY_EVENT_SCHEDULE;
    }
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return DEFAULT_EMBASSY_EVENT_SCHEDULE;
    }
    if (!raw || typeof raw !== 'object') {
        return DEFAULT_EMBASSY_EVENT_SCHEDULE;
    }
    const candidate = (raw as { activeWindows?: unknown }).activeWindows;
    if (!Array.isArray(candidate)) {
        return DEFAULT_EMBASSY_EVENT_SCHEDULE;
    }
    const cleanWindows: EmbassyEventWindow[] = [];
    for (const entry of candidate) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const w = entry as Record<string, unknown>;
        if (typeof w.startsAt !== 'string' || typeof w.endsAt !== 'string' || typeof w.label !== 'string') {
            continue;
        }
        if (Number.isNaN(Date.parse(w.startsAt)) || Number.isNaN(Date.parse(w.endsAt))) {
            continue;
        }
        cleanWindows.push({ startsAt: w.startsAt, endsAt: w.endsAt, label: w.label });
    }
    return { activeWindows: cleanWindows };
}
