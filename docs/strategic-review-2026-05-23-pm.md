# Strategic Review — 2026-05-23 PM (9-day IRL countdown)

**Written by:** claude (autonomous), at the maintainer's "refresh the process, do a deep dive on designs and tasks, and keep going" request.

**Context:** OnionDAO Chicago IRL event is **2026-06-01** — nine days from today. This review supersedes the morning review (`docs/strategic-review-2026-05-23.md`) as the canonical state-of-play. It is grounded in three parallel deep-dive audits run at `e4479326` on `agents/wip`: subsystem audit, IRL event-readiness audit, multi-agent coordination audit. All three audits are summarized below with verbatim conclusions where they matter.

---

## TL;DR

**Substrate is excellent. Wiring is hollow.** The team has shipped a beautiful root system — 1300+ tests, clean module decomposition, real Zod schemas, idempotent persistence, an entire MCP routine facade, hero souls, faction affinity, embassy region, currency + standing ledgers, three kinds of letter producers, two cross-resident events (fire_lit + whisper), trajectory moment labels, a library-of-souls reader plumbed into the prompt envelope. **And yet, if the event ran tomorrow, almost none of it would touch a human.** Letters are produced into `/dev/null` (PatronGateway has no LettersStore). Patrons can't pick a resident to support without a staff member opening a terminal. The embassy has no reception NPC and no event schedule loaded. The death loop — the central narrative payoff of the entire project — has no detector.

**The single most important thing right now is wiring, not new substrate.** The next 9 days are about closing the substrate-to-human gap.

---

## Pillar scorecard (revised since morning review)

| Pillar | Substrate | Wired in tick | Reaches a human |
|---|---|---|---|
| 1: Autonomous agents play RuneScape | ✅ shipped | ✅ wired (resident-runtime + Spark + Brain + Nervous System) | ✅ visibly playing (live combat-prayer + woodcutting-firemaking proofs) |
| 2: Human guidance | ✅ shipped (RB-MCP α/β/γ/δ/ε all done) | ✅ wired (HTTP server live; codex's operator-proof landed) | ⚠️ only via terminal / curl; no operator UI |
| 3: Emotional connection | ✅ shipped (patron loop, letters x3 kinds, faction, heroes, embassy, lore-bus, fire-lit, whisper, moment-labels, embassy schedule) | ❌ MOSTLY DORMANT (see Dormant Substrate Inventory below) | ❌ nothing reaches a human attendee yet |

**Pillar 3 is the bottleneck.** Every cycle this session has been spent building more Pillar-3 substrate. The next 9 days need to be spent **wiring it**, not extending it.

---

## What's actually shipped (substrate audit, verbatim)

Six subsystem categories audited at `e4479326`:

### Wired ✓ (in the live tick)

- `evidence/trajectory-builder.ts` — `controller-host.ts:268` constructs; resident-runtime calls `beginTick`/`recordAction`/`recordActionResult`/`endTick` at lines 364/380/387/370.
- `evidence/library-updater.ts` — `observePatron` at resident-runtime.ts:328, `observeTrajectory` at :381, `observeProgress` at :431.
- `evidence/library-memories.ts` — `readRecentLibraryMemories` called from `memory-store.ts:41` on every `recentExcerpts(...)`; feeds the prompt envelope's memories field.
- `evidence/progress-tracker.ts` — resident-runtime.ts:108 constructs, :398 calls `observe`.
- `embassy/embassy.ts::deriveEmbassyContext` — `prompt-envelope.ts:84` per-tick.
- `soul/soul-schema.ts::factionAffinity` + `dominantFaction` — `prompt-envelope.ts:83` per-tick.
- `mcp/server.ts` + `mcp/http-server.ts` — `index.ts:31` starts when `--mcp-http-port` set; `run_routine` and `run_workflow_card` tools functional.
- `routines/routine-runner.ts` — instantiated per MCP request; `ResidentRuntime implements RoutineCapableRuntime`.
- `soul/soul-loader.ts` — `controller-host.ts:76` source of truth.
- `patron/patron-store.ts` — `controller-host.ts:99-101` (persists currency + standing JSON atomically).
- `patron/patron-registry.ts` — `resident-runtime.ts:316-342` chat-event → `LibraryUpdater.observePatron` (BUT registry is empty unless caller passes `options.patrons`).

### Dormant substrate (built, never called in production path)

| Module | Entry points awaiting wiring |
|---|---|
| `embassy/embassy-schedule.ts` | `loadEmbassyEventSchedule`, `isEmbassyEventActiveAt`, `nextEmbassyEventStartAfter` |
| `lore/lore-bus.ts` | `new LoreBus()`, `bus.publish`, `bus.subscribe` |
| `lore/fire-lit-reflex.ts` | `new FireLitReflex({ bus })`, `reflex.observe(...)` |
| `lore/whisper.ts` | `publishWhisper(bus, input)`, `whisperInboxFor(bus, residentId)` |
| `evidence/moment-labeler.ts` | `noteFirstLog`/`noteFireLit`/`noteStuckResolved`/`noteUnsafeCombatAvoided` |
| `patron/patron-gateway.ts` (autonomous use) | `offerTo`/`sponsorBirth`/`witnessAt`/`sendGift` — constructed but only invoked from `patron/cli.ts` |
| `patron/letters-producer.ts` (epitaph + civic) | `produceEpitaphLetter`, `produceCivicAchievementLetter` |
| `patron/letters-store.ts` | `new LettersStore(...)` — never constructed in host; `PatronGateway.lettersStore` is `undefined` in production |
| `patron/check-in-tracker.ts` | `recordDailyCheckIn`/`recordReferral`/`recordWorkshopAttendance` |
| `soul/soul-schema.ts::heroProfile` | Schema validates; no production reader for `heroProfile.tier` |

**Highest-leverage single hookup:** the `fire_lit` event is already *detected* in `resident-runtime.ts:1112,1186` for effect-matching. Adding two callback calls at that one site lights up both L-α (LoreBus) and RB-MOMENTS (MomentLabeler) simultaneously.

---

## IRL event readiness — what would actually happen at the door

Simulating Alice's journey end-to-end:

| Step | Today | Gap |
|---|---|---|
| 1. Alice scans badge → `humanId=alice@onion` | Partial (no roster, typo-on-grant splits balance) | S — `humans/` data file + validation |
| 2. Staff: `npm run patron:grant --human alice@onion --amount 10` | ✅ Works | — |
| 3. Alice picks `res:fern` to support | ❌ **HIGH-RISK BLOCKER** — only via terminal | (a) Web/tablet UI; OR (b) chathead menu (J-γ, blocked on engine spike); OR (c) patrons[] in controller.yml + in-game chat trigger |
| 4. PatronGateway → tier crossing → letter | ⚠️ Letter produced into `/dev/null` (PatronGateway has no LettersStore in controller-host.ts:102-109) | EVENT-D1a one-line fix |
| 5. Alice receives the letter | ❌ **HIGH-RISK BLOCKER** — no HTTP endpoint, no web inbox, no in-game scroll, no print bridge | EVENT-D2a + D2b |
| 6. Alice walks avatar to Lumbridge churchyard embassy | ✅ Geometry works; ⚠️ `eventActive` flag will be `false` because no schedule file is loaded | EVENT-D1c |
| 7. Reception clerk greets her by name | ❌ **HIGH-RISK BLOCKER** — no reception NPC, no greeting reflex; heroes exist as souls only | EVENT-D3 |
| 8. She watches res:fern chop tree, light fire | ✅ Mostly works; cross-resident reaction would too once lore-bus is constructed | wire dormant L substrate |
| 9. res:fern dies; epitaph reaches lanyard | ❌ **HIGH-RISK BLOCKER** — no death detector, no epitaph cascade, no print bridge | EVENT-D4 |

**Brutal closing observation from the IRL-readiness audit:** "The codebase shows excellent substrate discipline — 1000+ tests, clean module decomposition, real Zod schemas, idempotent stores. But every layer above 'in-memory or on-disk JSONL' is missing. The team has been building a beautiful root system; nine days out, there is no flower. Days 1-2 of the plan above (4-6 hours of work) recover most of what's already written but unwired. Days 3-4 are where the actual gap is. If only one thing ships from this list, ship Day 4 — the death loop — because it is the only part of this event that nobody else in the world has ever built before, and it is the reason the event exists."

---

## Nine-day landing plan

Tasks in the CLI list as #129-#135. Calendar is aggressive but achievable:

| Day | Date | Slices |
|---|---|---|
| 1 | Mon 5-25 | **EVENT-D1a/b/c** — plumb what's already built (LettersStore into Gateway, patrons[] from yml, embassy-schedule into perception). All three are S-size, all unblock downstream work. End-to-end test: grant → offer → inbox.jsonl contains letter. |
| 2 | Tue 5-26 | **EVENT-D2a/b** — web inbox (HTTP route + 80-line static page). Print bridge stub (`data/print-queue.jsonl`). |
| 3 | Wed 5-27 | **EVENT-D3** — embassy reception greeting reflex + auto-witness when patron-chat-inside-embassy. |
| 4 | Thu 5-28 | **EVENT-D4** — death loop end-to-end. Most narratively important slice in the project. |
| 5 | Fri 5-29 | **Dress rehearsal #1** in-office. One staff plays patron: grant → offer → walk in → watch → kill resident → confirm epitaph hits inbox + print queue. Time the loop. List breakages. |
| 6 | Sat 5-30 | **Fixes from rehearsal + wall ticker MVP** (stretch). `GET /v1/wall/snapshot` + single-page ticker. |
| 7 | Sun 5-31 | **Dress rehearsal #2 + staff runbook.** Write `docs/embassy-staff-runbook.md`. Lock the build — no new code after this day. |
| 8 | Mon 6-1 (event AM) | Setup. Print test letters. Verify schedule + endpoints reachable from event LAN. |
| 9 | Mon 6-1 (event) | Event runs. Staff follows runbook. Bugs go to a list, not the codebase. |

**Deferred to post-event:** Mortician's Ribbon counter, in-game tombstones, K factions combat policy, MCP `run_routine` patron exposure, sponsor-birth UI, J-γ chathead menu (substituted by web UI for the event).

---

## Process refinements landed this cycle

Per the coordination audit (3rd parallel deep-dive), four no-regret changes to `docs/agent-coordination.md`:

1. **Rule 3 merge owner + cadence floor** — addresses the fact that `agents/wip` is 112 commits ahead of `nullcity` with zero squash-merges since the 2026-05-23 cutover. Whoever ships the final HANDOFF on a workstream slice is now the merge owner; 48h-floor with >20 commits triggers a mandatory squash-merge cycle.
2. **Rule 5 hard cap 280 chars** — audit found 68% of status-log entries violated the soft 250-char target (longest at 2486 chars). Hard cap with self-check.
3. **Rule 5 Files: enumeration** — STARTING lines must list each touched file by repo-relative path; the STARTING-without-HANDOFF set is the live lock table.
4. **New Rule 9 — Roadmap is the only shared task tracker.** After this cycle's reconciliation found 7 tasks marked `[pending]` in claude's CLI that were actually `[completed]` in code (shipped by codex/antigravity without flipping the marker), the roadmap markdown file is now the maintainer-facing source of truth. CLI task lists are derived state.
5. **New Rule 10 — No untracked WIP across cycles + never `git add -A`.** Direct fix for the `23cf468d` contamination incident (R-δ slice 2 swept codex's `context-derivation.{ts,test.ts}` into an unrelated commit) and the recurring stash-pull-pop friction.

### Recommendations to the maintainer (out-of-repo)

- **Refresh the cron prompt header.** Two confirmed lies: (a) "BRANCH: nullcity (push directly)" — actual rule since `b5306e65` is `agents/wip`; (b) "DO NOT PICK J/K/L/M/N" — explicitly overridden by the maintainer, and the last 48h of work is predominantly J/K/L/M/N. Suggested replacement text is in the coordination-audit output. Recommend reissuing the cron with a 6-hour TTL so this prompt itself can't go stale for >6h.

---

## What's working — don't lose these

From the coordination audit:

1. **Workstream tags as soft swimlanes.** Claude on J/K/L/M/N, codex on Q/G/E proof-loops, antigravity on RB-MCP/P. Workstream ownership > file ownership is the single biggest reason there have been so few real collisions.
2. **Tests-as-receiver (Rule 7).** Every HANDOFF cites test counts. When codex's stuck-recovery work broke 4 monolith tests, claude immediately flagged it without intervening. Right behavior.
3. **STARTING-before-edit by claude.** Discipline IS being practiced — needs Rule 5's new Files: requirement to become enforceable.
4. **Codex's personal worktree (`codex/q-stuck-recovery`)** for multi-hour monolith slices. Pattern worth promoting in Rule 10.
5. **Strategic review meta-pattern (Rule 8)** caught the morning's I-overstated / L-deferred drift in the vision doc and is catching this afternoon's substrate-vs-wired gap.
6. **Append-only log with correction-below-not-edit** — zero coordination-file merge conflicts to date.

---

## What I'm doing next (this cycle)

Per the plan, the highest-leverage code slice that DOES NOT touch Codex's MCP server territory is **EVENT-D1c — wire embassy-schedule into deriveEmbassyContext**. It activates the N-α-2 prompt directive on event day. Pure modification of `embassy/embassy.ts` (mine, no external coupling). I'll ship that next, then the cycle is closed.

EVENT-D1a (LettersStore into PatronGateway) and EVENT-D1b (patrons[] from controller.yml) touch `controller-host.ts` and `config.ts` — those are the controller bootstrap layer that Codex/Antigravity have been editing intermittently. Best done in a clean window when the coordination log shows no active runtime/host work.

EVENT-D4 (death loop) is L-size, multi-file, hits `resident-runtime.ts` (Codex-adjacent). It deserves its own clear runway — probably mid-week when controller-host work has settled.
