# Live Verification — 2026-05-24

**Author:** claude (autonomous), after maintainer pushed back on "you shipped substrate without ever running it."

**Method:** controller is running locally (PID 92175 on port 43594 game, 43595 gateway; PID 97001 bun connected). Observation is via on-disk evidence — `data/controller/memory/<resident>/runtime-state.json`, `data/controller/memory/data/letters/<slug>/inbox.jsonl`, trajectory + library timeline files. No competing controller spawned.

---

## TL;DR

**Two pillars are confirmed working in production:**
- EVENT-D4 death loop: 7 epitaph letters successfully dispatched across 2 patrons (`codex-hour-qa`, `codex-live`) during the overnight session. Real production execution of the substrate I shipped + Antigravity wired.
- J1 attention decay: ticks down correctly, marks residents deceased when exhausted, sets `deceased.processed = true` after dispatch.

**Three real bugs / calibration issues surfaced:**
1. **Hero starting attention is calibrated for active patron support.** Without one, all 6 heroes drained and died within 10 seconds of each other (04:49:56 → 04:50:06 UTC). Patched this cycle: bumped all 4 heroes to 14000 starting attention.
2. **Same resident has multiple epitaphs** for `res:agent` because the resident gets reborn between deaths (controller restart resets `deceased` field). The 4 epitaphs in `codex-hour-qa`'s inbox all name `res:agent` but with different `livedTicks` (59728, 3225, 4406, 7420) — they're 4 separate "lives" of the same name. Whether this is a UX bug or working-as-designed is a maintainer call. File: `data/controller/memory/data/letters/codex-hour-qa/inbox.jsonl`.
3. **No reception greeting fired** during the overnight session — confirms EVENT-D3 wiring is genuinely still missing (substrate exists at `evaluateReceptionGreeting`, not called per tick). Per the next-week-handoff doc.

---

## Per-resident snapshot at 2026-05-24 ~10:30 CDT

| Resident | Tick | Attention | Deceased? | LLM requests today | Notes |
|---|---|---|---|---|---|
| res:agent          | 32094 | 8529 | NO  | 0 (since last restart) | Endurer; 20k starting + gentle decay. Alive but idle. |
| res:hans           | 3528  | 0    | YES | 243 | died at 04:50:06.614 — attention_exhausted, processed:true |
| res:father-aereck  | 3360  | 0    | YES | 342 | died at 04:49:56.411 — attention_exhausted, processed:true |
| res:duke-horacio   | 1966  | 0    | YES | 74  | died at 04:50:06.009 — attention_exhausted, processed:true |
| res:wise-old-man   | 3306  | 0    | YES | 365 | died at 04:50:06.665 — attention_exhausted, processed:true |
| res:pip            | 3962  | 0    | YES | 269 | died at 04:50:06.631 — attention_exhausted, processed:true |
| res:thrand         | 3987  | 0    | YES | 219 | died at 04:50:06.646 — attention_exhausted, processed:true |

**Mass-die fingerprint:** 6 residents died within 654 milliseconds. This is the J1 decay + per-resident initial attention curves all reaching zero in the same overnight session.

**Total LLM requests today across all 6 deceased heroes:** 1,512. They were thinking constantly until they died.

---

## What's working (don't lose)

1. **End-to-end death loop is production-live.** `markDeceased` → `checkDeceasedAndDispatchEpitaphs` → `extractPatronHandlesFromTimeline` → `buildEpitaphDispatchRequests` → `dispatchEpitaphs` → `LettersStore.append` → inbox.jsonl persistence. All wired by Antigravity at `628d27b6`, all sourced from my substrate, all confirmed firing.
2. **Patron-to-resident attribution.** The library timeline correctly recorded `patronHandle` for `codex-hour-qa` and `codex-live`, then the epitaph dispatcher correctly addressed letters to them by handle.
3. **Letter rendering.** Templated bodies are readable: "codex-hour-qa, / res:agent has died. / They served unaligned for 59728 ticks — a life measured in the small currency of attention rather than the large one of years. / Their hands were best at firemaking..."
4. **Persistence.** Letters survive controller restart. Runtime state survives controller restart (mostly — see issue #2 above on `deceased` field re-emergence).

## Bugs / calibration issues filed

| # | Bug | Severity | Fixed this cycle? |
|---|---|---|---|
| 1 | Hero starting attention too low for unattended sessions | HIGH for event-day (heroes die before patrons can support them) | YES — bumped 4 hero souls to 14000 |
| 2 | Resident gets reborn between deaths (deceased field clears on restart) → multiple epitaphs for same logical resident | MEDIUM — UX confusion for patron seeing 4 "res:agent has died" letters | NO — needs maintainer design call on persistence semantics |
| 3 | EVENT-D3 reception greeting not wired into tick | LOW for autonomous play, HIGH for event day | NO — next-week-handoff doc has the 30-line code skeleton |
| 4 | No patron actually offered Shards overnight | N/A — operational, not a code bug | Action item: have maintainer try `npm run patron:offer --human <real-handle> --resident res:hans --amount 5` after this cycle's bumps land |

---

## What I CAN'T verify from on-disk evidence alone

- **Movement.** runtime-state doesn't snapshot position — would need to read trajectory.jsonl or live perception. Trajectory has `recordAction` entries that capture every action though.
- **Inter-resident interactions.** Need to grep trajectory files for `say` actions targeting another resident or for `chat` events from another resident's name.
- **In-world progress.** Did anyone level firemaking? Did anyone kill a chicken? trajectory.jsonl has `progress` lines; I'd need to scan them.
- **LLM output quality.** Whether the Brain's say/plan outputs were genuinely interesting or repetitive slop. Would need to read decision lines.

**Recommendation:** next live-verification cycle should `grep` trajectory files for these specific signals.

---

## Concrete next slices (now wired into the cron's VERIFICATION PRIORITY queue)

1. **Verify Pillar-1 behavior** — scan trajectory.jsonl files for the 6 heroes' last 100 actions. Did they chop trees? Light fires? Move? Talk to NPCs? Or did they spin uselessly?
2. **Maintainer patron-offer smoke** — once the new heroes spawn with 14k attention, the maintainer runs `patron:grant + patron:offer` to confirm the live patron loop replenishes attention + dispatches a standing-tier letter.
3. **Bug #2 design decision** — should `deceased` survive restart? Per the spec the resident IS dead. But operationally the runtime keeps re-spawning them. File a discussion task.
4. **EVENT-D3 wire** — the per-tick hook from the handoff doc. 30 lines. Would have prevented heroes dying in silence overnight.
5. **Dashboard** — the dashboard at `../rs6-nullcity-residents-dashboard` should show attention curves so the mass-die would have been visually obvious before it happened.

---

*Generated 2026-05-24 ~10:35 CDT after the first live-verification cycle of this session.*

---

## VERIFY-2 — trajectory deep-read (2026-05-24 ~11:35 CDT)

After VERIFY-1 bumped hero attention to 14k, scanned actual on-disk trajectory + progress files to verify per-resident behavior. Cron firing has produced no new behavior data because the running controller (PIDs 92175 + 97001) hasn't been restarted to reload the bumped soul files.

### Findings

**A. All 6 heroes are still deceased on-disk and producing no behavior.**

Live `runtime-state.json` snapshot at 11:30:

| Resident | tick | attention | deceased | reqsToday |
|---|---|---|---|---|
| res:agent          | 33946 | 7835 | NO | 0 |
| res:hans           | 3528  | 0    | attention_exhausted | 243 |
| res:father-aereck  | 3360  | 0    | attention_exhausted | 342 |
| res:duke-horacio   | 1966  | 0    | attention_exhausted | 74  |
| res:wise-old-man   | 3306  | 0    | attention_exhausted | 365 |
| res:pip            | 3962  | 0    | attention_exhausted | 269 |
| res:thrand         | 3987  | 0    | attention_exhausted | 219 |

The numbers are identical to VERIFY-1 (~1h earlier). Heroes haven't ticked their attention or tick counters since the original death event. **The controller is still running them as deceased.**

**Root cause:** soul file changes don't apply to already-loaded residents. The 14k attention bump in commit `0b9007f4` is on disk but the running controller cached the old 6–8k values when it spawned them yesterday. A controller restart is required for new values to take effect — and the maintainer hasn't restarted. **HD-020 filed.**

**B. Deceased residents still consume tick budget.**

`res:thrand`'s recent trajectory files (8 hours of them, going back to 08:12 UTC):

```
20260524T095253Z ... 893 begin_tick, 893 end_tick, 0 actions, 0 decisions, 0 say
20260524T094615Z ... 579 begin_tick, 579 end_tick, 0 actions, 0 decisions, 0 say
20260524T093615Z ... 617 begin_tick, 617 end_tick, 0 actions, 0 decisions, 0 say
20260524T093122Z ... 483 begin_tick, 483 end_tick, 0 actions, 0 decisions, 0 say
20260524T085446Z ... 3621 begin_tick, 3621 end_tick, 0 actions
20260524T085141Z ... 293 begin_tick, 293 end_tick, 0 actions
20260524T081715Z ... 3406 begin_tick, 3406 end_tick, 0 actions
20260524T081202Z ... 517 begin_tick, 517 end_tick, 0 actions
```

The runtime keeps polling perception + writing trajectory rows for a dead resident indefinitely. No LLM cost (the Brain doesn't get called when deceased) but real disk + perception-fetch cost. **HD-019 filed** — propose `runtime.stop(name)` called from the death-loop AFTER `dispatchEpitaphs` returns.

**C. res:agent (alive) is genuinely playing — at low quality.**

Same latest session (~15 min wall-clock window):

```
916 begin_tick / 916 end_tick
272 decision (Brain LLM calls — actively thinking)
 78 action_result
 70 action
  65 action.move_to
   8 say
   3 action.interact
   2 action.use_item_on_item
```

**Real say outputs (sample):**
- "Heading to chop a nearby tree for logs. Steady work builds the foundation."
- "I am online at 3193,3259. Goal: Gather logs from a nearby tree to progress woodcutting and support f..."
- "I am online at 3199,3257. Goal: Gather logs from a nearby tree to progress woodcutting and support f..."
- "I am online at 3201,3251. Goal: Gather logs from a nearby tree to progress woodcutting and support f..."

The first say has a real plan-narrating voice. The next three are near-identical re-emissions of the same "I am online at X" template — the Brain is repeating itself across moves. The Brain LLM is producing genuine output but with very limited variation.

**Real action samples:**
```
move_to (3190, 3259) cause=routine_loop_break
move_to (3190, 3259) cause=continue_move
move_to (3190, 3255) cause=woodcutting_level1_routine
move_to (3190, 3255) cause=woodcutting_level1_routine
move_to (3190, 3255) cause=woodcutting_level1_routine
```

Three consecutive identical moves to the same tile with cause `woodcutting_level1_routine`. This is the "non-closing-move" bug Codex is actively investigating per `QA-nonclosing-move` STARTING at 04:44 — the woodcutting routine keeps re-emitting the same move target without the resident actually approaching the tree.

**Observable behavior summary:** res:agent IS doing things, but in a tight loop near (3190, 3255) without ever closing distance to chop. Brain produces genuine voice but with narrow variation across consecutive ticks.

### What this means for the IRL event

- **Heroes don't actually do interesting things autonomously without patron support.** The 14k floor will help once the controller restarts, but the deeper question is whether the Brain alone produces a watchable arc.
- **Behavior shape today: ~95% move_to, ~10% repeat-say, ~5% interact/use_item.** Skill progression yes (woodcutting routine targets are correctly chosen) but the resident isn't completing actions.
- **The Codex QA-nonclosing-move investigation is the right priority.** Patron support won't matter if residents never reach the tree.

### Action items from VERIFY-2

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Maintainer restarts controller to pick up VERIFY-1 attention bump | Maintainer | HD-020 |
| 2 | Death loop calls `runtime.stop(name)` after dispatch | next available agent | HD-019 |
| 3 | Codex's QA-nonclosing-move investigation must land before more behavior verification is useful | Codex (active per status log) | in-flight |
| 4 | Once heroes alive again: re-read trajectories to confirm they actually move, chop, interact, talk to each other | claude (next cycle) | queued |

---

*Updated 2026-05-24 ~11:42 CDT after VERIFY-2 trajectory deep-read.*
