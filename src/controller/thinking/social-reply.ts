import { escapeRegExp } from './hybrid-agent-utils';
import type { HybridPerception } from './hybrid-agent-utils';
import type { Soul } from '../soul/soul-schema';

/** Same-speaker window (ticks) for the cheap 1-turn follow-up memory (~12s at 600ms/tick). */
export const FOLLOW_UP_WINDOW_TICKS = 20;

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

/** The minimal 4-field context packet handed to the reply inference (plus a 1-turn follow-up). */
export interface SocialReplyContext {
    /** Field 1 — who I am, in voice (display + register + quirks + aesthetic). */
    voice: string;
    /** Field 2 — what I'm doing now (active-goal summary, or "idle"). */
    activity: string;
    /** Field 3 — who addressed me + what they said. */
    speaker: string;
    /** Field 4 — one salient nearby fact, only when notable. */
    salienceNote?: string;
    /** Optional 1-turn continuity line for a same-speaker follow-up. */
    followUp?: string;
    /** True when this is a same-speaker follow-up (relaxes the per-resident rate limit once). */
    bypassRateLimit: boolean;
    /** The addressing player's actor id (used later to check they're still present at emit time). */
    speakerActorId: string;
}

export interface BuildReplyContextInput {
    soul: Soul;
    perception: HybridPerception;
    /** Caller passes `cognition.activeGoal?.description`. */
    activeGoalDescription?: string;
    speakerName: string;
    speakerId: string;
    chatText: string;
    currentTick: number;
    /** Caller passes `cognition.lastSocialReply` (kept an explicit param so this stays type-decoupled). */
    lastReply?: { text: string; tick: number; speaker: string };
    followUpWindowTicks?: number;
}

/**
 * Assemble the minimal voiced context packet. Pure — no inference, no engine state
 * mutation. Field 4 is omitted unless something is genuinely notable; the follow-up
 * line appears only for the same speaker within the window and relaxes the rate limit.
 */
export function buildReplyContext(input: BuildReplyContextInput): SocialReplyContext {
    const fm = input.soul.frontmatter;
    const voice = [fm.display ?? fm.name, fm.voice?.register, ...(fm.voice?.quirks ?? []).slice(0, 3), fm.aesthetic]
        .filter(Boolean)
        .join('; ');

    const goal = input.activeGoalDescription?.trim();
    const activity = goal ? goal.slice(0, 80) : 'idle';

    const speaker = `${input.speakerName} said: "${input.chatText}"`;

    const hp = input.perception.resident?.hp;
    const salienceNote =
        hp && typeof hp.current === 'number' && typeof hp.max === 'number' && hp.max > 0 && hp.current / hp.max <= 0.3
            ? 'you are hurt and low on health'
            : undefined;

    const window = input.followUpWindowTicks ?? FOLLOW_UP_WINDOW_TICKS;
    const last = input.lastReply;
    const isFollowUp = Boolean(
        last && last.speaker === input.speakerId && input.currentTick >= last.tick && input.currentTick - last.tick <= window,
    );
    const followUp = isFollowUp && last ? `(a moment ago you said: "${last.text}")` : undefined;

    return { voice, activity, speaker, salienceNote, followUp, bypassRateLimit: isFollowUp, speakerActorId: input.speakerId };
}
