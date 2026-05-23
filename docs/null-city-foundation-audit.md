# Null City Foundation Audit — 2026-05-23

A snapshot taken mid-weekend (after 20 cycles of RuneScape-basics work landed) to identify what's actually built for the **Null City × OnionDAO** layer (workstreams J/K/L/M/N) and where the concrete next-week first slices should land.

The weekend prompt explicitly deferred J/K/L/M/N to next week. This doc does **not** start those workstreams — it audits the ground beneath them so next week's work has a place to land.

---

## TL;DR

Five Null City specs exist (J Patron, K Factions, L Cross-Resident Lore, M Heroes, N Embassy) totaling ~3000 lines of design. **None are implemented.** Of the foundation primitives those specs assume, one is fully built (PatronEvent + LibraryUpdater.observePatron), one is partially built (Evidence Layer trajectory + portrait), and the rest are TODO.

**The most actionable gap:** `PatronEvent` is typed and `LibraryUpdater.observePatron()` is implemented and unit-tested, but **nothing in the runtime calls observePatron**. The function is dead code from the resident's perspective. Wiring it is the J workstream's natural first slice.

---

## What Exists Today

### Evidence Layer (Workstream I — DONE)

- `src/controller/evidence/`:
  - `EvidenceStore` (per-resident append-only JSONL + session lifecycle + rotation)
  - `ProgressTracker` (XP/inventory/HP/position deltas + stuck detection)
  - `TrajectoryBuilder` (per-tick orchestrator, 12 line kinds, named exit reasons)
  - `MockPerceptionAdapter` (test FIFO queue)
  - `schemas.ts` (Zod for trajectory line + endTickReason + progress)
  - `library-updater.ts` — **contains `PatronEvent` type + `observePatron()` method**
  - `portrait-template.ts` — Library of Souls portrait shape with `PortraitPatron` field
- `RuntimeState.lastMeaningfulProgressAt` + `stuckSince` (pulse fields)
- Spark kernel wired into the trajectory builder for `beginTick` / `recordHook` / `recordBudget` / `recordDecision` / `recordAction` / `recordLegacy` / `endTick`

### SOUL Layer (DONE)

- Soul schema with `name / display / archetype / voice / fears / loves / goals / alignment / aesthetic` (slice 8 of the SOUL-coherence push earlier this multi-day session)
- Prompt envelope wires every SOUL field into Brain + Body prompts as directive sections
- 27-test coherence regression in `src/controller/llm/prompt-envelope-coherence.test.ts`

### Runtime Knowledge (Workstream P — DONE this weekend)

- 54 `ENGINE_KNOWLEDGE_ENTRIES` covering 13 skills, 4 quests, 4 monsters, 7 places, 5 NPCs, 5 item categories, 3 workflow chains, 3 survival, 3 communication, 2 meta, 2 economy, 3 cross-cutting
- Knowledge retriever has perception + goal filtering, scoring, token budgeting (Antigravity P1)
- 47 docs in `docs/runescape-skill/` mirror the runtime layer

### Combat Survival (Workstream Q F3 + F5 — DONE this weekend)

- F3 phrasebook for stuck-recovery voicing (Antigravity)
- F5 combat survival personality (Antigravity 2bedd776) — eat-when-hurt, weakest-aggressor selection, retreat with narration

---

## What's Missing — Foundation Gaps For Null City

### Gap 1 (MOST ACTIONABLE) — Patron events have no runtime source

**Status:** type + storage built; **call site missing**.

**Detail:**
- `LibraryUpdater.observePatron({ kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor', ts, patronHandle, ... })` is fully implemented and tested in `src/controller/evidence/library-updater.{ts,test.ts}`.
- `grep -rn "observePatron\|recordPatron" src/` returns ONLY the definition and its unit tests. **No runtime code calls it.**
- Implication: even if a human at the IRL OnionDAO event interacts with a resident, that interaction will never enter the resident's evidence trajectory or Library of Souls portrait.

**Concrete next-week first slice (J-α):**
1. Add a `PatronRegistry` config source: list of known patron handles (Discord/wallet/in-game name) + which `kind` their interactions count as.
2. Hook into the perception pipeline: when a chat event's speaker matches a registered patron handle, emit an `observePatron` call to the resident's `LibraryUpdater`.
3. Add a test fixture: chat event from a registered patron → patron line in the resident's library timeline.
4. Wire a simple "thank patron" reflex into the nervous system so residents acknowledge sponsorship publicly.

### Gap 2 — No multi-resident interaction protocol (Workstream L territory)

**Status:** specs exist (`2026-05-22-cross-resident-lore-design.md`, 821 lines), no code.

**Detail:** Each resident currently runs as an isolated SPARK kernel; there's no message-passing layer between residents, no shared lore, no faction coordination. The cross-resident-lore spec proposes a `LoreBus` with typed events but nothing scaffolds that yet.

**Next-week first slice (L-α):** define the `LoreEvent` Zod schema + an in-memory `LoreBus` (no persistence yet) + 1 reflex that emits a `lore.fire_lit` event when a resident successfully lights a fire. Other residents within visibility radius receive the event into their perception layer.

### Gap 3 — Hero residents are not distinguished from any other resident (Workstream M)

**Status:** spec exists (`2026-05-22-hero-residents-design.md`, 386 lines), no code.

**Detail:** Hero residents (named/public-facing residents that humans recognize) currently have nothing special at the kernel level — they're just souls with a name. M proposes specific SOUL templates + dedicated location anchors + a "famous" flag that gives heroes priority in patron interactions.

**Next-week first slice (M-α):** add a `heroProfile: { tier: 'hero' | 'novice' | 'background', publicName: string, signature_action: string }` optional field to the soul schema, and one named hero soul file (e.g., `library/souls/wise-old-man.md`) wired to a Draynor Village anchor.

### Gap 4 — Embassy/event venue is not modeled (Workstream N)

**Status:** spec exists (`2026-05-22-embassy-and-event-design.md`, 474 lines), no code.

**Detail:** The IRL OnionDAO Chicago event needs a virtual "embassy" tile cluster where residents congregate, patrons enter, and the event runs. None of this is in the engine.

**Next-week first slice (N-α):** designate an embassy coord region (e.g., a 10×10 tile cluster near Lumbridge for proximity) + add an `embassyContext: { isInside: boolean, eventActive: boolean }` perception field + a runtime knowledge entry for the embassy.

### Gap 5 — Factions are flavor-only (Workstream K)

**Status:** spec exists (`2026-05-22-rs6-factions-design.md`, 672 lines), no code.

**Detail:** RuneScape factions (Saradomin/Guthix/Zamorak/etc.) exist as world flavor but residents have no faction state, no faction-based reactions, no faction quest reward routing.

**Next-week first slice (K-α):** add `factionAffinity: { saradomin?: number, guthix?: number, zamorak?: number, unaligned?: number }` to soul schema + one faction-flavored Brain prompt directive (residents bias dialog and choice to their highest affinity).

---

## What Is Working Well That Should Continue

- **TDD discipline** on every src change has kept the test suite growing 542 → 1008 with **zero behavior regressions** across 20+ cycles.
- **Multi-agent coordination** via append-only `docs/agent-status.md` + stash-pull-pop has held: 3 agents (claude/codex/antigravity) shipped 60+ commits this weekend with **zero collisions**.
- **Evidence layer + SOUL coherence** are solid foundations — anything built on top inherits replayable trajectories + grounded identity prompts.
- **Direct-to-default-branch** (no PRs for routine work) keeps history tight; the workflow is sound.

---

## Recommended Sequence For Next Week

If next week budgets time to start Null City work, this sequence minimizes risk and unlocks the most downstream value per slice:

1. **J-α** (Patron events wired) — 1-2 days, unblocks every patron-facing feature. The LibraryUpdater is already there waiting.
2. **N-α** (Embassy region + perception field) — 1 day, gives the IRL event a virtual venue. Simple geometry + a perception flag.
3. **M-α** (Hero soul template + one named hero) — 1 day, gives patrons someone recognizable to interact with.
4. **L-α** (LoreBus skeleton + 1 cross-resident event) — 2 days, opens the multi-resident interaction surface.
5. **K-α** (Faction affinity field) — 1 day, gives Brain prompt a flavor signal.

That's ~5-7 days of work to get all five Null City workstreams to "first slice landed" status. From there, each becomes iterable per the existing weekend cron pattern.

---

## Honest Process Assessment (2026-05-23 mid-weekend)

What's working (keep):
- TDD red→green discipline on every src change.
- Stash-pull-pop for shared-tree WIP from parallel agents.
- File-level soft locks via STARTING-without-HANDOFF lines.
- Direct-to-default-branch workflow.

What's not working (fix):
- **Status log bloat:** my HANDOFF entries grew to 600-1500 chars each. The brevity convention added to `docs/agent-coordination.md` § Rule 5 caps future HANDOFFs at ~250 chars. Long rollups belong in commit bodies.
- **Knowledge saturation:** the runtime knowledge layer hit diminishing returns around entry #45. Future cycles should not default to "+2 entries." Time for behavior work, not more facts.
- **No live verification from claude:** Codex runs autonomous benchmarks each cycle; I haven't smoked a resident to verify my entries actually surface and get used by the LLM. The next claude src slice should include a focused smoke + dashboard inspection.
- **Null City gap:** 20 cycles of pure RS basics is more than enough. The next claude slice that's not docs cleanup should pick from J/K/L/M/N foundation tasks above.

---

## Cross-references

- `docs/null-city-rs6-vision.md` — the north-star design.
- `docs/null-city-ideation-backlog.md` — early brainstorm material.
- `docs/superpowers/specs/2026-05-22-{patron-loop,rs6-factions,hero-residents,embassy-and-event,cross-resident-lore}-design.md` — the 5 Null City workstream specs.
- `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — full roadmap including J/K/L/M/N task markers.
- `docs/agent-coordination.md` § Rule 5 — sync log brevity convention added this slice.
