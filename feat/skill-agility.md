# Agility Skill - Implementation Spec

Audience: future subagent implementing Agility for RuneScape revision 435 in this repo. Keep the implementation additive and do not rewrite unrelated movement, task, or client systems.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- Skills already include Agility in `rs6-nullcity-server/src/engine/world/actor/skills.ts` as `Skill.AGILITY` and skill name `agility`.
- The server already has the action/task shape this feature should reuse:
  - Object interactions: `src/engine/action/pipe/object-interaction.action.ts`.
  - Item-on-object interactions: `src/engine/action/pipe/item-on-object.action.ts`.
  - Walk-to-object task wrapper: `src/engine/action/pipe/task/walk-to-object-plugin-task.ts`.
  - Base object task: `src/engine/task/impl/actor-landscape-object-interaction-task.ts`.
  - Existing skill plugin examples: `src/plugins/skills/mining/`, `src/plugins/skills/woodcutting/`, `src/plugins/skills/firemaking/`.
- Object IDs are centralized in `src/engine/world/config/object-ids.ts`; animation and gfx IDs are in `src/engine/world/config/animation-ids.ts` and `src/engine/world/config/gfx-ids.ts`.
- Skill-guide data for Agility already exists at `src/plugins/skills/skill-guides/agility.json`; do not treat that as functional gameplay.
- Some shortcut IDs already exist under `objectIds.shortCuts`, but there is no Agility plugin directory or obstacle runtime today.
- Player persistence already saves skills through `src/engine/world/actor/player/player-data.ts`; no new save shape is needed for simple obstacle completion.
- Client skill availability is already revision-435-like in `rs6-nullcity-client-ts/src/constants/Skill.ts`; Agility is enabled in the used-skill array.

## Revision-435 Scope

Target a practical revision-435 subset, not OSRS rooftop Agility.

Implement:

- Core obstacle interaction model: level requirement, route movement, animation, optional delay, XP reward, optional fail roll, optional damage/teleport-back.
- At least one complete low-level course for smoke testing, preferably Gnome Stronghold if map/object coverage allows it.
- A small set of world shortcuts already available or easy to spawn in current maps, including:
  - Falador/Al Kharid fence or stile-style shortcuts if object IDs exist.
  - Pipe/log/stepping-stone style shortcuts only where the cache has correct landscape objects.
- Course lap completion for configured courses, with the lap bonus awarded only after the configured obstacle sequence is completed in order.

Defer unless the map/data is already present:

- Full Wilderness, Ape Atoll, Werewolf, Agility Pyramid, and Barbarian courses.
- Weight/run-energy integration if no server-side run energy exists yet.
- Marks of grace, rooftop courses, graceful outfit, or post-435 content.

Revision fidelity notes:

- Use 2006-era course/shortcut behavior as the baseline: object option text, obstacle level gates, simple fail rolls, short movement locks, and XP per obstacle/lap.
- Prefer authentic object IDs from the 435 cache over guessed IDs. If a location needs custom objects for testing, put them in config and mark them as development spawns.

## Server Work In `rs6-nullcity-server`

Create:

- `src/plugins/skills/agility/agility.plugin.ts`
  - Registers `object_interaction` hooks for all configured obstacles.
  - Uses `walkTo: true` for obstacles that need normal pathing first.
- `src/plugins/skills/agility/agility-task.ts`
  - Extends `ActorLandscapeObjectInteractionTask<Player>`.
  - Locks competing object interactions while the obstacle is executing.
  - Faces the obstacle, plays configured animation(s), moves the player along configured tiles, awards XP, then unlocks.
- `src/plugins/skills/agility/agility-config.ts`
  - Defines obstacle/course data in TypeScript until YAML loading is justified.
  - Shape should include `objectIds`, `option`, `level`, `xp`, `courseId`, `sequence`, `start`, `end`, `animation`, `ticks`, `fail`.
- `src/plugins/skills/agility/agility-state.ts`
  - Minimal per-player in-memory course progress, stored in `player.metadata`.
  - Avoid save migration unless lap progress must persist, which v1 should not require.
- Focused tests under `src/plugins/skills/agility/` or nearby test utilities if existing test setup supports plugin/task tests.

Modify only as needed:

- `src/engine/world/config/object-ids.ts` for named Agility obstacle IDs.
- `src/engine/world/config/animation-ids.ts` for named Agility animations.
- `src/engine/world/config/gfx-ids.ts` only if an obstacle really has a gfx.
- `src/plugins/skills/skill-guides/agility.json` only to correct demonstrably wrong revision-435 entries discovered while implementing.

Implementation details:

- Reuse `player.enqueueTask(...)`; do not run timers with `setTimeout` or `setInterval`.
- Use tick counts inside the task for delay and multi-step motion.
- Validate level before starting the task and again when executing after walk-to.
- If a player moves, starts another action, logs out, or the object disappears, stop cleanly without awarding XP.
- Use `player.skills.addExp(Skill.AGILITY, xp)` for obstacle and lap rewards.
- Use `player.sendMessage(...)` for level/failure feedback and `player.playAnimation(...)`/`player.face(...)` for presentation.
- Do not add broad pathfinding changes for one shortcut. If an obstacle needs to move through blocked tiles, encode the route in the task.

## Client Work In `rs6-nullcity-client-ts`

Expected v1 client work is minimal:

- Verify Agility remains enabled in `src/constants/Skill.ts`.
- Verify the existing cache/object options render and click through the normal object interaction packets.
- No custom UI is required for v1; skill-guide UI is already server-driven.

Only edit client if testing proves one of these is broken:

- Object option mapping in `src/client/MiniMenuAction.ts` or packet dispatch prevents clicking a revision-435 Agility option.
- The skill tab incorrectly hides Agility despite server support.
- The client has a cache/type decoding issue for obstacle locs in `src/config/LocType.ts`.

## Data And Config Requirements

- Object IDs and option names for each obstacle, preferably from the 435 cache.
- Animation IDs for crawl, climb, squeeze-through, balance, jump, and rope swing actions.
- Optional sound IDs if known; otherwise omit sound rather than guessing.
- Course definitions:
  - `courseId`
  - ordered obstacle keys
  - lap bonus XP
  - reset behavior when obstacles are taken out of order
- Optional custom scenery spawns in `data/config/scenery-spawns.yaml` for test-only obstacles not present in the current map.

Data quality bar:

- Every configured object ID must be resolvable by `findObject`/filestore at runtime or explicitly documented as a spawned custom object.
- Every configured item/guide icon key must already resolve via item config if touched.
- Do not hard-code coordinates inside the plugin handler when the same obstacle can be expressed in the obstacle config.

## Acceptance Checklist

- A level-1 player can complete the chosen starter course obstacles and receive Agility XP.
- Completing the configured course in order awards exactly one lap bonus.
- Taking obstacles out of order does not award a lap bonus.
- A player below an obstacle requirement receives a clear message and does not move through the obstacle.
- Failure-capable obstacles can fail, apply configured damage or displacement, and do not award success XP.
- Inventory, combat, logout, and unrelated skills are not affected.
- Object interactions still go through the existing action pipeline and walk-to task.
- `npm run typecheck` passes in `rs6-nullcity-server`.
- Focused tests cover level gating, XP award, course sequence reset, and failure behavior.
- Manual smoke: start server, click one configured obstacle from the real client, observe movement/animation/XP.

## Rough Work Estimate

- Core config, task, and plugin: 1.5-2.5 days.
- One complete starter course with authentic IDs/animations: 1-2 days depending on cache/map coverage.
- Tests and smoke fixes: 0.5-1 day.
- Additional courses/shortcuts: 0.5-2 days each depending on object/data availability.
