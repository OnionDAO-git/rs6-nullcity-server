# Null City — MVP / Beta Readiness Tracker

**Owner:** Claude (MVP coordinator — single tracking point) · **Updated:** 2026-06-04 (Thu)
**Branch:** `agents/wip` is canonical (everyone writes here). Live services run from it.
**How to use:** This is the single source of truth for "what's left for the beta." Each row has an owner you can farm to. Claude keeps it current as items land. Update the Status column when you finish a row.

---

## MVP definition — the 5 core loops must be demonstrable end-to-end
| # | Loop | Status (verified live 2026-06-04) |
|---|---|---|
| 1 | Residents autonomously play the game | ✅ DONE — 8 residents ALIVE_ACTING, real skilling |
| 2 | Crowd screen renders the living city | ✅ DONE — dashboard `/overview` up, projector frame 200 |
| 3 | Storyteller narrates the city live | ✅ DONE — overseer running, `latest-frame.json` fresh (Storyteller agent) |
| 4 | Human says a resident's name → it replies in character | ⚠️ CODE LIVE, not yet smoke-tested (MVP-3) |
| 5 | Human supports a resident → standing + letter back | ⚠️ Logic works & verified live; **UI blocked on auth** (MVP-1) |

**Verdict: close.** Loops 1–3 done. Loop 4 needs a smoke. Loop 5 works via CLI today; the UI path needs auth wired.

---

## Open punch-list (the actual work)

| ID | Item | Owner | Blocking MVP? | Effort | Acceptance check | Status |
|----|------|-------|---------------|--------|------------------|--------|
| **MVP-1** | **Dashboard auth** so a user (incl. a test account) can log in and the "Support" UI works. Today the dashboard only does remote SSO against a landing Postgres that isn't connected → auth `disabled` → add-attention returns 401. Pick: (a) **dev-login shim** in the BFF (fastest, no DB), or (b) connect `LANDING_DATABASE_URL` + seed a test session. | Dashboard agent / landing-infra (Dev) | **YES** (for UI Loop 5) | S–M | `GET /api/session` → `authenticated:true` for a test account; UI "Support" POST returns 200 and credits the resident | OPEN |
| **MVP-2** | **Bring embassy heroes online.** `father-aereck`, `duke-horacio`, `mother-anvil`, `wise-old-man` are OFFLINE (not in `controller.yml` residents); `hans` is loaded but STUCK with no goal. The "a hero greets you by name" pillar is currently dead. | Codex (runtime/config) | **YES** (greeter pillar) | S | `controller:status` shows father-aereck ALIVE; hans has an active goal/anchor inside embassy region | OPEN |
| **MVP-3** | **Conv-reply live smoke.** Confirm a resident actually replies when a human says its display name on the live build (code is in the build, behavior unverified). Needs an in-world action. | Claude (+ in-world tester) | YES (Loop 4 proof) | S | A player near a resident types its name → resident emits a `say` reply within a few ticks | OPEN |
| **MVP-4** | **Support→letter CLI smoke.** Prove the operator path end-to-end: a grant large enough to cross a standing tier produces a letter. (Pipeline verified wired; tier-crossing not yet demonstrated.) | Claude | No (fallback path) | S | `patron:offer` crossing a tier → `standing_tier_crossed` letter in `:43596/v1/inbox?human=<h>` | OPEN |
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
