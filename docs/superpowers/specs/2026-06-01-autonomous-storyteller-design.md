# Autonomous Storyteller Design

**Date:** 2026-06-01  
**Status:** Approved direction, ready for implementation planning after maintainer review.  
**Scope:** Null City server read models, Storyteller run loop, dashboard projector feed contract, and admin override controls.  
**Related docs:** `docs/2026-05-28-storyteller-design.md`, `docs/superpowers/specs/2026-05-30-storyteller-overseer-design.md`, `docs/capability-evidence/2026-05-31-s-apgp-story-live-digest-qa-1.md`.

## Purpose

The Storyteller is the autonomous showrunner for the OnionDAO projector. Humans should be able to glance at one webpage and understand what is happening, who matters right now, where the action is, and why the city has drama.

The Storyteller must use a smart model, preferably a Sonnet-class OpenRouter model, but it must stay grounded in bounded evidence. It is not an admin draft queue. Admins will be busy. The system publishes automatically, falls back automatically, and exposes an audited escape hatch for edits, suppressions, or deletions when something public needs correction.

## Decisions

- **Autonomous publishing:** No normal admin review gate. A model dispatch publishes if the machine verifier accepts it.
- **Fallback-first safety:** If model output fails verification, the projector still updates using deterministic grounded fallback copy.
- **Smart model:** Use OpenRouter Sonnet for Storyteller narration, separate from resident body/brain inference.
- **Projector priority:** The public `/overview` page is the primary consumer and should lead with Storyteller narration, map callouts, top actions, and watch items.
- **Server/dashboard boundary:** Server owns JSON artifacts, run loop, verification, and control APIs. Dashboard owns human-facing UI.
- **Admin override:** Admins can edit, suppress, or delete public Storyteller messages after publication. Overrides are audited and should not destroy the original evidence artifact.

## Current Gaps

The existing substrate is close but not real yet:

- `storyteller:run` currently reads only `STORYTELLER_LLM_*` environment variables. It does not automatically use `controller.yml`'s `openrouter_storyteller` profile.
- `.env.example` documents OpenRouter keys, but not the actual `STORYTELLER_LLM_BASE_URL`, `STORYTELLER_LLM_API_KEY`, `STORYTELLER_LLM_MODEL`, or `STORYTELLER_DAILY_COST_CAP_USD` variables needed by the runner.
- The current `CityEventDigest` is capped at 8 residents/top events and orders resident snapshots alphabetically before slicing, which can omit the main actor.
- The model prompt sees resident snapshots and top events, but not enough coordinates, actions, recent speech, human/patron activity, map context, or source freshness.
- The dashboard projector currently stitches Storyteller artifacts to live positions in the browser. That works for V1, but the real Storyteller should receive and publish a server-built frame so narration, map, and action lists share evidence refs.
- The latest local Storyteller artifact was stale relative to newer economy events, so freshness must be an explicit part of the frame.

## Model Activation

Use the existing OpenAI-compatible `LlmClient` path. Because the client appends `/v1/chat/completions`, the OpenRouter base URL should be:

```text
STORYTELLER_LLM_BASE_URL=https://openrouter.ai/api
STORYTELLER_LLM_API_KEY=<openrouter key>
STORYTELLER_LLM_MODEL=anthropic/claude-sonnet-4.5
STORYTELLER_DAILY_COST_CAP_USD=<small event cap>
```

The model slug should remain configurable. Before the event run loop is enabled, run a tiny fixture probe to confirm the currently preferred Sonnet slug and provider behavior. If Sonnet is unavailable, fail over to deterministic fallback rather than routing Storyteller traffic to resident inference.

## Run Cadence

The runtime has two layers:

1. **Frame builder:** Cheap, deterministic, no model call. It can refresh frequently, such as every 15-30 seconds, so the map/action feed stays fresh.
2. **Narration loop:** Sonnet-backed, budgeted, and deduplicated. Default event-day cadence is every 5 minutes when meaningful changes exist, with a 10-minute maximum quiet refresh.

Important events may trigger an earlier narration pass after a short aggregation delay. Suggested MVP trigger behavior:

- Aggregate trigger events for 60-90 seconds so related events land in one dispatch.
- Do not run paid narration more often than every 2 minutes unless manually forced.
- Deduplicate repeated top-event fingerprints inside a 30-minute window.
- If the daily cap is exhausted, keep building frames and publish fallback updates.

## Important Event Triggers

These events should be considered narratively important:

- Resident death, fade, revival, or saved-state transition.
- Low-AP emergency or recovery from low AP.
- AP-for-GP exchange.
- Significant GP earning, trade, or inventory proof.
- NCRI minted, sold, transferred for value, redeemed, or physically printed.
- Soul proposal funded, approved, born, or rejected.
- Goal completed, quest completion verified, or resident enters the Library.
- Major patron/human action, including AP grant, offer, ask, witness, or useful letter.
- Multi-resident interaction or unusual cluster of coordinated actions.
- System drama that affects the public story: controller outage, inference outage, many stuck residents, or recovery from those states.

Quiet routine ticks should not spend Sonnet unless needed to keep attendees oriented.

## ProjectorStoryFrame

Create a public-safe server-produced frame that the dashboard can render directly:

```ts
interface ProjectorStoryFrame {
  schemaVersion: 1;
  frameId: string;
  asOf: string;
  window: {
    start: string;
    end: string;
    builtAt: string;
    freshnessMs: number;
    staleSources: string[];
  };
  narration: {
    status:
      | 'model_published'
      | 'fallback_published'
      | 'held_duplicate'
      | 'held_no_delta'
      | 'held_budget'
      | 'held_model_error'
      | 'suppressed'
      | 'deleted'
      | 'edited';
    title: string;
    body: string;
    bullets: string[];
    modelProfile?: string;
    generatedAt?: string;
    eventRefsUsed: string[];
    confidence: 'high' | 'medium' | 'fallback';
  };
  events: Array<{
    ref: string;
    kind: string;
    importance: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
    ts: string;
    residentIds: string[];
    summary: string;
    location?: { x: number; y: number; level?: number };
    targetLocation?: { x: number; y: number; level?: number };
    action?: { kind: string; result?: string };
    evidenceRefs: string[];
  }>;
  residents: Array<{
    id: string;
    displayName: string;
    online: boolean;
    attention?: number;
    lowAp: boolean;
    faded: boolean;
    saved: boolean;
    goal?: string;
    position?: { x: number; y: number; level?: number };
    currentAction?: string;
    latestSpeech?: string;
    gpObserved?: number;
  }>;
  map: {
    selectedViewport: {
      id: string;
      label: string;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    };
    pins: Array<{
      residentId: string;
      label: string;
      x: number;
      y: number;
      level?: number;
      tone: 'event' | 'ok' | 'watch' | 'quiet';
      eventRef?: string;
    }>;
    offMapRegions: Array<{ label: string; residents: string[] }>;
  };
  actions: Array<{
    residentId?: string;
    label: string;
    kind: string;
    result?: string;
    targetLocation?: { x: number; y: number; level?: number };
    evidenceRef: string;
    freshnessMs: number;
  }>;
  humanActions: Array<{
    actorLabel: string;
    kind: string;
    summary: string;
    evidenceRef: string;
    freshnessMs: number;
  }>;
  health: {
    sourceCounts: Record<string, number>;
    omittedCounts: Record<string, number>;
    warnings: string[];
  };
}
```

This frame should be built beside `digest.json` and `dispatch.json`, with a stable `latest.json` or `latest-frame.json` pointer for consumers.

## Data Smoothing

Before capping, the server should score residents and events by narrative relevance:

- Critical events first: death/fade, saved state, verified goal completion, NCRI, AP-for-GP, GP proof.
- Lead resident from top event.
- Live position and recent action.
- Low AP, in combat, or warning state.
- Recent speech or human interaction.
- Online residents with fresh telemetry.

Caps remain necessary, but omitted counts must be explicit. The model should know that 8 residents were shown out of 23, and why those 8 were selected.

Structured fixes needed:

- Add structured `observedGpAmount`, `itemId`, and `sourceRef` for GP observations instead of relying on prose notes.
- Include resident position/action/freshness in digest/frame resident snapshots.
- Include source refs or evidence labels for every narratable claim.
- Prefer stable resident ids over name-only joins where available.
- Select map viewport from the lead event or densest important cluster, not always Lumbridge.

## Prompt Contract

The Storyteller prompt should receive the shaped frame or a frame-derived prompt packet, not raw unbounded logs.

The prompt should instruct the model to:

- Write in the Null City Storyteller voice: irreverent dungeon-show civic archivist, onion/Chicago/tech weirdness welcome, but not a direct imitation of any author.
- Keep AP and GP distinct.
- Use specific resident names, places, and stakes.
- Mention where the action is when location data exists.
- Never invent deaths, births, goal completions, AP grants, GP earnings/trades, NCRIs, patron actions, motives, or private identities.
- Return strict JSON.
- Include only event refs present in the input.

The output should support projector rendering:

- `publicTitle`
- `publicBody`
- `publicBullets`
- `operatorSummary`
- `eventRefsUsed`
- `mapFocusRefs`
- `watchNext`
- `confidence`

## Verification And Fallback

The verifier remains the gate between model output and public publication. It should reject or downgrade:

- Unknown event refs.
- Unsupported critical claims.
- AP/GP conflation.
- Private handles, numeric ids, Discord names, email addresses, or raw patron ids.
- Claims about locations or actions not present in evidence.
- Overly long or malformed JSON output.

If verification fails:

1. Record the failed model artifact for debugging.
2. Publish deterministic fallback copy from the same frame.
3. Mark `narration.status = 'fallback_published'`.
4. Keep the projector current.

This is intentionally not an admin review queue.

## Admin Overrides

Admins need an emergency brake without becoming part of the normal publishing path.

Provide server-side control APIs or CLI commands, with dashboard UI later:

- `suppress`: remove a dispatch from the public projector/feed while preserving the original artifact.
- `delete`: stronger public removal alias for suppress; original evidence remains in audit storage.
- `edit`: publish an amended title/body/bullets overlay with editor, timestamp, and reason.
- `restore`: remove the override and show the original again.

Override records should be append-only:

```ts
interface StorytellerOverride {
  overrideId: string;
  dispatchId: string;
  action: 'suppress' | 'delete' | 'edit' | 'restore';
  createdAt: string;
  actor: string;
  reason: string;
  replacement?: {
    title?: string;
    body?: string;
    bullets?: string[];
  };
}
```

Dashboard public views must honor overrides. Operator/debug views may show the original and override history.

## Dashboard Contract

The dashboard should render the server-produced frame via a public-safe endpoint such as:

```text
GET /api/projector/overview
```

The dashboard BFF can proxy the controller frame when the controller endpoint is configured, with local filesystem fallback in dev. The frontend should not perform model calls or invent narrative state. Its job is presentation:

- Lead dispatch.
- Map and pins.
- Top resident actions.
- Top human actions.
- Watch-next list.
- Freshness/confidence indicator.
- Links to resident/detail pages.

## Acceptance Criteria

- A tiny Sonnet fixture run succeeds through OpenRouter with cost cap enforcement.
- A live run publishes a model dispatch without admin review when verifier passes.
- If the model call fails or verifier rejects it, `/overview` still updates with fallback narration.
- Important events can trigger a Storyteller run or aggregation window ahead of normal cadence.
- Death/fade, NCRI, AP-for-GP, goal completion, and Soul events are visible in the frame when present.
- The model receives structured location/action/human context for projector-grade narration.
- The selected map viewport follows the lead event or action cluster.
- `latest-frame.json` or equivalent gives consumers a stable fresh artifact.
- Admins can edit, suppress/delete, and restore a dispatch with append-only audit history.
- Server repo exposes JSON/control APIs only; no human-facing UI is added to server.
- Dashboard `/overview` consumes the frame and does not run inference.

## Out Of Scope For First Implementation

- External publishing to Discord, Twitter, email, or audio systems.
- Model-decided persona changes.
- Long-form essays or archival chapter writing.
- Letting Storyteller control residents.
- Replacing resident speech with Storyteller speech.

