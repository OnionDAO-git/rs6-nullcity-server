# Pre-Chicago Readiness Checklist

> Single-page go/no-go for event day. Replaces the bottom-up `embassy-staff-runbook.md` with a top-down checklist. Each item has a verification command and a green/yellow/red status from the most recent smoke run.

**Event:** OnionDAO Chicago IRL, 2026-06-01 (~8 days from this writing on 2026-05-24).
**Maintainer:** James (jamescarnley@gmail.com).
**Sprint context:** see `docs/intelligence-verification-log.md` and `docs/human-decisions.md`.

---

## Quick run

Two complementary go/no-go checks land in ~2 minutes total:

```sh
# (1) ops health — process / HTTP / wall snapshot / library / patron registry
bash scripts/post-restart-smoke.sh

# (2) behavior health — per-resident action/result/say evidence from trajectories
npm run controller:smoke

# (3) timed live behavior proof — residents must advance during the window
npm run controller:smoke -- --observe-seconds 120 --min-observed-actions 1 --allow-recent-visible
```

**`post-restart-smoke.sh`** reports `READY` / `READY WITH WARNINGS` / `NOT READY` — if `NOT READY`, address the red items first. Exit 0 = ready; 1 = blocking red.

**`controller:smoke`** reports per-resident `OK <name> tick=N actions=A results=R success=S timeout=T fail=F says=Y lastAction=K lastResult=R lastSay="…"`. Useful for confirming heroes are emitting their soul-distinctive personality lines (Hans "A good day in the courtyard, friend.", Aereck "Bless this ground beneath us.", Wise "Pick your fights…", Duke "Well met. The duchy stands open to you.", Pip "Oh — hello!", Thrand "Still here as Thrand…") and that cohort residents are action-active (qa-woodcutter / qa-forager hit 15-19 actions per window). If a hero shows 0 says or a cohort resident shows 0 actions over a few minutes, something is off.

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
| **Staff trained on patron-grant CLI** | `npm run patron:grant -- --help` and `npm run patron:offer -- --help` | Staff can grant + offer Shards via terminal |
| **One Brain success per hero confirmed today** | Read recent trajectories for any decision row with `promptTokens > 0` per hero | At least one organic Brain output per hero (heroes are currently mostly in fallback per F19c) |

---

## Open Chicago-relevant decisions (review with maintainer)

| ID | Priority | Decision needed | Current default |
|---|---|---|---|
| **HD-011** | High | Who populates `controller.yml#patrons[]` with attendee handles? | Event-staff onboarding step ~24h before doors. D3 is wired now, so an empty registry blocks implicit in-world greetings. CLI staffer verbs still work as a fallback. |
| **HD-015** | High | Will the dashboard surface patron / Shards / letters / standing UI? | Ready — recent letters, patron Shards/standing/balances, event readiness, and Library relationship evidence are visible |
| **HD-016** | **C/D CLOSED 2026-05-26** | Self-service balance + standing HTTP endpoints | `GET /v1/patron/balance?human=<h>` and `GET /v1/patron/standing?human=<h>[&faction=embassy]` live on port 43596. QR-code accessible for attendees. Codex live re-verified 2026-05-26: known patron returned nonzero Shards + Officer standing, missing `human` returns 400, stranger returns next-tier guidance. |
| **HD-008** | **CLOSED 2026-05-24 21:30 UTC** | Hero attention calibration | Soul-declared `attentionProfile.floor` clamps spend outcomes. Hans/Aereck/Wise/Duke=5000, Pip/Thrand=3000. **E32 live-verify: zero hero deaths in 50+ min post-restart; 3 heroes resting exactly at floor (clamp firing); 3 above floor (patron offers lifting).** |
| **HD-018** | Closed | D3 embassy reception greeting wire-in | Closed by Codex `fd575281`: registered patrons who chat in-world while a hero is inside the Lumbridge churchyard embassy trigger `Welcome to the embassy, <handle>.` and a `PatronGateway.witnessAt(...)` record after the say action succeeds. Live firing still needs HD-011 registry contents. |
| **HD-032** | Critical-Mitigated | Heroes alive but Brain conversation poor | Fallback covers; rich conversation gated on inference health. ENGINE-still-residual (upstream inference layer). |
| **HD-033** | **Mitigated 2026-05-25 00:30 UTC** | Heroes' Brain returns empty 84-100% under load | **F20c CLOSED by Codex `8eae437f` (watchdog/LLM-timeout aligned to 65s); E53 live-verified +3-9 successful Brain calls/hero post-fix.** F20a (Qwen3 thinking-mode empty-returns 87.5%) + F20b (uniform ~44s endpoint queueing) remain upstream-inference-layer; F20d (promptTokens missing on empty) is minor observability polish. |
| **HD-039** | **Decided-by-codex** | qa-guardian + qa-survivor catatonic (2192+ back-to-back `low_health_hold_position` decisions) | Closed by Codex `0747ff8c` (recover hurt combat residents safely). **Note: a separate E54 subagent re-verify is in flight; flag if live confirmation has not landed before doors.** |
| **HD-040** | **CLOSED 2026-05-24 23:55 UTC** | Standing-tier letter dispatcher LOSSY on multi-tier crosses | Fixed by E38 / `ae60cb9d` (per-tier emission); E39 live-verified end-to-end. 75-Shard sponsor now produces Acquaintance + Ally + Officer letters; CLI surfaces `Tiers crossed: …` via new `standingDelta.tiersCrossed` field. |
| **HD-041** | **Decided-not-a-bug** | Zero cross-resident chat observed in 14-min window | Closed by E41: LoreBus + whisper substrates exist + tested but are dead-in-prod (never wired). Resident copy fixed to stop falsely advertising perception they cannot have. Wire-in tracked separately as HD-043. |
| **HD-042** | **CLOSED 2026-05-25 00:05 UTC** | Heroes 100% `watchdog_fallback` cause | Closed by Codex `32ba93c9` (hero decision cadence) + `aed50245` (harden unnamed SPARK completion causes). E52 live-verified `cause=_none` count = 0 across all 6 heroes. |
| **HD-043** | Open (Normal, post-Chicago) | LoreBus + whisper wire-ins remain unwired in resident-runtime.ts | D3 greeting is no longer part of this blocker; HD-018 closed it. LoreBus and whisper substrates remain post-Chicago integration work. |
| **HD-044** | **Decided** | Damage-edge event kind mismatch — 15 hit/death soul reflexes unfireable | Closed by b1e9c12a (amended to 601634f2): implemented event kind aliasing via matchEventKind helper in rules.ts, plan-executor.ts, and hook-evaluator.ts. |

---

## Behaviors residents will exhibit at the event

Verified end-to-end this sprint (E14-E19):

1. **Patron-acknowledge thanks** (Codex `80f25d18`): when any patron offers Shards via `patron:offer`, the resident says e.g. `"Thank you for the Shards, <handle>, and everyone backing me!"` Cooldown ~19 sec; subsequent patrons in the same minute are collapsed under "everyone backing me."
2. **Hero identity beacons** (Codex `2e32a7bb`): each hero periodically (every ~30s in fallback) says e.g. `"Still here as Hans; getting my bearings near my post."` — name is per-hero, NOT identical across heroes.
3. **Anchor patrol** (Codex `2e32a7bb`): anchored heroes patrol 4 unique tiles around their post (range 1) — they do not wander away.
4. **res:agent free exploration**: 100+ unique tiles per 30-min window, organic conversational lines occasionally (one observed: `"Path to the south is blocked or broken. Anyone heading that way?"`).
5. **Tier-crossing letters** (E6 / E7): patron's first ≥10 Shards crosses them to `acquaintance`; the embassy clerk's letter lands in their inbox immediately and the resident says thanks within ~30 sec. **2000 Shards crosses straight to `officer`** (observed today with `claude-mega-rescue`).
6. **Death + epitaph** (D4): if a resident dies, all their patrons receive an epitaph letter naming the resident's lived ticks + cause + lasting impressions.
7. **Wall ticker** (E13): public projection masks recipients (`alice@onion` → `a***@onion`) and clears bodies. Per-patron `/v1/inbox` URL preserves full content for their own private viewing.
8. **Per-tier letter dispatch** (HD-040 fix `ae60cb9d` / E38 + E39 live): a single 75-Shard sponsor that crosses Acquaintance + Ally + Officer now produces **all three letters** (was 1; LOSSY before). CLI surfaces `Tiers crossed: acquaintance, ally, officer (3 letters dispatched)` via new `standingDelta.tiersCrossed` field.
9. **Revival narrative in Brain prompt envelope** (E44 / task #156 closure, `903914e1`): every hero revived after `attention_exhausted` sees `"I returned to life — this is my Nth life — humanized cause"` in their next prompt envelope. 18 revival events across 6 residents render via the new `case 'revival'` in `library-memories.ts`. Combined with HD-008 floor, heroes can now narratively reflect on continuity breaks.
10. **Hero death prevention** (HD-008 attention floor + Codex `0747ff8c` qa-guardian/survivor recovery waypoint): heroes clamp at declared floor instead of decaying to zero; catatonic low-health combat residents now seek a recovery waypoint instead of locking on `low_health_hold_position` forever.
11. **Embassy reception greeting** (HD-018 / N6): after `controller.yml#patrons[]` is populated, a registered patron who chats in-world while a hero is inside Lumbridge churchyard should be greeted and witnessed automatically. CLI `patron:grant → patron:offer → inbox URL` remains the guaranteed staff fallback.

## Known residual gaps (not blockers)

- **F19c**: heroes' Brain (rich conversation) succeeds <10% of calls under load; reflex layer carries the experience.
- **F19d / Codex F6**: `res:thrand` is the quietest hero — separate Codex workstream `7669f384` shipped idle_initiative no-hook pulse.
- **F9a**: ~~scout-template "Goal: ... Next: ..." tail still identical across consecutive says~~ **CLOSED** by `5fba2c06`: phase-gated suffix — phase 0 shows Goal+Next, phases 1+2 show Goal only, phase 3 shows prefix+position only. Heroes now cycle through 4 distinct speech shapes per interval.
- **HD-015**: dashboard surfaces recent patron letters plus Shards, standing, balances, tier counts, next-tier gaps, an Event Readiness rollup, and relationship evidence from visible residents' Library timelines.
- **HD-033 F20a**: Qwen3 thinking-mode returns empty 87.5% of calls (upstream LLM behavior; reflex layer carries experience). F20b uniform ~44s endpoint queueing also upstream. F20c CLOSED by `8eae437f`; F20d (promptTokens missing on empty) is observability polish only.
- **HD-043**: LoreBus + whisper wire-ins remain post-Chicago integration work. Cross-resident chat won't happen organically at the event.
- **HD-011**: empty `controller.yml#patrons[]` is the live blocker for implicit embassy greetings. Load real attendee handles with `patron:bulk-register` before doors.

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
| Hero says nothing for >5 minutes | Likely `empty_completion` (HD-033 F20a Qwen3 thinking-mode quirk); 87.5% of Brain calls return empty | Restart controller; reflex layer should still produce fallback says + identity beacons within ~30s. If silence persists, suspect a deeper freeze and run smoke script. |
| Patron got Officer letter but no Acquaintance/Ally | Pre-HD-040-fix bug (single letter on multi-tier cross) | Should not occur post-`ae60cb9d` (E38 + E39 verified). If it does, the controller is running a stale binary — `npm run build` and restart. |
| qa-guardian / qa-survivor stuck saying "I am hurt" | HD-039 catatonic combat residents (2192+ back-to-back `low_health_hold_position`) | Verify Codex `0747ff8c` is in the live dist (`git log --oneline dist/ \| grep 0747ff8c`). If not, restart controller after `npm run build`. E54 re-verify may still be in flight — flag the maintainer if not yet confirmed. |

---

## Live state as of this writing (2026-05-25 17:35 CDT)

- Controller healthy after `c651ac6c` and latest `agents/wip` pulls; live stack: game, controller, and dashboard screens are running.
- **All 23 residents alive** — 6 RuneScape heroes + 4 faction flagships + res:agent + 12-soul Codex QA cohort.
- Tests: **1998/1998** passing on `agents/wip` at the latest full `npm run fin` gate.
- D3 embassy greeting is wired; live firing still depends on HD-011 real patron registry contents.
- Smoke script: `READY WITH WARNINGS` because `patrons[]` is empty. Recent trajectory activity is green for all 23 residents, and wall snapshot redaction is active.
- Wall/dashboard proof: `/v1/wall/snapshot` shows 23 residents, active SOUL/runtime goals, faction labels, and faction stockpile totals; `/observe/resident/res%3Aagent` shows live feed, module, thinking/body state, inventory, and progress.

See `docs/sprint-handoff-2026-05-26.md` for the maintainer's Tuesday recovery context.
