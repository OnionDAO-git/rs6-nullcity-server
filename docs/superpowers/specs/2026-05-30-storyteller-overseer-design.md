# Storyteller Overseer — Design (S-STORY)

**Status:** Design draft. Awaits maintainer approval before any cron schedule or paid-model cap is enabled.
**Author:** claude (autonomous, D-WEEKEND-DESIGN packet).
**Date:** 2026-05-30.
**Roadmap:** Workstream S, parent task S7 (Storyteller model run). Builds on S6 digest + S7a verifier + S7b CLI which are already in code.
**Read first:**
- `docs/2026-05-28-storyteller-design.md` — original Storyteller product brief.
- `docs/2026-05-29-cic-meetup-decisions.md` — Storyteller is "locked" but should not invent over a weak loop.
- `src/controller/storyteller/{digest-builder,verifier,run-cli,prompt-builder}.ts` — substrate.
- `src/controller/storyteller/types.ts` for `CityEventDigest` and `StorytellerDispatch`.

---

## Purpose

The Storyteller is the gated narrator that turns AP/GP/NCRI/goal evidence into public canon for the OnionDAO viewer surface. The substrate (digest + verifier + dry-run + one-shot model-backed CLI) shipped over the weekend. **What is still unspec'd:** how the Storyteller *runs continuously* without inventing facts, blowing budget, or repeating itself; what the narrator persona is and how spicy it can be; how dashboard consumers know whether a dispatch is fresh, stale, or `needs_review`; and how the operator approves/rejects a draft before it becomes public.

This spec exists so we can build the Overseer (the continuous-mode wrapper around `storyteller:run`) once the maintainer answers the four product decisions in §Decisions to make. It also unblocks dashboard D5 evolution from "show the latest dispatch" to "show a canonical, operator-approved feed."

## Decisions to make (maintainer-blocking)

1. **Narrator name and persona.** Open since the original sprint plan. Candidates: a single named narrator ("The Archivist of Null City"), an unnamed chorus voice, or a rotating cast (one of `res:duke`/`res:hans` writes the digest in-character). Pick one before the persona prompt block is frozen.
2. **Cadence.** Original brief floated ~10 minutes between paid runs. CIC scope cut said this can only run after cost caps exist. Pick: every N minutes (fixed), every N significant events (event-triggered), or operator-only (no cron). Default proposal: event-triggered with floor + ceiling.
3. **Cost ceiling per day.** Hard daily cap in dollars or tokens; when the cap trips, fall back to dry-run only. No cron schedule should ship without this.
4. **Operator approval gate.** Should a dispatch with zero `needs_review` warnings publish automatically, or always wait for operator approval? Default proposal: zero-warning auto-publish, any warning blocks until approval.

## Proposed approach

Wrap the existing one-shot `storyteller:run` into an **Overseer loop** that owns cadence, cost accounting, deduplication, and publish-vs-hold decisions. The Overseer never invents facts because it only ever calls `storyteller:run` over `CityEventDigest` data the verifier already approves.

### Architecture

```
                   ┌────────────────────────────────────────────────────┐
                   │ StorytellerOverseer  (new: src/controller/         │
                   │                       storyteller/overseer.ts)    │
                   │                                                    │
  cron / event ──▶ │ 1. Read EconomyEventLog tail; detect "significant │
                   │    delta" (new ncri_sale, soul_born, exchange,    │
                   │    death, AP burnout, etc).                       │
                   │ 2. Build digest (existing digest-builder).        │
                   │ 3. Check dedupe: was this digest's top-event-set  │
                   │    already narrated within DEDUP_WINDOW?          │
                   │ 4. Check cost ledger (today's spend vs cap).      │
                   │ 5. If green: invoke storyteller:run with the      │
                   │    persona/profile; otherwise dry-run only.       │
                   │ 6. If dispatch has zero warnings AND auto-publish:│
                   │    move to `canon/`; else hold in `review/`.      │
                   │ 7. Append to OverseerLedger (run id, digest id,   │
                   │    cost, decision, refs).                         │
                   └────────────────────────────────────────────────────┘
```

### Persona prompt envelope (proposed)

The current `prompt-builder.ts` builds a JSON-shaped prompt with `publicTitle`/`publicBody`/`publicBullets`/`operatorSummary`/`operatorWarnings`/`eventRefsUsed`. The Overseer adds one block:

```
PERSONA: <one paragraph from config: name, voice, what they care about, what they refuse to do>
GROUNDING RULES: speak only of events present in eventRefs; never invent deaths, births, AP/GP movement, NCRI transactions, or quest completions; redact private handles; when in doubt mark needs_review.
```

The persona is **config-only**, not LLM-decided, so it cannot drift between runs.

### Dedup / no-repeat

Each digest gets a `topEventFingerprint` = stable hash of `(top 3 event refs sorted)`. The OverseerLedger remembers fingerprints for `DEDUP_WINDOW` (default 30 min). If a fingerprint repeats inside the window, the Overseer skips the paid call and emits a `held:duplicate` ledger row instead.

### Publishing surface

- `data/controller/storyteller/canon/<run-id>/dispatch.json` — operator-approved or auto-approved dispatches. Dashboard `GET /api/nullcity/storyteller/canon` returns the last N.
- `data/controller/storyteller/review/<run-id>/dispatch.json` — awaiting operator. Dashboard `GET /api/nullcity/storyteller/review` returns the queue.
- `data/controller/storyteller/dry-run/<run-id>/digest.json` — Overseer's grounding evidence (already produced by S6).
- `data/controller/storyteller/overseer-ledger.jsonl` — append-only audit: run id, digest id, fingerprint, decision (`paid` / `held:budget` / `held:duplicate` / `held:no-delta`), cost, model profile.

### Cost guardrails

- Per-day spend ceiling lives in `config/controller.yml` under `storyteller.overseer.costCapUsdPerDay`. Default `0` = paid runs disabled.
- Every paid invocation records `costUsdEstimate` (S7b already does this) and the Overseer rolls today's sum.
- Hitting the cap triggers `held:budget` for the rest of the UTC day; the Overseer still runs `storyteller:dry-run` so the dashboard stays fresh, just without narrated public copy.

### Avoiding fact invention (verifier-first)

The Overseer never short-circuits the existing verifier. Every paid run still passes through `verifier.ts`; warnings still gate auto-publish. Three additional guards specific to the Overseer:

1. **Empty-digest skip:** if the digest has zero events in any bucket, skip entirely (no "city was quiet today" filler).
2. **Refs-must-resolve:** verifier already checks unknown refs; Overseer also checks every `eventRefsUsed` resolves to an EconomyEvent or Library event with timestamp ≤ digest window.
3. **Persona-only language:** the persona block is allowed to use flavor adjectives ("a small triumph", "a quiet morning") but the operator-text generation prompt strips any phrase matching `unsupported_phrases` (death, birth, achievement, victory) when no corresponding event exists in `eventRefsUsed`.

## Definition of done

- `src/controller/storyteller/overseer.ts` + tests build digest, decide paid-vs-dry-run, dedupe, gate on cost cap, and write to the correct surface.
- New CLI: `npm run storyteller:overseer -- --tick` runs one Overseer cycle deterministically (tests).
- New CLI: `npm run storyteller:overseer -- --watch --interval-ms <N>` runs continuously with hot-reloadable config.
- `config/controller.yml.example` documents `storyteller.overseer.{persona, cadence, costCapUsdPerDay, dedupWindowMs, autoPublishOnZeroWarnings}`.
- `OverseerLedger` is append-only; replay is deterministic.
- `GET /api/nullcity/storyteller/canon` + `GET /api/nullcity/storyteller/review` return JSON arrays of `{runId, digestId, publishedAt, fingerprint, dispatchSummary}`.
- `docs/city-dashboard-integration.md` documents canon and review routes; `npm run check:no-ui` passes.
- A focused test proves: empty digest → skipped; duplicate fingerprint → `held:duplicate`; over cost cap → `held:budget`; zero warnings + auto-publish → moved to `canon/`; any warning → moved to `review/`.

## Open questions

- **OQ-1:** Should canon be append-only forever, or can the operator unpublish? Default: append-only (Storyteller is canon).
- **OQ-2:** When two residents do an AP-for-GP exchange in the same tick, does the Overseer narrate both as one event or two? Probably one with both refs; needs taste.
- **OQ-3:** Should the persona file itself live in `data/controller/storyteller/persona.md` (operator-editable, hot-reload) or `config/controller.yml` (deploy-time only)? Default: persona.md.
- **OQ-4:** Should the Overseer ever delete dry-run artifacts older than N days, or keep forever? Default: rotate after 30 days.

## Out of scope

- LLM-decided persona evolution (the narrator's voice does not change without operator edit).
- Multi-language dispatches.
- Storyteller publishing to external surfaces (Twitter, Discord). External fan-out is downstream of canon; not in this spec.
- Replacing the in-game `say` voice of any specific resident with the Storyteller's voice.
- Long-form essays. Dispatches stay short (the existing prompt enforces ≤200 words public body).

## Packet decomposition

- **S-STORY-1: Overseer skeleton + dry-run loop** (cloud-doable). Build `overseer.ts` + `OverseerLedger` + the cron-tick CLI. No paid calls. Tests: empty-digest skip, duplicate fingerprint, ledger append, refs-resolve guard. DoD: `npm run storyteller:overseer -- --tick` produces a deterministic ledger row for a fixture digest. **No live stack needed.**

- **S-STORY-2: Cost cap + publish surface** (cloud-doable). Add `costCapUsdPerDay`, `autoPublishOnZeroWarnings`, `held:budget` decision, and the `canon/` vs `review/` surfaces. Add `GET /api/nullcity/storyteller/canon` + `/review` routes (JSON only). Tests: budget exhaustion, zero-warning auto-publish, warning hold. DoD: dashboard can read canon + review queues from JSON. **No live stack needed.**

- **S-STORY-3: Persona + watch mode** (needs paid endpoint). Wire persona prompt block, implement `--watch --interval-ms`, run one real paid dispatch with a configured model profile, prove the output is grounded (no invented facts) and recorded with cost metadata. DoD: one canon entry produced from a real digest using a real model profile, total cost ≤ $0.50. **Needs hot stack + paid profile.**
