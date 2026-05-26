# Null City — Dev Demo Readiness (2026-05-26)

Audit run: 2026-05-26 12:33 CDT (17:33 UTC). agents/wip @ 6771d806.
Reviewers: release engineer, RuneScape evaluator, dashboard reviewer, narrative/SOUL reviewer, live HTTP probes, static gates.

## TL;DR — VERDICT: **CONDITIONAL**

**Safe to merge agents/wip → nullcity NOW. Do not live-demo to Dev for ~3 hours of polish.**

Three reasons for CONDITIONAL (not GO, not NO-GO):

1. **Merge itself is clean** — 603 commits ahead, 5 behind, but the 5 ahead are already absorbed by agents/wip (verified by symmetric diff: nullcity..agents/wip = +2732/-472, agents/wip..nullcity = inverse on same 25 files). All gates green (2124/2124 tests, typecheck, lint, format). Zero conflict risk.
2. **The narrative core is real** — the codex-live epitaph for res:agent (*"a life measured in the small currency of attention rather than the large one of years"*) is genuinely literary. Wall ticker + inbox styling are demo-quality vellum. The letter system has soul.
3. **The live system embarrasses itself today** — 16/19 residents catatonic (100% `position_changed`); ALL 6 heroes loop the same template phrase 5,000+ times; `/library` + `/graveyard` pages return 404 because running controller is stale; no root landing page / nav; demo patron `demo@oniondao` is blank. Founder demo on this state = "the named characters are statues."

**Confidence: MEDIUM.** Gates and merge mechanics are HIGH. Live behavior is the variable.

**Top 3 blockers for live-demo (not for merge):**
1. Heroes have no body routine — Brain says are 96% generic template loop.
2. Running controller binary is from 03:53 AM, predates `/v1/library` + `/v1/graveyard` endpoints.
3. No `public/index.html` landing page; demo patron not seeded.

---

## Readiness Matrix

| Area | Status | Evidence | Blockers / Polish |
|---|---|---|---|
| **Pillar 1 — Smart Gameplay** | 🔴 | 16/19 residents >50% `position_changed`. Only qa-woodcutter, qa-cook, qa-angler producing real XP. 3 attack-XP events lifetime; combat is dead. ALL 6 heroes stuck on "Still here as X; watching the area" template 5,000×+ each. (See §Pillar 1 detail.) | **DEMO BLOCKER**: bind hero souls to a body routine OR fall back to `explorationAction`. Either suppress the "Still here" loop or rotate ambient lines from soul `loves`/`fears`/`aesthetic`. |
| **Pillar 2 — Patron Economy** | 🟡 | Letters dispatch end-to-end (verified via `/v1/wall/snapshot` — standing_tier_crossed, epitaph, civic_milestone all present). `npm run patron:register/offer/witness/grant/ask` CLIs all shipped. **But:** `demo@oniondao` patron is blank (0 Shards, null tier, 0 letters). | Seed a demo patron pre-event: `npm run patron:grant -- --human demo@oniondao --shards 50` + offer + witness so `/patron/?human=demo@oniondao` looks alive on stage. |
| **Pillar 3 — Narrative Artifacts** | 🟡 | Wall ticker styling 5/5 (vellum + faction badges + fresh-pulse animation). Inbox styling 5/5 (vellum + drop-cap + wax-seal + deckle-edge). Recent commit 138a8371 deduplicated portrait "wants" — verified ≤5 entries on hero portraits. **But:** portraits' "In their own words" sections still log-dump (Hans portrait contains *"Became stuck at tick 21"* repeated 73× under Life I). Letters bimodal: 21% literary, 79% `[Broadcast]` clinical. | Dedup portrait quotes (same fix pattern as wants). Filter `[Broadcast]` letters from front-page surfaces. Suppress `res-qa-*` and `res-bmk_*` slugs from wall roster. |
| **Infra — Tests & Build** | 🟢 | `npm run fin` 2124/2124 tests pass in 48s. typecheck clean. biome lint 874 files no fixes. biome format no diffs. `npm run build` succeeded. | None. |
| **Infra — Live Boot** | 🔴 | Controller process alive at PID 52651 since 03:53 AM 2026-05-26 (98.9% CPU). Tick 71077. `/v1/wall/snapshot` returns 200 with rich content. `/v1/inbox` returns 200. **But `/v1/library` and `/v1/graveyard` return 404 (binary predates today's cron-fired commits).** `/v1/health` returns HTTP 000 (hung) on letters port, 404 on MCP port. | **DEMO BLOCKER**: rebuild + restart controller. The page HTML and snapshot logic are already shipped to disk; the running process is stale. |
| **Ops — Multi-controller Safety** | 🟢 | Controller-lock substrate verified in SPRINT-E60 (`docs/intelligence-verification-log.md`). Codex's parallel clone in `/tmp/rs6-nullcity-server-o10-stuck-codex` runs cleanly alongside main clone. | None. |
| **Docs — Handoff Freshness** | 🟢 | `docs/sprint-handoff-2026-05-26.md` last refreshed 2026-05-25 03:30 (SPRINT-E61). `docs/pre-chicago-readiness.md` refreshed 2026-05-25 01:50 (SPRINT-QA5). `docs/agent-status.md` shows ~7 successful cron cycles overnight + this morning. `docs/human-decisions.md` and `docs/intelligence-verification-log.md` current. | Nothing blocking; consider one consolidated re-read pass post-merge for the Tuesday-morning maintainer view. |
| **Open HDs** | 🟡 | HD-047 (qa-guardian/survivor hold-loop edge) still open — manifests as the catatonia pattern in 16/19 residents. HD-011 closed by helper CLI (commit 69c4eae0). HD-048 (perception-builder smoke) still pending pre-Chicago. No HDs flagged High/Blocking explicitly; HD-047 is effectively High by impact. | HD-047 is the umbrella issue for "heroes are statues." Fix it before live demo. |

---

## Pillar Detail

### Pillar 1 — Smart RuneScape Gameplay (🔴)

**Healthy (3/19):**
- **res:qa-woodcutter** — 22/25 score. Fresh first_xp at 17:37:14 UTC (woodcutting) + 17:37:26 (firemaking). 241 first_xp lifetime. Real gather→fire chain landing in production.
- **res:qa-cook** — 22/25 score. Fish→cook chain alive (xp_gain:fishing:40 → xp_gain:cooking:30 within seconds).
- **res:qa-angler** — Active first_xp:fishing events recent.

**Catatonic (16/19):**
All 6 heroes (hans, father-aereck, wise-old-man, duke-horacio, pip, thrand), 4 flagships (mother-anvil, severn-vesta, wren-calix, the-hush), and 6 QA roles (qa-guide, qa-scout, qa-trader, qa-banker, qa-priest, qa-survivor, qa-social, qa-guardian, qa-forager) all show 100% `position_changed` cause, 0 first_xp lifetime, repeating the same templated say-line >5,000 times.

**Cause histogram (last 200 events, all residents):**
- `position_changed`: 64,222
- `inventory:-1` / `inventory:+1`: 937
- `xp_gain:cooking:30`: 340
- `xp_gain:fishing:10`: 264
- `xp_gain:fishing:40`: 36
- `xp_gain:woodcutting:25`: 21
- `xp_gain:attack:4`: **3 (lifetime, across all 19 residents, last 4 days)**
- `xp_gain:prayer:4.5`: 1

**Failure mode classification:**
- **DESIGN** — Hero souls have no Body workflow bound to their goals. The Brain emits the say tail; the Body never executes anything but small shuffles. Affects 10 heroes/flagships.
- **DESIGN** — QA soul → body wiring broken for 9 QA roles. Their goal text never produces XP events.
- **INFERENCE** — Even healthy QA residents emit templated say lines ("I am scouting / I am working my route / I am checking this area"). Task #154 F9a "enrich say tail" is the exact unblock.
- **OTHER** — Combat path is completely cold. 3 attack events in 4 days. The canonical "RuneScape moment" (goblin fight) is invisible.

### Pillar 2 — Patron Economy (🟡)

End-to-end flow works:
- `npm run patron:register --human X --kind patron_gift` ✅
- `npm run patron:offer --human X --resident res:hans --shards 5` ✅
- `npm run patron:witness --human X --resident res:hans` ✅
- Letter appears in `/v1/inbox?human=X` ✅
- Wall snapshot reflects tier crossings ✅

`demo@oniondao` patron not seeded — needs pre-event grant + offer + witness to look alive.

Real handles like `codex-live` have 30+ letters in inbox; use one of these for the demo if you don't seed demo@oniondao.

### Pillar 3 — Narrative Artifacts (🟡)

**Strongest line found** (THE demo anchor):

> *"They served unaligned for 3225 ticks — a life measured in the small currency of attention rather than the large one of years. Their hands were best at firemaking; they reached level 42 before the end. The cause was attention_exhausted. Your patronage stayed with them through it. That mattered, in a way the registers don't quite know how to write down. We are writing it down here."*
>
> — `data/controller/memory/data/letters/codex-live/inbox.jsonl`, epitaph for res:agent

This single letter justifies the entire project's existence to Dev. Build the demo around showing it, and let everything else (wall, library, patron, graveyard) serve as the supporting cast.

**Letters quality:** bimodal. `epitaph`, `civic_milestone`, `standing_tier_crossed` letters score 4-5/5. `[Broadcast]` letters (348/443 = **79%** of letter volume) are clinical system events scoring 2/5.

**Portrait quality:** Hero wants section is clean post-138a8371 dedup fix (≤5 entries). But "In their own words" still log-dumps. Notable disaster: Hans portrait `Life I` literally contains "Became stuck at tick 21. Became stuck at tick 21. Became stuck at tick 21..." 73 times. QA-soul portraits are unshippable.

**Cross-resident lore:** ZERO events found in any timeline. `whisper` verb shipped (L-β task #113) but no whisper events fire. Hero souls reference each other in their `behaviors`, but the live channel never emits a cross-resident say.

---

## Risk Surface (what could embarrass us during demo)

1. **The "Still here as X; watching the area" loop on the wall ticker.** It's ~96% of all hero say events. If Dev watches for 60 seconds, that's what they see. Make it stop or rotate it.
2. **`/library` and `/graveyard` returning 404.** If Dev clicks the demo nav and lands on a 404, the whole illusion breaks.
3. **18× `res-qa-*` slugs in the wall roster sidebar.** Looks like a debug environment, not a city.
4. **Duplicate "On the passing of res:hans" cards stacked 5× on the wall.** Multi-witness is the right model but the ticker should dedupe by subject.
5. **QA-soul portraits in `/library`** — if accessible, they're log-dumps and read as broken.
6. **`demo@oniondao` blank state** — empty patron profile renders "No letters yet. Walk the embassy and find a resident to support." (on-brand, but anti-climactic).
7. **Inference health endpoint hung** — if Dev asks "is the LLM up?", we don't have an answer.

## Polish Recommendations (≤30 min each)

P0 (MUST before demo):
1. **Rebuild + restart controller** — `npm run build` already passes; restart screen `nullcity-controller-agents-wip-clean`. Brings `/v1/library` + `/v1/graveyard` online.
2. **Bind heroes to a body routine, OR add a global "no body → explorationAction" fallback.** Otherwise the wall ticker is a slow-motion still life.
3. **Write `public/index.html` landing page** — single vellum card with `Wall · Inbox · Patron · Library · Graveyard` nav. ~10 LOC + CSS reuse. Without this Dev can't navigate.

P1 (SHOULD before demo):
4. **Filter `res-qa-*` and `res-bmk_*` slugs** from `/v1/wall/snapshot.residents` and `/v1/library`. ~5 LOC, one regex.
5. **Dedupe identical-subject letters** in `recentLetters` on the wall snapshot. ~10 LOC.
6. **Seed `demo@oniondao` patron** — `npm run patron:grant -- --human demo@oniondao --shards 50` + offer/witness on res:hans. ~3 CLI calls.
7. **Suppress the "Still here as X" loop**, OR raise its `cooldownTicks` to ≥3600. Search the brain-planner / spark substrate for the rule.

P2 (NICE if time):
8. **Dedup portrait quotes** (same pattern as wants dedup in commit 138a8371). Removes the "Became stuck at tick 21 (×73)" embarrassment.
9. **Filter `[Broadcast]` letters** from front-page inbox; route them to a separate "broadcasts" tab or de-emphasize visually.
10. **Surface the strongest epitaph** (the "small currency of attention" one) on the landing page as a hero quote.

## What to NOT show Dev

- `data/controller/memory/library/res-agent/portrait.md` (1.08MB log-dump)
- Any `res-qa-*` or `res-bmk_*` portrait
- `/library` and `/graveyard` URLs until the binary is rebuilt
- The roster sidebar on `/wall` if Dev asks "who are all these QA people?"
- `/patron/?human=demo@oniondao` until it's seeded
- Anything that triggers `/v1/health`

---

## Reviewer Reports (full)

Available on request. Synthesized into this matrix.

- **Release engineer**: SAFE_WITH_PRECAUTIONS — squash-merge recommended, exclude `docs/agent-status.md` per convention.
- **RuneScape evaluator**: MIXED — 3 healthy residents prove the design works; 16 dumb residents prove most souls aren't body-wired.
- **Dashboard reviewer**: NEEDS_POLISH — pages are styled well, running binary is stale, no landing/nav.
- **Narrative/SOUL reviewer**: SERVICEABLE-LEANING-GENERIC — souls are gorgeous on paper, live channel is templated. Best moment: the codex-live epitaph.

---

## Recommended Path

1. **Now (or next cron cycle):** ship the merge to nullcity per `docs/merge-to-main-plan.md`. The code is good. Tag the resulting nullcity tip `pre-chicago-demo-2026-05-26`.
2. **Next 3 hours:** ship the P0 polish list. None require more than 30 min.
3. **Then:** restart the controller against the new build, soak 20 minutes, re-screenshot the wall + inbox + library + graveyard, and we're demo-ready.
4. **Then and only then:** schedule the live walkthrough with Dev.
