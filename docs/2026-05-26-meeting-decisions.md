# Null City Progress Meeting — Decisions (2026-05-26)

Meeting between James (Null City lead), Dev (OnionDAO founder, project initiator), and Adam (hardware / ESP32). Captures decisions, defaults, action items, and "do not build yet" constraints from the post-demo meeting.

This doc is the single source of truth for what was settled. Anything more nuanced lives elsewhere:

- Existing capability reference: `HUMANS.md` (repo root)
- Demo evidence: `docs/dev-demo-readiness.md` and `CHANGELOG.md` § `[2026-05-26]`
- Model benchmark setup: `docs/model-benchmarking.md` (now on both branches)
- Stale strategy doc (now superseded): `docs/post-demo-team-brief.md`

## Decisions (settled — don't relitigate)

1. **No new UI code until Dev's MDA framework lands** (Thursday 2026-05-29). Aesthetics → Dynamics → Mechanics. Story/faction first; mechanics + UI follow. The framework is the gate.
2. **Anything 3D lives inside the modified RuneScape client.** External map / AI-generated portraits / wall display — rejected. Dev burned days on this at NYE; RuneScape assets are a proprietary format. Spectator-mode auto-hopping page replaces the wall-display use case.
3. **Three UIs, not one.** Operator Dashboard + user-facing Embassy (daily-login shards, workshop shards, favorite agents) + modified RuneScape web client (admin via tilde, travel command, HD mode via `?resizable=true&scale=4`).
4. **Spawning uses queue + voting + shards threshold.** Anyone proposes an agent; collective shards push it onto a top-10; threshold spawns it. Not free-for-all. Shards stay expensive (~2-3 workshops to earn enough). **Week 1 starts with 8 fixed agents** before any spawn-vote happens.
5. **Pre-loaded skill files stay; memory system is required for new facts.** Fog-of-war too risky with current models. NPCs met, quests received, kills — those need a memory layer. Evaluating mem0, qmd, and Adam's third path (MCP that runs a second inference to fetch only the relevant snippet).
6. **Model strategy: cheap local for masses, paid for important roles.** Per-agent model swap already supported. Storyteller / overseer gets the paid model. Bring-your-own-API-keys for users: rejected.
7. **Player and agent both subclass actor; humans can walk and teleport but not actually play.** Most player actions disabled. Travel command exists so humans can teleport to agents.
8. **Chat anti-loop is shipped.** Agent only responds when its name is mentioned, won't repeat itself.
9. **Storyteller / AI overseer is a named feature.** One smart model on a ~20 min cron generates Dungeon-Crawler-Carl-style narration of world state. One call per 20 min is cheap; UX payoff is big.
10. **Goal-as-orientation over authored stories.** Give agents one big unknown goal (e.g. "kill the King Black Dragon") — they don't know where it is or how. Drives emergent behavior cheaply.

## Scope reality

- ~400 signed up
- ~80 expected to show
- ~10-20 actually engaged
- **Hardware caps at ~10-30 concurrent agents**
- Size every design decision to those numbers, not 400.

## Action items by Thursday

### James
- Benchmark Haiku / Sonnet / MiniMax / Qwen / corpus on 1-2 RuneScape workflows → results table.
- Write a capabilities doc — every tested task + reliability level (evidence-based, not aspirational).
- Implement and test the memory system (mem0, qmd, or Adam's MCP-snippet-fetch).
- ~~Add `HUMANS.md` mirror of `AGENTS.md`~~ **DONE** (2026-05-26): renamed from existing `RUNBOOK.md` content; same 356-line Null City human guide.
- Surface model / endpoint / spark module on the dashboard.
- No new UI code until Dev's framework lands.

### Dev
- Define Aesthetics + framework, no code (~6-7 hrs).
- Design the queue/voting spawn system.
- Storyline + faction structure.

### Adam
- Verify sub-GHz module soldering, finish mic/speaker.
- Crack ESP-NOW protocol, prototype the trade portal box.
- QA + user guides + Embassy review.

## Do not build yet

Explicitly off the table until further notice:

- UI code (any surface — operator, embassy, client)
- Dashboard code
- Client code
- Resident behavior code (no new soul rules, no body routine work)
- Spawn mechanics code
- Human-created quests (deferred — needs admin UI we don't have)
- Bring-your-own-API-keys
- External 3D / map / portrait renderers

## Open / unresolved

- **Autonomy showcase vs. participation experience.** It's both, but which one leads keeps flipping. Needs a primary frame.
- **Memory system choice.** mem0 vs qmd vs Adam's MCP-snippet-fetch. James benchmarks before Thursday.
- **Model defaults after benchmark.** Haiku is realistic ceiling for general agents; Sonnet too expensive at scale.
- **Cost ceiling for autonomous Claude+Codex.** Real constraint, not currently bounded.

## Physical hook (Adam)

ESP32 badge ↔ physical "portal box" at the venue. An agent stands at the corresponding in-game location; the box proposes a trade (shards for items); the human accepts on their badge; the trade executes in-game. Adam owns the hardware path; the in-game half needs `J-γ` (chathead) wiring or equivalent.

## Schedule

- **Thursday 7–10 PM (2026-05-29)**: remote jam — finalize MVP + storyline.
- **Friday–Sunday (2026-05-30 to 06-01)**: in-person setup at the venue (monitors, 3D printers).

## Watch-outs

- File-based multi-agent sync only works if every agent pushes "starting X" before touching anything. Otherwise teams stomp.
- Token budget is a real constraint; the overnight Claude+Codex pattern is not free.

## Recurring Dev frame to remember

"I agree with your goals, I disagree with your implementations." Across every disagreement in the meeting, Dev's pushback was implementation-level, not goal-level. Useful posture for future debates: lead with the goal both sides share, then negotiate implementation.
