# Storyteller + Projector Dashboard Backlog

Date: 2026-06-01

Status: Active working list for James-controlled Storyteller/dashboard iteration.

Related docs:

- `docs/superpowers/specs/2026-06-01-autonomous-storyteller-design.md`
- `docs/2026-05-28-storyteller-design.md`
- `docs/2026-05-28-attention-loop-and-storyteller-tasks.md`
- `docs/city-dashboard-integration.md`
- `../rs6-nullcity-residents-dashboard/AGENTS.md`
- `../rs6-nullcity-residents-dashboard/spec/09-implementation-roadmap.md`

## Purpose

Make the Storyteller and public `/overview` page the live attention router for Null City at OnionDAO.

Humans should be able to glance at one projector page and understand:

- what just happened;
- who matters right now;
- where the action is;
- what danger, opportunity, or comedy is developing;
- what humans might usefully do next.

The Storyteller should feel sharp, weird, fantasy/cyberpunk, and DCC-adjacent without becoming an old-fashioned news anchor or imitating a copyrighted voice directly. It must stay grounded in real evidence.

## Ownership Boundary

- Server repo owns JSON artifacts, evidence frames, run cadence, model calls, verification, public-safe read models, and admin control APIs.
- Dashboard repo owns `/overview`, visual layout, projector/mobile rendering, dashboard links, admin UI, and all human-facing screens.
- No human-facing UI belongs in `rs6-nullcity-server`.

## Current Working State

- `/overview` exists in the dashboard and is public/read-only.
- The page shows `Null City Live`, Storyteller copy, key fact cards, live atlas, metrics, leaderboards/drama/watch lists, and a dashboard escape link.
- Storyteller can run against live digests and publish canon artifacts.
- OpenRouter/Sonnet-class inference has been proven manually with a cost cap.
- Current output is useful but still too dependent on shallow digests and dashboard-side stitching.
- The next leap is making Storyteller choose what matters reliably, then publishing one coherent public-safe frame that narration, map, stats, and watch lists all share.

## P0: Make Storyteller Real

- [ ] **P0-S0: Fail closed before autonomous publishing.**
  - Repo: server and dashboard.
  - Goal: public projector routes render only a verified `published-frame`/`latest-frame` or deterministic fallback, never candidate, review-needed, dry-run, malformed, or failed model text.
  - Add fixtures proving a newer review/dry-run artifact cannot outrank an older safe public artifact.
  - This is the first implementation safety rail; admin deletion after the fact is not enough for a live projector.
  - Progress 2026-06-01: dashboard Storyteller digest reader now strips public dispatch copy from dry-run, review, and review-needed canon artifacts; `/overview` now selects safe canon dispatch copy over newer unsafe draft text. Full server-owned `latest-frame` path remains open.
  - Progress 2026-06-03: server scheduler/run path now keeps clean candidate dispatch text out of public `latest-frame.json`; only the overseer can promote verified dispatch copy to projector narration.

- [ ] **P0-S1: Configure Storyteller model activation through normal ops config.**
  - Repo: server.
  - Goal: Storyteller uses a Sonnet-class OpenRouter profile without one-off shell exports.
  - Include env/config docs for `STORYTELLER_LLM_BASE_URL`, `STORYTELLER_LLM_API_KEY`, `STORYTELLER_LLM_MODEL`, and `STORYTELLER_DAILY_COST_CAP_USD`.
  - Keep secrets out of git.
  - Progress 2026-06-03: `storyteller:run` and `storyteller:scheduler` accept `--controller-config` / `STORYTELLER_CONTROLLER_CONFIG`, so a named controller `llm.profiles` entry such as `openrouter_storyteller` can be used without one-off endpoint exports.

- [ ] **P0-S2: Build a deterministic public projector frame.**
  - Repo: server.
  - Goal: produce a single public-safe `ProjectorStoryFrame` or equivalent that includes narration, events, residents, map pins, actions, calls to action, watch-next, source freshness, and public health.
  - Dashboard should consume this frame instead of independently stitching Storyteller artifacts to live positions.
  - Separate artifacts: internal frame, prompt packet, candidate dispatch, verifier result, published frame, latest frame, overrides, and overseer ledger.

- [ ] **P0-S3: Add narrative relevance scoring before caps.**
  - Repo: server.
  - Goal: rank residents/events before slicing so the main actor is not dropped alphabetically.
  - Prioritize death/fade, saved state, low AP, AP recovery, combat, NCRI, AP-for-GP, GP proof, goal progress, human interaction, multi-resident clusters, and system drama.

- [ ] **P0-S4: Make evidence refs and source freshness first-class.**
  - Repo: server.
  - Goal: every narratable event has typed refs, age, source family, and public/private treatment.
  - Show omitted counts when caps hide lower-priority data.

- [ ] **P0-S5: Expand the model prompt packet.**
  - Repo: server.
  - Goal: Storyteller sees structured locations, recent actions, speech summaries, human actions, AP/GP/NCRI proof, map focus candidates, calls to action, and what was omitted.
  - Treat resident speech, letters, and free-text notes as untrusted data, never as instructions.

- [ ] **P0-S6: Add claim-level verification and fallback publication.**
  - Repo: server.
  - Goal: public copy only publishes when claims are grounded; failed or malformed model output is never rendered publicly.
  - Fallback copy must be template-only from typed public-safe fields.
  - Reject wrong actor, wrong amount, wrong item, wrong location, stale position, duplicate refs, private ids, AP/GP conflation, and invented motive.

- [ ] **P0-S7: Implement real autonomous cadence.**
  - Repo: server.
  - Goal: cheap frame builder refreshes frequently; Sonnet narration runs on cadence only when useful.
  - Include dedupe, cooldowns, single-writer lease, budget cap, pessimistic unknown-cost handling, request timeout, retry/backoff, and circuit breaker.

- [ ] **P0-S8: Add event-trigger aggregation.**
  - Repo: server.
  - Goal: important events trigger a Storyteller window ahead of the normal cadence after a short aggregation delay.
  - Triggers: death/fade/revival/saved, low AP/recovery, combat, AP-for-GP, GP proof, NCRI lifecycle, Soul birth/proposal, verified goal completion, major human action, clusters, and system outages/recoveries.

- [ ] **P0-S9: Add admin escape hatch.**
  - Repo: server first, dashboard second.
  - Goal: edit, suppress/delete, and restore a public Storyteller message with append-only audit history.
  - No normal review queue; this is only for emergency correction.

## P0: Make `/overview` Projector-Grade

- [ ] **P0-D1: Consume the server public frame.**
  - Repo: dashboard.
  - Goal: dashboard BFF exposes `GET /api/projector/overview` and `/overview` renders only public-safe frame fields.
  - The frontend should not invent narrative state or render candidate/review-needed model output.

- [ ] **P0-D2: Protect the first viewport.**
  - Repo: dashboard.
  - Goal: on a 16:9 projector, users can understand main event, location, and what to watch/do without scrolling.
  - Keep story, map, and top stakes above the fold.

- [ ] **P0-D3: Improve Storyteller readability.**
  - Repo: dashboard.
  - Goal: split body copy into readable paragraphs, keep type projector-readable but not huge, and make key fact cards scannable without becoming a wall of boxes.

- [ ] **P0-D4: Make right rail high-signal only.**
  - Repo: dashboard.
  - Goal: remove duplicate or low-quality filler; show one combined Top Things/Live Focus rail with a limited set of Danger/Drama, Watch Next, AP/GP/NCRI, and human-action items when they are meaningful.
  - Move full leaderboards and long feeds below the fold.

- [ ] **P0-D5: Make the map follow the story.**
  - Repo: dashboard, based on server frame data.
  - Goal: focus viewport on the lead event or densest important cluster; highlight event pins, protagonist pins, off-map clusters, and place labels.
  - If no spatial event matters, let story/stakes grow instead of showing a decorative map.
  - Progress 2026-06-01: current `/overview` model now selects the lead resident viewport or highest-scoring active cluster instead of always using Lumbridge. Server-frame-driven event pins, richer place labels, and viewport-specific map art remain open.

- [ ] **P0-D6: Keep dashboard navigation obvious.**
  - Repo: dashboard.
  - Goal: `/overview` remains public/projector-friendly while still offering a clear path back to the rest of the dashboard for admins.

## P1: Richer Context And Continuity

- [ ] **P1-S10: Track ongoing story arcs.**
  - Repo: server.
  - Goal: maintain "previously in Null City" continuity, unresolved dangers, repeated character beats, and arc state across dispatches.

- [ ] **P1-S11: Add resident character memory to Storyteller packets.**
  - Repo: server.
  - Goal: include goals, personality constraints, recent quotes/speech summaries, relationships, and recurring behavior without leaking private data.

- [ ] **P1-S12: Add human action summaries.**
  - Repo: server/dashboard as data allows.
  - Goal: summarize AP grants, asks, witnesses, offers, letters, trades, and useful interventions with public aliases.

- [ ] **P1-S13: Add stronger economy/drama sources.**
  - Repo: server.
  - Goal: structured AP delta, GP amount/item id, NCRI ownership/print state, trade evidence, and goal-completion evidence.

- [ ] **P1-S14: Add Storyteller quality evaluation.**
  - Repo: server.
  - Goal: fixtures score accuracy, specificity, drama, usefulness, JSON validity, latency, and cost across model choices.

- [ ] **P1-D7: Add dispatch history / chronicle view.**
  - Repo: dashboard.
  - Goal: latest projector page stays focused, but admins/humans can drill into previous dispatches and evidence.

- [ ] **P1-D8: Add feedback labels.**
  - Repo: dashboard/server.
  - Goal: admins can mark Storyteller output as boring, wrong, useful, great, too much, or unsafe, feeding future prompt/model tuning.

- [ ] **P1-D9: Add projector mode polish.**
  - Repo: dashboard.
  - Goal: full-screen mode, stale-data indicator, optional panel rotation, large-room contrast, and mobile fallback.

## P2: Event Experience And Stretch Ideas

- [ ] **P2-S15: Generate special epilogues for saved residents.**
  - Repo: server.
  - Goal: when a resident completes a verified goal, Storyteller creates a distinct public moment and optional Library hook.

- [ ] **P2-S16: Add weekly/daily chronicle summaries.**
  - Repo: server/dashboard.
  - Goal: long-form recap after the live event stream has enough durable evidence.

- [ ] **P2-D10: Audio or venue narration mode.**
  - Repo: dashboard/event tooling.
  - Goal: optionally read or display major events in a venue-safe way.

- [ ] **P2-D11: Deeper map drilldown.**
  - Repo: dashboard.
  - Goal: click pins/regions to inspect resident pages, events, nearby agents, and route history.

## Test And Fixture Backlog

- [ ] **T1: AP emergency fixture.**
  - Low AP resident should trigger urgency, public-safe call to action, and no invented death.

- [ ] **T2: Death/fade/revival fixture.**
  - Death/fade claims require explicit evidence and produce dramatic but safe copy.

- [ ] **T3: AP-for-GP fixture.**
  - Verifies AP and GP are not conflated and RuneScape coin/item evidence is cited.

- [ ] **T4: NCRI lifecycle fixture.**
  - Mint/sale/redemption/print claims require structured NCRI evidence.

- [ ] **T5: Goal completion/saved fixture.**
  - Storyteller may celebrate only verified completion, not aspiration.

- [ ] **T6: Cluster/map fixture.**
  - Lead map viewport follows the important cluster, not a default place.

- [ ] **T7: Quiet city fixture.**
  - Quiet output is still interesting, honest, and does not spend a paid call unless freshness requires it.

- [ ] **T8: Prompt injection/private text fixture.**
  - Resident speech, patron letters, URLs, Discord handles, emails, raw `human:`/`patron:` ids, file paths, API-key-shaped strings, and hostile text cannot steer model instructions or leak publicly.

- [ ] **T9: Bad model output fixture.**
  - Malformed JSON, unknown refs, wrong amounts, stale locations, invented motives, and AP/GP confusion fall back.

- [ ] **T10: Concurrency/budget fixture.**
  - Concurrent scheduler ticks cause at most one paid call; budget exhaustion keeps frame updates alive with fallback.

- [ ] **T11: Public latest artifact fixture.**
  - Newer review/dry-run/candidate artifacts with unsafe text never appear on public `/overview` or public JSON.
  - Progress 2026-06-01: added dashboard tests for review/dry-run/review-needed dispatch copy stripping and `/overview` safe-canon preference. Candidate artifact and future `latest-frame` fixtures remain open.
  - Progress 2026-06-03: added server tests for direct `storyteller:run` candidate suppression, clean review-queue fallback, and unknown-cost model output holding.

- [ ] **T12: Override fixture.**
  - Suppressed/deleted dispatches never appear publicly; restore is blocked if the original no longer passes public verification.

## Working Order

1. P0-S0 and T11: make the current projector fail closed immediately.
2. P0-S2, P0-S3, P0-S4: create the model-free public frame and trustworthy evidence selection.
3. P0-S6, T8, T9: make public publishing safe before relying on autonomy.
4. P0-D1, P0-D2, P0-D3, P0-D4, P0-D5: make `/overview` render the frame well.
5. P0-S1, P0-S7, P0-S8, T10: wire smart model automation, cadence, triggers, and cost controls.
6. P0-S9 and T12: give admins emergency controls.
7. P1 continuity, feedback, and chronicle work once the live loop is dependable.

## Notes For Future Agents

- Claim the smallest item you can finish and verify.
- Keep server and dashboard commits separate unless James asks otherwise.
- For server work, run `npm run check:no-ui`.
- For dashboard UI work, run focused Bun tests plus `bun run --filter '@nullcity-dashboard/web' check` and `bun run --filter '@nullcity-dashboard/web' build`; use browser screenshots for visible changes.
- Do not print, commit, or document API keys.
