import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';

/**
 * Patron-handle extractor (EVENT-D4-bridge).
 *
 * Pure reader that scans a resident's library timeline JSONL and
 * returns the unique patron handles who ever interacted with that
 * resident — gift, witness, or sponsor. This is the bridge between
 * the death-loop substrate (EVENT-D4 `buildEpitaphDispatchRequests`)
 * and the production wiring layer that calls it: the wiring slice
 * calls `extractPatronHandlesFromTimeline(libraryRoot, residentName)`,
 * threads the result into `buildEpitaphDispatchRequests`, and
 * dispatches via `dispatchEpitaphs`.
 *
 * Resilience properties:
 *   - Missing timeline file ⇒ [] (fresh resident has no patrons).
 *   - Malformed JSONL lines silently skipped (no throw on log
 *     corruption — the death-letter cascade must not fail closed).
 *   - Blank lines skipped.
 *   - Non-string / empty / whitespace-only `patronHandle` ignored.
 *   - Case-insensitive dedup; first-seen casing preserved on output
 *     (lets the wiring layer pass through whatever casing the
 *     patron originally introduced themselves with).
 *
 * Slug derivation matches the existing `library/<slug>/timeline.jsonl`
 * convention used by `LibraryUpdater` and `readRecentLibraryMemories`.
 */
export function extractPatronHandlesFromTimeline(libraryRoot: string, residentName: string): string[] {
    const timelinePath = path.join(libraryRoot, 'library', residentSlug(residentName), 'timeline.jsonl');
    if (!fs.existsSync(timelinePath)) {
        return [];
    }

    const seen = new Set<string>();
    const handles: string[] = [];
    const lines = fs.readFileSync(timelinePath, 'utf8').split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0) {
            continue;
        }
        let event: Record<string, unknown>;
        try {
            const parsed = JSON.parse(line);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                continue;
            }
            event = parsed as Record<string, unknown>;
        } catch {
            // Corruption in a single line should not silence the rest of
            // the patrons. The death cascade is the central narrative
            // payoff — fail open, not closed.
            continue;
        }
        const handleRaw = event.patronHandle;
        if (typeof handleRaw !== 'string') {
            continue;
        }
        const trimmed = handleRaw.trim();
        if (trimmed.length === 0) {
            continue;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        handles.push(trimmed);
    }
    return handles;
}
