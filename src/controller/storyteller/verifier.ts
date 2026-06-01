import type { CityEventDigest, StorytellerDispatch } from './types';

// ---------------------------------------------------------------------------
// Storyteller verifier — S7a
//
// Validates a StorytellerDispatch against its source CityEventDigest:
//   1. eventRefsUsed only references refs present in the digest.
//   2. Public-facing text contains no unredacted private handles.
//   3. Specific claim keywords (death, GP, NCRI, quest, AP grant) are backed
//      by matching evidence in the digest.
//
// Only public-facing fields (publicTitle, publicBody, publicBullets) are
// checked for keyword claims. Operator fields may carry more detail.
// ---------------------------------------------------------------------------

export interface VerifierResult {
    passed: boolean;
    warnings: string[];
}

// Unredacted private handle: @username mention or Discord-like snowflake ID.
const PRIVATE_HANDLE = /(?:^|\s)@[A-Za-z]\w{1,30}\b|\b\d{17,19}\b/;

// Claim patterns — matched against public text only (title + body + bullets).
const DEATH_CLAIM = /\b(?:died|faded|deceased|passed away)\b/i;
const GP_MOVE_CLAIM =
    /\b(?:earned|traded|gained|collected|burned|lost)\b.{0,30}\b(?:GP|gold|coins?)\b|\b(?:GP|gold|coins?)\b.{0,30}\b(?:earned|traded|gained|collected)\b/i;
const NCRI_CLAIM = /\bNCRI\b/i;
const QUEST_COMPLETE_CLAIM = /\b(?:completed?|finished)\b.{0,50}\b(?:quest|goal)\b|\b(?:quest|goal)\b.{0,50}\b(?:completed?|finished)\b/i;
const AP_GRANT_CLAIM = /\b(?:granted|credited|received|sent)\s+(?:\d+\s+)?AP\b|\bAP\s+(?:was\s+)?(?:granted|credited|received)\b/i;
const RESIDENT_BIRTH_CLAIM = /\b(?:new resident|resident(?:s)?(?:\s+\w+){0,3}\s+born|soul(?:s)?\s+born|birth of (?:a|new) resident)\b/i;

function publicText(dispatch: StorytellerDispatch): string {
    return [dispatch.publicTitle, dispatch.publicBody, ...dispatch.publicBullets].join(' ');
}

function allRefs(digest: CityEventDigest): Set<string> {
    const refs = new Set<string>();
    const arrays = [
        digest.apEvents,
        digest.gpEvents,
        digest.exchangeEvents,
        digest.ncriEvents,
        digest.goalEvents,
        digest.stuckEvents,
        digest.miscEvents,
    ];
    for (const arr of arrays) for (const ev of arr) refs.add(ev.ref);
    return refs;
}

/**
 * Verify a StorytellerDispatch against its source CityEventDigest.
 * Returns a VerifierResult with any warnings found. `passed` is true iff
 * warnings is empty.
 */
export function verifyDispatch(dispatch: StorytellerDispatch, digest: CityEventDigest): VerifierResult {
    const warnings: string[] = [];
    const text = publicText(dispatch);

    // 1. Unknown event refs
    const validRefs = allRefs(digest);
    for (const ref of dispatch.eventRefsUsed) {
        if (!validRefs.has(ref)) warnings.push(`unknown event ref: "${ref}"`);
    }

    // 2. Private handle patterns in public text
    if (PRIVATE_HANDLE.test(text)) {
        warnings.push('public text may contain an unredacted private handle (@mention or large numeric ID)');
    }

    // 3. Unsupported death / fade claim
    const hasFadeEvidence =
        digest.apEvents.some(e => e.kind === 'resident_faded') ||
        digest.miscEvents.some(e => e.kind === 'resident_faded') ||
        digest.residents.some(r => r.isFaded);
    if (DEATH_CLAIM.test(text) && !hasFadeEvidence) {
        warnings.push('public text claims a death or fade but no resident_faded event or faded snapshot in digest');
    }

    // 4. Unsupported GP movement claim
    const hasGpEvidence = digest.gpEvents.length > 0 || digest.exchangeEvents.length > 0;
    if (GP_MOVE_CLAIM.test(text) && !hasGpEvidence) {
        warnings.push('public text claims GP movement but no GP or exchange events in digest');
    }

    // 5. Unsupported NCRI claim
    if (NCRI_CLAIM.test(text) && digest.ncriEvents.length === 0) {
        warnings.push('public text mentions NCRI but no NCRI events in digest');
    }

    // 6. Unsupported quest / goal completion claim
    const hasGoalCompletedEvidence = digest.goalEvents.some(e => e.kind === 'goal_completed');
    if (QUEST_COMPLETE_CLAIM.test(text) && !hasGoalCompletedEvidence) {
        warnings.push('public text claims quest or goal completion but no goal_completed events in digest');
    }

    // 7. Unsupported AP grant claim
    const hasApGrantEvidence = digest.apEvents.some(e => e.kind === 'ap_granted');
    if (AP_GRANT_CLAIM.test(text) && !hasApGrantEvidence) {
        warnings.push('public text claims AP was granted but no ap_granted events in digest');
    }

    // 8. Unsupported resident birth claim
    const hasResidentBirthEvidence = [
        ...digest.apEvents,
        ...digest.gpEvents,
        ...digest.exchangeEvents,
        ...digest.ncriEvents,
        ...digest.goalEvents,
        ...digest.stuckEvents,
        ...digest.miscEvents,
    ].some(e => e.kind === 'soul_born');
    if (RESIDENT_BIRTH_CLAIM.test(text) && !hasResidentBirthEvidence) {
        warnings.push('public text claims resident birth but no soul_born events in digest');
    }

    return { passed: warnings.length === 0, warnings };
}

/**
 * Apply a VerifierResult to a dispatch, returning a (possibly new) dispatch
 * with needsReview and reviewReasons populated. Returns the original reference
 * when passed — no allocation on the happy path.
 */
export function applyVerifierResult(dispatch: StorytellerDispatch, result: VerifierResult): StorytellerDispatch {
    if (result.passed) return dispatch;
    return {
        ...dispatch,
        needsReview: true,
        reviewReasons: [...(dispatch.reviewReasons ?? []), ...result.warnings],
    };
}
