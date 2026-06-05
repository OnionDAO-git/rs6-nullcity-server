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
| 4 | Human says a resident's name → it replies in character | ⚠️ CODE LIVE, not yet smoke-tested (MVP-3) |
| 5 | Human supports a resident → standing + letter back | ✅ **ENGINE CHAIN VERIFIED** + **UI AUTH NOW WORKS** — landing DB wired (`auth.mode: landing-db`), test login succeeds, add-attention passes auth+CSRF and runs the write path. Only remaining: fund user AP (MVP-9) + set onion scale (MVP-7). |

**Verdict: all 5 core loops are functional, and the UI front-door (auth) now works too.** Remaining for a clean MVP: fund a test user's AP + set the onion scale (MVP-9 / MVP-7), bring the 4 embassy heroes online (MVP-2), resolve the Bob/axe stall (MVP-8), and smoke conv-reply (MVP-3). _Refreshed 2026-06-04 PM against `agents/wip @8b4d0be6`._

---

## Open punch-list (the actual work)

| ID | Item | Owner | Blocking MVP? | Effort | Acceptance check | Status |
|----|------|-------|---------------|--------|------------------|--------|
| **MVP-1** | ~~Dashboard auth~~ | Dashboard agent | — | — | done | ✅ **DONE 2026-06-04** — landing DB wired (`auth.mode: landing-db`, `landingDatabaseConfigured:true`, postgres store); seeded test users/sessions. Verified: login with session cookie → `authenticated:true`; `POST attention-grants` passes auth+CSRF and runs the write path (stops only at `409 insufficient_points` — see MVP-9). Real onion-burn wiring (`16fe947`) is on `origin/wip/spec`, not yet merged to dashboard `main`. |
| **MVP-9** | **Onion-spend support → letter (per LOCKED decision: onions as the single currency).** WIP code now routes the visible dashboard Support button through Dev's onion burn API (`/onion-attention-grants`), auto-approves in dev with the attendee session, and calls `creditAttention` with `personId` + `patronHandle`. Server patch prefers `patronHandle` for standing/letters, and the dashboard `/api/inbox` folds controller `/v1/inbox` letters into the authenticated inbox. Remaining work is live acceptance after restart/config. | onion agent / ops | **YES** (Loop 5 via UI) | M | logged-in test account spends onions → resident attention refills + a letter lands in their inbox (the same handle the inbox screen queries) | ⚠️ **CODE READY / LIVE E2E PENDING 2026-06-04** — focused dashboard + server tests pass; needs live service restart/config and 100-onion UI smoke before DONE. |
| **MVP-2** | **Bring embassy heroes online.** `father-aereck`, `duke-horacio`, `mother-anvil`, `wise-old-man` are OFFLINE — they're simply **not in `controller.yml`'s `residents:` list** (souls exist on disk). Add them + restart. NOTE: `res:hans` is **fine** — he's a reflex/hook hero (`thinking:false`), already greeting ("Good morning, friend…") + patrolling (703 actions today); the "STUCK / no active goal" status label is a misleading classifier for hook-heroes, not a bug. | Codex (runtime/config) | **YES** (greeter pillar) | S | `controller:status` shows father-aereck + the others ALIVE; a registered patron near the embassy gets a named greeting | OPEN |
| **MVP-3** | **Conv-reply live smoke.** Confirm a resident actually replies when a human says its display name on the live build (code is in the build, behavior unverified). Needs an in-world action. | Claude (+ in-world tester) | YES (Loop 4 proof) | S | A player near a resident types its name → resident emits a `say` reply within a few ticks | OPEN |
| **MVP-4** | ~~Support→letter CLI smoke~~ | Claude | — | — | done | ✅ **DONE 2026-06-04** — `patron:smoke` PASS + manual fresh-handle walkthrough: attention refill → standing 0→10 → acquaintance tier → `standing_tier_crossed` letter served over HTTP `:43596`. Loop closed. |
| **MVP-7** | **Set the onion→standing scale variable (LOCKED: default → first letter at 100 onions).** Variable infra shipped (`6cd74e4c`): `config.economy.onionsPerStandingPoint` → env `CITY_ONIONS_PER_STANDING_POINT` → else placeholder 1:1. Set **`= 10`** → Acquaintance(10pts)=100 onions, Ally=300, Officer=750. Tunable later. | Codex (config) / Ops (restart) | **YES** (economy correctness) | S | scale set to 10 + restart; no placeholder warning; first letter at 100 onions of support | ⚠️ **CONFIG SET LOCALLY / RESTART PENDING 2026-06-04** — ignored local `controller.yml` now has `economy.onionsPerStandingPoint: 10`; Ops must restart or set `CITY_ONIONS_PER_STANDING_POINT=10` in the managed runtime. |
| **MVP-8** | **Bob (axe-shop NPC) still missing → woodcutters stuck.** STILL OPEN as of 2026-06-04: `acquire_axe_shopkeeper_missing` firing live (res:agent 427×, qa-guardian 614× today, last at the current tick); no resident acquired an axe today; Bob not spawned. The new goal-stall→replan (S-GOAL-4) fires `routine_loop_break` (280–333×) so they're not hard-frozen, **but it doesn't replan off the unsatisfiable axe goal** — still stuck. Fastest MVP mitigation: **pre-seed a bronze axe** into the stuck residents' inventories OR reassign their goals, so the crowd screen isn't half-stuck; real fix = spawn Bob. (qa-woodcutter already has an axe and chops fine.) | Codex (game/world spawn) | No (but hurts roster liveliness) | S–M | Bob spawned/visible OR stuck woodcutters pre-seeded/reassigned; a tool-less woodcutting resident gets chopping | OPEN |
| **MVP-5** | **Register test/real patron handles** so greetings + standing + letters attach to names (only 2 test patrons registered today; HD-011). | Ops / James | No (but needed for named demo) | S | `patron:bulk-register --file <handles>`; handle resolves in greeting + inbox | OPEN |
| **MVP-6** | **Curate the live cohort.** 15 residents OFFLINE (test souls `restart-test`/`wf-verify-born`/`qa-angler` etc. + offline heroes) make the roster look half-dead on the crowd screen. Trim test souls from the active set. | Codex (config) | No (polish) | S | Crowd screen shows a clean roster of active residents + online heroes | OPEN |

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
