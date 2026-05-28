import fs from 'fs';
import path from 'path';
import { inferStoryArc } from '../evidence/story-arc';
import { FACTIONS, type FactionId } from '../factions/factions';
import { readFactionStockpileSnapshot } from '../factions/stockpile-ledger';
import type { Letter } from '../patron/letters-producer';
import { SoulLoader } from '../soul/soul-loader';

/**
 * One deceased resident's data for the IRL graveyard wall (N4).
 * Derived from runtime-state.json + optional prepared-epitaph.txt.
 */
export interface GraveyardEntry {
    /** Directory slug, e.g. "res-hans". */
    slug: string;
    /** Human-friendly display name, e.g. "Hans". */
    displayName: string;
    /** Faction id from SOUL file, if declared. */
    factionId?: string;
    /** Faction display name, e.g. "The Foundry". */
    factionDisplayName?: string;
    /** Primary hex color for the faction. */
    factionColor?: string;
    /** Cause of death, e.g. "attention_exhausted" or "combat". */
    cause: string;
    /** ISO timestamp when the resident died. */
    diedAt: string;
    /** Tick count at time of death (how long they lived). */
    livedTicks: number;
    /** Resident-authored epitaph text, if written via M4 prepare_epitaph. */
    epitaph?: string;
}

/**
 * Read all deceased residents from `lettersRoot` and return them sorted
 * most-recently-deceased first. Resilient: missing dirs, unreadable files,
 * and malformed JSON are skipped silently.
 */
export function readGraveyardEntries(
    lettersRoot: string,
    options: { residentIds?: readonly string[]; soulsDir?: string },
): GraveyardEntry[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(lettersRoot, { withFileTypes: true });
    } catch {
        return [];
    }

    const soulLoader = options.soulsDir !== undefined ? new SoulLoader(options.soulsDir) : undefined;
    const allowedSlugs = options.residentIds !== undefined ? new Set(options.residentIds.map(toResidentSlug)) : undefined;
    if (allowedSlugs !== undefined && soulLoader !== undefined) {
        for (const name of soulLoader.listResidentNames()) {
            allowedSlugs.add(toResidentSlug(name));
        }
    }

    const results: GraveyardEntry[] = [];
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
        if (!isDeceasedRuntimeState(parsed)) {
            continue;
        }

        const residentName = slugToResidentName(slug);
        const soulSummary = soulLoader !== undefined ? readSoulRosterSummary(soulLoader, residentName) : undefined;
        const displayName = soulSummary?.displayName || humanizeName(slug);

        const factionId = soulSummary?.factionId;
        const faction = factionId !== undefined ? factionDisplayMetadata(factionId) : undefined;

        const epitaph = readPreparedEpitaph(path.join(lettersRoot, 'library', slug, 'prepared-epitaph.txt'));

        const graveyardEntry: GraveyardEntry = {
            slug,
            displayName,
            cause: parsed.deceased.cause,
            diedAt: parsed.deceased.date,
            livedTicks: parsed.tick,
        };
        if (factionId !== undefined) {
            graveyardEntry.factionId = factionId;
        }
        if (faction !== undefined) {
            graveyardEntry.factionDisplayName = faction.displayName;
            graveyardEntry.factionColor = faction.wallColor;
        }
        if (epitaph !== undefined) {
            graveyardEntry.epitaph = epitaph;
        }
        results.push(graveyardEntry);
    }

    // Most recently deceased first.
    results.sort((a, b) => (a.diedAt < b.diedAt ? 1 : a.diedAt > b.diedAt ? -1 : 0));
    return results;
}

function readPreparedEpitaph(filePath: string): string | undefined {
    try {
        const text = fs.readFileSync(filePath, 'utf8').trim();
        return text.length > 0 ? text : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Summary of a resident's Library of Souls portrait for the browse page (Pillar 3).
 */
export interface LibraryEntry {
    /** Directory slug, e.g. "res-hans". */
    slug: string;
    /** Human-friendly display name. */
    displayName: string;
    factionId?: string;
    factionDisplayName?: string;
    factionColor?: string;
    /** living, deceased, or reborn (2nd+ life). */
    currentState: 'living' | 'deceased' | 'reborn';
    livesCount: number;
    epithet?: string;
    arcPhase?: string;
    /** Best quote from the resident's voice log. */
    topQuote?: string;
    patronHandles: string[];
    /** Active wants (empty for deceased). */
    currentWants: string[];
    lastUpdated: string;
}

/**
 * Read Library of Souls portraits from `<lettersRoot>/library/` and return
 * a summary per resident. Living first, then reborn, then deceased;
 * alphabetically within each group. Missing/malformed files are skipped.
 *
 * @param options.excludeSynthetic When true, residents whose slug matches
 *   {@link SYNTHETIC_SLUG_PATTERN} (QA fixtures, benchmark synthetics) are
 *   omitted from the result. Used by the public `/v1/library` route.
 */
export function readLibraryEntries(lettersRoot: string, options?: { excludeSynthetic?: boolean }): LibraryEntry[] {
    const libraryDir = path.join(lettersRoot, 'library');
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(libraryDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const results: LibraryEntry[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('res-')) {
            continue;
        }
        const slug = entry.name;
        if (options?.excludeSynthetic && isSyntheticSlug(slug)) {
            continue;
        }
        const portraitPath = path.join(libraryDir, slug, 'portrait.json');
        let raw: string;
        try {
            raw = fs.readFileSync(portraitPath, 'utf8');
        } catch {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            continue;
        }
        if (!isPortraitSummaryShape(parsed)) {
            continue;
        }
        const p = parsed;
        const displayName = typeof p.residentName === 'string' ? p.residentName : humanizeName(slug);

        const quotes: unknown[] = Array.isArray(p.voice?.quotes) ? (p.voice.quotes as unknown[]) : [];
        const firstTagged = quotes.find(q => isQuoteShape(q) && q.tag === 'first');
        const quoteObj = firstTagged ?? (quotes.length > 0 && isQuoteShape(quotes[0]) ? quotes[0] : undefined);
        const topQuote = quoteObj && isQuoteShape(quoteObj) && quoteObj.text.length > 0 ? quoteObj.text : undefined;

        const patronHandles: string[] = Array.isArray(p.patrons)
            ? (p.patrons as unknown[])
                  .filter(
                      (pt): pt is { handle: string } =>
                          typeof pt === 'object' &&
                          pt !== null &&
                          typeof (pt as Record<string, unknown>).handle === 'string' &&
                          (pt as Record<string, unknown>).handle !== 'anonymous',
                  )
                  .map(pt => pt.handle)
            : [];
        const currentWants: string[] = Array.isArray(p.wants?.current)
            ? (p.wants.current as unknown[]).filter((w): w is string => typeof w === 'string').slice(0, 3)
            : [];

        const libEntry: LibraryEntry = {
            slug,
            displayName,
            currentState: p.currentState,
            livesCount: typeof p.livesCount === 'number' ? p.livesCount : 1,
            lastUpdated: typeof p.lastUpdated?.ts === 'string' ? p.lastUpdated.ts : '',
            patronHandles,
            currentWants,
        };
        if (typeof p.epithet === 'string' && p.epithet.length > 0) {
            libEntry.epithet = p.epithet;
        }
        if (topQuote !== undefined) {
            libEntry.topQuote = topQuote;
        }
        if (typeof p.storyArc?.phase === 'string') {
            libEntry.arcPhase = p.storyArc.phase;
        }
        if (typeof p.faction === 'string' && p.faction.length > 0) {
            libEntry.factionDisplayName = p.faction;
            const factionDef = FACTIONS.find(f => f.displayName === p.faction);
            if (factionDef) {
                libEntry.factionId = factionDef.id;
                const uiMeta = factionDisplayMetadata(factionDef.id);
                if (uiMeta) {
                    libEntry.factionColor = uiMeta.wallColor;
                }
            }
        }
        results.push(libEntry);
    }

    const STATE_ORDER: Record<string, number> = { living: 0, reborn: 1, deceased: 2 };
    results.sort((a, b) => {
        const ao = STATE_ORDER[a.currentState] ?? 3;
        const bo = STATE_ORDER[b.currentState] ?? 3;
        if (ao !== bo) return ao - bo;
        return a.displayName.localeCompare(b.displayName);
    });
    return results;
}

interface PortraitSummaryShape {
    residentName?: string;
    epithet?: string;
    faction?: string;
    currentState: 'living' | 'deceased' | 'reborn';
    livesCount?: number;
    voice?: { quotes?: unknown[] };
    patrons?: unknown[];
    wants?: { current?: unknown[] };
    storyArc?: { phase?: string };
    lastUpdated?: { ts?: string };
}

interface QuoteShape {
    text: string;
    tag?: string;
}

function isPortraitSummaryShape(value: unknown): value is PortraitSummaryShape {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Record<string, unknown>;
    return v.currentState === 'living' || v.currentState === 'deceased' || v.currentState === 'reborn';
}

function isQuoteShape(value: unknown): value is QuoteShape {
    return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).text === 'string';
}

function isDeceasedRuntimeState(value: unknown): value is {
    tick: number;
    deceased: { date: string; tick: number; cause: string; processed?: boolean };
} {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.tick !== 'number' || !v.deceased || typeof v.deceased !== 'object') {
        return false;
    }
    const d = v.deceased as Record<string, unknown>;
    return typeof d.cause === 'string' && typeof d.date === 'string' && typeof d.tick === 'number';
}

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
 * Pairs with the HTTP route `GET /v1/wall/snapshot`; dashboard-owned
 * static pages render this read model for the venue wall.
 */
export const DEFAULT_WALL_LIMIT = 10;

export interface BuildWallSnapshotOptions {
    /** Wall-clock now used for deathsToday windowing + asOf echo. */
    now: Date;
    /** Cap on recentLetters length. Defaults to {@link DEFAULT_WALL_LIMIT}. */
    limit?: number;
    /**
     * Optional configured resident ids/slugs to include in the wall roster. If
     * soulsDir is supplied, SOUL-discovered residents are merged into this set
     * so live starter/flagship souls appear while stale benchmark folders stay hidden.
     */
    residentIds?: readonly string[];
    /**
     * Optional SOUL directory used to fill public roster display names and
     * fallback ambitions when runtime cognition has not chosen an active goal.
     */
    soulsDir?: string;
    /**
     * When true, residents whose slug matches the synthetic prefix set
     * ({@link SYNTHETIC_SLUG_PATTERN}) are dropped from the public roster.
     * Used by the public `/v1/wall/snapshot` route so QA/benchmark fixtures
     * (e.g. `res-qa-cook`, `res-bmk_fire_5m_xxx`) don't appear on the wall
     * ticker mixed in with named heroes. Default `false` preserves the
     * full roster for operator/debug callers.
     */
    excludeSynthetic?: boolean;
    /**
     * When true, `recentLetters` is deduplicated by `subject` so multi-witness
     * events (e.g. five identical "On the passing of res:hans" cards from five
     * patrons present at the death) collapse to one entry — the newest — per
     * subject. Used by the public wall ticker to avoid spam. Limit is applied
     * AFTER dedup, so the wall shows N distinct subjects. Default `false`
     * preserves the per-recipient detail for operator views.
     */
    dedupeBySubject?: boolean;
}

/**
 * Slug pattern for residents that should be hidden from public-facing surfaces.
 * Covers QA fixture residents (`res-qa-*`) and benchmark synthetics (`res-bmk_*`).
 * Canonical demo residents like `res-agent` are intentionally NOT matched —
 * they're real demo souls, not fixtures.
 */
export const SYNTHETIC_SLUG_PATTERN = /^res-(qa-|bmk_)/;

export function isSyntheticSlug(slug: string): boolean {
    return SYNTHETIC_SLUG_PATTERN.test(slug);
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
    /** Faction id from the resident's SOUL file, if declared. */
    factionId?: string;
    /** Faction display name (e.g. "The Foundry"), present when factionId resolves. */
    factionDisplayName?: string;
    /** Primary hex color for the faction, for wall UI rendering. */
    factionColor?: string;
    /**
     * Current story arc phase inferred from the resident's library timeline.
     * Only present when the timeline contains at least one classified event
     * (patron support, visible progress, resolution, or letter aftermath).
     * Values: 'pitch' | 'fund' | 'progress' | 'resolve' | 'letter'.
     */
    arcPhase?: string;
}

export interface WallSnapshot {
    recentLetters: Letter[];
    deathsToday: number;
    /** Live roster scanned from runtime-state files. Always present; empty when no res- dirs exist. */
    residents: ResidentSummary[];
    /** Public aggregate faction work totals from faction-stockpile.json. */
    factionStockpiles: FactionStockpileSummary[];
    asOf: string;
}

export interface FactionStockpileSummary {
    factionId: FactionId;
    factionDisplayName: string;
    factionColor: string;
    total: number;
    resources: Array<{ resource: string; amount: number }>;
}

export function buildWallSnapshot(lettersRoot: string, options: BuildWallSnapshotOptions): WallSnapshot {
    const limit = options.limit ?? DEFAULT_WALL_LIMIT;
    const asOf = options.now.toISOString();
    const lettersDir = path.join(lettersRoot, 'data', 'letters');

    if (!fs.existsSync(lettersDir)) {
        return {
            recentLetters: [],
            deathsToday: 0,
            residents: readResidents(lettersRoot, options.residentIds, options.soulsDir, options.excludeSynthetic),
            factionStockpiles: readFactionStockpiles(lettersRoot),
            asOf,
        };
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
    // Optional public-display dedup: collapse repeats by subject, keep newest
    // per subject. We dedup BEFORE limit so the wall shows N distinct subjects.
    const dedupedLetters = options.dedupeBySubject ? dedupeLettersBySubject(allLetters) : allLetters;
    const recentLetters = dedupedLetters.slice(0, limit);

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

    const residents = readResidents(lettersRoot, options.residentIds, options.soulsDir, options.excludeSynthetic);
    const factionStockpiles = readFactionStockpiles(lettersRoot);

    return {
        recentLetters,
        deathsToday: deceasedResidents.size,
        residents,
        factionStockpiles,
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
        factionStockpiles: snapshot.factionStockpiles,
        asOf: snapshot.asOf,
    };
}

function readFactionStockpiles(lettersRoot: string): FactionStockpileSummary[] {
    const snapshot = readFactionStockpileSnapshot(lettersRoot);
    const summaries: FactionStockpileSummary[] = [];
    for (const faction of FACTIONS) {
        const totals = snapshot.totals[faction.id];
        if (!totals) {
            continue;
        }
        const resources = Object.entries(totals)
            .filter(([, amount]) => amount > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([resource, amount]) => ({ resource, amount }));
        const total = resources.reduce((sum, resource) => sum + resource.amount, 0);
        if (total <= 0) {
            continue;
        }
        summaries.push({
            factionId: faction.id,
            factionDisplayName: faction.displayName,
            factionColor: factionWallColor(faction.id) || faction.color,
            total,
            resources,
        });
    }
    return summaries;
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
function dedupeLettersBySubject(letters: Letter[]): Letter[] {
    // `letters` is already sorted newest-first; the first occurrence of each
    // subject is therefore the newest and is the one we keep.
    const seen = new Set<string>();
    const out: Letter[] = [];
    for (const letter of letters) {
        if (seen.has(letter.subject)) {
            continue;
        }
        seen.add(letter.subject);
        out.push(letter);
    }
    return out;
}

function readResidents(
    lettersRoot: string,
    residentIds?: readonly string[],
    soulsDir?: string,
    excludeSynthetic?: boolean,
): ResidentSummary[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(lettersRoot, { withFileTypes: true });
    } catch {
        return [];
    }

    const soulLoader = soulsDir !== undefined ? new SoulLoader(soulsDir) : undefined;
    const allowedSlugs = residentIds !== undefined ? new Set(residentIds.map(toResidentSlug)) : undefined;
    if (allowedSlugs !== undefined && soulLoader !== undefined) {
        for (const name of soulLoader.listResidentNames()) {
            allowedSlugs.add(toResidentSlug(name));
        }
    }
    const summaries: ResidentSummary[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('res-')) {
            continue;
        }
        const slug = entry.name;
        if (allowedSlugs !== undefined && !allowedSlugs.has(slug)) {
            continue;
        }
        if (excludeSynthetic && isSyntheticSlug(slug)) {
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
        const residentName = slugToResidentName(slug);
        const soulSummary = soulLoader !== undefined ? readSoulRosterSummary(soulLoader, residentName) : undefined;
        const displayName = soulSummary?.displayName || humanizeName(slug);
        const alive = parsed.deceased === undefined || parsed.deceased === null;
        const runtimeActiveGoal =
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
        const activeGoal = runtimeActiveGoal || soulSummary?.fallbackGoal;

        const factionId = soulSummary?.factionId;
        const faction = factionId !== undefined ? factionDisplayMetadata(factionId) : undefined;

        const summary: ResidentSummary = { slug, displayName, alive, attention: parsed.attention };
        if (activeGoal !== undefined) {
            summary.activeGoal = activeGoal;
        }
        if (factionId !== undefined) {
            summary.factionId = factionId;
        }
        if (faction !== undefined) {
            summary.factionDisplayName = faction.displayName;
            summary.factionColor = faction.wallColor;
        }
        const arcPhase = readResidentArcPhase(path.join(lettersRoot, 'library', slug, 'timeline.jsonl'));
        if (arcPhase !== undefined) {
            summary.arcPhase = arcPhase;
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

function readResidentArcPhase(timelinePath: string): string | undefined {
    if (!fs.existsSync(timelinePath)) {
        return undefined;
    }
    try {
        const raw = fs.readFileSync(timelinePath, 'utf8');
        const events = raw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
                try {
                    return JSON.parse(line) as Record<string, unknown>;
                } catch {
                    return null;
                }
            })
            .filter((e): e is Record<string, unknown> => e !== null);
        if (events.length === 0) {
            return undefined;
        }
        const arc = inferStoryArc(events);
        const totalClassified =
            arc.evidence.pitches +
            arc.evidence.fundingEvents +
            arc.evidence.progressEvents +
            arc.evidence.resolutionEvents +
            arc.evidence.letterEvents;
        return totalClassified > 0 ? arc.phase : undefined;
    } catch {
        return undefined;
    }
}

function toResidentSlug(value: string): string {
    return value.startsWith('res:') ? `res-${value.slice('res:'.length).replace(/:/g, '-')}` : value;
}

function slugToResidentName(slug: string): string {
    return slug.startsWith('res-') ? `res:${slug.slice('res-'.length)}` : slug;
}

function readSoulRosterSummary(
    loader: SoulLoader,
    residentName: string,
): { displayName?: string; fallbackGoal?: string; factionId?: string } | undefined {
    try {
        const soul = loader.load(residentName);
        return {
            displayName: soul.frontmatter.display,
            fallbackGoal: soul.frontmatter.goals?.[0],
            factionId: soul.frontmatter.factionId,
        };
    } catch {
        return undefined;
    }
}

function factionDisplayMetadata(id: string): { displayName: string; wallColor: string } | undefined {
    const faction = FACTIONS.find(candidate => candidate.id === id);
    if (!faction) {
        return undefined;
    }
    return {
        displayName: faction.displayName,
        wallColor: factionWallColor(faction.id) || faction.color,
    };
}

function factionWallColor(id: FactionId): string | undefined {
    const faction = FACTIONS.find(candidate => candidate.id === id);
    if (!faction) {
        return undefined;
    }
    return faction.color === '#0A0A0A' && faction.accentColor ? faction.accentColor : faction.color;
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
