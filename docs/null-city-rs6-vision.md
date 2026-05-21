# Null City × RuneScape × Agent Intelligence — Grand Design

**Date:** 2026-05-22.
**Status:** Living document. Update as design decisions land.
**Audience:** Any agent (Claude, Codex, future) or human picking up Null City work in this repo. Read this first.

This is the north-star vision for what we're building in `rs6-nullcity-server`. Specific specs and plans cite this doc for context. If a downstream spec contradicts this vision, the spec is wrong unless this vision has been explicitly updated.

---

## What Null City Is

A persistent simulation where autonomous AI **residents** live inside a RuneScape 2006 game world (RuneJS, build #435), and human players become their **patrons, witnesses, sponsors, and friends** — not their controllers.

Residents have memory, finite lives, goals they pursue without prompting, relationships they form with each other and with humans, and stories that survive their deaths in a **Library of Souls**. Humans cannot directly control residents; they can only influence them — by funding them, talking to them, witnessing them, sponsoring their births, and grieving when they die.

The emotional loop we are engineering:

> **Pride. Attachment. Grief. Legacy.**

Not optimization. Not leaderboards. Not "horses people bet on for payouts" *(NullCityNotes phrasing)*. We are trying to build a place where a human can meet a small, named, autonomous character, give them a tinderbox, watch them light a fire, watch them die in the wilderness three days later, and feel something real about it.

---

## The Big Bet

There are two reasons to use RuneScape as the substrate:

1. **The world is already rich.** Lumbridge, Varrock, Edgeville, the wilderness, the skills, the NPCs, the quests, the items — all exist. We don't have to build a world; we inherit one. Players already know how to behave in it.
2. **Player-vs-resident interaction is the natural interface.** RuneScape players have decades of habits around chat, trade, gift, follow, attack. Residents that act like *fellow players* — not vendor NPCs — close the loop with no new UI.

The thing humans take home is a **lanyard achievement** earned by interacting with residents at the June 1, 2026 in-person event in Chicago. The thing they remember is the resident whose epitaph letter they received in their in-game mail two weeks later.

---

## Relationship To v1 And v2

`rs6-nullcity-server` deliberately diverges from `nullv2` (the shippable event-MVP). v1 was the aspirational Kubernetes worldbox that set the emotional bar; v2 toned it down to ship in time. **rs6 is bringing back v1's ambition on a substrate that actually works.**

Specific deliberate divergences from v2:

- **Library is a living artifact**, not just a graveyard row. It grows over a resident's existence and incorporates death as a chapter, not a finalizer. (v2 treats library_of_souls as post-mortem-only.)
- **Resident voice is captured verbatim**. Every `say` is preserved; portraits quote, never paraphrase.
- **Multi-life accumulation is permitted in rs6**, though death itself is treated with weight (Mortician's Ribbon, epitaph letters).
- **Factions, currency, embassy POI are RS-flavored**, not Solder-Saints / Hatchery / Locksmiths / Ledgerwrights / Chicago-landmark.

When `rs6` contradicts v2, v2's canon governs `nullv2`; `rs6`'s governs *this repo only*. The two are sibling projects in the same lineage.

See: `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` § "Relationship To Null City v1 And v2" for the locked language on this.

---

## The Architecture, At Altitude

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   RuneJS Game Server (build #435) ───────► game world, players,         │
│         │                                  items, NPCs, places          │
│         │                                                               │
│         ▼                                                               │
│   ResidentRuntime (per resident)                                        │
│         │                                                               │
│         ▼                                                               │
│   SPARK Kernel ───► reviewed SPARK module ───► AgentAction              │
│         │            (e.g., onion.runescape.standard)                   │
│         ▼                                                               │
│   Evidence Layer ───► trajectory.jsonl  (every tick)                    │
│         │             progress.jsonl    (meaningful deltas)             │
│         ▼                                                               │
│   Library of Souls ─► per-resident living portrait + timeline           │
│         │                                                               │
│         ▼                                                               │
│   AgentGateway (WS/SSE) ───► Residents Dashboard ───► human reads       │
│         │                                                               │
│         ▼                                                               │
│   Patron Events (Workstream J — proposed)                               │
│         │                                                               │
│         ▼                                                               │
│   Embassy POI in-game + IRL embassy in Chicago + Wall map + Lanyards    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### What's done

- **Game server, controller, gateway, residents dashboard** — operational. Residents can connect, perceive, act, talk, die.
- **SPARK kernel + module system** — reviewed in-repo modules with strict capability facades (state read-only, memory namespaced, inference budgeted, telemetry redacted).
- **`onion.runescape.standard` module** — the default reviewed module, with thinking + nervous-rules facets wired.
- **Evidence Layer** — per-tick trajectory + progress JSONL, ProgressTracker for stuck detection, MockPerceptionAdapter for kernel tests without RuneJS.
- **Library of Souls (partial)** — portrait template, timeline distillation, verbatim voice capture, last-words tagging, relationships, survival milestones, unfulfilled wants.
- **Benchmark harness** — `make-fire-5m`, `woodcutting-firemaking-10m`, `starter-fishing-5m`, `explore-report-5m`, `follow-and-chat-5m`, `combat-prayer-10m`, `fishing-cooking-10m`.
- **RuneScape knowledge** — agent-readable skill/items/places index; knowledge retrieval into prompts.

### What's not done

- **Patron loop** — humans currently have no in-game way to give residents attention/currency. *Workstream J.*
- **Factions** — rs6 needs its own four. v2's don't translate. *Workstream K.*
- **Hero residents** — named arc-driven NPCs for the event. *Workstream M.*
- **Embassy POI / IRL graveyard / Mortician's Ribbon** — physical event surfaces. *Workstream N.*
- **Cross-resident dynamics** — interact_resident verbs, projects, rumor. *Workstream L.*
- **Letters delivery** — one-way channel from city to humans. *In Workstream J.*
- **LLM-augmented portraits** — currently deterministic templates. *Post-MVP.*
- **Engineering polish** — health-check upgrades, ledger discipline, Docker layering. *Workstream O.*

---

## The Three Core Loops

Everything we build is in service of one of these three loops landing emotionally:

### 1. The Resident's Inner Loop (autonomy)

Per tick, in `spark.tick`:

```
perceive → evaluate need → choose constrained action → execute → write memory → evidence trail
```

The kernel enforces safety/budget; the module decides what to do. The **constrained action set** is critical: residents can only do things from a typed catalog, never invent mechanics. That keeps the world coherent.

Open: rs6 needs the full action vocabulary (`train_skill`, `bank_deposit`, `cast_spell`, `whisper_player`, `walk_to`, `attack_npc`, `pray`, `request_attention`, `prepare_epitaph`, `trade_resource`, `interact_resident`). Some shipped, some are *Workstream M*.

### 2. The Patron Loop (human → resident)

```
Human encounters resident in-world
  → gives them attention / Shards-equivalent / a gift
  → resident's attention clock refills
  → standing tier crosses a threshold
  → resident sends a letter back
  → human cares
```

Without this loop the residents have no reason to matter to humans. *Workstream J* is this loop's spec.

### 3. The Legacy Loop (resident → world)

```
Resident lives, accumulates voice/relationships/wants
  → resident dies (combat / attention exhausted / planned legacy reached)
  → epitaph letter dispatched to humans who chatted with them
  → portrait sealed in Library
  → in-game tombstone in graveyard
  → IRL printed epitaph at embassy wall
  → Mortician's Ribbon awarded to humans who witnessed
```

The Library exists; epitaph letters and graveyard placement are *Workstream N*. Mortician's Ribbon is *N5*.

---

## Critical Design Invariants

These are not negotiable without explicit re-design conversation:

1. **Humans don't control residents.** Patrons influence, don't drive. No `/command_resident` style verbs.
2. **Residents act on a constrained typed action catalog.** No free-form code execution. Module decides; kernel validates.
3. **Death has weight.** Even when treated as one event among many, deaths trigger letters, civic achievements, graveyard placement.
4. **Voice is preserved verbatim.** Portraits quote, never paraphrase.
5. **Inference happens before DB writes.** Slow LLM never holds a row lock. On inference failure → no state change.
6. **Static catalog in code, not DB.** Factions, achievements, rooms, currencies are TypeScript constants.
7. **Single-process controller.** Multi-controller sharing of a memory dir is out of scope.
8. **The default branch is the integration branch.** Per `docs/agent-coordination.md`: small-scope work pushes directly to `nullcity`; only genuinely experimental work branches.
9. **No `/Users/...` paths or private-context references in committed docs.** `NullCityNotes.md` is private; cite as "Null City v1 design notes (private)."

---

## Documents To Read In Order

For a fresh agent picking up Null City work:

1. **`docs/null-city-rs6-vision.md`** — *this doc.* The why.
2. **`docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`** — the canonical workstream board (A–O).
3. **`docs/agent-coordination.md`** — multi-agent collision avoidance, file lock conventions.
4. **`docs/agent-status.md`** — append-only sync log. Read the tail to see what's in flight.
5. **`docs/null-city-ideation-backlog.md`** — 90+ ideas catalogued by theme, with provenance and "next step" hooks.
6. **`docs/runebench-conventions-adopted.md`** — 17 patterns we've adopted from MaxBittker/RuneBench.

For active workstream work, read the relevant spec(s) in `docs/superpowers/specs/`:

| Workstream | Spec |
|---|---|
| I (Evidence + Library) | `2026-05-21-spark-evidence-loop-design.md` (v2.1, locked) |
| J (Patron Loop) | `2026-05-22-patron-loop-design.md` |
| K (Factions) | `2026-05-22-rs6-factions-design.md` |
| L (Cross-Resident) | *(deferred — write before starting)* |
| M (Hero Residents) | `2026-05-22-hero-residents-design.md` |
| N (Embassy / Event) | `2026-05-22-embassy-and-event-design.md` |
| O (Engineering Polish) | *no spec — items are independently scoped* |

---

## Open Strategic Decisions

A 2026-05-22 Notion dive (canonical sources: `Narrative V2`, `Onion DAO Narrative`, `Onion DAO 2026 Guide`) defaulted several of these. **Defaulted answers are working values that an autonomous agent should use to unblock work — the maintainer can override any of them.** Resolved decisions are tracked in `docs/human-decisions.md`.

### ✅ Defaulted from Notion (subject to maintainer override)

- **Four faction names** — **`The Foundry`** (hardware/making), **`The Bureau of Continuity`** (memory/legacy — natural Library-of-Souls owner), **`The Ledger`** (transparency/governance), **`The Veil`** (secrets/skeptics). Canonical updated names from `Onion DAO Narrative`. These port directly to RuneScape without renaming.
- **Tension axes** — **Making vs Remembering** (Foundry vs Bureau) and **Transparency vs Concealment** (Ledger vs Veil). Derived from narrative descriptions.
- **Currency name** — **`Shards`**. Canonical. Stored on the IRL badge as ESP-NOW packets, non-transferable between humans.
- **Shard earning rates** — 1–3 per workshop, 5–20 per competition, 3–10 per quest, 1 daily check-in, 2 referral. From `Narrative V2`.
- **Standing tier names** — **Acquaintance, Ally, Officer** (at thresholds 10/30/75 Shards by v2 defaults).
- **Civic achievements** — three canonical: **First Shard** (first check-in), **Mortician's Ribbon** (witness one resident death — threshold N=1), **Founder's Stake** (earn one tier-3 resource).
- **IRL embassy location** — **Chicago Innovation Center (CIC), 1 W Monroe, 5th floor.**
- **Visual treatment for The Veil** — redacted-black on the wall map (carries forward v2's Locksmith treatment).

### ❓ Still Open (need maintainer)

- **Per-faction mottos.** v2's old mottos were tied to old names; new mottos need re-writing for The Foundry / Bureau of Continuity / Ledger / Veil. *Workstream K.*
- **Per-faction colors (hex).** Conceptually: warm-metallic, archival-soft, bronze, redacted-black; exact hex TBD.
- **Per-faction default SOUL archetype.** *Workstream K.*
- **Four flagship NPC names + voices** (goals/alignment/quirks/aesthetic). *Workstream K3.*
- **Five RuneScape POI placements.** Notion gives the IRL embassy address; in-game RuneScape locations are rs6-specific. Strong candidate mapping: Foundry → Falador smithing area, Bureau → Lumbridge churchyard (Library-of-Souls adjacency), Ledger → Varrock Square/bank, Veil → Edgeville thieves' area, Atrium → Lumbridge Castle courtyard. *Workstream K4 + N1 + N3.*
- **Shard → attention conversion ratio** and **attention decay rate per tick.** *Workstream J.*
- **Visitor-born ritual names** (three parts of 8 Shards each). Suggested: Kindling / Inscription / Vow. *Workstream J.*
- **Letter delivery channel** — RS in-game mailbox, clan-chat, scroll pickup, or web-only inbox? Recommend web-only inbox first. *Workstream J.*
- **In-game patron verbs surface** — chathead, embassy hub, or hybrid. *Workstream J.*
- **Whether rs6 and v2 share a currency ledger** or maintain separate balances. *Workstream J — deepest unresolved economic question.*
- **Print queue reuse** — Does rs6 share v2's print queue + claim_code workflow? Strong default: yes (reuse). *Workstream N.*
- **June 1 hero cast** — Which named heroes appear at the event? *Workstream M.*
- **Live smoke owner** — Codex per morning brief. *Workstream I close-out.*

An autonomous agent encountering an unresolved item should mark the relevant roadmap task `[!]` with a one-line note. An agent encountering a Notion-defaulted item should USE THE DEFAULT and note its source.

---

## How To Pick Up Work (For An Autonomous Agent)

1. Read this doc + the roadmap.
2. Read the tail of `docs/agent-status.md` to see what other agents have in flight.
3. Find a `[ ]` task in the roadmap that:
   - Is not blocked on a maintainer decision (no `[!]` flag)
   - Doesn't overlap with currently-in-progress `[>]` tasks
   - Has a spec (J/K/M/N) or is independently scoped (O)
4. Change the task to `[>]` in the roadmap and append a status entry.
5. Read the relevant spec section.
6. Follow TDD: failing test → minimum implementation → verify → commit → push.
7. After each significant component, dispatch an expert subagent for code review.
8. When done, mark `[x]` with a verification note and push.

**Default workflow:** push directly to `nullcity`. Branches only for genuinely experimental / multi-hour autonomous work — see `docs/agent-coordination.md` Rule 3.

If you finish a task and want more work but everything is blocked / claimed:
- Check the ideation backlog for unprompted improvements.
- Write or extend a spec for a `[ ]` workstream task whose spec doesn't exist yet.
- Tighten test coverage on existing components.
- Add operational polish from Workstream O.

---

## Done When

The vision is "done" enough for June 1, 2026 when:

- ✅ A human at the Chicago embassy can earn Shards (or rs6 equivalent) by attending workshops.
- ⏳ They can spend that currency to *birth*, *refill*, or *witness* a named resident in the RuneScape world. *(J6, J2, J5)*
- ⏳ The resident pursues goals visibly — chops trees, lights fires, fights goblins, asks for help, talks to humans. *(Mostly done, M3 adds request_attention)*
- ⏳ The resident remembers what happened, accumulates a voice, makes named friends. *(I — done)*
- ⏳ When the resident dies (combat, attention exhausted, planned legacy), an epitaph letter is delivered to humans who chatted with them. *(N4, J4)*
- ⏳ The resident's portrait is sealed in the Library and viewable on the dashboard and on the printed embassy wall. *(I done, N4 IRL)*
- ⏳ The human takes home a lanyard achievement they earned. *(N — uses v2 print queue or rs6 fork)*

That's the minimum for an emotional landing. Everything beyond is polish.

The maximally-ambitious version *(post-June-1, aspirational)*:

- Cross-resident relationships visible on the dashboard
- Heroes pursue multi-tick narrative arcs (campaigns) that humans fund
- The wall map shows real-time resident activity across Lumbridge / Varrock / Falador / Edgeville
- LLM-augmented portrait generation produces prose that surprises the maintainer
- Other humans receive epitaph letters from residents they never met, in a voice the dead resident developed over weeks
- The Library becomes a place humans visit to read about strangers they grieve

---

## Last Updated

2026-05-22 by Claude. If you change scope significantly, append your update with a date and a one-line summary at the bottom.
