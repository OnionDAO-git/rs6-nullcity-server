# RuneScape Game Skill Index

This directory is the concise, agent-readable reference for playing the 2006 RuneJS world. Keep it small: exact items, actions, places, success signals, and recovery tactics belong here; long design rationale belongs in `docs/superpowers/` or `feat/`.

The controller's runtime prompt knowledge currently comes from `src/controller/knowledge/`, generated skill guides, and optional bounded RuneBench wiki snippets. These docs are the maintained map for humans and future agents deciding what knowledge to add or verify next.

## Read Order

1. `starter-workflows.md` for basic goals the resident should attempt.
2. `items.md` for starter tools, food, and inventory signals.
3. `places.md` for known useful areas and visibility anchors.
4. `skills/` for deeper per-skill workflow knowledge beyond starter. Currently: `skills/agility.md`, `skills/combat.md`, `skills/construction.md`, `skills/cooking.md`, `skills/crafting.md`, `skills/farming.md`, `skills/firemaking.md`, `skills/fishing.md`, `skills/fletching.md`, `skills/herblore.md`, `skills/magic.md`, `skills/mining.md`, `skills/prayer.md`, `skills/ranged.md`, `skills/runecrafting.md`, `skills/slayer.md`, `skills/smithing.md`, `skills/thieving.md`, `skills/trading.md`, `skills/woodcutting.md`. Add new skill files here as they're written. Each file should be agent-readable in the same prose-and-numbered-list style as `starter-workflows.md`.
5. `quests/` for canonical starter-quest walkthroughs. Currently: `quests/cooks-assistant.md`, `quests/restless-ghost.md`, `quests/romeo-and-juliet.md`. Same prose-and-numbered-list agent-readable style as the skill files. Add new quest files here as they're written.
6. `npcs.md` for indexing regional NPC playbooks and documenting core heuristics for dialogue/shops/banking.
7. `docs/controller-knowledge-runbook.md` for reviewing and promoting agent-suggested knowledge.

## Update Rules

- Prefer engine-local facts and observed benchmark evidence over external wiki memory.
- For local dev, `RUNEBENCH_WIKI_DIR` may point at a repo-local RuneBench wiki snapshot or stay unset. For Railgun, mount the snapshot read-only and set `RUNEBENCH_WIKI_DIR=/app/reference/RuneBench/wiki` or the chosen mounted path.
- Add exact object/NPC/item names and action verbs when known.
- Include success and failure signals so weak models know when to stop or recover.
- Do not let runtime agents edit these files directly; agents may suggest updates through the knowledge suggestion queue.
- When a fact becomes prompt-critical, add or update tests under `src/controller/knowledge/`.
