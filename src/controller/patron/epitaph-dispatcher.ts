import { type Letter, type EpitaphLetterInput, produceEpitaphLetter, produceMorticiansRibbonLetter } from './letters-producer';
import type { LettersStore, LettersStoreAppendResult } from './letters-store';

/**
 * End-to-end death loop substrate (workstream EVENT-D4 / J-δ-2 / M-β).
 *
 * Pure module that turns a deceased resident summary plus a list of
 * patron handles into a batch of {@link Letter}s (one per unique
 * patron), then a separate `dispatchEpitaphs` step appends them to a
 * {@link LettersStore}. Idempotency comes from LettersStore's dedup on
 * (recipient, kind, dispatchedAt) — re-running the dispatch with the
 * same `deceasedAt` timestamp is safe.
 *
 * Per docs/strategic-review-2026-05-23-pm.md, this is "the central
 * narrative payoff of the entire project" — when a resident dies,
 * their patrons must hear about it on every channel. The wiring layer
 * (spark.ts / legacy.ts hooks into markDeceased + LibraryUpdater for
 * patron-handle enumeration) is a follow-on slice once this substrate
 * lands and the runtime soft-lock window is open.
 */

/** Summary the runtime collects at the moment of death. */
export interface DeceasedResidentSummary {
    residentName: string;
    residentArchetype: string;
    residentFaction: string;
    livedTicks: number;
    bestSkill?: { name: string; level: number };
    causeOfDeath?: string;
    /** ISO timestamp of the death (drives Letter.dispatchedAt for idempotency). */
    deceasedAt: string;
    deceasedTick: number;
}

export interface BuildEpitaphsOptions {
    /**
     * Optional sibling-flagship sender (J-δ-3 hero-death seam). When
     * the deceased is a hero, the runtime can route the letter "from"
     * a surviving sibling in the same faction so the letter doesn't
     * arrive from the deceased themselves. Defaults to the deceased's
     * own {@link DeceasedResidentSummary.residentName}.
     */
    senderResident?: string;
}

/**
 * Build one {@link Letter} per unique patron handle. Returns [] when
 * the patron list is empty or contains only empty/whitespace handles.
 * Handle uniqueness is case-insensitive; the first-seen casing is
 * preserved on the Letter.recipient field.
 */
export function buildEpitaphDispatchRequests(
    deceased: DeceasedResidentSummary,
    patronHandles: readonly string[],
    options: BuildEpitaphsOptions = {},
): Letter[] {
    const seen = new Set<string>();
    const letters: Letter[] = [];
    for (const raw of patronHandles) {
        if (typeof raw !== 'string') {
            continue;
        }
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
            continue;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const input: EpitaphLetterInput = {
            humanId: trimmed,
            faction: deceased.residentFaction,
            residentName: deceased.residentName,
            residentArchetype: deceased.residentArchetype,
            livedTicks: deceased.livedTicks,
            bestSkill: deceased.bestSkill,
            causeOfDeath: deceased.causeOfDeath,
            ts: deceased.deceasedAt,
            senderResident: options.senderResident,
        };
        letters.push(produceEpitaphLetter(input));
    }
    return letters;
}

/** Per-letter dispatch outcome. */
export interface DispatchEpitaphResult {
    recipient: string;
    /** True when the letter was already in the inbox (re-dispatch safe). */
    deduped: boolean;
    /** Present when this letter's append threw — siblings still run. */
    error?: string;
}

/**
 * Append a batch of epitaph letters to the LettersStore. Resilient to
 * per-letter failures: a thrown append surfaces in the returned
 * result, but does NOT short-circuit the rest of the batch. The
 * cascade of "everyone who supported this resident hears about it" is
 * the whole point — one bad disk write shouldn't silence the others.
 *
 * N5: After dispatching all epitaph letters, also dispatches a
 * Mortician's Ribbon civic milestone letter for each unique patron.
 * Ribbon dispatch failures are silently swallowed so a broken ribbon
 * write never prevents the epitaph from landing. The LettersStore's
 * natural dedup (kind + dispatchedAt + subject + recipient) makes
 * re-dispatching the same death idempotent.
 */
export function dispatchEpitaphs(letters: readonly Letter[], store: LettersStore): DispatchEpitaphResult[] {
    const results: DispatchEpitaphResult[] = [];
    for (const letter of letters) {
        try {
            const appended: LettersStoreAppendResult = store.append(letter);
            results.push({ recipient: letter.recipient, deduped: appended.deduped });
        } catch (error) {
            results.push({
                recipient: letter.recipient,
                deduped: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // N5: Mortician's Ribbon — one per unique patron per dispatched epitaph.
    // Only fires for epitaph-kind letters so broadcast/civic batches are safe.
    for (const letter of letters) {
        if (letter.kind !== 'epitaph') {
            continue;
        }
        try {
            const ribbon = produceMorticiansRibbonLetter({
                humanId: letter.recipient,
                deceasedResidentName: letter.senderResident,
                ts: letter.dispatchedAt,
            });
            store.append(ribbon);
        } catch {
            // Ribbon dispatch failure is non-fatal.
        }
    }

    return results;
}
