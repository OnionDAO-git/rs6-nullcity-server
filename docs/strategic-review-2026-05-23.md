# Strategic Review — 2026-05-23 (mid-weekend)

A high-level look at where rs6-nullcity-server is, taken at the maintainer's prompt mid-weekend. Two parallel deep-audit subagents read the RuneBench source docs and the Null City vision/ideation/5-specs against current code + tasks. This doc captures their findings, the cohesion check, and the refinement decisions.

**Snapshot reference:**
- Default branch (`nullcity`) tip: `d1e9a84b` (workflow-spec only this weekend; runtime work elsewhere)
- Working branch (`agents/wip`) tip: this commit
- Test count: 120 suites / 1003+ tests
- Code shipped this weekend: `ENGINE_KNOWLEDGE_ENTRIES` 8→54, `docs/runescape-skill/` 47 files, J-α-1 CurrencyLedger landed

---

## TL;DR

**Three pillars for the OnionDAO June 1 2026 event:**
1. **Autonomous RS agents** — SOLID.
2. **Interesting human guidance** — WEAK. The biggest miss. No MCP `run_routine` facade exists; humans can only shout in-game chat at residents.
3. **Emotional connection to story** — WEAK SUBSTRATE. Library timelines write but never read back into next-session prompts. PatronEvent uncalled. Death loop incomplete end-to-end. Sibling-flagship epitaph routing missing.

The weekend has done valuable Pillar-1 work (runtime knowledge, combat survival, monolith split) and started Pillar-3 substrate (J-α-1 CurrencyLedger). Pillar 2 is essentially un-started.

Eight days to event. The remaining ~7 days should rebalance toward Pillars 2 and 3 — Pillar 1 is good enough to keep refining incrementally.

---

## Pillar Scorecard

### Pillar 1: Autonomous RS agents

**Status: SOLID.**

Built:
- SOUL schema with archetype/voice/fears/loves/goals/alignment/aesthetic; 27-test prompt-coherence regression.
- SPARK kernel with Brain + Body + Nervous + Spark facade, modular hooks, action-coordinator.
- Evidence Layer (trajectory + progress + library updater + portrait).
- 54 ENGINE_KNOWLEDGE_ENTRIES across 13 skills + 4 quests + 4 monsters + 7 places + 5 NPCs + 5 item categories + 3 workflow chains + 3 survival + 3 communication + 2 meta + 2 economy + 3 cross-cutting.
- 17 agent-facing skill knowledge files + 3 starter quest walkthroughs + monsters.md + economy.md + npcs/ + places/.
- F3 phrasebook (stuck recovery voicing) + F5 combat survival personality (eat / flee / weakest-aggressor).
- Codex's recent live-truthful benchmark fixes for make-fire, fishing-cooking, combat-prayer.

Verified: 7 autonomous benchmarks pass live (`make-fire-5m`, `woodcutting-firemaking-10m`, `starter-fishing-5m`, `fishing-cooking-10m`, `combat-prayer-10m`, `explore-report-5m`, `follow-and-chat-5m`).

Top remaining Pillar-1 work (RuneBench gap audit, not blockers):
- ResidentSDK freshness facade (state staleness detection).
- Trajectory moment-labels (`first-log` / `fire-lit` / `stuck-recovery`) — also Pillar-3 narrative win.
- `lastSuccessfulEffectAt` vs `lastMeaningfulProgressAt` distinction.
- Brain ambition-from-knowledge ("you've never been to Varrock — try it").
- Routine Runner (whitelisted controller-side; required for MCP `run_routine`).
- Knowledge auto-generation from engine config.

### Pillar 2: Interesting human guidance

**Status: WEAK. Biggest gap.**

Built:
- In-game chat is the only human → resident channel.
- The `say` action exists for resident → human channel.
- Dashboard reads evidence (D1/D3/D4 verified).

Missing:
- **Controller MCP routine facade** — humans can't issue `run_routine make-fire res:agent` from outside the autonomous loop. RuneBench specified this (`run_routine`, `run_workflow_card`, `resident_api`, `workflow_cards` resources); rs6 has none of it. (Task added: RB-MCP.)
- **In-world chathead patron verbs** (J-γ) — "Offer to <resident>", "Send gift", "Sponsor a new resident" chathead menu options. Tasked but blocked on N-α (embassy placement) and J-β (PatronGateway).
- **SuggestedIntervention** — RuneBench had a dashboard suggestion type so humans could see "this resident is stuck — try X". Missing entirely.
- **Web inbox** for letters delivered to humans. J-δ depends.

This pillar's success directly determines whether humans at the IRL Chicago event feel like participants or spectators.

### Pillar 3: Emotional connection to story

**Status: WEAK SUBSTRATE.**

Built (substrate):
- `PatronEvent` type, `LibraryUpdater.observePatron()`, portrait-template with `PortraitPatron`.
- `CurrencyLedger` (Shards) shipped this cycle.
- `legacy_event` line kind, `prepare_epitaph` field in M4 spec.

Built (functional):
- Almost nothing reaches a human or a resident in a way that builds attachment.

Missing:
- **Per-resident memory feedback into prompts** — vision claims I done, but only WRITE side is built; next session's prompt does NOT read the timeline. Resident who met Alice yesterday won't remember her. Breaks the entire attachment loop. (Task added: I-β.)
- **End-to-end death loop** — pieces exist; chain not wired. No defined death trigger; no epitaph generation path; no Mortician's Ribbon flow. (Task added: J-δ-2 / M-β.)
- **Multi-resident conversation surface** — current L-α task covers L3 (world events), not L1 (whisper / gift / assist_skill / challenge_duel). Without resident-to-resident dialog, the city is "solitary monologues" — vision's own warning. (Task added: L-β.)
- **Sibling-flagship epitaph routing** — v2 canon: death triggers a letter from a sibling flagship to patrons, not a self-templated epitaph. K spec mentions the routing but no task wires it.
- **Brand voice (Onion-themed copy)** — generic civic-ritual prose currently; no layered/peeling/concealment-as-revelation voice convention. OnionDAO branding gap.
- **Currency cap + decay** — J Open Q #9 specified a first-10-Shards-at-full-strength patron contribution cap to prevent whale flattening; no task. Decay rate also unset.

---

## Drift + Contradictions (8 issues from Null City audit)

Same task fixes all four naming issues — added as `DRIFT` task above. Other drift:

1. **Vision claims I (Library) is DONE** (`docs/null-city-rs6-vision.md` line ~260) but read-back side is missing. **Fix in this commit** (see below).
2. **Vision says L is deferred** (line ~188) but spec exists (821 lines). **Fix in this commit.**
3. **Foundation audit's α-wedges vs spec's α-plans** — Audit's K-α is "add factionAffinity field" (one day); K spec K-α is "Catalog skeleton: write factions.ts + pois.ts + integrity tests" (much larger). Intentional decomposition. Add note to spec.
4. **Architecture drift: kernel vs module ownership** — vision says "module decides, kernel validates" but L/M specs put validation in the kernel. Soft drift; worth one line in vision next update.

---

## RuneBench Gaps (12 ideas not yet captured)

Top 5 with highest leverage for the OnionDAO goal:

1. **`run_routine` MCP facade** — see Pillar 2. (Task: RB-MCP)
2. **Trajectory moment-labels** — turns raw evidence into watchable narrative for both dashboard and library portrait. (Task: RB-MOMENTS)
3. **`lastSuccessfulEffectAt` distinction** — diagnoses "actions succeed but goal stuck" pattern, dashboard surfacable.
4. **Brain ambition-from-knowledge** — drives the "discovery moment" feel.
5. **Knowledge auto-generation from engine config** — without it, our 47 hand-curated knowledge files drift whenever the server changes.

Full list in the audit (this is the surfaced summary). Stale ideas (RuneBench LostCity substrate, 8× clock, `execute_code`) correctly remain rejected per `docs/runebench-conventions-adopted.md`.

---

## Refinements Decided This Slice

### Process

- **Strategic review becomes a recurring artifact.** Every ~30 cycles or ~24h, the next agent runs the same parallel-audit pattern used here. Output: dated `docs/strategic-review-YYYY-MM-DD.md`. Added to `docs/agent-coordination.md` (separate commit). Prevents the 12-cycle runtime-knowledge-saturation drift this weekend.
- **Status-log brevity convention** already in `docs/agent-coordination.md` § Rule 5 (this morning).
- **Shared agent branch + curated milestones** already in `docs/agent-coordination.md` § Rule 3 (this morning).

### Designs

- **Pillar rebalance:** future cycles should weight Pillar 2 (human guidance) and Pillar 3 (emotional connection) more heavily than Pillar 1 (autonomy refinement). Pillar 1 is good enough; the IRL event needs Pillars 2 and 3 to feel alive.
- **Drift fixes:** Shards/tier/Mortician-N/PatronEvent-kinds reconciled in one DRIFT task.
- **Vision-doc accuracy:** L deferred line removed + I overstatement fixed (this commit).

### Coordination

- 7 new high-priority tasks added (see task list #110-#116):
  - RB-MCP: MCP routine facade (largest Pillar-2 wedge)
  - I-β: prompt envelope reads timeline (largest Pillar-3 wedge)
  - J-δ-2 / M-β: end-to-end death loop
  - L-β: multi-resident whisper verb
  - DRIFT: reconcile naming across spec/code/vision
  - RB-MOMENTS: trajectory moment-labels
  - PROCESS: recurring strategic review convention

---

## Recommended Slice Order For Remaining Weekend / Next Week

If only 5-7 days remain before event-readiness review:

1. **I-β (memory feedback into prompts)** — unlocks every emotional-connection feature; 1-2 days.
2. **Wire `observePatron` from runtime** — even a simple chat-event-from-patron-handle detector unblocks J-δ tests; 1 day.
3. **DRIFT fixes** — 1-cycle docs-only sweep to align spec/code/vision.
4. **RB-MCP routine facade design + first slice** — opens the human-guidance seam; 2-3 days for a working spec + tested first verb (`run_routine make-fire`).
5. **L-β whisper verb** — minimum-viable multi-resident dialog; 1 day after L-α.
6. **Continue J-α-2 through J-ε** — the patron substrate keeps maturing in parallel.

Defer to post-event:
- K factions-vs-factions combat policy table.
- Embassy persistence between event days (O2-rs6).
- RuneBench Brain ambition-from-knowledge.

---

## Honest Caveat

This review is itself a snapshot. Two parallel audit subagents are good but not perfect — they may have missed ideas in the source docs. Cron-fired future agents reading this doc should treat it as a working hypothesis, not a final scorecard. The recurring-review convention (PROCESS task above) is the mechanism for self-correction.

The biggest unknown: **whether the in-world chathead patron verbs (J-γ) are even achievable in RuneJS engine without major plugin work**. That gates the patron loop's UX. Worth a focused engine-spike before sinking many days into J-β.

---

## Cross-references

- `docs/null-city-foundation-audit.md` — earlier mid-weekend audit (overlaps; this doc supersedes for cohesion view)
- `docs/null-city-rs6-vision.md` — north star (drift fixes this commit)
- `docs/superpowers/specs/2026-05-22-{patron-loop,rs6-factions,cross-resident-lore,hero-residents,embassy-and-event}-design.md` — 5 workstream specs
- `feat/runebench-systems-design.md` — RuneBench reference (audited this cycle)
- `docs/agent-coordination.md` — workflow + brevity + recurring-review conventions
