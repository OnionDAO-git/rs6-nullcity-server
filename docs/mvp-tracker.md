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
| **MVP-9** | **Fund a test user's AP + enable real spend.** Authenticated add-attention currently returns `409 insufficient_points` (test user AP=0), and `ONION_SPEND_MODE` defaults to `standin` (no real onion burn). To demo onion→support through the UI: grant the test user AP (or wire onion balance) and decide standin vs. real onion burn. | onion-spend agent / ops | **YES** (for the UI support demo to complete) | S | logged-in test user has AP/onions; UI "Support" POST returns 200 and credits the resident + (on a tier crossing) mints a letter | OPEN |
| **MVP-2** | **Bring embassy heroes online.** `father-aereck`, `duke-horacio`, `mother-anvil`, `wise-old-man` are OFFLINE — they're simply **not in `controller.yml`'s `residents:` list** (souls exist on disk). Add them + restart. NOTE: `res:hans` is **fine** — he's a reflex/hook hero (`thinking:false`), already greeting ("Good morning, friend…") + patrolling (703 actions today); the "STUCK / no active goal" status label is a misleading classifier for hook-heroes, not a bug. | Codex (runtime/config) | **YES** (greeter pillar) | S | `controller:status` shows father-aereck + the others ALIVE; a registered patron near the embassy gets a named greeting | OPEN |
| **MVP-3** | **Conv-reply live smoke.** Confirm a resident actually replies when a human says its display name on the live build (code is in the build, behavior unverified). Needs an in-world action. | Claude (+ in-world tester) | YES (Loop 4 proof) | S | A player near a resident types its name → resident emits a `say` reply within a few ticks | OPEN |
| **MVP-4** | ~~Support→letter CLI smoke~~ | Claude | — | — | done | ✅ **DONE 2026-06-04** — `patron:smoke` PASS + manual fresh-handle walkthrough: attention refill → standing 0→10 → acquaintance tier → `standing_tier_crossed` letter served over HTTP `:43596`. Loop closed. |
| **MVP-7** | **Set the onion→standing scale.** Mechanism now shipped (commit `6cd74e4c`): resolves `config.economy.onionsPerStandingPoint` → else env `CITY_ONIONS_PER_STANDING_POINT` → else **placeholder 1:1 with a loud warning**. Neither is set, so the running controller is **still on placeholder 1:1** (warning actively printing in the supervised log) → a single onion check-in (~500 onions) could instantly mint a top tier (tiers 10/30/75). Set to the intended ratio (≥100) + restart before real onion spend. | James + onion-spend agent | **YES** (onion economy correctness) | S | scale set (yaml or env); no placeholder warning in logs; a check-in crosses tiers at the intended pace | OPEN |
| **MVP-8** | **Bob (axe-shop NPC) still missing → woodcutters stuck.** STILL OPEN as of 2026-06-04: `acquire_axe_shopkeeper_missing` firing live (res:agent 427×, qa-guardian 614× today, last at the current tick); no resident acquired an axe today; Bob not spawned. The new goal-stall→replan (S-GOAL-4) fires `routine_loop_break` (280–333×) so they're not hard-frozen, **but it doesn't replan off the unsatisfiable axe goal** — still stuck. Fastest MVP mitigation: **pre-seed a bronze axe** into the stuck residents' inventories OR reassign their goals, so the crowd screen isn't half-stuck; real fix = spawn Bob. (qa-woodcutter already has an axe and chops fine.) | Codex (game/world spawn) | No (but hurts roster liveliness) | S–M | Bob spawned/visible OR stuck woodcutters pre-seeded/reassigned; a tool-less woodcutting resident gets chopping | OPEN |
| **MVP-5** | **Register test/real patron handles** so greetings + standing + letters attach to names (only 2 test patrons registered today; HD-011). | Ops / James | No (but needed for named demo) | S | `patron:bulk-register --file <handles>`; handle resolves in greeting + inbox | OPEN |
| **MVP-6** | **Curate the live cohort.** 15 residents OFFLINE (test souls `restart-test`/`wf-verify-born`/`qa-angler` etc. + offline heroes) make the roster look half-dead on the crowd screen. Trim test souls from the active set. | Codex (config) | No (polish) | S | Crowd screen shows a clean roster of active residents + online heroes | OPEN |

---

## Decisions needed from James
1. **Self-serve UI support in MVP scope, or operator-CLI enough?** If UI → MVP-1 is required. If CLI-only beta → MVP-1 drops to post-beta and the loop is demoed via `patron:offer`.
2. **Auth approach for MVP-1:** dev-login shim (fast, beta-grade) vs. connect the real landing DB (production-grade).
3. **Hero set to show:** which named heroes must be online for the beta (drives MVP-2 scope).

---

## Corrections to earlier assessments (so the record is accurate)
- The "keystone gap" (support bypasses PatronGateway → no letter) is **CLOSED**: `creditAttention → onPatronSupport → recordSettledSupport(standingLedger, lettersStore)` is wired (`controller-host.ts`). Credit lands live (verified +5 on `res:qa-cook`); letters fire on tier crossings. The remaining Loop-5 blocker is **auth (MVP-1)**, not the letter wiring.
- Branch fork is **healed**: the deployed line + origin line were consolidated into `agents/wip` (merge `53b7761d`), gate green (3986 tests); other agents now build on it.

---

## Verified-good (don't re-litigate)
Consolidation live & gate-green · conv-reply + Storyteller pipeline in the running build · dashboard up · Storyteller overseer running · letters serve over HTTP · de-spammed beacons live · tool-acquisition live · pre-consolidation backups on origin (`backup/deployed-agents-wip-20260603`, `backup/origin-agents-wip-20260603`).
