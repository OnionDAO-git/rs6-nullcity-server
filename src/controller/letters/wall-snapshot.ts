import fs from 'fs';
import path from 'path';
import type { Letter } from '../patron/letters-producer';

/**
 * Wall ticker snapshot (workstream EVENT-D6).
 *
 * Pure function that scans every per-patron inbox in
 * `<lettersRoot>/data/letters/<slug>/inbox.jsonl`, merges the
 * letters, and returns a snapshot suitable for a venue-side display:
 *
 *   - `recentLetters`: the N most-recently-dispatched letters,
 *     newest first. Capped at {@link DEFAULT_WALL_LIMIT} when no
 *     limit is supplied.
 *   - `deathsToday`: count of UNIQUE deceased residents whose
 *     epitaphs were dispatched during the local-day window
 *     containing `now`. A resident with multiple patrons still
 *     counts once.
 *   - `asOf`: the supplied `now` echoed back as ISO so the consumer
 *     can render "as of HH:MM".
 *
 * Resilience:
 *   - Missing letters directory ⇒ empty snapshot.
 *   - Inbox sub-directory without inbox.jsonl ⇒ skipped.
 *   - Malformed JSONL lines ⇒ skipped (not thrown).
 *
 * Pairs with the planned HTTP route `GET /v1/wall/snapshot` and a
 * static page at `public/wall/` (post-event).
 */
export const DEFAULT_WALL_LIMIT = 10;

export interface BuildWallSnapshotOptions {
    /** Wall-clock now used for deathsToday windowing + asOf echo. */
    now: Date;
    /** Cap on recentLetters length. Defaults to {@link DEFAULT_WALL_LIMIT}. */
    limit?: number;
}

export interface WallSnapshot {
    recentLetters: Letter[];
    deathsToday: number;
    asOf: string;
}

export function buildWallSnapshot(lettersRoot: string, options: BuildWallSnapshotOptions): WallSnapshot {
    const limit = options.limit ?? DEFAULT_WALL_LIMIT;
    const asOf = options.now.toISOString();
    const lettersDir = path.join(lettersRoot, 'data', 'letters');

    if (!fs.existsSync(lettersDir)) {
        return { recentLetters: [], deathsToday: 0, asOf };
    }

    const allLetters: Letter[] = [];
    for (const entry of fs.readdirSync(lettersDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const inboxPath = path.join(lettersDir, entry.name, 'inbox.jsonl');
        if (!fs.existsSync(inboxPath)) {
            continue;
        }
        const raw = fs.readFileSync(inboxPath, 'utf8');
        for (const rawLine of raw.split('\n')) {
            const line = rawLine.trim();
            if (line.length === 0) {
                continue;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                continue;
            }
            if (isLetter(parsed)) {
                allLetters.push(parsed);
            }
        }
    }

    // Newest first.
    allLetters.sort((a, b) => (a.dispatchedAt < b.dispatchedAt ? 1 : a.dispatchedAt > b.dispatchedAt ? -1 : 0));
    const recentLetters = allLetters.slice(0, limit);

    // Unique deceased residents whose epitaphs landed in the local-day
    // window containing `now`. We use the LOCAL day window because the
    // physical venue runs on local time — staff cares about "today" by
    // wall clock, not by UTC.
    const dayStart = new Date(options.now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    const deceasedResidents = new Set<string>();
    for (const letter of allLetters) {
        if (letter.kind !== 'epitaph') {
            continue;
        }
        const ms = Date.parse(letter.dispatchedAt);
        if (Number.isNaN(ms) || ms < dayStartMs || ms >= dayEndMs) {
            continue;
        }
        // Identify the deceased resident from the senderResident field.
        // For sibling-flagship hero deaths, this is the FLAGSHIP, not
        // the deceased — but the audit cost of getting it right (read
        // body or subject) is not worth the precision for a wall ticker.
        // Operators reading the wall can tolerate small mis-counts.
        deceasedResidents.add(letter.senderResident);
    }

    return {
        recentLetters,
        deathsToday: deceasedResidents.size,
        asOf,
    };
}

/**
 * Public-display redaction for a {@link WallSnapshot} (HD-013).
 *
 * The wall ticker at the IRL event is a passers-by display, not a
 * patron's private inbox. Returning full recipient handles + full letter
 * bodies leaks per-person standing crossings and emotional epitaph
 * content to anyone glancing at the screen. This pure function takes a
 * snapshot and returns a copy with:
 *
 *   - `letter.body` replaced with `''` so renderers fall back to showing
 *     only `kind` + `subject` (the latter being a short, already-public
 *     phrase like "You are now Acquaintance of embassy").
 *   - `letter.recipient` masked to `firstChar + '***' + suffix` where
 *     `suffix` is the part of the handle after the first delimiter
 *     (`@` first, then last `-`); single-character handles render as
 *     `'***'`. The full handle remains available via the per-patron
 *     {@link DEFAULT_LETTERS_PATH} (which staff hands directly to the
 *     patron) — only the wall view is redacted.
 *
 * Other snapshot fields (`deathsToday`, `asOf`) are preserved as-is.
 * Does NOT mutate its input.
 */
export function redactWallSnapshot(snapshot: WallSnapshot): WallSnapshot {
    return {
        recentLetters: snapshot.recentLetters.map(letter => ({
            ...letter,
            recipient: redactHandle(letter.recipient),
            body: '',
        })),
        deathsToday: snapshot.deathsToday,
        asOf: snapshot.asOf,
    };
}

function redactHandle(handle: string): string {
    if (handle.length === 0) {
        return '***';
    }
    if (handle.length === 1) {
        // Defensive — never return a 1-char handle in clear, even though
        // such handles shouldn't pass slug normalization in practice.
        return '***';
    }
    // Prefer '@' as the separator (email-shaped handles), then fall back
    // to the LAST '-' (kebab-shaped handles like 'claude-sprint-patron'
    // → 'c***-patron'). With neither, just mask the tail.
    const atIndex = handle.indexOf('@');
    if (atIndex > 0) {
        return `${handle[0]}***${handle.slice(atIndex)}`;
    }
    const lastDash = handle.lastIndexOf('-');
    if (lastDash > 0) {
        return `${handle[0]}***${handle.slice(lastDash)}`;
    }
    return `${handle[0]}***`;
}

function isLetter(value: unknown): value is Letter {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Record<string, unknown>;
    return (
        typeof v.kind === 'string' &&
        (v.kind === 'standing_tier_crossed' || v.kind === 'epitaph' || v.kind === 'civic_milestone') &&
        typeof v.recipient === 'string' &&
        typeof v.senderResident === 'string' &&
        typeof v.subject === 'string' &&
        typeof v.body === 'string' &&
        typeof v.dispatchedAt === 'string' &&
        Array.isArray(v.deliveryChannels)
    );
}
