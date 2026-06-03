import { escapeRegExp } from './hybrid-agent-utils';

/**
 * Resident conversational-reply — pure helpers (slice 1).
 *
 * A resident engages the conversational-reply path only when a human PLAYER says
 * its display name. These helpers are the strict, word-boundary name match and the
 * leading-address-prefix stripper used to decide command-vs-conversation. Kept pure
 * and engine-free so the decision logic is unit-testable without the runtime.
 * See docs/superpowers/plans/2026-06-02-resident-conversational-reply.md.
 */

/** True iff `text` mentions `displayName` as a whole word (case-insensitive). */
export function isAddressedByName(text: string, displayName: string | undefined): boolean {
    if (!displayName) {
        return false;
    }
    return new RegExp(`\\b${escapeRegExp(displayName)}\\b`, 'i').test(text);
}

/**
 * Strip a leading "<name><punctuation/space>" address prefix and return the
 * remainder verbatim (trailing punctuation preserved). If the name is not the
 * leading token, the text is returned unchanged — routing only needs to know
 * whether the remainder is a recognized command.
 */
export function messageAfterName(text: string, displayName: string | undefined): string {
    if (!displayName) {
        return text.trim();
    }
    const prefix = new RegExp(`^\\s*${escapeRegExp(displayName)}\\b[\\s,:;!?.]*`, 'i');
    const match = text.match(prefix);
    if (!match) {
        return text.trim();
    }
    return text.slice(match[0].length).trim();
}
