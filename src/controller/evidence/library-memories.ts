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
    const timelinePath = path.join(libraryRoot, 'library', residentSlug(resident), 'timeline.jsonl');
    if (!fs.existsSync(timelinePath)) {
        return [];
    }
    const events = fs
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
    const lastN = events.slice(-n);
    return lastN.map(renderEventAsMemory);
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
            const artifact = typeof event.artifact === 'string' ? event.artifact : 'a gift';
            return `Patron gift from ${handle}: ${artifact} (${ts})`;
        }
        case 'patron_sponsor': {
            const handle = typeof event.patronHandle === 'string' ? event.patronHandle : 'an unknown patron';
            return `Patron sponsor: ${handle} (${ts})`;
        }
        default: {
            const note = typeof event.note === 'string' ? `: ${event.note}` : '';
            const skill = typeof event.skill === 'string' ? ` skill=${event.skill}` : '';
            return `${kind}${skill}${note} at ${ts}`;
        }
    }
}
