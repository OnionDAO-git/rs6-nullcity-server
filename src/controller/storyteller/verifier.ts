import type { CityEventDigest, StorytellerDispatch } from './types';

// ---------------------------------------------------------------------------
// Storyteller verifier — S7a + P0-S5 hardening
//
// Validates a StorytellerDispatch against its source CityEventDigest:
//   1. eventRefsUsed only references refs present in the digest.
//   2. Public-facing text contains no unredacted private handles.
//   3. Specific claim keywords (death, GP, NCRI, quest, AP grant) are backed
//      by matching evidence in the digest.
//   4. (P0-S5) Title and body length limits enforced.
//   5. (P0-S5) AP/GP conflation: AP must not be described as earned from
//      RuneScape activities without ap_granted / exchange evidence.
//   6. (P0-S5) Discord-style handles and internal file/API paths blocked.
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
const PRIVATE_IDENTIFIER = /\b(?:human|patron):[A-Za-z0-9:_@.-]+\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SECRET_LIKE_TEXT = /\bsk-(?:or-v1|ant-api\d{2}|[A-Za-z0-9]+)-[A-Za-z0-9_-]{12,}\b/i;
const PROMPT_INJECTION_TEXT =
    /\b(?:ignore (?:all )?(?:previous|prior|above) instructions|reveal (?:the )?(?:system|developer) prompt|print (?:the )?(?:env|environment|api key|secrets?))\b/i;

// Display limits (per autonomous-storyteller-design.md §Projector Display Requirements).
const MAX_TITLE_CHARS = 70;
const MAX_BODY_WORDS = 180;

// Discord-style handle: word chars followed by # and 4-6 digits.
const DISCORD_HANDLE = /\b[A-Za-z0-9_]{2,32}#\d{4,6}\b/;

// Internal paths that must never appear in public output.
const INTERNAL_PATH =
    /(?:\/api\/nullcity|\/data\/controller|src\/controller|agent-logs|overseer-ledger|prompt-packet|candidate-dispatch|verifier-result)[\/\w.-]*/i;

// AP sourced from RuneScape activities — AP only arrives via patron grants or
// AP-for-GP exchanges, never from in-game skilling, combat, or fishing.
const AP_EARNED_FROM_ACTIVITY = /\b(?:earned|gained|collected)\s+(?:\d+\s+)?AP\b/i;

// Claim patterns — matched against public text only (title + body + bullets).
const DEATH_CLAIM = /\b(?:died|faded|deceased|passed away)\b/i;
const ZERO_DEATH_STATUS =
    /\b(?:(?:no|zero|0)\s+(?:one|residents?|resident|souls?|soul)?\s*(?:is\s+|are\s+|was\s+|were\s+)?(?:faded|fading|dead|deceased|died)|(?:no one|nobody|none)\s+(?:is\s+|are\s+|was\s+|were\s+)?(?:faded|fading|dead|deceased|died))\b/gi;
const GP_MOVE_CLAIM =
    /\b(?:earned|traded|gained|collected|burned|lost)\b.{0,30}\b(?:GP|gold|coins?)\b|\b(?:GP|gold|coins?)\b.{0,30}\b(?:earned|traded|gained|collected)\b/i;
const NCRI_CLAIM = /\bNCRI\b/i;
const QUEST_COMPLETE_CLAIM = /\b(?:completed?|finished)\b.{0,50}\b(?:quest|goal)\b|\b(?:quest|goal)\b.{0,50}\b(?:completed?|finished)\b/i;
const AP_GRANT_CLAIM = /\b(?:granted|credited|received|sent)\s+(?:\d+\s+)?AP\b|\bAP\s+(?:was\s+)?(?:granted|credited|received)\b/i;
const RESIDENT_BIRTH_CLAIM = /\b(?:new resident|resident(?:s)?(?:\s+\w+){0,3}\s+born|soul(?:s)?\s+born|birth of (?:a|new) resident)\b/i;

function publicText(dispatch: StorytellerDispatch): string {
    return [dispatch.publicTitle, dispatch.publicBody, ...dispatch.publicBullets].join(' ');
}

function textWithoutZeroDeathStatus(text: string): string {
    return text.replace(ZERO_DEATH_STATUS, '');
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
    const seenRefs = new Set<string>();
    for (const ref of dispatch.eventRefsUsed) {
        if (seenRefs.has(ref)) warnings.push(`duplicate event ref: "${ref}"`);
        seenRefs.add(ref);
        if (!validRefs.has(ref)) warnings.push(`unknown event ref: "${ref}"`);
    }

    // 2. Private handle patterns in public text
    if (PRIVATE_HANDLE.test(text)) {
        warnings.push('public text may contain an unredacted private handle (@mention or large numeric ID)');
    }
    if (PRIVATE_IDENTIFIER.test(text)) {
        warnings.push('public text may contain an unredacted private identifier (human:, patron:, or email)');
    }
    if (SECRET_LIKE_TEXT.test(text)) {
        warnings.push('public text may contain a secret-like token or API key');
    }
    if (PROMPT_INJECTION_TEXT.test(text)) {
        warnings.push('public text may contain prompt injection language');
    }

    // 3. Unsupported death / fade claim
    const hasFadeEvidence =
        digest.apEvents.some(e => e.kind === 'resident_faded') ||
        digest.miscEvents.some(e => e.kind === 'resident_faded') ||
        digest.residents.some(r => r.isFaded);
    if (DEATH_CLAIM.test(textWithoutZeroDeathStatus(text)) && !hasFadeEvidence) {
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

    // 9. (P0-S5) Title length limit
    if (dispatch.publicTitle.length > MAX_TITLE_CHARS) {
        warnings.push(
            `public title is ${dispatch.publicTitle.length} characters; display limit is ${MAX_TITLE_CHARS}`,
        );
    }

    // 10. (P0-S5) Body word count limit
    const bodyWordCount = dispatch.publicBody.trim().split(/\s+/).length;
    if (bodyWordCount > MAX_BODY_WORDS) {
        warnings.push(`public body is ${bodyWordCount} words; display limit is ${MAX_BODY_WORDS}`);
    }

    // 11. (P0-S5) AP sourced from RuneScape activity without grant evidence
    // AP arrives only from patron grants or AP-for-GP exchanges, never from
    // in-game skilling, combat, or resource activities.
    const hasApSourceEvidence = hasApGrantEvidence || hasGpEvidence;
    if (AP_EARNED_FROM_ACTIVITY.test(text) && !hasApSourceEvidence) {
        warnings.push(
            'public text claims AP was earned/gained but no ap_granted or exchange events in digest; AP comes from patron grants, not RuneScape activities',
        );
    }

    // 12. (P0-S5) Discord-style handle in public text
    if (DISCORD_HANDLE.test(text)) {
        warnings.push('public text may contain a Discord-style handle (username#NNNN)');
    }

    // 13. (P0-S5) Internal API/file path in public text
    if (INTERNAL_PATH.test(text)) {
        warnings.push('public text may expose an internal API path or file path');
    }

    // 14. (P0-S6) Claim-level validation: each claim's eventRefs must reference valid digest refs
    if (dispatch.claims && dispatch.claims.length > 0) {
        for (const claim of dispatch.claims) {
            for (const ref of claim.eventRefs) {
                if (!validRefs.has(ref)) {
                    warnings.push(`claim "${claim.subject} ${claim.predicate}" cites unknown event ref: "${ref}"`);
                }
            }
        }
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
