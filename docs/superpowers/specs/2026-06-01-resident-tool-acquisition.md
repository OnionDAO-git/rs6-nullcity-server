# Resident Tool Acquisition — residents bootstrap their own prerequisites

Author: claude, 2026-06-01. Status: **engine capability shipped (`1455fcba`); body routine = next slice.**

## The bug
A resident assigned a skill goal it lacks the tool for (woodcutter with no axe, fisher
with no net) **stalls forever**: `levelOneWoodcuttingAction` (`runescape-body-routines.ts:689`)
returns `undefined` when `!hasWoodcuttingAxe`, `firemakingAction` no-ops without tinderbox+log.
The only "missing tool" handling is a verbal excuse (`hybrid-agent-chat.ts:419-430`) that never
acquires anything. There was **no buy/shop action** in the resident vocabulary — residents hold
coins but could not spend them. Meanwhile Bob's axe shop (`rs:lumbridge_bobs_axes`, ~3230,3203)
is spawned, stocked (10× bronze axe `1351`), reachable, and opens on `interact(bob,'trade')`.

## Shipped (slices 1–3, tested, typecheck clean)
- `buy_from_shop {itemId, quantity, cause?}` verb in BOTH codec layers
  (`engine/.../agent-action.ts` AgentActionSchema + `controller/transport/message-codecs.ts`).
- `ActionAdapter.buyFromShop()` (`engine/.../action-adapter.ts`): purchases from the open shop
  (`metadata.lastOpenedShopKey`), deducts coins, decrements stock; guards `no_shop_open`,
  `insufficient_coins`, `out_of_stock`, `item_not_in_shop`, `inventory_full`.
- Contract: resident `interact(shopkeeper,'trade')` (opens shop, sets `lastOpenedShopKey`),
  then `buy_from_shop` on a later tick.

## Remaining (slice 4 — the autonomous driver; needs a game restart to live-verify)

### 4a. `acquireToolAction(perception)` body routine (`runescape-body-routines.ts`)
A prerequisite-acquisition routine, gated + state-machined per tick:
- **Gate**: active goal needs a tool the resident lacks (no axe for woodcutting/firemaking;
  no net for fishing) AND resident has ≥ tool cost in coins (995).
- **Tool→source table**: `{ axe(1351) → Bob @ (3230,3203, key rs:lumbridge_bobs_axes);
  net(303)/tinderbox(590) → Lumbridge general store }`.
- **State machine** (store progress in `cognition` like other multi-tick routines):
  1. Not near the shopkeeper → `move_to` the shop NPC's known coords (hardcoded; the NPC is
     out of perception range from the woodcutting area, so navigate by known location).
  2. Near shopkeeper, shop not open → `interact(npcRef, 'trade')`.
  3. Shop open (detect via `dialogue_opened`/shop perception or a 1-tick wait) → `buy_from_shop {itemId, quantity:1}`.
  4. Tool now in inventory → clear acquire-state, fall through to the normal skill routine.
- **Affordability/again guards**: if broke → report blocked + switch goal (don't loop); cooldown
  on repeated failed acquire attempts.

### 4b. Wire into the no-tool branches
Replace the silent `return undefined` at `levelOneWoodcuttingAction:689` (and the
`make_fire`/`chop_tree` dispatch in `resident-runtime.ts:1568,1590`, and the fishing no-net path)
with `return acquireToolAction(perception)` when the tool is missing but affordable. Replace the
dead-end `say` refusal (`hybrid-agent-chat.ts:419-430,632-636`) to enqueue the acquire subgoal.

### 4c. Knowledge
Add/confirm a knowledge entry telling residents Bob sells axes at (3230,3203) and the general
store sells nets/tinderboxes, so the brain's plan + the body's navigation agree. (`shops-starter-tools`
entry exists at `knowledge-retriever.ts:262` but promised a capability that didn't exist — now it does.)

### Tests (4a is unit-testable without the live engine)
- `acquireToolAction`: given perception {no axe, has coins, far from Bob} → returns `move_to` Bob;
  {near Bob, shop closed} → `interact trade`; {shop open} → `buy_from_shop 1351`; {has axe} →
  null (defers to skill routine); {broke} → blocked/switch.
- Live smoke (post game-restart): a woodcutter spawned with coins but no axe walks to Bob, buys an
  axe, and starts chopping (meaningful progress climbs from ~0%).

## Why this matters
This is the capability that makes residents genuinely autonomous — set a goal → figure out the
prerequisite → go obtain it — rather than scripted agents that stall the moment the world doesn't
hand them exactly the right starting inventory. It also removes the need to hand-provision every
resident's tools via soul `initialInventory` (the current band-aid).
