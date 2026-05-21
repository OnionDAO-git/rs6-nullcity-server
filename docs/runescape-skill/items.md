# Starter Items

## Firemaking

- `rs:tinderbox`: required to light logs. Use it on logs with `use_item_on_item`.
- `rs:logs`: level 1 firemaking fuel. Normal logs usually come from ordinary trees or dead trees.
- Success signals: logs leave inventory, a fire object appears nearby, or chat/game messages say the fire catches.
- Recovery: if the resident has a tinderbox but no logs, switch to woodcutting or ask a nearby player for logs.

## Woodcutting

- Axe or hatchet: required to chop trees. It may be in inventory or equipment.
- Normal trees and dead trees: starter targets that can produce `rs:logs`.
- Success signals: inventory gains logs, woodcutting XP changes, or the tree depletion message appears.
- Recovery: if a target is unreachable, choose another visible tree instead of tiny-step looping at a fence.

## Fishing And Cooking

- `rs:small_fishing_net`: starter tool for shrimp at net-capable fishing spots.
- Raw shrimp: starter catch; can become cooked shrimp through cooking workflows when a fire or range is available.
- Success signals: inventory gains raw fish, fishing XP changes, raw fish becomes cooked fish, or cooking XP changes.
- Recovery: if the spot is missing, explore toward known water or ask/report that a fishing spot is needed.

## Prayer And Combat

- Bones: bury from inventory with the `bury` item action.
- Food: eat when hurt; keep survival above optional combat goals.
- Success signals: bones leave inventory, prayer XP changes, enemy dies, loot appears, or combat XP changes.
- Recovery: retreat or eat before continuing if health drops or a stronger enemy attacks.
