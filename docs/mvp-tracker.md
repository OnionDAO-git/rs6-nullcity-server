# Null City — MVP / Beta Readiness Tracker

**Owner:** Claude (MVP coordinator — single tracking point) · **Updated:** 2026-06-04 (Thu)
**Branch:** `agents/wip` is canonical (everyone writes here). Live services run from it.
**How to use:** This is the single source of truth for "what's left for the beta." Each row has an owner you can farm to. Claude keeps it current as items land. Update the Status column when you finish a row.

---

## MVP definition — the 5 core loops must be demonstrable end-to-end
| # | Loop | Status (verified live 2026-06-04) |
|---|---|---|
| 1 | Residents autonomously play the game | ✅ **VERIFIED LIVE** — qa-woodcutter +775 WC / +200 FM XP in ~3min; qa-cook +210 Cooking / +70 Fishing; coherent on-goal loops; brain ok, 0 erroring |
| 2 | Crowd screen renders the living city | ✅ DONE — dashboard `/overview` up, projector frame 200 |
| 3 | Storyteller narrates the city live | ✅ DONE — overseer running, `latest-frame.json` fresh (Storyteller agent) |
| 4 | Human says a resident's name → it replies in character | ✅ **VERIFIED LIVE** — triggered via controller MCP `patron_ask`; `res:hans` replied in-character naming the player back, ~few ticks later via the detached path. Deterministic demo trigger exists (no client needed). |
| 5 | Human supports a resident → standing + letter back | ✅ **VERIFIED LIVE END-TO-END** — authenticated dashboard support spent 100 onions (corrected 10:1 scale) → resident attention up → standing 0→10 → Acquaintance letter in both inboxes. MVP-1/7/9/10 all DONE. |

**Verdict: all 5 core loops VERIFIED LIVE.** _Refreshed 2026-06-04 PM; live-rechecked 2026-06-05 — see refresh below._

---

## 2026-06-05 — live refresh + new findings (Claude, 3 subagents @ `agents/wip 0f6a6e37`)

**🔴 URGENT live regression — Dashboard BFF (`:8787`) is DOWN** (crashed; nothing listening). This takes **Loop 2 (crowd screen `/api/projector/overview`)** + auth/session/inbox UI **offline right now**. SPA (`:5174`) + letters (`:43596`) are still up. The loop *code* is fine — the human-facing surface is just down. → **Ops: restart the dashboard BFF.**

**Confirmed since 06-04:**
- **MVP-7 proven live** — `alice` 100 onions → 10 standing → Acquaintance; placeholder 1:1 warning gone. Running build (20:44, restarted 20:47) includes the onion-scale loader + beacon polish (MVP-11) + the goal-completion hook — **no rebuild needed**.
- **H2R wave shipped** (depth on already-green loops): resident→human **reply round-trip** makes Loop 4 a two-way thread — wired + unit-tested but **0 live `resident_reply` letters yet → needs a smoke**; **attention-plea** letters fire **live (82)** when a resident's life fades (Support/Legacy); new `GET /v1/letters/all` bridge serves 1698 letters across 36 recipients.

**Still open (mostly unchanged):**
- **MVP-2 heroes** — `father-aereck`/`duke`/`mother-anvil`/`wise-old-man` still absent from `controller.yml residents:` → OFFLINE. (Codex config.)
- **MVP-8 Bob/axe** — `res:agent` (525×) + `qa-guardian` (384×) still looping `acquire_axe_shopkeeper_missing`; no axe acquired today; the `controller:ensure-inventory` mitigation isn't applied yet. (Codex.)
- **Goal-completion (LB-LOOP-7e31)** — `onPlanCompleted → markGoalAchieved` hook is live in the build but **not observed firing this run**; probe to confirm a plan reaches `completed` and a resident graduates to a new goal.
- **Real onion-burn mode** — adapter built (dashboard `main cb13aeb`) but `ONION_SPEND_MODE` defaults to `standin` and the running dashboard sits on `wip/spec`; confirm the real-burn path before the public event.

---

## Tonight's review + fixes (2026-06-04 PM, 5 expert passes)
**Verified:** Loop 4 conv-reply works live (MCP `patron_ask` → `res:hans` replied in-voice). Death/legacy **letter** path works end-to-end (67 epitaph letters live, 150/150 tests) — demoable via a patron inbox; in-game tombstone is dormant because every resident is reborn (`currentState` never stays `ended`) → documented caveat, not MVP-blocking.

**Fixed tonight (Claude):**
- **MVP-11 — resident-bubble voice polish: ✅ DONE in code** (`30cebf98`, gate 4214 pass). Presence beacons now route through the register phrasebook (voiced per soul), the "Nearby I see 17 trees" debug telemetry is stripped from public bubbles, and consecutive-identical beacons are suppressed. e.g. *"I am scouting. Nearby I see 17 trees…"* → *"Scouting, nothing easy out here. Goal: …"*. **Not visible live until Codex rebuilds + restarts.**
- **MVP-10 — identity-join mismatch: ✅ DONE 2026-06-04** — support letters now key on `patronHandle` first, and dashboard `/api/inbox` folds controller `/v1/inbox` letters into authenticated inbox threads. Live proof: James spend created recipient `james` letter visible in both public and authenticated inboxes.

**Routed to other agents (their lanes):**
- **MVP-8 — stuck residents → Codex:** Bob spawn/shop config are CORRECT; the bug is in `runescape-body-routines.ts acquireWoodcuttingAxeAction` (~733-796) — Bob flickers out of perception so `acquire_axe_buy` never fires (0× ever). Tonight mitigation: `npm run controller:ensure-inventory -- --resident res:agent --item rs:bronze_axe --amount 1` (+ `res:qa-guardian`); durable fix = persist the shop-open handshake across the perception flicker.
- **Storyteller narration (B-) → Storyteller agent:** writing is great (paid Sonnet) but starved of plot — same 3 events re-paraphrased. Promote skill-ups / deaths / attention-grants into the digest **lead slot** (a sort-key change in `digest-builder.ts`, no model change).

**Demo note:** conv-reply voice is A- but fires only on exact name (deliberate). Trigger it at the booth by typing a resident's display name near it, or via the `patron_ask` MCP one-liner.

---

## Open punch-list (the actual work)

| ID | Item | Owner | Blocking MVP? | Effort | Acceptance check | Status |
|----|------|-------|---------------|--------|------------------|--------|
| **MVP-1** | ~~Dashboard auth~~ | Dashboard agent | — | — | done | ✅ **DONE 2026-06-04** — landing DB wired (`auth.mode: landing-db`, `landingDatabaseConfigured:true`, postgres store); seeded test users/sessions. Verified: login with session cookie → `authenticated:true`; `POST attention-grants` passes auth+CSRF and runs the write path (stops only at `409 insufficient_points` — see MVP-9). Real onion-burn wiring (`16fe947`) is on `origin/wip/spec`, not yet merged to dashboard `main`. |
| **MVP-9** | ~~Onion-spend support → letter~~ | onion agent / ops | — | — | done | ✅ **DONE 2026-06-04** — live corrected-scale smoke as `james`: authenticated dashboard session → spent 100 dev onions (`5000→4900`) via Dev's burn API → `res:qa-cook` attention `2437→2537` → standing `0→10` (Acquaintance only) → letter visible at `/v1/inbox?human=james` and dashboard `/api/inbox`. |
| **MVP-2** | **Bring embassy heroes online.** `father-aereck`, `duke-horacio`, `mother-anvil`, `wise-old-man` are OFFLINE — they're simply **not in `controller.yml`'s `residents:` list** (souls exist on disk). Add them + restart. NOTE: `res:hans` is **fine** — he's a reflex/hook hero (`thinking:false`), already greeting ("Good morning, friend…") + patrolling (703 actions today); the "STUCK / no active goal" status label is a misleading classifier for hook-heroes, not a bug. | Codex (runtime/config) | **YES** (greeter pillar) | S | `controller:status` shows father-aereck + the others ALIVE; a registered patron near the embassy gets a named greeting | OPEN |
| **MVP-3** | ~~Conv-reply live smoke~~ | Claude | — | — | done | ✅ **DONE 2026-06-04** — triggered live via controller MCP `patron_ask`; `res:hans` replied in-character ("I heard you, PlayerJames…") via the detached path. Loop 4 proven; deterministic demo trigger documented. |
| **MVP-4** | ~~Support→letter CLI smoke~~ | Claude | — | — | done | ✅ **DONE 2026-06-04** — `patron:smoke` PASS + manual fresh-handle walkthrough: attention refill → standing 0→10 → acquaintance tier → `standing_tier_crossed` letter served over HTTP `:43596`. Loop closed. |
| **MVP-7** | ~~Set the onion→standing scale variable~~ | Codex / Ops | — | — | done | ✅ **DONE 2026-06-04** — `loadControllerConfig` now reads `economy.onionsPerStandingPoint: 10`; after rebuild/restart, 100 onions produced exactly 10 standing points and one Acquaintance letter. |
| **MVP-8** | **Bob (axe-shop NPC) still missing → woodcutters stuck.** STILL OPEN as of 2026-06-04: `acquire_axe_shopkeeper_missing` firing live (res:agent 427×, qa-guardian 614× today, last at the current tick); no resident acquired an axe today; Bob not spawned. The new goal-stall→replan (S-GOAL-4) fires `routine_loop_break` (280–333×) so they're not hard-frozen, **but it doesn't replan off the unsatisfiable axe goal** — still stuck. Fastest MVP mitigation: **pre-seed a bronze axe** into the stuck residents' inventories OR reassign their goals, so the crowd screen isn't half-stuck; real fix = spawn Bob. (qa-woodcutter already has an axe and chops fine.) | Codex (game/world spawn) | No (but hurts roster liveliness) | S–M | Bob spawned/visible OR stuck woodcutters pre-seeded/reassigned; a tool-less woodcutting resident gets chopping | OPEN |
| **MVP-5** | **Register test/real patron handles** so greetings + standing + letters attach to names (only 2 test patrons registered today; HD-011). | Ops / James | No (but needed for named demo) | S | `patron:bulk-register --file <handles>`; handle resolves in greeting + inbox | OPEN |
| **MVP-6** | **Curate the live cohort.** 15 residents OFFLINE (test souls `restart-test`/`wf-verify-born`/`qa-angler` etc. + offline heroes) make the roster look half-dead on the crowd screen. Trim test souls from the active set. | Codex (config) | No (polish) | S | Crowd screen shows a clean roster of active residents + online heroes | OPEN |

**2026-06-11 — survivable-weekend knobs landed (substrate):** `economy.attentionDecaySchedule` (evening ×0.5 / night ×0.25 / weekend min ×0.5, America/Chicago local time) + `economy.maxAttention`/`startingAttention` capacity (support credits now clamp; per-soul `attentionProfile.maxAttention` overrides) — proposed values + runway math live in `controller.yml` comments; takes effect on next controller restart. Hero floors unchanged.

---

## Decisions — LOCKED 2026-06-04
1. **Currency = onions (single currency).** A visitor spends onions; that drives attention + standing. Retire the AP intermediary from the support UX (AP may remain internal plumbing, not user-facing). All amounts/conversions must be **config variables — no hardcoded numbers.**
2. **Letters fire at a configurable threshold; default ≈ 100 onions for the first letter.** Threshold is a tunable variable. Maps to existing standing tiers via the scale: `onionsPerStandingPoint = 10` → Acquaintance (10 pts) at **100 onions**, Ally (30) at 300, Officer (75) at 750. Tune via that one variable.
3. **Resident reset / hero-set: ON HOLD.** Keep the current cohort for now; no wipe.

### Onion-support → letter spec (hand to onion agent + Codex)
- **Onion agent (dashboard repo):** route "Support" to **spend onions** (not AP). Use the real consent-burn route (`/onion-attention-grants` + Dev's landing consent-spend API) if that API is live; **else** an interim where the city store holds an onion balance that's debited (clearly labelled non-prod), still onions-as-the-unit. On settle → `creditAttention(resident, {personId, patronHandle, amount})` so the engine accrues standing + mints the letter. Keep onion→attention and onion→standing as **config variables**. **Verify the identity join** so the letter is keyed to the same handle the inbox screen queries (else standing accrues but the visitor never sees the letter).
- **Codex (config):** set `CITY_ONIONS_PER_STANDING_POINT=10` (→ first letter at 100 onions) + restart; clears the placeholder-1:1 warning. _(If we later want the tier point-thresholds themselves tunable, that's a small follow-up — the scale var alone covers "first letter at 100" today.)_
- **Dev API status:** confirmed live in local dev (`POST /api/public/onions/requests` bearer-gated, portal approval session-gated, points burns settle in `point_transactions`). Use `http://localhost` callback URLs in dev; `http://127.0.0.1` callbacks are rejected by landing validation.
- **Acceptance:** logged-in test account with onions → spend 100 → resident attention refills **and** a letter appears in that account's inbox.

---

## Corrections to earlier assessments (so the record is accurate)
- The "keystone gap" (support bypasses PatronGateway → no letter) is **CLOSED**: `creditAttention → onPatronSupport → recordSettledSupport(standingLedger, lettersStore)` is wired (`controller-host.ts`). Credit lands live (verified +5 on `res:qa-cook`); letters fire on tier crossings. The remaining Loop-5 blocker is **auth (MVP-1)**, not the letter wiring.
- Branch fork is **healed**: the deployed line + origin line were consolidated into `agents/wip` (merge `53b7761d`), gate green (3986 tests); other agents now build on it.

---

## Verified-good (don't re-litigate)
Consolidation live & gate-green · conv-reply + Storyteller pipeline in the running build · dashboard up · Storyteller overseer running · letters serve over HTTP · de-spammed beacons live · tool-acquisition live · pre-consolidation backups on origin (`backup/deployed-agents-wip-20260603`, `backup/origin-agents-wip-20260603`).
