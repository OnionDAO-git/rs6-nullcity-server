# Fishing — Implementation Spec

Audience: a future subagent implementing Fishing for RuneScape revision 435 in this repo. This is a new skill implementation rather than a cleanup pass, so keep the first version deliberately narrow and testable.

## Current Repo State

Relevant server paths:

- No Fishing plugin implementation currently exists under `rs6-nullcity-server/src/plugins/skills/fishing/`.
- `rs6-nullcity-server/src/plugins/skills/skill-guides/fishing.json` exists and lists catch levels and equipment.
- `rs6-nullcity-server/data/config/items/skills/fishing.json` defines fishing tools: small net, big net, fishing rod, fly fishing rod, harpoon, lobster pot, oily fishing rod, and karambwan vessel.
- `rs6-nullcity-server/data/config/items/food.json` defines raw fish items such as `rs:raw_shrimp`, `rs:raw_anchovies`, `rs:raw_trout`, `rs:raw_salmon`, `rs:raw_tuna`, `rs:raw_lobster`, `rs:raw_swordfish`, `rs:raw_monkfish`, and more.
- `rs6-nullcity-server/src/engine/action/pipe/npc-interaction.action.ts` supports NPC option hooks with `walkTo`.
- `rs6-nullcity-server/src/engine/task/impl/actor-actor-interaction-task.ts` and `rs6-nullcity-server/src/engine/action/pipe/task/walk-to-actor-plugin-task.ts` are the relevant patterns for NPC-based repeated interactions.
- `rs6-nullcity-server/src/engine/world/actor/skills.ts` already includes `Skill.FISHING`.
- There are no fishing spot NPC configs or spawns found in the existing `data/config/npcs/` and `data/config/npc-spawns/` search.

Relevant client paths:

- `rs6-nullcity-client-ts/src/client/Client.ts` already sends `OPNPC1..OPNPC5` packets for NPC options.
- `rs6-nullcity-client-ts/src/client/MiniMenuAction.ts` and `rs6-nullcity-client-ts/src/io/ClientProt.ts` define NPC interaction actions/opcodes.
- `rs6-nullcity-server/src/engine/net/inbound-packets/npc-interaction.packet.ts` currently decodes only three NPC options: opcodes 63, 57, and 116.
- The client can display NPC menu options from cache `NpcType`; Fishing should not require custom UI.

Known gaps and risks:

- Fishing spot NPC data and spawns need to be added or discovered from cache and wrapped by server config.
- The inbound NPC packet handler currently supports only three NPC options. Revision-435 fishing spots often need multiple options such as `Net`, `Bait`, `Lure`, `Harpoon`, and `Cage`; verify whether the needed options fall within the implemented three before adding more.
- There is no shared fishing data model yet.
- There are no focused Fishing tests.

## Revision-435 Scope

Implement a practical revision-435 Fishing v1 using local cache/config as the authority.

In scope for v1:

- NPC fishing spot interactions through options such as `Net`, `Bait`, `Lure`, `Harpoon`, and `Cage`, depending on cache option text.
- Fishing tool requirements:
  - Small net for shrimp/anchovies.
  - Fishing rod plus bait for sardine/herring/pike, where configured.
  - Fly fishing rod plus feathers for trout/salmon.
  - Harpoon for tuna/swordfish.
  - Lobster pot for lobster.
  - Big net can be included only if a suitable revision-435 spot and drop table are configured.
- Level checks per catch.
- Consumable bait/feather removal only on successful catches unless revision-435 verification proves otherwise.
- Inventory-full handling before and during repeated fishing.
- Repeated fishing attempts until catch success, inventory full, player interruption, spot invalidation, or missing requirements.
- Correct fishing animation, catch message, XP award, and item reward.
- At least one accessible low-level fishing area with spawned spots for acceptance testing.

Out of scope for v1:

- Fishing Trawler, Barbarian Fishing, aerial/drift-net style systems, minnows, sacred eels, and any post-435 activity.
- Complex moving fishing spots unless simple spot replacement/movement is already supported by existing NPC APIs.
- Cooking integration beyond raw fish item rewards.

## Server Work In `rs6-nullcity-server`

1. Create a focused Fishing plugin directory:
   - `src/plugins/skills/fishing/fishing.plugin.ts`
   - `src/plugins/skills/fishing/fishing-task.ts`
   - `src/plugins/skills/fishing/fishing-data.ts`
   - `src/plugins/skills/fishing/fishing-types.ts`
   - `src/plugins/skills/fishing/chance.ts`

2. Model fishing data:
   - Define a `FishingSpot` keyed by NPC key or game id plus option text.
   - Define `FishingMethod` with required tool, optional consumable, animation, level, catches, and base chance.
   - Define catch tables that can return a single fish or weighted fish choices, e.g. shrimp/anchovies, trout/salmon, tuna/swordfish.
   - Use item config keys, not raw game ids, where possible, and resolve through `findItem()`.

3. Add NPC interaction hooks:
   - Register `npc_interaction` hooks for fishing spot NPCs and method option text.
   - Use `walkTo: true` so existing actor-walk-to behavior is used.
   - The handler should validate requirements quickly, then enqueue `FishingTask`.

4. Implement `FishingTask`:
   - Extend the appropriate actor/NPC interaction task, following local task patterns.
   - On each cycle, validate the spot, level, tool, consumable, and inventory.
   - Play the method animation at a stable interval.
   - Roll catch success using a documented formula similar to other harvest skills unless a better 435 formula is verified.
   - On success, remove one consumable if required, add the fish, award Fishing XP, and continue until stopped.
   - Stop cleanly on movement, inventory full, missing tool/consumable, missing level, or invalid NPC.

5. Add or configure fishing spot NPCs:
   - Add NPC config entries under `data/config/npcs/` only for needed fishing spots if cache-backed lookup alone is not enough.
   - Add spawns under `data/config/npc-spawns/` for at least one low-level test location.
   - Prefer existing 435 NPC ids and option text from cache. Do not invent custom ids.

6. Extend NPC packet support only if required:
   - Check whether needed fishing options are option indexes 1 through 3, already supported by `npc-interaction.packet.ts`.
   - If option 4 or 5 is needed, add the missing revision-435 opcode decoding in `npc-interaction.packet.ts` and align it with `ClientProt.OPNPC4/OPNPC5`.
   - Add packet tests if a packet handler changes.

7. Add tests:
   - Unit-test fishing chance and weighted catch selection.
   - Add task tests for missing tool, missing bait/feathers, insufficient level, full inventory, successful catch, XP award, consumable removal, and repeated catch behavior.
   - Add hook tests for option text matching if multiple methods share one spot.

## Client Work In `rs6-nullcity-client-ts`

Expected client work is minimal unless the server cannot decode the needed NPC option.

- Verify fishing spot menu options are displayed from cache `NpcType` data.
- Verify option selection sends the expected `ClientProt.OPNPC*` opcode.
- If server support for option 4/5 is added, confirm `Client.ts` packet encoding already matches the new server decoder.
- Do not add a Fishing UI; the existing menu and inventory behavior should be sufficient.

## Data / Config Requirements

Required data must be available and verified:

- Fishing tool configs in `rs6-nullcity-server/data/config/items/skills/fishing.json`.
- Raw fish configs in `rs6-nullcity-server/data/config/items/food.json`.
- Consumable configs for bait and feathers. `rs6-nullcity-server/src/engine/world/config/item-ids.ts` already includes `feather`; add explicit fishing bait constants only if useful.
- Fishing spot NPC ids, names, and option text from the revision-435 cache.
- Fishing spot spawns in `rs6-nullcity-server/data/config/npc-spawns/`.
- Fishing animations in `rs6-nullcity-server/src/engine/world/config/animation-ids.ts` or a new method-local config if no shared constants exist yet.
- Optional fishing sounds in `rs6-nullcity-server/src/engine/world/config/sound-ids.ts` only if verified.
- Skill guide consistency in `rs6-nullcity-server/src/plugins/skills/skill-guides/fishing.json`.

Suggested v1 methods and catches:

| Method | Tool | Consumable | Catches |
| --- | --- | --- | --- |
| Net | `rs:small_fishing_net` | none | `rs:raw_shrimp`, `rs:raw_anchovies` |
| Bait | `rs:fishing_rod` | fishing bait | `rs:raw_sardine`, `rs:raw_herring`, `rs:raw_pike` |
| Lure | `rs:fly_fishing_rod` | `rs:feather` | `rs:raw_trout`, `rs:raw_salmon` |
| Harpoon | `rs:harpoon` | none | `rs:raw_tuna`, `rs:raw_swordfish` |
| Cage | `rs:lobster_pot` | none | `rs:raw_lobster` |

Use the exact item config keys that exist locally; for example the repo uses `rs:raw_shrimp`, not `rs:raw_shrimps`.

## Acceptance Checklist

- [ ] A level-1 player with a small fishing net can catch raw shrimp at a configured fishing spot.
- [ ] Catching awards the configured raw fish item and Fishing XP once per success.
- [ ] Shrimp/anchovy, trout/salmon, tuna/swordfish mixed catch tables respect level gates.
- [ ] Missing tool gives a clear message and starts no task.
- [ ] Missing bait or feathers gives a clear message and starts no task.
- [ ] Consumables are removed only when a catch succeeds.
- [ ] Inventory-full handling stops the task with a clear message.
- [ ] Player movement or another action cancels Fishing via the task system.
- [ ] At least one low-level fishing spot is available from server data after config load.
- [ ] NPC interaction packet support covers every fishing option used by v1.
- [ ] `npm run typecheck` passes in `rs6-nullcity-server`.
- [ ] Focused Jest tests for Fishing pass.
- [ ] `bun run build` passes in `rs6-nullcity-client-ts` if client files are touched.

## Rough Work Estimate

- New server data model, plugin, and task: 2 days.
- NPC config/spawns and packet option verification: 0.5 to 1 day.
- Tests for methods, consumables, and repeated task behavior: 1 to 1.5 days.
- Client verification: 0.25 day if no changes are needed, 0.5 day if option packet support needs alignment.

Total: 4 to 5 days.
