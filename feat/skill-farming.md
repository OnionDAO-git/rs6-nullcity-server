# Farming Skill - Implementation Spec

Audience: future subagent implementing Farming for RuneScape revision 435 in this repo. Farming has long timers and object-state persistence, so keep v1 narrow and build the data model before broad crop coverage.

## Current Repo State

- Server root: `rs6-nullcity-server`.
- Client root: `rs6-nullcity-client-ts`.
- `Skill.FARMING` and skill name `farming` already exist in `src/engine/world/actor/skills.ts`.
- There is no `src/plugins/skills/farming/` gameplay implementation today.
- Skill-guide data exists at `src/plugins/skills/skill-guides/farming.json`.
- Existing object/item action hooks to reuse:
  - Object interactions: `src/engine/action/pipe/object-interaction.action.ts`.
  - Item-on-object interactions: `src/engine/action/pipe/item-on-object.action.ts`.
  - Item-on-item interactions: `src/engine/action/pipe/item-on-item.action.ts`.
- Player save data persists `savedMetadata` in `src/engine/world/actor/player/player-data.ts`; simple per-player patch state can use this, but global/shared patch state should use a separate data file.
- Landscape object replacement exists through instance APIs used by Mining and other object plugins.
- Item IDs are centralized in `src/engine/world/config/item-ids.ts`; object IDs in `src/engine/world/config/object-ids.ts`; animations in `src/engine/world/config/animation-ids.ts`.
- Client skill availability is already enabled in `rs6-nullcity-client-ts/src/constants/Skill.ts`.

## Revision-435 Scope

Implement a revision-435 Farming v1 focused on allotment patches:

- Patch lifecycle:
  - Inspect patch.
  - Rake weeds.
  - Treat with compost if configured.
  - Plant seed with seed dibber.
  - Water with watering can if configured for v1.
  - Grow through timed stages.
  - Harvest produce and award Farming XP.
  - Clear dead/diseased crops if disease is included.
- Crop subset:
  - Potatoes at level 1.
  - Onions or cabbages as the second crop if item/object data is available.
- Tools:
  - Rake, seed dibber, spade, watering can, compost bucket only as needed for the subset.
- Patch state persistence:
  - State must survive server restart.
  - For v1, per-player patch ownership is acceptable if shared-world patch state is too invasive.

Defer unless needed:

- Trees, fruit trees, herbs, hops, flowers, bushes, special patches, gardeners/protection payments, scarecrows, magic secateurs, amulets of nature, and full disease/cure complexity.
- Real-time growth matching exact historical minutes for every crop. Use a configurable growth tick length so tests can run fast.
- Complex compost yield math beyond a simple disease/yield modifier.

Revision fidelity notes:

- Farming in this revision is patch-object-state heavy. Do not fake it as direct item conversion; the player should interact with patch objects and see state changes.
- If exact 435 varbits/config IDs for patch states are unavailable, use server-side spawned/replaced objects and document the mapping.

## Server Work In `rs6-nullcity-server`

Create:

- `src/plugins/skills/farming/farming.plugin.ts`
  - Registers object and item-on-object hooks for patch actions.
- `src/plugins/skills/farming/farming-config.ts`
  - Patch definitions, crop definitions, tool IDs, object state IDs, XP, yields, growth stages.
- `src/plugins/skills/farming/farming-state.ts`
  - Patch state model and persistence read/write.
- `src/plugins/skills/farming/farming-clock.ts`
  - Converts wall-clock or server ticks into crop growth stages.
  - Must support accelerated test clock.
- `src/plugins/skills/farming/farming-task.ts`
  - Tick-based action execution for raking, planting, watering, harvesting, clearing.
- `src/plugins/skills/farming/farming-patches.ts`
  - Helpers to identify patch objects and resolve current state.
- Tests for state transitions, growth, level gates, inventory requirements, and persistence.

Likely modifications:

- `src/engine/world/config/item-ids.ts` for seed/tool/produce aliases.
- `src/engine/world/config/object-ids.ts` for patch object IDs and patch-state object IDs.
- `src/engine/world/config/animation-ids.ts` for rake/dig/plant/water/harvest animations if known.
- `data/config/scenery-spawns.yaml` if current maps do not expose a convenient allotment patch for testing.
- A small server startup loader/saver only if the Farming state file cannot live inside existing plugin initialization.

Persistence recommendation:

- Use `data/farming/patches.json` or similar for global state only if multiple players should share patches.
- Use `player.savedMetadata.farming.patches` for per-player state in v1 if that avoids global concurrency complexity.
- Whichever route is chosen, write a small typed serializer/deserializer and tests. Do not scatter raw JSON access through handlers.

Implementation details:

- Every item-on-object action should validate:
  - target object is a known patch/state
  - player has required level
  - player has required tool/seed/item
  - inventory has space for harvested produce
- Growth should be computed from persisted `plantedAt` plus crop config, not advanced only while the server is online.
- Object presentation can be lazy: resolve and replace visible patch object when a player interacts or enters the area.
- Harvest should roll yield, add produce, award XP, then update patch state. Avoid duplicate harvest on spam clicks.
- If disease is included, keep it simple: a stage can become diseased by configured chance; watering/compost modifies chance; diseased crops stop progressing until cured or cleared.
- Avoid introducing global timers per patch. Farming should not require thousands of live timers.

## Client Work In `rs6-nullcity-client-ts`

Expected v1 client work is minimal:

- Verify Farming remains enabled in `src/constants/Skill.ts`.
- Verify item-on-object and object option packets work for the patch object options used.
- No custom Farming UI is required for v1; use chat messages and object state changes.

Only edit client if testing proves one of these is broken:

- Item-on-object packet composition in client action code.
- Object option mapping in `src/client/MiniMenuAction.ts`.
- Loc/object config decoding in `src/config/LocType.ts`.
- Skill tab presentation hides or mislabels Farming.

## Data And Config Requirements

- Patch object IDs for weeds, raked/empty, planted stages, watered stages, diseased/dead stages if used.
- Tool item IDs:
  - rake
  - seed dibber
  - spade
  - watering can variants
  - compost bucket, if compost is included
- Crop item IDs:
  - potato seeds and potatoes
  - onion/cabbage seeds and produce if included
- Crop config:
  - required Farming level
  - plant XP
  - harvest XP
  - growth stage durations
  - min/max yield
  - disease chance if included
- Patch locations for at least one testable allotment patch.

Data quality bar:

- Every crop/tool/produce item must resolve through `findItem`.
- Every patch object must resolve through object config or be explicitly spawned.
- Growth timings must be config values, not hard-coded constants inside handlers.
- Test config should allow accelerated growth without changing production config.

## Acceptance Checklist

- A level-1 player can rake a configured patch, plant potato seeds, wait through configured growth, and harvest potatoes for Farming XP.
- Patch state survives logout and server restart.
- Growth progresses based on elapsed time while the server is offline.
- Missing tool, missing seed, low level, or full inventory states produce clear messages and no state corruption.
- Spam clicking cannot duplicate seeds, produce, or XP.
- Object state seen by the player matches the persisted patch state after each action.
- `npm run typecheck` passes in `rs6-nullcity-server`.
- Focused tests cover state machine transitions, persistence, growth clock, inventory checks, and harvest reward.
- Manual smoke: plant and harvest the starter crop through the real client.

## Rough Work Estimate

- Patch state model, persistence, and growth clock: 2-3 days.
- Starter allotment actions and crop config: 2-3 days.
- Object-state presentation and spawn/config cleanup: 1-2 days.
- Tests and smoke fixes: 1-1.5 days.
- Additional crop categories: 1-3 days per category depending on object/data coverage.
