import type { DigestEvent } from './types';
import { IMPORTANCE_WEIGHT } from './types';

const KIND_BONUS: Record<DigestEvent['kind'], number> = {
    resident_faded: 80,
    resident_revived: 75,
    ap_zero: 70,
    skill_level_up: 50,
    ap_for_gp_exchange: 45,
    ncri_created: 45,
    ncri_redeemed: 45,
    goal_completed: 45,
    gp_earned: 35,
    ap_low: 35,
    soul_born: 30,
    ap_granted: 25,
    patron_gift: 20,
    gp_observed: 20,
    library_writeback: 0,
    stuck_recovered: -20,
    quiet_resident: -20,
};

const TANGIBLE_NOTE =
    /\b(?:said|says|asked|warned|offering|embassy|shop|bank|castle|courtyard|chapel|quest|goal|trade|traded|gold|item|ncri|tool|found|reached|delivered|completed|fading|alive|attention)\b/i;

export function rankEventsForStorytellerPresentation(events: DigestEvent[]): DigestEvent[] {
    return [...events].sort((left, right) => {
        const scoreDiff = presentationScore(right) - presentationScore(left);
        if (scoreDiff !== 0) return scoreDiff;
        return left.ts.localeCompare(right.ts);
    });
}

function presentationScore(event: DigestEvent): number {
    let score = IMPORTANCE_WEIGHT[event.importance] + KIND_BONUS[event.kind];
    if (isTangibleEvent(event)) score += event.kind === 'library_writeback' ? 50 : 15;
    return score;
}

function isTangibleEvent(event: DigestEvent): boolean {
    if (event.note.includes('"')) return true;
    return TANGIBLE_NOTE.test(event.note);
}
