# Firemaking — Implementation Spec

Audience: a future subagent implementing or finishing Firemaking for RuneScape revision 435 in this repo. Keep changes scoped to Firemaking unless a small shared item/task helper is clearly needed.

## Current Repo State

Relevant server paths:

- `rs6-nullcity-server/src/plugins/skills/firemaking/index.ts` registers `rs:firemaking` for tinderbox-on-log item interactions and tinderbox-on-world-log interactions.
- `rs6-nullcity-server/src/plugins/skills/firemaking/firemaking-task.ts` implements a world-item log lighting task using `ActorWorldItemInteractionTask`.
- `rs6-nullcity-server/src/plugins/skills/firemaking/light-fire.ts` handles tile validation, despawning the log, spawning the fire object, awarding XP, moving the player aside, spawning ashes after the fire expires, and tracking `player.metadata.lastFire`.
- `rs6-nullcity-server/src/plugins/skills/firemaking/data.ts` defines burnable logs from `findItem()`.
- `rs6-nullcity-server/src/plugins/skills/firemaking/chance.ts` contains current `canLight()` and `canChain()` formulas.
- `rs6-nullcity-server/src/plugins/skills/firemaking/types.ts` defines `Burnable`.
- `rs6-nullcity-server/src/engine/world/config/item-ids.ts` includes `tinderbox` and `ashes`.
- `rs6-nullcity-server/src/engine/world/config/object-ids.ts` includes `fire`.
- `rs6-nullcity-server/src/plugins/skills/skill-guides/firemaking.json` already exists.
- `rs6-nullcity-server/data/config/items/skills/firemaking.json` and `rs6-nullcity-server/data/config/items/logs.json` are the primary item config inputs.

Relevant client paths:

- `rs6-nullcity-client-ts/src/client/Client.ts` already sends inventory item-on-item and use-item-on-ground-item packets.
- `rs6-nullcity-client-ts/src/client/MiniMenuAction.ts` and `rs6-nullcity-client-ts/src/io/ClientProt.ts` define `USEHELD_ONHELD`, `USEHELD_ONOBJ`, and held-item operations.
- `rs6-nullcity-server/src/engine/net/inbound-packets/item-on-item.packet.ts` decodes tinderbox-on-log inventory interactions.
- `rs6-nullcity-server/src/engine/net/inbound-packets/item-on-world-item.packet.ts` decodes tinderbox-on-world-log interactions.

Known gaps and risks in the current Firemaking code:

- `canChain()` has a TODO saying the behavior is undocumented. Treat it as suspect until verified against revision 435 expectations.
- `FiremakingTask` sets `actor.busy = true` only after `canLightFire` succeeds. Confirm interactions during the attempt cannot duplicate or corrupt state.
- `lightFire()` moves the player aside by trying west, east, south, north. Verify this matches desired 435 behavior well enough and handles blocked movement gracefully.
- Fire placement currently checks spawned type-10 objects only. Confirm this prevents lighting on existing fires and other blocking locs in this engine.
- There are no focused Firemaking tests in the repo.

## Revision-435 Scope

Implement classic revision-435 Firemaking behavior using server authority.

In scope:

- Use tinderbox on supported logs in the inventory.
- Use tinderbox on a supported dropped log owned/visible to the player.
- Level checks per log type.
- Inventory removal of one log when starting from inventory.
- Spawn a temporary world log when lighting from inventory, then convert it to a fire on success.
- Repeated lighting attempts until success, player interruption, item invalidation, or blocked tile failure.
- Correct messages, lighting animation, lighting sounds, fire-lit sound, XP award, temporary fire object, ashes after burn-out, and player movement away from the fire.
- Supported logs currently listed in `FIREMAKING_LOGS`: normal, oak, willow, teak, maple, mahogany, yew, and magic logs.

Out of scope for this skill pass:

- Barbarian Firemaking, pyre logs, quest-only firemaking, colored fires, or post-435 systems.
- Client-side fire prediction or custom UI.
- Broad collision-map rewrites. Only add a small tile eligibility helper if Firemaking cannot be made correct with existing instance APIs.

## Server Work In `rs6-nullcity-server`

1. Preserve plugin behavior:
   - Keep `pluginId: 'rs:firemaking'`.
   - Keep item-on-item and item-on-world-item hooks.
   - Ensure both item orderings work for tinderbox/log inventory use.

2. Harden item and task handling:
   - Validate the log item still exists when the task reaches it.
   - Ensure one log is removed exactly once for inventory lighting.
   - Ensure the world-item log is despawned exactly once on success.
   - Stop the task cleanly on movement, invalid world item, blocked fire tile, or missing level.
   - Clear animation and `busy` state on all stop/failure paths.

3. Review chance and timing:
   - Verify `canLight()` produces plausible revision-435 behavior for low and high levels.
   - Either remove `canChain()` or explicitly support fast-light behavior with tests and comments. Do not leave undocumented behavior as an accidental feature.
   - Keep the attempt loop tick-based; do not use timers outside the engine task system.

4. Validate fire placement:
   - Keep `canLightFireAtCurrentPosition()` or move it to a better shared location if needed.
   - Confirm it rejects existing fires and other spawned type-10 objects on the player's tile.
   - Confirm it handles permanent map blocking well enough for a fire object.
   - Make movement away from the fire deterministic and safe when adjacent tiles are blocked.

5. Add tests:
   - Unit-test `canLight()` boundaries where deterministic mocking is feasible.
   - Add task/plugin tests for tinderbox-on-log, reversed item order, insufficient level, blocked tile, successful fire spawn, XP award, ashes spawn after expiry, and movement cancellation.

## Client Work In `rs6-nullcity-client-ts`

Expected client work is minimal.

- Verify using a tinderbox on a log sends the packet shape expected by `item-on-item.packet.ts`.
- Verify using a tinderbox on a ground log sends the packet shape expected by `item-on-world-item.packet.ts`.
- Confirm the client does not need custom Firemaking UI or local state.
- Only touch client code if revision-435 packet encoding for item use is demonstrably mismatched.

## Data / Config Requirements

Required data must be available and verified:

- Tinderbox item id in `rs6-nullcity-server/src/engine/world/config/item-ids.ts`.
- Ashes item id in `rs6-nullcity-server/src/engine/world/config/item-ids.ts`.
- Fire object id in `rs6-nullcity-server/src/engine/world/config/object-ids.ts`.
- Burnable logs in `rs6-nullcity-server/src/plugins/skills/firemaking/data.ts`.
- Log item configs in `rs6-nullcity-server/data/config/items/logs.json`.
- Firemaking item config in `rs6-nullcity-server/data/config/items/skills/firemaking.json`.
- Lighting/fire sounds in `rs6-nullcity-server/src/engine/world/config/sound-ids.ts`.
- Lighting animation in `rs6-nullcity-server/src/engine/world/config/animation-ids.ts`.
- Skill guide consistency in `rs6-nullcity-server/src/plugins/skills/skill-guides/firemaking.json`.

If a configured burnable log cannot be found at startup, fail loudly in tests or during configuration validation rather than letting a player hit a vague runtime error.

## Acceptance Checklist

- [ ] Using tinderbox on normal logs at level 1 starts an attempt and can produce a fire.
- [ ] Using tinderbox/log in either inventory order works.
- [ ] Using tinderbox on a supported world log works when the player can reach it.
- [ ] Insufficient Firemaking level gives a clear message and does not remove the log.
- [ ] A blocked tile gives `You cannot light a fire here.` and does not corrupt inventory/world items.
- [ ] On success, one log is consumed, one fire object appears, XP is awarded once, and ashes spawn when the fire expires.
- [ ] The player is moved off the fire tile when possible.
- [ ] Movement or another action cancels the lighting attempt cleanly.
- [ ] No undocumented chain-light behavior remains without tests.
- [ ] `npm run typecheck` passes in `rs6-nullcity-server`.
- [ ] Focused Jest tests for Firemaking pass.
- [ ] `bun run build` passes in `rs6-nullcity-client-ts` if client files are touched.

## Rough Work Estimate

- Harden current server behavior and clean chance/timing: 1 to 1.5 days.
- Add fire placement/item lifecycle tests: 1 day.
- Client verification: 0.25 day if no changes are needed, 0.5 day if packet mapping needs adjustment.

Total: 2.25 to 3 days.
