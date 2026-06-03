import type { CityEventDigest, StorytellerConfig } from './types';

// ---------------------------------------------------------------------------
// Storyteller prompt builder — S7b
//
// Builds the LLM prompt from a CityEventDigest. The model must return a JSON
// object with exactly the fields listed in REQUIRED_OUTPUT_SCHEMA.
//
// AP = Attention Points (Null City ledger). GP = real RuneScape gold (coin
// item 995). The prompt makes this distinction explicit so models do not
// conflate them.
// ---------------------------------------------------------------------------

const REQUIRED_OUTPUT_SCHEMA = `{
  "publicTitle": "string — short headline, max 70 characters",
  "publicBody": "string — narrative paragraph, max {MAX_WORDS} words",
  "publicBullets": ["string", "string", ...] — 2 to 5 bullet points,
  "operatorSummary": "string — brief operator-only summary of what happened",
  "operatorWarnings": ["string", ...] — list unsupported or uncertain claims; empty array if none,
  "eventRefsUsed": ["string", ...] — ONLY ref values that appear in the digest below,
  "claims": [
    {
      "subject": "resident name or city",
      "predicate": "what happened (e.g. earned, faded, exchanged, asked for AP)",
      "eventRefs": ["ref1", ...] — ONLY refs that appear in the digest,
      "ts": "ISO timestamp or window string",
      "amount": 123 (optional — include only when a specific number is supported by evidence),
      "location": "place label" (optional — include only when location data is in the digest)
    }
  ],
  "watchNext": ["string", ...] — 0 to 3 items for humans to watch in the next window,
  "confidence": "high|medium|low" — your confidence that all public claims are grounded in evidence
}`;

function renderResidents(digest: CityEventDigest): string {
    if (digest.residents.length === 0) return '(none)';
    return digest.residents
        .map(r => {
            const apStatus = r.isFaded ? 'FADED' : r.isLowAp ? `LOW AP (${r.attention})` : `AP ${r.attention}`;
            const gpStatus = r.gpObserved === null ? 'GP unobserved' : `GP ${r.gpObserved} (real RuneScape gold)`;
            const goal = r.goalText ? ` | Goal: ${r.goalText}` : '';
            return `  - ${r.residentName}: ${apStatus}, ${gpStatus}${goal}`;
        })
        .join('\n');
}

function renderTopEvents(digest: CityEventDigest): string {
    if (digest.topEvents.length === 0) return '(no notable events this window)';
    return digest.topEvents
        .map(e => `  - ref="${e.ref}" kind=${e.kind} resident=${e.residentName} importance=${e.importance}: ${e.note}`)
        .join('\n');
}

/**
 * Build the LLM prompt for the Storyteller model run.
 * Returns a single string. Pure function — no I/O, no model calls.
 *
 * AP = Attention Points (Null City ledger balance that sustains residents).
 * GP = real RuneScape gold (coin item 995, game state — NOT a Null City ledger).
 */
export function buildStorytellerPrompt(digest: CityEventDigest, config: StorytellerConfig): string {
    const schema = REQUIRED_OUTPUT_SCHEMA.replace('{MAX_WORDS}', String(config.maxPublicBodyWords));
    const { totalResidents, activeResidents, fadedResidents, lowApResidents } = digest.systemHealth;

    return `You are the Null City Storyteller. Write grounded public-facing narration for the Null City community.

PUBLIC VOICE:
- Sound like a cyberpunk-fantasy dungeon-crawl broadcast coming from a half-broken quest terminal, not an old-fashioned news-anchor.
- Use sharp, playful, dangerous energy: fantasy stakes, tech weirdness, OnionDAO oddity, and the feeling that the city is a live experiment worth watching.
- Describe the actual drama in a way that makes humans understand why humans should care, who is at risk, who is changing, and what they might want to watch next or want to know more about.
- Prefer vivid but grounded framing: "the AP tank is leaking," "the road just produced a witness," "a tiny quest flag blinked awake." Do not copy these examples unless they fit the digest.
- Do not start with stale broadcast phrases like "Good evening," "big news tonight," "tonight's top story," or "ladies and gentlemen."
- Do not overhype quiet windows. If the digest is calm, make the calm interesting: tension, patterns, weird absences, or what the quiet implies.
- Keep it public-safe and evidence-bound. No slurs, no cruelty toward real people, no private handles, and no unsupported lore.

ECONOMY RULES (follow exactly):
- AP (Attention Points) is the Null City ledger currency that sustains residents. AP is NOT RuneScape gold.
- GP means real RuneScape gold (coin item 995 in-game). GP is NOT a Null City ledger balance.
- Do not invent facts. Only describe events that appear in the digest below.
- Only include refs in eventRefsUsed that are listed in the digest events below.
- Do not reveal private handles, Discord usernames, or numeric IDs.
- Keep AP and GP clearly distinct — never merge them or say GP is "earned AP."

DIGEST WINDOW: ${digest.windowStart} → ${digest.windowEnd}
Built at: ${digest.builtAt}

SYSTEM HEALTH:
${totalResidents} total residents, ${activeResidents} active, ${fadedResidents} faded, ${lowApResidents} low-AP (Attention Points).

RESIDENT SNAPSHOTS:
${renderResidents(digest)}

TOP EVENTS (sorted by importance, highest first):
${renderTopEvents(digest)}

TASK:
Respond with a valid JSON object matching this schema exactly:
${schema}

Constraints:
- publicTitle must be at most 70 characters.
- publicBody must be at most ${config.maxPublicBodyWords} words and must keep AP (Attention Points) and GP (real RuneScape gold) distinct.
- You must not return {} or placeholder copy. publicTitle, publicBody, and publicBullets must be non-empty and specific to the digest.
- publicBullets must contain 2 to 5 short, grounded facts drawn from the digest.
- operatorWarnings should only include publish-blocking public safety issues: unsupported public claims, privacy leaks, or evidence conflicts.
- Do not add routine caveats for facts you avoided claiming, normal missing data, or harmless uncertainty that does not affect the public copy.
- eventRefsUsed must only contain ref values provided in the TOP EVENTS list above.
- claims: include one object per distinct factual claim in your public copy. Each claim's eventRefs must only use refs from the TOP EVENTS list. If a claim has no supporting event ref, omit the claim. An empty claims array is valid when no event-backed claims are made.
- watchNext: include 0 to 3 plain-text items that humans should watch for in the next window. Omit if there is nothing specific to flag.
- confidence: rate your overall confidence that every public claim is grounded in digest evidence (high = all claims event-backed, medium = some inference, low = mostly quiet window or thin evidence).
- If there is nothing notable to narrate, write a short neutral update instead of inventing events.
- Do not invent deaths, GP earnings, AP grants, NCRIs, or quest completions that are not in the digest.`;
}
