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
| **All 7 residents alive** | `for h in res-agent res-hans res-father-aereck res-wise-old-man res-duke-horacio res-pip res-thrand; do echo -n "$h: "; jq -r '.deceased // "alive"' data/controller/memory/$h/runtime-state.json; done` | All show `alive` | `npm run controller:revive -- --resident res:<name>` for each dead one. (Codex's `3f042b38` tooling.) **Use `scripts/post-restart-smoke.sh` for the same loop with green/red coloring.** |
| **Hero attention > 5000** | `for h in res-hans res-father-aereck res-wise-old-man res-duke-horacio res-pip res-thrand; do jq '.attention' data/controller/memory/$h/runtime-state.json; done` | All ≥ 5000 | Patron:offer `--amount 1000+` to top them up. `claude-mega-rescue` rescued pip from 162 → 4067 with `--amount 2000`. |
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
| **HD-011** | High | Who populates `controller.yml#patrons[]` with attendee handles? | Event-staff onboarding step ~24h before doors |
| **HD-015** | High | Will the dashboard surface patron / Shards / letters / standing UI? | No — staff reads files directly via this runbook |
| **HD-016** | High | Which Shards UX verb ships first beyond `patron:grant`/`patron:offer`? | C/D (balance lookup + tier visibility) |
| **HD-008** | High | Hero attention calibration | 14000 floor; **observed decay much faster — pip at 162 today** |
| **HD-032** | Critical-Mitigated | Heroes alive but Brain conversation poor | Fallback covers; rich conversation gated on inference health |

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

## Known residual gaps (not blockers)

- **F19c**: heroes' Brain (rich conversation) succeeds <10% of calls under load; reflex layer carries the experience.
- **F19d / Codex F6**: `res:thrand` is the quietest hero — separate Codex workstream `7669f384` shipped idle_initiative no-hook pulse.
- **F9a**: scout-template "Goal: ... Next: ..." tail still identical across consecutive says. Polish, not a blocker.
- **HD-015**: dashboard does not surface patron / Shards / letters. Staff reads disk files directly.

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

---

## Live state as of this writing (2026-05-24 19:10 CDT)

- Controller `local-93740` (then `local-73320`) healthy
- All 7 residents alive (after `claude-mega-rescue` saved pip from 162 attention)
- Tests: 1562/1562 passing on `agents/wip`
- Open critical HDs: HD-032 mitigated; F19c / E20 / E21 quantified
- Smoke script: READY WITH WARNINGS (5 yellows — patron registry empty, 4 hero attentions below 5000 floor)

See `docs/sprint-handoff-2026-05-26.md` for the maintainer's Tuesday recovery context.
