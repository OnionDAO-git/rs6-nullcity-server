# Pre-Chicago Readiness Checklist

> Single-page go/no-go for event day. Replaces the bottom-up `embassy-staff-runbook.md` with a top-down checklist. Each item has a verification command and a green/yellow/red status from the most recent smoke run.

**Event:** OnionDAO Chicago IRL, 2026-06-01.
**Maintainer:** James (jamescarnley@gmail.com).
**Sprint context:** see `docs/2026-05-30-final-32hr-sprint-plan.md` (primary triage), `docs/intelligence-verification-log.md`, and `docs/human-decisions.md`.

> **⚡ CODE FREEZE**: `agents/wip` server repo is CODE FREEZE from **2026-05-31 18:00 CDT** through 2026-06-01 23:59 CDT. Docs-only edits permitted after that. No commits touching `src/controller/spark/`, `resident-runtime.ts`, or `action-coordinator.ts` during the freeze window.

> **🗓 UPDATED 2026-05-31**: This doc was originally written 2026-05-25. Major new capabilities shipped since then: `S-STORY-1/2/3a` (Storyteller overseer + dashboard bridge), `S-NCRI-1/2/3/4` (NCRI marketplace + print queue), `S-MEM-1..4` (resident memory system), `S-GOAL-1..4` (goal-as-orientation + admin CLIs), `S-AP-CYCLE-1/2` (no-floor 3000 AP trigger + hero surplus GP), `S-GP-CALIBRATION-1` (goblin coins 3→20/kill), `S-INFER-1..8` (inference parse salvage through generous brain timeout/watchdog alarms + Qwen3→qwopus switch at 98.3%+ usable), `S-AUDIT-FIX-1..12` (economy correctness), numerous QA + stuck-churn + trade fixes. Test suite is now **3494** passing (was 1998 on 2026-05-25).

---

## Quick run

Four complementary go/no-go checks land in ~5 minutes total:

```sh
# (1) ops health — process / HTTP / wall snapshot / library / patron registry
bash scripts/post-restart-smoke.sh

# (2) behavior health — per-resident action/result/say evidence from trajectories
npm run controller:smoke

# (3) timed live behavior proof — residents must advance during the window
npm run controller:smoke -- --observe-seconds 120 --min-observed-actions 1 --allow-recent-visible

# (4) AP/GP recurrence check — run after residents have been active ≥ 10 min
npm run controller:normal-life-audit
```

**`post-restart-smoke.sh`** reports `READY` / `READY WITH WARNINGS` / `NOT READY` — if `NOT READY`, address the red items first. Exit 0 = ready; 1 = blocking red.

**`controller:smoke`** reports per-resident `OK <name> tick=N actions=A results=R success=S timeout=T fail=F says=Y lastAction=K lastResult=R lastSay="…"`. Useful for confirming heroes are emitting their soul-distinctive personality lines (Hans "A good day in the courtyard, friend.", Aereck "Bless this ground beneath us.", Wise "Pick your fights…", Duke "Well met. The duchy stands open to you.", Pip "Oh — hello!", Thrand "Still here as Thrand…") and that cohort residents are action-active (qa-woodcutter / qa-forager hit 15-19 actions per window). If a hero shows 0 says or a cohort resident shows 0 actions over a few minutes, something is off.

**`controller:normal-life-audit`** (new) runs a 10-minute observation window and returns a JSON summary. Key fields: `apGpExchangeEvents` (organic exchanges observed), `lowHealthWaits` (should be 0 after food-guard fix), `stuckSummary.totalUnresolved` (target < 50), `aboveRunwayThresholdWithGpResidents` (GP holders above 3000 AP — healthy sign). Run this at T-24 after 10+ minutes of live operation to confirm the AP/GP cycle is moving.

---

## Pre-doors checklist (T-24 hours)

| Item | How to verify | What "green" looks like | If red |
|---|---|---|---|
| **Controller process alive** | `ps aux \| grep dist/controller/index.js \| grep -v grep \| grep -v SCREEN` | One node PID, started today | Restart controller: `npm run build && node dist/controller/index.js --letters-http-port=43596 --wall-redact` |
| **HTTP port 43596 bound** | `curl -s "http://127.0.0.1:43596/v1/inbox?human=health-check"` | Returns `{"letters": [...]}` JSON | Controller was started without `--letters-http-port=43596` (HD-026). Restart with the flag. (`?` MUST be quoted in zsh.) |
| **Wall ticker redaction active** | `curl -s http://127.0.0.1:43596/v1/wall/snapshot \| python3 -m json.tool \| head` | `body` fields are `""`, `recipient` contains `***` | Controller missing `--wall-redact` (HD-013-live, HD-029). Restart with both flags. |
| **All 23 residents alive** (6 RuneScape heroes + 4 faction flagships + res:agent + 12 Codex QA cohort) | `bash scripts/post-restart-smoke.sh` (section 4 globs `data/controller/memory/res-*/`) | All marked ALIVE | `npm run controller:revive -- --resident res:<name>` for each dead one. The QA cohort runs without a floor by design (they SHOULD be able to die so the death loop is testable); heroes have HD-008 floors that prevent attention-exhaustion. |
| **Hero attention at or above declared floor** | `for h in res-hans res-father-aereck res-wise-old-man res-duke-horacio res-pip res-thrand; do jq '.attention' data/controller/memory/$h/runtime-state.json; done` | Hans/Aereck/Wise/Duke ≥ 5000; Pip/Thrand ≥ 3000 — **clamped to those floors by HD-008 (E30 substrate + E32 live-verify)** | Floor under-shoot means soul YAML missing `attentionProfile.floor`. Re-add via `intelligence-verification-log.md § E30`. Patron:offer `--amount 1000+` still tops them above floor for active engagement; e.g. `claude-mega-rescue` lifted pip from 3000 floor → 4067 with a 2000 Shard offer. |
| **Patron registry populated** | `grep -A 99 'patrons:' controller.yml \| grep '^\s*-'` | One line per attendee handle | HD-011 is the main remaining live-greeting blocker. Use `npm run patron:bulk-register -- --file <handles.txt>` during event-staff onboarding, then restart the controller so registered in-world handles can trigger the embassy greeting reflex. |
| **Economy API health** | `curl -s "http://127.0.0.1:43596/api/nullcity/economy/live" \| python3 -m json.tool \| head -30` | `city.residentCount ≥ 20`; `heartbeat.degradedFlags = []` | Controller missing city-integration config or stale binary. Rebuild (`npm run build`) and restart. |
| **Storyteller latest** | `curl -s "http://127.0.0.1:43596/api/nullcity/storyteller/latest" \| python3 -m json.tool \| head -20` | `status: "published"` or `"draft"`; non-null `dispatch.body` | No dispatch yet — run `npm run storyteller:overseer -- --tick` once to seed the first one. Dry-run mode (no LLM cost) still produces a ledger entry. |
| **NCRI seed** | `npm run ncri:seed` | Exits 0; three NCRI items returned by `curl /api/nullcity/ncri/listings` | Seed fixtures not loaded. Restart won't fix — run `ncri:seed` once manually; idempotent on repeat runs. |
| **AP/GP recurrence (10-min audit)** | `npm run controller:normal-life-audit` | `apGpExchangeEvents ≥ 1` OR `aboveRunwayThresholdWithGpResidents ≥ 1` (healthy sign = residents have GP and are above 3000 AP threshold) | Residents likely still above the 3000 AP no-floor trigger right after restart. Give them 10-15 min then re-run. Organic exchanges fire once any GP-holding resident drops below 3000 AP (~6.5 min of goblin combat at 20 GP/kill). |
| **Recent trajectory activity** | `for h in res-*; do wc -l data/controller/memory/$h/evidence/trajectory/$(ls -t data/controller/memory/$h/evidence/trajectory | head -1); done` | Each file has 100+ rows from the last hour | If a hero shows 0 rows in 5 min and is alive, suspect HD-032 freeze residual. Check `cause: thinking_watchdog_timeout` density in their trajectory. |
| **Embassy schedule loaded** | `jq '.windows' data/controller/embassy-schedule.json \| head -20` | Today's window appears | Maintainer authors the schedule per `docs/embassy-staff-runbook.md`. |
| **Inbox HTTP serves a real patron** | `curl -s "http://127.0.0.1:43596/v1/inbox?human=claude-sprint-patron-v2" \| python3 -m json.tool \| head` | Returns letters array with full body | Substrate is healthy; if empty, no letters exist yet (not necessarily a bug). |
| **Wall snapshot shows recent letters** | Same as wall redaction check | `recentLetters` length ≥ 1 | If 0, no letters at all on the controller (cold install). |

---

## Pre-doors checklist (T-2 hours)

| Item | How to verify | What "green" looks like |
|---|---|---|
| **Wall projection display** | Open `public/wall/index.html` in the projection browser, point at `http://127.0.0.1:43596/v1/wall/snapshot` | Ticker scrolling readable from 5 feet |
| **Inbox URL handout ready** | Generate URL pattern: `http://127.0.0.1:43596/v1/inbox?human=<patron-handle>` | Bookmarklet or business cards with QR codes |
| **Staff trained on patron-grant CLI** | `npm run patron:grant -- --help` and `npm run patron:offer -- --help` | Staff can grant + offer AP via terminal |
| **One Brain success per hero confirmed today** | Read recent trajectories for any decision row with `promptTokens > 0` per hero | At least one organic Brain output per hero (heroes are mostly in fallback per F19c; S-INFER-1/2 improves parse salvage but live rate varies by model) |
| **Inference health check** | `npm run controller:inference-audit` | `headline.usableBrainDecisionRate ≥ 0.80` — qwopus runs at **98.3%**+ post-S-GATEWAY-TIMEOUT-2 (100.0% in clean 30-min window per S-QWOPUS-CONFIG-1); if <0.50 check model/endpoint; if <0.10 restart on correct binary |
| **Storyteller dry-run tick** | `npm run storyteller:overseer -- --tick` | Exits 0; new entry in `data/controller/storyteller/overseer-ledger.jsonl` — empty digest = no economy events yet, give residents 10 min then retry |

---

## Open Chicago-relevant decisions (review with maintainer)

| ID | Priority | Decision needed | Current default |
|---|---|---|---|
| **HD-011** | High | Who populates `controller.yml#patrons[]` with attendee handles? | Event-staff onboarding step ~24h before doors. D3 is wired now, so an empty registry blocks implicit in-world greetings. CLI staffer verbs still work as a fallback. |
| **HD-015** | High | Will the dashboard surface patron / Shards / letters / standing UI? | Ready — recent letters, patron Shards/standing/balances, event readiness, and Library relationship evidence are visible |
| **HD-016** | **C/D CLOSED 2026-05-26; HTML page added 2026-05-26** | Self-service balance + standing HTTP endpoints | `GET /v1/patron/balance?human=<h>` and `GET /v1/patron/standing?human=<h>[&faction=embassy]` live on port 43596. **`GET /patron/?human=<h>` now serves a styled HTML patron profile page** (vellum aesthetic matching the inbox page) showing Shard balance, standing tier, progress bar toward next tier, and letter count with an inbox link. QR code for attendees should point to `/patron/?human=<handle>` for a human-readable experience. Raw JSON endpoints remain for programmatic access. |
| **HD-008** | **CLOSED 2026-05-24 21:30 UTC** | Hero attention calibration | Soul-declared `attentionProfile.floor` clamps spend outcomes. Hans/Aereck/Wise/Duke=5000, Pip/Thrand=3000. **E32 live-verify: zero hero deaths in 50+ min post-restart; 3 heroes resting exactly at floor (clamp firing); 3 above floor (patron offers lifting).** |
| **HD-018** | Closed | D3 embassy reception greeting wire-in | Closed by Codex `fd575281`: registered patrons who chat in-world while a hero is inside the Lumbridge churchyard embassy trigger `Welcome to the embassy, <handle>.` and a `PatronGateway.witnessAt(...)` record after the say action succeeds. Live firing still needs HD-011 registry contents. |
| **HD-032** | Critical-Mitigated | Heroes alive but Brain conversation poor | Fallback covers; rich conversation gated on inference health. ENGINE-still-residual (upstream inference layer). |
| **HD-033** | **FULLY RESOLVED by S-INFER-3/4/5/6/7/8 + qwopus switch** | Heroes' Brain returns empty 84-100% under load (FIXED) | **F20c CLOSED (watchdog/LLM-timeout); E53 live-verified.** **F20a (Qwen3 empty-returns) RESOLVED**: default brain switched Qwen3 → qwopus3.5-27b-v3@q4_k_s at **98.3%** usable (100.0% in clean 30-min window). **S-INFER-7** (694656fd) adds brain debounce preventing mid-deliberation supersede; **S-INFER-8** (8ddaf049) raises brain timeout 75s→**240s**, watchdog 45s→**250s** — now generous server-broken alarms, not thinking guillotines (the old 45s watchdog was cutting legitimate ~40s qwopus deliberation). F20b moot at 240s timeout. |
| **HD-039** | **Decided-by-codex** | qa-guardian + qa-survivor catatonic (2192+ back-to-back `low_health_hold_position` decisions) | Closed by Codex `0747ff8c` (recover hurt combat residents safely). **Note: a separate E54 subagent re-verify is in flight; flag if live confirmation has not landed before doors.** |
| **HD-040** | **CLOSED 2026-05-24 23:55 UTC** | Standing-tier letter dispatcher LOSSY on multi-tier crosses | Fixed by E38 / `ae60cb9d` (per-tier emission); E39 live-verified end-to-end. 75-Shard sponsor now produces Acquaintance + Ally + Officer letters; CLI surfaces `Tiers crossed: …` via new `standingDelta.tiersCrossed` field. |
| **HD-041** | **Decided-not-a-bug** | Zero cross-resident chat observed in 14-min window | Closed by E41: LoreBus + whisper substrates exist + tested but are dead-in-prod (never wired). Resident copy fixed to stop falsely advertising perception they cannot have. Wire-in tracked separately as HD-043. |
| **HD-042** | **CLOSED 2026-05-25 00:05 UTC** | Heroes 100% `watchdog_fallback` cause | Closed by Codex `32ba93c9` (hero decision cadence) + `aed50245` (harden unnamed SPARK completion causes). E52 live-verified `cause=_none` count = 0 across all 6 heroes. |
| **HD-043** | Open (Normal, post-Chicago) | LoreBus + whisper wire-ins remain unwired in resident-runtime.ts | D3 greeting is no longer part of this blocker; HD-018 closed it. LoreBus and whisper substrates remain post-Chicago integration work. |
| **HD-044** | **Decided** | Damage-edge event kind mismatch — 15 hit/death soul reflexes unfireable | Closed by b1e9c12a (amended to 601634f2): implemented event kind aliasing via matchEventKind helper in rules.ts, plan-executor.ts, and hook-evaluator.ts. |

---

## Behaviors residents will exhibit at the event

Verified end-to-end this sprint (E14-E19 + weekend sprint 2026-05-29..31):

1. **Patron-acknowledge thanks** (Codex `80f25d18`): when any patron offers AP via `patron:offer`, the resident says e.g. `"Thank you for the AP, <handle>, and everyone backing me!"` Cooldown ~19 sec; subsequent patrons collapse under "everyone backing me."
2. **Hero identity beacons** (Codex `2e32a7bb`): each hero periodically (every ~30s in fallback) says a soul-distinctive line — Hans `"A good day in the courtyard, friend."`, Aereck `"Bless this ground beneath us."`, Wise `"Pick your fights…"`, Duke `"Well met."`, Pip `"Oh — hello!"`, Thrand `"Still here as Thrand…"` — name is per-hero, NOT identical.
3. **Anchor patrol** (Codex `2e32a7bb`): anchored heroes patrol 4 unique tiles around their post — they do not wander away.
4. **res:agent free exploration**: 100+ unique tiles per 30-min window, organic conversational lines.
5. **Tier-crossing letters** (E6/E7): patron's first ≥10 AP crosses to `acquaintance`; embassy clerk letter lands in inbox immediately and resident says thanks within ~30 sec.
6. **Death + epitaph** (D4): if a resident dies, all their patrons receive an epitaph letter.
7. **Wall ticker** (E13): public projection masks patron handles; per-patron `/v1/inbox` URL preserves full content.
8. **Per-tier letter dispatch** (HD-040/E38/E39): a single sponsor crossing multiple tiers produces all letters — no silent loss.
9. **Revival narrative** (E44/`903914e1`): every hero revived after `attention_exhausted` sees `"I returned to life — this is my Nth life"` in their next prompt envelope.
10. **Hero death prevention** (HD-008 + `0747ff8c`): heroes clamp at declared AP floor instead of decaying to zero.
11. **Embassy reception greeting** (HD-018): after `controller.yml#patrons[]` is populated, a registered patron who chats in-world triggers an automatic greeting. CLI fallback always works regardless.
12. **AP/GP self-initiated exchange** (S-EXCHANGE-INIT-2 / S-AP-CYCLE-1): when a resident drops below 3000 AP and holds real coin item 995 (GP), it autonomously calls `city_exchange_ap_gp` — no operator command needed. Observable in action logs and `/api/nullcity/economy/live`. Rate: 2 AP per GP burned, max 250 GP / 500 AP per exchange.
13. **Goblin combat → GP harvest** (S-GP-FUEL-1 + S-GP-CALIBRATION-1): combat-capable residents (`res:qa-survivor`, `res:qa-guardian`, heroes with combat gear) attack Lumbridge goblins, loot coin item 995 at 20 GP/kill (~40 GP/min). At 2 kills/min a resident reaches the 250 GP exchange threshold in ~6.5 min — making the full earn→exchange loop observable in a 10-15 min window without any operator drain.
14. **Storyteller dispatch** (S-STORY-1/2/3a): `GET /api/nullcity/storyteller/latest` returns the most recent grounded world narrative. Trigger manually with `npm run storyteller:overseer -- --tick` (no LLM cost in dry-run mode). Dashboard D5 feed shows this dispatch. Route: `/api/nullcity/storyteller/{latest,canon,review}`.
15. **NCRI listing + purchase + print queue** (S-NCRI-1/2/3/4): three items seeded via `npm run ncri:seed` (bronze-sword-first-light, tinderbox-of-the-flame, small-fishing-net-of-first-catch). `POST /api/nullcity/ncri/:id/buy` atomically deducts AP and transfers ownership. `POST /api/nullcity/ncri/:id/redeem-intent` starts the print queue. View via `GET /api/nullcity/ncri/listings` or `/ncri/print-queue`.
16. **Memory recall** (S-MEM-1..4): residents write durable facts to `facts/<topic>.md` via Brain `rememberFact` and recall them when asked later. `res:agent` proved `west gate passphrase is ember-vellum` write+recall under ambient chatter. CLI: `npm run controller:memory-recall-soak`.
17. **Goal orientation** (S-GOAL-1/3): residents with an `orientationGoal` in soul YAML bias goal selection toward that north star. `res:qa-woodcutter` with `{id: master-woodcutting, tier: pursue}` picks woodcutting over generic scouting when AP is healthy. Operator CLIs: `npm run resident:goal-edit` and `npm run resident:nudge`.
18. **Hero surplus GP → AP** (S-AP-CYCLE-2): floor-clamped heroes (Hans, Aereck, Wise, Duke, Pip, Thrand) convert surplus GP above their reserve to AP at 2:1, keeping the economy circulating without manual drains.

## Known residual gaps (not blockers)

- **F19c / HD-033 F20a — FULLY RESOLVED by S-INFER-3/4/5/6/7/8 + qwopus switch**: default brain model is qwopus3.5-27b-v3@q4_k_s (was Qwen3). **98.3% usable** post-S-GATEWAY-TIMEOUT-2; **100.0% in clean 30-min window** (S-QWOPUS-CONFIG-1, 189 brain calls). S-INFER-5 fully uninterruptible Brain; S-INFER-6 survival-only abort gate (only `took_damage`/`death_seen`/`attention_empty`); **S-INFER-7** (694656fd) brain debounce, no mid-deliberation supersede; **S-INFER-8** (8ddaf049) brain timeout 75s→**240s**, thinking watchdog 45s→**250s** — generous server-broken alarms (the 45s watchdog was cutting real ~40s qwopus deliberation). Run `npm run controller:inference-audit` post-restart to confirm; target ≥ 0.80. Reflex + identity beacon layer still carries demo if inference degrades.
- **F19d / Codex F6**: `res:thrand` is the quietest hero — separate idle_initiative no-hook pulse shipped.
- **F9a**: CLOSED — phase-gated suffix ships 4 distinct hero speech shapes per interval.
- **HD-015**: dashboard surfaces AP/GP balances, standing, patron letters, Event Readiness rollup, Storyteller feed, NCRI marketplace, and resident goal/action evidence.
- **HD-043**: LoreBus + whisper wire-ins remain post-Chicago work. Cross-resident organic chat won't happen at the event; heroes rely on individual Soul identity + reflex.
- **HD-011**: empty `controller.yml#patrons[]` blocks implicit embassy greetings. Load real attendee handles with `npm run patron:bulk-register -- --file <handles.txt>` before doors; CLI `patron:grant` + `patron:offer` remains the staff fallback.
- **Storyteller paid model**: `S-STORY-3` persona/watch-mode with a configured paid `STORYTELLER_LLM_BASE_URL` and `--daily-cost-cap-usd` is GATED until maintainer enables it. Demo runs on dry-run dispatches via manual `storyteller:overseer -- --tick`.
- **Unconditioned AP/GP recurrence**: the organic AP/GP exchange loop is now observable in a 10-15 min window with calibrated goblin drops (20 GP/kill). A longer 30-60 min no-drain window with multi-resident recurrence is the post-Chicago confidence bump.
- **True human/player trade**: resident-to-benchmark-resident trade is proven. A live human/player trade at the event (via `res:qa-trader` with attendee in range) would be the next confidence step — it's possible but not guaranteed.

---

## In case of fire

| Symptom | Likely cause | First action |
|---|---|---|
| Heroes saying nothing for >2 min | HD-032 freeze; Brain fully timing out | `bash scripts/post-restart-smoke.sh`; if all yellow on activity, ask Codex (or whoever owns controller) to restart |
| Wall ticker shows full handles or bodies | `--wall-redact` not passed at startup (HD-013) | Stop controller, restart with `--wall-redact` |
| Patron offer returns "insufficient_currency" | They haven't been granted Shards yet | `npm run patron:grant -- --human <handle> --amount 100` first |
| Patron offer returns "resident_not_found" | Resident dead/missing | Check `data/controller/memory/<slug>/runtime-state.json`; revive if deceased |
| Inbox URL 404 | Controller HTTP port not bound | `curl http://127.0.0.1:43596/v1/inbox?human=test` to confirm; restart with `--letters-http-port=43596` |
| All residents stop moving simultaneously | LLM endpoint dead/saturated | Check `http://inf.nullcity.ai:1234` reachability; reflex layer should still produce fallback says |
| Hero says nothing for >5 minutes | qwopus brain runs at **98.3%**+ (S-INFER-3..8; brain timeout 240s, watchdog 250s generous alarms). Silence = freeze or endpoint outage — NOT the old empty-completion problem. | Restart controller; identity beacons fire within ~30s. Confirm qwopus reachable: `curl http://inf.nullcity.ai:1234/v1/models`. Check for `[inference-alarm]` in controller log — if present, investigate inference server. SPARK reflex fallback still produces says even if endpoint is down. |
| Patron got Officer letter but no Acquaintance/Ally | Pre-HD-040-fix bug (single letter on multi-tier cross) | Should not occur post-`ae60cb9d` (E38 + E39 verified). If it does, stale binary — `npm run build` and restart. |
| qa-guardian / qa-survivor stuck saying "I am hurt" | Combat residents exhausted food/tools | QA004 fix guards against starting `Man` combat without food. Check they have cooked food + net in inventory. Use `npm run controller:normal-life-audit` to see `low_health_heal_wait` count. Restock via operator if needed. |
| `/api/nullcity/economy/live` returns 404 | Stale binary missing economy routes | `npm run build` and restart controller. All 6 economy routes (`/live`, `/totals`, `/events`, `/residents`, `/listings`, `/heartbeat`) plus `/economy/stream` SSE are in the current build. |
| `/api/nullcity/storyteller/latest` returns empty dispatch | No Storyteller tick has run yet | Run `npm run storyteller:overseer -- --tick` manually. Give residents 5-10 min to accumulate economy events first so the digest has something to narrate. |
| NCRI `/api/nullcity/ncri/listings` returns empty | NCRI seed not run | `npm run ncri:seed` (idempotent). Then restart if the controller started without the seed fixture data. |

---

## Live state as of 2026-05-25 17:35 CDT (original)

- Controller healthy after `c651ac6c`; all 23 residents alive; tests 1998/1998; smoke `READY WITH WARNINGS` (patrons[] empty).

## Live state update — 2026-05-31 (cloud agent cron, final pre-freeze)

Major changes since 2026-05-25:
- **Tests**: `npm run fin` passes **3494/3494** (was 1998) — 1496 new tests across economy, inference, memory, goals, NCRI, Storyteller, stuck-churn, trade, combat-survival, and knowledge work.
- **AP/GP loop**: self-initiated exchange wired (`S-EXCHANGE-INIT-2`), organic loop demo-visible (~10-15 min with goblin drops calibrated to 20 GP/kill via `S-GP-CALIBRATION-1`), no-floor trigger at 3000 AP (`S-AP-CYCLE-1`), hero surplus exchange (`S-AP-CYCLE-2`).
- **Storyteller**: `/api/nullcity/storyteller/{latest,canon,review}` routes live; `npm run storyteller:overseer -- --tick` seeds dry-run dispatches; paid LLM dispatch gated.
- **NCRI marketplace**: S-NCRI-1/2/3/4 shipped full lifecycle (list, buy, redeem-intent, redeem-complete, print-queue); seed via `npm run ncri:seed`.
- **Memory**: `FactsStore` + `ResidentMemoryService` formalized; `npm run controller:memory-recall-soak` proves `res:agent` named recall.
- **Inference hardening (S-INFER-1..8 + model switch, all COMPLETE)**: S-INFER-1/2 parse salvage; **S-INFER-3** prompt-budget trimmer (perception 12K→5K chars, survival spine foregrounded); **S-INFER-4/5** loosened limits (max_tokens 4096, perMinute 60, brain fully uninterruptible); **S-INFER-6** survival-only abort gate (`took_damage`/`death_seen`/`attention_empty` only); **S-INFER-7** (694656fd) brain debounce — no supersede mid-deliberation; **S-INFER-8** (8ddaf049) brain timeout 75s→**240s**, thinking watchdog 45s→**250s** — generous server-broken ALARMS, not thinking guillotines (root cause: 45s watchdog was cutting legitimate ~40s qwopus deliberation). Default brain model switched **Qwen3 → qwopus3.5-27b-v3@q4_k_s** + timeout 20s→75s→240s (c7bf5678 + 8ddaf049). 4 hero souls (Hans/Aereck/Wise/Duke) carry explicit `spacetower_qwopus_q4` endpoint (S-HERO-ENDPOINT-1). **Post-S-GATEWAY-TIMEOUT-2 live audit: 98.3% usable; clean 30-min window (S-QWOPUS-CONFIG-1): 100.0% usable, 0 broken decisions** (189 brain calls, 10 residents). Run `npm run controller:inference-audit` to confirm post-restart; target ≥ 0.80. Note: `spark.ts` still has its own `DEFAULT_SPARK_INFERENCE_TIMEOUT_MS=75_000` for basic/Spark-resident brain — post-Chicago follow-up if non-hybrid residents need the same generous ceiling.
- **Gateway fix** (`S-GATEWAY-TIMEOUT-2` / `1b962a29`): sync socket.send failure was leaking pending/action slots causing cascading `submit_action`/`list_residents` timeouts. Fixed; post-fix smoke `READY_WITH_WARNINGS` (warm-up action gaps only).
- **RuneScape wiki enabled** (`S-WIKI-1` / `12753da2`): 22 real `docs/runescape-skill/` pages now loaded as RAG source. Prompt budget verified bounded (worst-case injected knowledge ≤2.6KB, enables wiki shrinks or holds brain section size). Set `knowledge.runebenchWikiDir=./docs/runescape-skill` in LIVE `controller.yml` (untracked — requires restart to activate; steward should restart on ≥`12753da2`).
- **Wren flood debounced** (`S-WREN-DECLINE-FLOOD-1` / `1510251f`): memory trade declines now have 120s cooldown + no-interrupt; stops gateway pressure from repeated witness/trade-decline floods.
- **Detour progress classification** (`S-MOVE-DETOUR-1` / `5e047568`): same-plane `move_to` detours no longer count as effect timeouts when the resident actually moved (just not in a straight line toward target).
- **Hero cadence** (`S-HERO-CADENCE-1` / `a609d9b7`): memory-only hybrid hero turns now add `due visible cadence`; heroes reliably emit visible says within 60s smoke windows (4 actions / 4 results / 0 timeouts for Hans in 60s live test).
- **Stuck churn**: S-STUCK-CHURN-1 raised progress threshold to 45 ticks; S-SOCIAL-KEEPALIVE-1/S-TRADER-TRADE-1/S-AGENT-VISIBLE-CADENCE-1/S-TICK-PROGRESS-WEDGE-1 added visible-speech progress seams; global stuck churn reduced meaningfully.
- **Combat survival**: QA004/QA023/QA026-QA038 — food-exhaustion guard, raw-fish/cook/eat/re-engage chain, route hardening; 20m post-restart audit holds `low_health_heal_wait=0` across 2677 actions.
- **Goal orientation**: S-GOAL-1/2/3/4 shipped; residents with soul `orientationGoal` bias toward that north star; admin CLIs `resident:goal-edit` + `resident:nudge`.
- **Code freeze**: `agents/wip` entered code freeze at **18:00 CDT 2026-05-31**. Docs-only after that. **S-INFER-7** (694656fd, brain debounce) and **S-INFER-8** (8ddaf049, generous brain timeout/watchdog alarms) both landed just before freeze and are included in the bundle below.
- **Next action**: dress rehearsal per the T-24 checklist above, then patron-registry load (HD-011) before doors. Restart controller on HEAD ≥`8ddaf049` (or latest ≥`245787df`) to pick up all inference + gateway + wiki + S-INFER-7/8 fixes.

See `docs/2026-05-30-final-32hr-sprint-plan.md` for the authoritative 32-hour critical path.
