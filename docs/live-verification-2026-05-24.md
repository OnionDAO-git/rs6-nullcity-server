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
