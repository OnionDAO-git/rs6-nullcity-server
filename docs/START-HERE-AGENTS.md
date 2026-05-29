# Start Here — For Agents (Claude, Codex, future)

**You are a new agent picking up Null City work in this repo.** Read this file end to end before doing anything else. It will save you (and the maintainer) hours.

---

## What this repo is

A fork of RuneJS (RuneScape 2006 game server, build #435) with a custom SPARK kernel layered on top that runs autonomous AI "residents" inside the game world. Humans interact with residents as patrons/witnesses/sponsors during a June 1, 2026 in-person event in Chicago.

For the full vision: read **`docs/null-city-rs6-vision.md`**. That's the north star.

---

## Canonical Flow

If this file conflicts with `AGENTS.md`, `AGENTS.md` wins. If weekend packet details conflict with this file, the Workstream S implementation plan wins.

Routine autonomous-agent work goes to `agents/wip`, not directly to `nullcity`. `nullcity` receives curated squash/merge commits only after QA/release gates pass.

## The reading order — 15 minutes, all of it

Do not skip. Order matters.

1. **`AGENTS.md`** — the current short operating guide and safe kickoff prompt.
2. **`docs/README.md`** — the docs map; use it to separate current docs from historical snapshots.
3. **`docs/null-city-rs6-vision.md`** — *the why.* The vision, the three core loops, the design invariants you must not break.
4. **`docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`** — *the what.* The canonical workstream board with task status markers `[ ] [>] [~] [!] [x]`.
5. **`docs/agent-coordination.md`** — *the how.* Multi-agent collision avoidance, file lock conventions, branch policy.
6. **`docs/agent-status.md`** — *the now.* Append-only sync log. Read the tail to see what's in flight before touching anything.

After those four, if you're working a specific workstream:

7. **Workstream-specific spec** in `docs/superpowers/specs/` — see the roadmap links.
8. For the May 29-June 1 weekend sprint, read **`docs/2026-05-29-weekend-sprint-plan.md`** and **`docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md`** before touching AP/GP, Soul birth, NCRI, Storyteller, benchmark, or capability QA work.

---

## The current branch and claim workflow

1. `git checkout agents/wip && git pull --ff-only`.
2. Read `docs/agent-status.md` tail and `docs/issue-register.md`.
3. Pick one unclaimed packet from Workstream S (`S0a`-`S12b`) or Capability QA (`CQA0`-`CQA11`).
4. Check the implementation plan's lane table and the status-log STARTING lines for exact file locks.
5. Change the parent roadmap task to `[>]` when appropriate.
6. Append a one-line `STARTING` entry to `docs/agent-status.md` with packet id, lane, and exact file list.
7. Implement with tests and real evidence. Use benchmarks/logs for behavior claims.
8. Run focused verification, `npm run check:no-ui`, and `npm run fin` for code changes unless a human explicitly allows a smaller gate.
9. Commit with explicit paths only; never `git add -A` or `git add .`.
10. Push to `agents/wip`.
11. Update roadmap/capability/issue docs as needed and append a short `HANDOFF`.

Only a QA/release owner performs curated merges to `nullcity`.

---

## What's currently done

- **Workstream A:** SPARK capability facades — DONE.
- **Workstream B:** Standard module extraction — partial.
- **Workstream C:** Benchmark harness — done through `fishing-cooking-10m`.
- **Workstream D:** Dashboard debugging (Dev's repo) — `[D1]` done, `[D2]/[D3]/[D4]` open.
- **Workstream E:** Knowledge & skill — DONE.
- **Workstream F:** Human-like behavior — partial.
- **Workstream G:** Real gameplay workflows — open.
- **Workstream H:** Operations — partial.
- **Workstream I:** Evidence layer + Library of Souls — DONE (I1/I2/I3 + Codex's bonus runtime wiring + post-review fixes).

## What's open

- **Workstream J: Patron / human-attention loop** — spec exists. Highest June-1 leverage. 8 tasks.
- **Workstream K: rs6 factions** — spec exists, creative drafts available for edit. Maintainer-pending lock on names/POIs.
- **Workstream L: Cross-resident lore** — spec exists. 4 plans covering interact-resident verbs, projects, WorldEventBus, in-game perception events.
- **Workstream M: Hero residents** — spec exists. 6 tasks.
- **Workstream N: Embassy / IRL event** — spec exists. 5 tasks.
- **Workstream O: Engineering polish** — no spec needed; 8 independently-scoped tasks.
- **Workstream P: Deeper game-skill knowledge** — spec exists. 6 plans: retrieval improvements, 23-skill expansion, world geography, NPCs+items, quests. Promotes `feat/skill-*.md` files.
- **Workstream Q: Smarter behavior (F+G finish)** — spec exists. 5 plans for non-command small talk, stuck-help-speech, combat personality, trading, broader command loop.
- **Workstream R: SPARK module extraction (B2-B5)** — spec exists. 5 plans carving the 2578-line monolith into 4 composable units + slim orchestrator. Foundation move; unblocks Q's integration points.
- **Workstream S: AP/GP economy, Soul birth, NCRIs, Storyteller** — active weekend sprint. Use `docs/2026-05-29-weekend-sprint-plan.md` for product context and `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md` for task execution.
  - Friday/Saturday autonomous agents should claim packet ids from the implementation plan's **Agent Packet Backlog** (`S0a`-`S12b`) and use its lane table as the file-lock map. Do not grab an entire S task when a smaller packet will do.
  - Capability QA packets (`CQA0`-`CQA11`) are standing work: use `docs/resident-capabilities.md` to pick one weak row, gather real evidence, fix what blocks it, and update `can do it` vs `does do it live`.

---

## Hard rules (don't break these)

These come from the vision doc but I'm restating them here because they're easy to violate by accident:

1. **Humans don't control residents.** They influence — fund, witness, sponsor, talk to. No direct command verbs.
2. **Residents only do things from the typed action catalog.** No free-form code or invented mechanics.
3. **Death has weight.** Even though rs6 permits multi-life accumulation in the Library, every death still triggers an epitaph + Mortician's Ribbon eligibility + tombstone.
4. **Voice is preserved verbatim.** Portraits quote `say` actions character-for-character. Never paraphrase.
5. **Inference before DB writes.** LLM completes; THEN single tx writes. No row locks during LLM round-trips.
6. **Static catalogs in code, not DB.** Factions, achievements, rooms, currencies are TypeScript constants.
7. **Single-process controller.** Don't add multi-process file locking.
8. **No `/Users/...` paths or private-context references in committed docs.** `NullCityNotes.md` is private. Cite as "Null City v1 design notes (private)."
9. **Don't push routine work to `main` or `nullcity`.** There is no `main`; routine work lands on `agents/wip`. Only curated release/QA merges go to `nullcity`.
10. **Don't `git commit --amend` blindly** if you're sharing the working tree with another agent (Codex). Their WIP can be folded into your commit. See `docs/multi_agent_codex_overnight.md` in the maintainer's memory if accessible, or learn it the hard way once.
11. **No human-facing UI in this server repo.** `rs6-nullcity-server` owns runtime, controller, JSON/control APIs, persistence, CLI tools, logs, and benchmarks. All dashboard, attendee, wall, inbox, Library, Graveyard, patron, Storyteller feed, HTML/CSS/Svelte/React/JSX/TSX work belongs in `../rs6-nullcity-residents-dashboard`. Run `npm run check:no-ui` before finishing server work that touches HTTP routes, package scripts, or surface docs.

---

## Multi-agent reality

You are probably not the only agent. Codex and possibly Claude in other sessions are likely working in parallel. Treat this as collaboration, not isolation:

- **Status log is the sync channel.** Read it. Write to it.
- **Roadmap `[>]` markers are the soft file lock.** If a task is `[>]` and not yours, work elsewhere.
- **`git status` showing `M` for files you didn't edit** is another worker's WIP. Do not revert it. Stage only your explicit files, or stop and coordinate if the file is required for your task.
- **Pull frequently.** Codex pushes every 2-3 minutes when in flow.
- **If you find yourself racing Codex on raw implementation velocity, redirect.** Codex is faster at code; your value is structural — plans, specs, reviews, coordination, briefs.

---

## When you get stuck

- **Blocked on a maintainer decision?** Mark the task `[!]` with a one-line description of what you need. Move to another task.
- **Tests inexplicably failing?** Pull origin first. The shared working tree may have Codex's mid-flight changes.
- **Don't understand a spec?** Dispatch a subagent to explain it back to you. If the spec is genuinely unclear, that's a spec bug — flag it in the status log and try to fix the spec itself.
- **Trying to write code and finding yourself guessing about design?** Stop. Use the brainstorming skill (`superpowers:brainstorming`) on the gap, then update the spec, THEN write code.

---

## When you're done with your task

- ✅ Roadmap task marker flipped `[ ]` → `[>]` → `[x]` (or `[!]` if blocked).
- ✅ Verification note appended to the task: tests run, builds clean, lint clean.
- ✅ Commit pushed to `agents/wip`.
- ✅ Status log entry appended showing what landed.
- ✅ If a new spec gap surfaced, the spec is updated or a follow-up task is added.

That's it. Welcome to Null City. Build with care.
