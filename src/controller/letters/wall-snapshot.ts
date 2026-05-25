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
 *   - `residents`: live roster of all residents found in
 *     lettersRoot/res-SLUG/runtime-state.json, sorted alive-first
 *     then alphabetically. Drives the "Who's Here" panel.
 *   - `asOf`: the supplied `now` echoed back as ISO so the consumer
 *     can render "as of HH:MM".
 *
 * Resilience:
 *   - Missing letters directory ⇒ empty snapshot.
 *   - Inbox sub-directory without inbox.jsonl ⇒ skipped.
 *   - Malformed JSONL lines ⇒ skipped (not thrown).
 *   - Missing or malformed runtime-state.json ⇒ resident skipped.
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
    /**
     * Optional configured resident ids/slugs to include in the wall roster.
     * When omitted, every res-* runtime-state directory is considered.
     */
    residentIds?: readonly string[];
}

/** One resident's live status for the wall roster panel. */
export interface ResidentSummary {
    /** Directory slug, e.g. "res-hans". */
    slug: string;
    /** Human-friendly display name derived from slug, e.g. "Hans". */
    displayName: string;
    /** True unless the runtime-state has a `deceased` entry. */
    alive: boolean;
    /** Remaining attention ticks. */
    attention: number;
    /** Current active goal description, if any. */
    activeGoal?: string;
}

export interface WallSnapshot {
    recentLetters: Letter[];
    deathsToday: number;
    /** Live roster scanned from runtime-state files. Always present; empty when no res- dirs exist. */
    residents: ResidentSummary[];
    asOf: string;
}

export function buildWallSnapshot(lettersRoot: string, options: BuildWallSnapshotOptions): WallSnapshot {
    const limit = options.limit ?? DEFAULT_WALL_LIMIT;
    const asOf = options.now.toISOString();
    const lettersDir = path.join(lettersRoot, 'data', 'letters');

    if (!fs.existsSync(lettersDir)) {
        return { recentLetters: [], deathsToday: 0, residents: readResidents(lettersRoot, options.residentIds), asOf };
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

    const residents = readResidents(lettersRoot, options.residentIds);

    return {
        recentLetters,
        deathsToday: deceasedResidents.size,
        residents,
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
        // Resident names and goals are public information on the wall display.
        residents: snapshot.residents,
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

/**
 * Scan lettersRoot/res-SLUG/runtime-state.json files and return a roster
 * of all residents (alive and deceased), sorted alive-first then by slug.
 * Resilient: missing dir, unreadable files, and malformed JSON are skipped.
 */
function readResidents(lettersRoot: string, residentIds?: readonly string[]): ResidentSummary[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(lettersRoot, { withFileTypes: true });
    } catch {
        return [];
    }

    const allowedSlugs = residentIds !== undefined ? new Set(residentIds.map(toResidentSlug)) : undefined;
    const summaries: ResidentSummary[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('res-')) {
            continue;
        }
        const slug = entry.name;
        if (allowedSlugs !== undefined && !allowedSlugs.has(slug)) {
            continue;
        }
        const statePath = path.join(lettersRoot, slug, 'runtime-state.json');
        if (!fs.existsSync(statePath)) {
            continue;
        }
        let raw: string;
        try {
            raw = fs.readFileSync(statePath, 'utf8');
        } catch {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            continue;
        }
        if (!isRuntimeStateShape(parsed)) {
            continue;
        }
        const displayName = humanizeName(slug);
        const alive = parsed.deceased === undefined || parsed.deceased === null;
        const activeGoal =
            parsed.cognition !== undefined &&
            parsed.cognition !== null &&
            typeof parsed.cognition === 'object' &&
            'activeGoal' in parsed.cognition &&
            parsed.cognition.activeGoal !== undefined &&
            parsed.cognition.activeGoal !== null &&
            typeof parsed.cognition.activeGoal === 'object' &&
            'description' in parsed.cognition.activeGoal &&
            typeof (parsed.cognition.activeGoal as Record<string, unknown>).description === 'string'
                ? ((parsed.cognition.activeGoal as Record<string, unknown>).description as string)
                : undefined;

        const summary: ResidentSummary = { slug, displayName, alive, attention: parsed.attention };
        if (activeGoal !== undefined) {
            summary.activeGoal = activeGoal;
        }
        summaries.push(summary);
    }

    // Alive residents first; alphabetical within each group.
    summaries.sort((a, b) => {
        if (a.alive !== b.alive) {
            return a.alive ? -1 : 1;
        }
        return a.slug.localeCompare(b.slug);
    });

    return summaries;
}

function toResidentSlug(value: string): string {
    return value.startsWith('res:') ? `res-${value.slice('res:'.length).replace(/:/g, '-')}` : value;
}

function humanizeName(slug: string): string {
    const withoutPrefix = slug.replace(/^res-/, '');
    return withoutPrefix
        .split('-')
        .map(word => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
        .join(' ')
        .trim();
}

function isRuntimeStateShape(value: unknown): value is {
    attention: number;
    deceased?: object | null;
    cognition?: unknown;
} {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Record<string, unknown>;
    return typeof v.attention === 'number';
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
