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
  "publicTitle": "string — short headline, max 80 characters",
  "publicBody": "string — narrative paragraph, max {MAX_WORDS} words",
  "publicBullets": ["string", "string", ...] — 2 to 5 bullet points,
  "operatorSummary": "string — brief operator-only summary of what happened",
  "operatorWarnings": ["string", ...] — list unsupported or uncertain claims; empty array if none,
  "eventRefsUsed": ["string", ...] — ONLY ref values that appear in the digest below
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
- publicBody must be at most ${config.maxPublicBodyWords} words and must keep AP (Attention Points) and GP (real RuneScape gold) distinct.
- eventRefsUsed must only contain ref values provided in the TOP EVENTS list above.
- If there is nothing notable to narrate, write a short neutral update instead of inventing events.
- Do not invent deaths, GP earnings, AP grants, NCRIs, or quest completions that are not in the digest.`;
}
