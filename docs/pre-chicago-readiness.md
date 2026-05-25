# Pre-Chicago Readiness Checklist

> Single-page go/no-go for event day. Replaces the bottom-up `embassy-staff-runbook.md` with a top-down checklist. Each item has a verification command and a green/yellow/red status from the most recent smoke run.

**Event:** OnionDAO Chicago IRL, 2026-06-01 (~8 days from this writing on 2026-05-24).
**Maintainer:** James (jamescarnley@gmail.com).
**Sprint context:** see `docs/intelligence-verification-log.md` and `docs/human-decisions.md`.

---

## Quick run

The fastest go/no-go check is the smoke script written this sprint:

```sh
bash scripts/post-restart-smoke.sh
```

Exit code 0 = ready; 1 = blocking red. If the script reports `READY` or `READY WITH WARNINGS`, you can open doors. If it reports `NOT READY`, address the red items first.

---

## Pre-doors checklist (T-24 hours)

| Item | How to verify | What "green" looks like | If red |
|---|---|---|---|
| **Controller process alive** | `ps aux \| grep dist/controller/index.js \| grep -v grep \| grep -v SCREEN` | One node PID, started today | Restart controller: `npm run build && node dist/controller/index.js --letters-http-port=43596 --wall-redact` |
| **HTTP port 43596 bound** | `curl -s "http://127.0.0.1:43596/v1/inbox?human=health-check"` | Returns `{"letters": [...]}` JSON | Controller was started without `--letters-http-port=43596` (HD-026). Restart with the flag. (`?` MUST be quoted in zsh.) |
| **Wall ticker redaction active** | `curl -s http://127.0.0.1:43596/v1/wall/snapshot \| python3 -m json.tool \| head` | `body` fields are `""`, `recipient` contains `***` | Controller missing `--wall-redact` (HD-013-live, HD-029). Restart with both flags. |
| **All 19 residents alive** (6 heroes + res:agent + 12 Codex QA cohort) | `bash scripts/post-restart-smoke.sh` (section 4 globs `data/controller/memory/res-*/`) | All marked ALIVE | `npm run controller:revive -- --resident res:<name>` for each dead one. (Codex's `3f042b38` tooling.) The QA cohort runs without a floor by design (they SHOULD be able to die so the death loop is testable); heroes have HD-008 floors that prevent attention-exhaustion. |
| **Hero attention at or above declared floor** | `for h in res-hans res-father-aereck res-wise-old-man res-duke-horacio res-pip res-thrand; do jq '.attention' data/controller/memory/$h/runtime-state.json; done` | Hans/Aereck/Wise/Duke ≥ 5000; Pip/Thrand ≥ 3000 — **clamped to those floors by HD-008 (E30 substrate + E32 live-verify)** | Floor under-shoot means soul YAML missing `attentionProfile.floor`. Re-add via `intelligence-verification-log.md § E30`. Patron:offer `--amount 1000+` still tops them above floor for active engagement; e.g. `claude-mega-rescue` lifted pip from 3000 floor → 4067 with a 2000 Shard offer. |
| **Patron registry populated** | `grep -A 99 'patrons:' controller.yml \| grep '^\s*-'` | One line per attendee handle | HD-011 default: event-staff onboarding step ~24h before doors writes the attendee list to `controller.yml`. |
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
| **HD-011** | Normal (DOWNGRADED) | Who populates `controller.yml#patrons[]` with attendee handles? | Event-staff onboarding step ~24h before doors. **E50 downgrade rationale: D3 in-world greeting is dead-in-prod (HD-018), so an empty patrons[] does not block the CLI staffer path which works regardless.** |
| **HD-015** | High | Will the dashboard surface patron / Shards / letters / standing UI? | No — staff reads files directly via this runbook |
| **HD-016** | High | Which Shards UX verb ships first beyond `patron:grant`/`patron:offer`? | C/D (balance lookup + tier visibility) |
| **HD-008** | **CLOSED 2026-05-24 21:30 UTC** | Hero attention calibration | Soul-declared `attentionProfile.floor` clamps spend outcomes. Hans/Aereck/Wise/Duke=5000, Pip/Thrand=3000. **E32 live-verify: zero hero deaths in 50+ min post-restart; 3 heroes resting exactly at floor (clamp firing); 3 above floor (patron offers lifting).** |
| **HD-018** | Open (RECONFIRMED) | D3 embassy reception greeting unwired | reception-reflex.ts substrate + 15 tests exist; zero callers in resident-runtime.ts / controller-host.ts / nervous-system.ts. **E50 grep + live trajectory both show DEAD CODE in prod.** Cross-ref HD-043: same root cause (substrate-ready-but-unwired; resident-runtime.ts continuously Codex-active prevents wire-in). CLI staffer recipe is the working alternative for Chicago. |
| **HD-032** | Critical-Mitigated | Heroes alive but Brain conversation poor | Fallback covers; rich conversation gated on inference health. ENGINE-still-residual (upstream inference layer). |
| **HD-033** | **Mitigated 2026-05-25 00:30 UTC** | Heroes' Brain returns empty 84-100% under load | **F20c CLOSED by Codex `8eae437f` (watchdog/LLM-timeout aligned to 65s); E53 live-verified +3-9 successful Brain calls/hero post-fix.** F20a (Qwen3 thinking-mode empty-returns 87.5%) + F20b (uniform ~44s endpoint queueing) remain upstream-inference-layer; F20d (promptTokens missing on empty) is minor observability polish. |
| **HD-039** | **Decided-by-codex** | qa-guardian + qa-survivor catatonic (2192+ back-to-back `low_health_hold_position` decisions) | Closed by Codex `0747ff8c` (recover hurt combat residents safely). **Note: a separate E54 subagent re-verify is in flight; flag if live confirmation has not landed before doors.** |
| **HD-040** | **CLOSED 2026-05-24 23:55 UTC** | Standing-tier letter dispatcher LOSSY on multi-tier crosses | Fixed by E38 / `ae60cb9d` (per-tier emission); E39 live-verified end-to-end. 75-Shard sponsor now produces Acquaintance + Ally + Officer letters; CLI surfaces `Tiers crossed: …` via new `standingDelta.tiersCrossed` field. |
| **HD-041** | **Decided-not-a-bug** | Zero cross-resident chat observed in 14-min window | Closed by E41: LoreBus + whisper substrates exist + tested but are dead-in-prod (never wired). Resident copy fixed to stop falsely advertising perception they cannot have. Wire-in tracked separately as HD-043. |
| **HD-042** | **CLOSED 2026-05-25 00:05 UTC** | Heroes 100% `watchdog_fallback` cause | Closed by Codex `32ba93c9` (hero decision cadence) + `aed50245` (harden unnamed SPARK completion causes). E52 live-verified `cause=_none` count = 0 across all 6 heroes. |
| **HD-043** | Open (Normal, post-Chicago) | LoreBus + whisper + D3-greeting wire-ins all unwired in resident-runtime.ts | ~90 LOC workstream blocked on resident-runtime.ts being continuously Codex-active. Substrates + tests exist; no callers. Same root cause as HD-018 and HD-044. |
| **HD-044** | Open (Normal) | Damage-edge `PerceptionEvent` missing — 15 hit/death soul reflexes unfireable | Same substrate-ready-but-unwired pattern as HD-018 / HD-043. ENGINE-debug. |

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
11. **CLI staffer recipe for guaranteed hero acknowledgement** (E50 / HD-018 dead-in-prod workaround): the 3-step `patron:grant → patron:offer → show inbox URL` flow produces explicit hero acknowledgement even though D3 in-world greeting is unwired. See `embassy-staff-runbook.md § "Patron is not greeted when they enter the embassy"`.

## Known residual gaps (not blockers)

- **F19c**: heroes' Brain (rich conversation) succeeds <10% of calls under load; reflex layer carries the experience.
- **F19d / Codex F6**: `res:thrand` is the quietest hero — separate Codex workstream `7669f384` shipped idle_initiative no-hook pulse.
- **F9a**: scout-template "Goal: ... Next: ..." tail still identical across consecutive says. Polish, not a blocker.
- **HD-015**: dashboard does not surface patron / Shards / letters. Staff reads disk files directly.
- **HD-033 F20a**: Qwen3 thinking-mode returns empty 87.5% of calls (upstream LLM behavior; reflex layer carries experience). F20b uniform ~44s endpoint queueing also upstream. F20c CLOSED by `8eae437f`; F20d (promptTokens missing on empty) is observability polish only.
- **HD-043**: LoreBus + whisper + D3-greeting wire-ins all unwired (post-Chicago ~90 LOC workstream). Cross-resident chat won't happen organically at the event.
- **HD-018 / HD-044**: same root cause as HD-043 — substrate-ready-but-unwired in `resident-runtime.ts`. The file has been continuously Codex-active all weekend (cooking-recovery / low-health-recovery / cadence / etc), preventing safe wire-in.

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

## Live state as of this writing (2026-05-25 01:35 CDT)

- Controller healthy through SPRINT-E53; SPRINT-QA5 (4 subagents, deep QA pass #5) currently dispatched
- **All 19 residents alive** — 6 heroes + res:agent + 12-soul Codex QA cohort (qa-angler, qa-banker, qa-cook, qa-forager, qa-guardian, qa-guide, qa-priest, qa-scout, qa-social, qa-survivor, qa-trader, qa-woodcutter)
- Tests: **1677/1677** passing on `agents/wip` (SPRINT-QA4 closure; subsequent E38/E43/E44/E50/E51/E52/E53 cycles pure-docs)
- Verification log range covered this refresh: **E30 → E53** (plus QA2 → QA5 deep passes); next dispatch is SPRINT-QA5 in flight + a separate E54 re-verify of HD-039
- **13 HDs CLOSED or MITIGATED across this weekend's sprint**: HD-008 (CLOSED), HD-030 / HD-031 (CLOSED), HD-032 (Mitigated), HD-033 (Mitigated — F20c CLOSED), HD-037 / HD-038 (CLOSED, patron-gateway), HD-039 (Decided-by-codex `0747ff8c`, E54 re-verify in flight), HD-040 (CLOSED `ae60cb9d` + E39), HD-041 (Decided-not-a-bug), HD-042 (CLOSED `32ba93c9` + `aed50245`), HD-046 (CLOSED Decided-by-default, standing permanent by design)
- Open Chicago-relevant HDs remaining: **HD-011 downgraded Normal** (CLI path works), **HD-018 reconfirmed dead-in-prod** (D3 greeting), **HD-043 / HD-044** (post-Chicago wire-in workstream), **HD-015 / HD-016** (UX scope decisions)
- Smoke script (post E37 ship): globs all 19 residents; READY WITH WARNINGS (no remaining Chicago-day blockers — HD-011 is now Normal and the CLI staffer recipe is the working path)

See `docs/sprint-handoff-2026-05-26.md` for the maintainer's Tuesday recovery context.
