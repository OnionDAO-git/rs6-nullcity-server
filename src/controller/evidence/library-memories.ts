import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';

/**
 * Pure-function reader for prior-session library timeline entries.
 *
 * Translates the last N JSONL events from `library/<resident>/timeline.jsonl`
 * into human-readable memory strings suitable for the `memories` field of
 * {@link PromptEnvelopeInput}. This is the READ-back side of the Library
 * of Souls — the WRITE side (`LibraryUpdater.observeTrajectory` /
 * `observePatron`) was built earlier; without this reader, residents never
 * remembered anyone between sessions.
 *
 * Returned strings are chronological (oldest first within the window). The
 * caller usually concatenates these with `MemoryStore.retrieve(...)` output
 * before passing to `buildPromptEnvelope`.
 *
 * Resilient to malformed JSONL lines (skipped silently, valid lines kept).
 * Returns [] if the timeline file does not exist (fresh resident with no
 * prior session).
 */
export function readRecentLibraryMemories(libraryRoot: string, resident: string, n: number): string[] {
    if (n <= 0) {
        return [];
    }
    const events = readTimeline(libraryRoot, resident);
    if (events.length === 0) {
        return [];
    }
    const lastN = events.slice(-n);
    return lastN.map(renderEventAsMemory);
}

/**
 * Read the last N patron-kind events from the library timeline, filtered
 * away from stuck/say noise. See E7 in
 * `docs/intelligence-verification-log.md`: res:agent's timeline is dominated
 * by ~92% stuck/say events at ~1/10s, so patron events evict from the
 * general {@link readRecentLibraryMemories} window within minutes. A
 * dedicated patron-only reader preserves them long enough for the resident
 * to acknowledge the patron in subsequent conversation or behavior. The
 * caller typically concatenates the two readers' output for the
 * `memories` field of {@link PromptEnvelopeInput}.
 */
export function readRecentPatronMemories(libraryRoot: string, resident: string, n: number): string[] {
    if (n <= 0) {
        return [];
    }
    const events = readTimeline(libraryRoot, resident);
    const patronEvents = events.filter(event => isPatronKind(event.kind));
    const lastN = patronEvents.slice(-n);
    return lastN.map(renderEventAsMemory);
}

function readTimeline(libraryRoot: string, resident: string): Array<Record<string, unknown>> {
    const timelinePath = path.join(libraryRoot, 'library', residentSlug(resident), 'timeline.jsonl');
    if (!fs.existsSync(timelinePath)) {
        return [];
    }
    return fs
        .readFileSync(timelinePath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .flatMap(line => {
            try {
                return [JSON.parse(line) as Record<string, unknown>];
            } catch {
                return [];
            }
        });
}

function isPatronKind(kind: unknown): boolean {
    return kind === 'patron_gift' || kind === 'patron_witness' || kind === 'patron_sponsor';
}

/**
 * Translate a `LibraryUpdater.observeRevival` cause string into first-person
 * narrative the Brain can react to. Unknown causes pass through verbatim so
 * future cause kinds remain legible even before this table is updated.
 */
function humanizeRevivalCause(cause: string): string {
    switch (cause) {
        case 'restart_respawn_policy':
            return 'after a controller restart';
        case 'operator_revive_attention_exhausted':
            return 'after my attention ran out — an operator restored me';
        case 'operator_revive_manual':
            return 'an operator chose to bring me back';
        case 'attention_exhausted':
            return 'after my attention ran out';
        default:
            return cause;
    }
}

/** "1st", "2nd", "3rd", "4th"... — small UX touch for life-count narration. */
function ordinal(n: number): string {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) {
        return `${n}th`;
    }
    switch (n % 10) {
        case 1:
            return `${n}st`;
        case 2:
            return `${n}nd`;
        case 3:
            return `${n}rd`;
        default:
            return `${n}th`;
    }
}

function renderEventAsMemory(event: Record<string, unknown>): string {
    const ts = typeof event.ts === 'string' ? event.ts.slice(0, 19).replace('T', ' ') : 'unknown time';
    const kind = typeof event.kind === 'string' ? event.kind : 'event';

    switch (kind) {
        case 'patron_witness': {
            const handle = typeof event.patronHandle === 'string' ? event.patronHandle : 'an unknown patron';
            return `Patron witnessed (${handle}) at ${ts}`;
        }
        case 'patron_gift': {
            const handle = typeof event.patronHandle === 'string' ? event.patronHandle : 'an unknown patron';
            // E7 (intelligence-verification-log.md § E7): when the CLI /
            // PatronGateway path forwards `amount` (Shards) and
            // `standingTier` (the tier the patron crossed into), prefer
            // the enriched rendering so the Brain can react meaningfully.
            // Fall back to legacy `artifact`-based rendering for in-world
            // gifts that carry a tangible item instead.
            const amount = typeof event.amount === 'number' && Number.isFinite(event.amount) ? event.amount : undefined;
            const tier = typeof event.standingTier === 'string' && event.standingTier.length > 0 ? event.standingTier : undefined;
            if (amount !== undefined) {
                const shards = `${amount} Shard${amount === 1 ? '' : 's'}`;
                const tierClause = tier ? ` (you are now ${tier} to them)` : '';
                return `Patron gift from ${handle}: ${shards}${tierClause} (${ts})`;
            }
            const artifact = typeof event.artifact === 'string' ? event.artifact : 'a gift';
            return `Patron gift from ${handle}: ${artifact} (${ts})`;
        }
        case 'patron_sponsor': {
            const handle = typeof event.patronHandle === 'string' ? event.patronHandle : 'an unknown patron';
            return `Patron sponsor: ${handle} (${ts})`;
        }
        case 'revival': {
            // E44 (intelligence-verification-log.md § E44, task #156): revival
            // events from `LibraryUpdater.observeRevival` ship `lifeIndex`
            // (this is my Nth life) + `cause` (why I'm back). Render as
            // first-person narrative so the Brain's prompt envelope sees the
            // continuity break and can reflect on it instead of treating
            // revival as anonymous noise.
            const cause = typeof event.cause === 'string' && event.cause.length > 0 ? humanizeRevivalCause(event.cause) : 'cause unknown';
            const lifeIndex =
                typeof event.lifeIndex === 'number' && Number.isFinite(event.lifeIndex) && event.lifeIndex > 0
                    ? event.lifeIndex
                    : undefined;
            const livesClause = lifeIndex !== undefined ? `this is my ${ordinal(lifeIndex)} life — ` : '';
            return `I returned to life — ${livesClause}${cause} (${ts})`;
        }
        default: {
            const note = typeof event.note === 'string' ? `: ${event.note}` : '';
            const skill = typeof event.skill === 'string' ? ` skill=${event.skill}` : '';
            return `${kind}${skill}${note} at ${ts}`;
        }
    }
}
