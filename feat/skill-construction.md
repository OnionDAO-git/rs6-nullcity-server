# Construction Skill — Implementation Spec

Audience: future subagent implementing Construction for RuneScape revision 435. Keep this document current as work lands.

## Current Repo State

- Server repo: `rs6-nullcity-server`.
- Client repo: `rs6-nullcity-client-ts`.
- Skill registry includes `Skill.CONSTRUCTION = 22` and the `construction` shortcut in `rs6-nullcity-server/src/engine/world/actor/skills.ts`.
- `skillDetails` has a placeholder null at index `21` and Construction at index `22` without an advancement widget id.
- Client `rs6-nullcity-client-ts/src/constants/Skill.ts` has skill index `22` enabled and index `21` disabled, matching the server gap.
- Existing Construction files:
  - `src/plugins/skills/construction/con-constants.ts` defines room types, template positions, room-builder button ids, and two hardcoded POH instance regions.
  - `src/plugins/skills/construction/house.ts` opens a house, loads/synthesizes custom map chunks, teleports to an instance, and preloads template chunks.
  - `src/plugins/skills/construction/home-saver.ts` saves/loads `data/houses/<player>.json5`.
  - `src/plugins/skills/construction/room-builder.ts` supports door hotspot room creation and rotation through widget `402`.
  - `src/plugins/skills/construction/index.ts` wires commands `con`, `poh`, `house`, `savepoh`, `savehouse`, room-builder widget buttons, door hotspots, and player-init reopen handling.
- `OutboundPacketHandler.constructMapRegion()` already serializes constructed map chunks for custom maps.
- `World` already checks `player.metadata.customMap` when resolving chunks/objects.
- No real estate agent, house portal, build mode, furniture hotspots, material costs, XP, object persistence, or visitor support is implemented.

## Revision-435 Scope

Implement a pragmatic revision 435 Player-Owned House foundation that works with the existing constructed-region engine.

In scope:
- Entering/leaving an owned house through a portal or temporary command while development continues.
- A per-player house save file with room layout and built hotspots/furniture.
- Build mode flag for owner, with room creation from door hotspots.
- Room requirements, coin costs, level requirements, and Construction XP for room creation.
- Basic furniture hotspot building for a small first set:
  - garden exit portal;
  - parlor chairs/bookcase/fireplace;
  - kitchen table/larder/sink or equivalent low-level objects;
  - workshop workbench if object ids are confirmed.
- Object spawn/render support inside constructed map chunks.
- Safe leaving behavior that returns players to the portal/overworld and saves owner progress.

Out of scope for first pass:
- Full POH content catalogue.
- Servants, parties, challenge mode, dungeon combat rooms, menagerie/costume storage depth.
- Multi-owner concurrency beyond one live instance per owner.
- Complex house permissions and guest routing unless the engine already has a clean hook for it.

## Server Work (`rs6-nullcity-server`)

Build incrementally on the current Construction scaffold.

Required work:
- Replace command-only entry with portal object interaction once portal object ids and locations are confirmed. Keep commands as admin/dev shortcuts.
- Add house lifecycle:
  - owner id/name;
  - build mode on/off;
  - instance allocation instead of only two hardcoded regions, or guarded reuse with clear error messaging;
  - enter, leave, save, unload.
- Extend save schema in `data/houses/*.json5`:
  - version;
  - room grid with type/orientation;
  - built objects keyed by room/local hotspot;
  - optional settings such as build mode/default teleport.
- Add migration-tolerant load logic. Existing simple room-only saves should still load.
- Add room metadata:
  - level requirement;
  - coin cost;
  - XP;
  - allowed floor/placement;
  - display name.
- Update `roomBuilderWidgetHandler` to charge coins, check level, add XP, and save/refresh reliably.
- Add furniture hotspot definitions and handlers:
  - detect hotspot object ids in constructed chunks;
  - open build options;
  - check materials/tools/level;
  - replace hotspot with built object in save state;
  - support remove/replace in build mode.
- Ensure custom-map object lookup in `World` can see built furniture, not just room template objects.
- Add tests for house save/load, room placement bounds, room costs/XP, build mode gating, furniture building/removal, and instance reuse.

## Client Work (`rs6-nullcity-client-ts`)

Expected work is mostly verification.

- Verify constructed map rebuilds from server packet `REBUILD_REGION` render correctly in the TypeScript client.
- Verify widget `402` and any build-option widgets are available and clickable through generic widget packets.
- If built furniture does not render because custom map object changes are not reflected, inspect `rs6-nullcity-client-ts/src/client/Client.ts` handling of `REBUILD_REGION`, `LOC_ADD_CHANGE`, and related zone packets.
- Do not put Construction rules in the client.

## Data / Config Requirements

- Confirm revision 435 object ids for:
  - house portal and exit portal;
  - room door hotspots;
  - room template chunks already listed in `con-constants.ts`;
  - furniture hotspots and built furniture objects.
- Add a typed Construction data file, likely `src/plugins/skills/construction/construction-data.ts`, for rooms, furniture, materials, costs, and XP.
- Add item ids/configs for planks, nails, cloth, limestone, marble, gold leaf, saw, hammer, and other first-pass materials if missing.
- Keep `data/houses/` as generated runtime data; do not commit player house saves unless they are fixtures.
- Add test fixtures under `src/plugins/skills/construction/` or a test fixture directory rather than using live `data/houses`.

## Acceptance Checklist

- [ ] New players can enter a default house and see the garden room.
- [ ] Existing room-only house saves still load after schema changes.
- [ ] Room building requires build mode, correct location, level, and coins.
- [ ] Successful room building adds XP, updates the constructed map, and persists.
- [ ] At least one furniture hotspot can be built, rendered, removed, and persisted.
- [ ] Leaving the house returns the player to a valid overworld position and saves owner progress.
- [ ] Player init inside a POH recovers safely or returns to overworld if the instance cannot be rebuilt.
- [ ] Tests cover save/load, room building, furniture building, and failure cases.
- [ ] `npm run typecheck` and targeted Jest tests pass in `rs6-nullcity-server`.
- [ ] Manual smoke test in `rs6-nullcity-client-ts` shows constructed map rebuild and clickable build UI.

## Rough Work Estimate

5-8 days for a stable first-pass Construction foundation with room costs, persistence, build mode, and a small furniture set. Full revision-435 POH content is substantially larger and should be broken into follow-up specs.
