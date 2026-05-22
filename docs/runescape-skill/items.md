# Items Reference

This is the canonical item reference for residents in the 2006 RuneJS world (revision 435). Items are referenced as `rs:item_name` ids. Numeric IDs are the engine's responsibility; agents only need to know names, recovery routes, and success signals when items are used.

## Inventory Basics

- 28 slots max. Stacked items (coins, runes, arrows, bolts) use 1 slot regardless of count.
- "Use X on Y" pattern: right-click an item → `Use` → click target. Common for tinderbox+logs, knife+bows, chisel+gems, ore+furnace.
- Equipped items (weapon, armour, ammo slot, ring, amulet, cape) do NOT count toward the 28-slot inventory cap.
- Lost-on-death rules: keep 3 most-valuable items unless skulled in the wilderness (then 0). Always carry less than you can afford to lose when crossing the wilderness ditch.
- "Your inventory is too full" message means stop the action, drop trash, eat, or bank before retrying.

## Starter Tools

The minimum kit a resident should rebuild within five minutes of any death.

| Item | Id | Source / Cost | Used For | Success Signal |
|---|---|---|---|---|
| Tinderbox | `rs:tinderbox` | Lumbridge General Store, 1gp | Lighting logs (firemaking) | Fire object appears, logs leave inventory |
| Small Fishing Net | `rs:small_fishing_net` | Port Sarim fishing shop, ~5gp | Net-fishing shrimp + anchovies | Inventory gains raw shrimp / raw anchovies |
| Bronze Hatchet | `rs:bronze_hatchet` | Bob's Brilliant Axes (Lumbridge), 16gp | Cutting trees (woodcutting) | Logs in inventory |
| Bronze Pickaxe | `rs:bronze_pickaxe` | Nurmof's Pickaxe Shop (Dwarven Mine), ~140gp | Mining ore | Ore in inventory |
| Hammer | `rs:hammer` | General Store, 1gp | Smithing on anvil | Bar → item transformation |
| Needle | `rs:needle` | Crafting shops, 1gp | Crafting cloth / leather | Clothing in inventory |
| Shears | `rs:shears` | General Store, 1gp | Sheep shearing for wool | Wool in inventory |
| Chisel | `rs:chisel` | Crafting shops, 1gp | Gem cutting | Cut gem in inventory |
| Knife | `rs:knife` | General Store, 6gp | Fletching bows, filleting | Bow / arrow shaft / fillet in inventory |
| Bucket | `rs:bucket` | General Store, 2gp | Carrying water, milk, sand | Filled bucket in inventory |
| Bowl | `rs:bowl` | General Store, 4gp | Soups / mixing | Filled bowl in inventory |
| Pot | `rs:pot` | General Store, 1gp | Flour, milk, water | Filled pot in inventory |
| Jug | `rs:jug` | General Store, 1gp | Wine, water | Filled jug in inventory |
| Spade | `rs:spade` | General Store, 3gp | Burying clues, digging | Hole appears / item buried |
| Tinderbox (restock) | `rs:tinderbox` | Lumbridge General Store always restocks | Recovery after death | Restored inventory |

Existing skeleton refs preserved: `rs:tinderbox`, `rs:logs`, `rs:small_fishing_net` — all three are also documented in the Firemaking, Woodcutting, and Fishing sections below.

## Firemaking

- `rs:tinderbox`: required to light logs. Use it on logs with `use_item_on_item`. Never consumed.
- `rs:logs`: level 1 firemaking fuel. Normal logs come from ordinary trees or dead trees.
- Success signals: logs leave inventory, a fire object appears nearby, chat says the fire catches, Firemaking XP changes.
- Recovery: if the resident has a tinderbox but no logs, switch to woodcutting or ask a nearby player for logs.

## Woodcutting

- Axe or hatchet: required to chop trees. May be in inventory or equipment slot. Naming is mixed in 2006 — both "axe" and "hatchet" refer to the same tool.
- Normal trees and dead trees are starter targets that produce `rs:logs`.
- Success signals: inventory gains logs, Woodcutting XP changes, tree depletion message appears.
- Recovery: if a target is unreachable, choose another visible tree instead of micro-stepping at a fence.

## Fishing And Cooking

- `rs:small_fishing_net`: starter tool for shrimp at net-capable fishing spots.
- Raw shrimp: starter catch; becomes cooked shrimp through cooking when a fire or range is available.
- Success signals: inventory gains raw fish, Fishing XP changes, raw fish becomes cooked fish, Cooking XP changes.
- Recovery: if the spot is missing, explore toward known water (Lumbridge waterfront) or ask / report that a fishing spot is needed.

## Prayer And Combat

- Bones: bury from inventory with the `bury` item action.
- Food: eat when hurt; keep survival above optional combat goals.
- Success signals: bones leave inventory, Prayer XP changes, enemy dies, loot appears, Combat XP changes.
- Recovery: retreat or eat before continuing if health drops or a stronger enemy attacks.

## Hatchets / Axes (Woodcutting) — Tier Table

| Tier | Id | Woodcutting Level | Source / Cost |
|---|---|---|---|
| Bronze | `rs:bronze_hatchet` | 1 | Bob's Brilliant Axes, 16gp |
| Iron | `rs:iron_hatchet` | 1 | Bob's Brilliant Axes, ~56gp |
| Steel | `rs:steel_hatchet` | 6 | Bob's Brilliant Axes, ~200gp |
| Mithril | `rs:mithril_hatchet` | 21 | Bob's Brilliant Axes, ~640gp |
| Adamant | `rs:adamant_hatchet` | 31 | Player trade / smithing |
| Rune | `rs:rune_hatchet` | 41 | Player trade only |

Agents should accept both "hatchet" and "axe" tokens to refer to the same tool.

## Pickaxes (Mining) — Tier Table

| Tier | Id | Mining Level | Source / Cost |
|---|---|---|---|
| Bronze | `rs:bronze_pickaxe` | 1 | Nurmof's Pickaxe Shop (Dwarven Mine), ~140gp |
| Iron | `rs:iron_pickaxe` | 1 | Nurmof's, ~140gp |
| Steel | `rs:steel_pickaxe` | 6 | Nurmof's, ~500gp |
| Mithril | `rs:mithril_pickaxe` | 21 | Nurmof's, ~1300gp |
| Adamant | `rs:adamant_pickaxe` | 31 | Player trade / smithing |
| Rune | `rs:rune_pickaxe` | 41 | Player trade only |

## Food (Heal Values)

| Food | Id | Heal | Source | Notes |
|---|---|---|---|---|
| Shrimp (cooked) | `rs:shrimps` | 3 | Cook raw shrimp on fire / range | Burns under level 34 Cooking |
| Anchovies (cooked) | `rs:anchovies` | 1 | Cook raw anchovies | Tiny heal; eat several |
| Sardine (cooked) | `rs:sardine` | 4 | Bait-fish, cook raw | |
| Herring (cooked) | `rs:herring` | 5 | Bait-fish, cook raw | |
| Cooked Chicken | `rs:cooked_chicken` | 3 | Cook raw chicken | Lumbridge chickens |
| Cooked Meat | `rs:cooked_meat` | 3 | Cook raw beef / rat meat | |
| Cooked Trout | `rs:trout` | 7 | Fly-fish, cook raw | |
| Cooked Salmon | `rs:salmon` | 9 | Fly-fish, cook raw | |
| Cooked Tuna | `rs:tuna` | 10 | Harpoon at 35 Fishing | |
| Cooked Lobster | `rs:lobster` | 12 | Lobster pot at 40 Fishing | Common combat food |
| Cooked Swordfish | `rs:swordfish` | 14 | Harpoon at 50 Fishing | Top non-quest heal |
| Cooked Shark | `rs:shark` | 20 | Harpoon at 76 Fishing | End-game food |
| Cake | `rs:cake` | 4 per bite (3 bites) | Bake in Lumbridge kitchen | 1 slot, 12 HP total |
| Cabbage | `rs:cabbage` | 1 | Farm patches / grown | Bulk emergency food |
| Bread | `rs:bread` | 5 | Cook flour + water dough | Mid-tier food |
| Apple Pie | `rs:apple_pie` | 7 per bite (2 bites) | Cook apple + pastry dough | |

Burnt-food entries are non-functional and should be discarded. Always carry food before combat — cross-ref `skills/combat.md`.

## Weapons By Tier (Melee)

| Tier | Attack Level | Notes |
|---|---|---|
| Bronze | 1 | Starter kit baseline |
| Iron | 1 | Cheap upgrade, Varrock Sword Shop ~50gp |
| Steel | 5 | Noticeable kill-speed gain |
| Mithril | 20 | Mining + smithing pays off here |
| Adamant | 30 | Major damage jump |
| Rune | 40 | Mid-game baseline |

Weapon styles available at every tier: dagger, sword, scimitar, longsword, mace, battleaxe, warhammer, spear, two-handed sword. Scimitars are recommended for fast attack speed at every tier. Spears allow Controlled style (XP split across Attack / Strength / Defence).

## Armour By Tier (Melee)

| Tier | Defence Level | Pieces Available |
|---|---|---|
| Bronze | 1 | full helm, chainbody, platebody, platelegs, plateskirt, kiteshield, square shield |
| Iron | 1 | same as bronze |
| Steel | 5 | same as bronze |
| Mithril | 20 | same as bronze |
| Adamant | 30 | same as bronze |
| Rune | 40 | same as bronze |

Higher tiers require the matching Defence level. Platebodies require completion of *Dragon Slayer* for rune-tier in some configurations — verify per server.

## Bows And Arrows (Ranged)

| Bow Type | Id Prefix | Fletching / Ranged Level | Notes |
|---|---|---|---|
| Shortbow | `rs:shortbow` | 1 | Fast attack speed, short range |
| Oak shortbow | `rs:oak_shortbow` | 20 | |
| Willow shortbow | `rs:willow_shortbow` | 35 | Common training bow |
| Maple shortbow | `rs:maple_shortbow` | 50 | |
| Yew shortbow | `rs:yew_shortbow` | 65 | |
| Magic shortbow | `rs:magic_shortbow` | 80 | |
| Longbow | `rs:longbow` | 1 | Slower attack, longer range |

Arrows: bronze through rune (`rs:bronze_arrow` … `rs:rune_arrow`). Match arrow tier to bow tier where possible; arrows below the bow's tier work but cap damage.

## Runes (Magic)

| Rune | Id | Common Use |
|---|---|---|
| Air | `rs:air_rune` | All wind / strike spells, teleports |
| Water | `rs:water_rune` | Water spells, teleports |
| Earth | `rs:earth_rune` | Earth spells, teleports |
| Fire | `rs:fire_rune` | Fire spells, teleports |
| Mind | `rs:mind_rune` | Low-level strikes |
| Body | `rs:body_rune` | Curse, confuse, weaken |
| Chaos | `rs:chaos_rune` | Mid-tier combat spells (bolt) |
| Death | `rs:death_rune` | High-tier combat spells (blast / wave) |
| Nature | `rs:nature_rune` | Alchemy spells |
| Cosmic | `rs:cosmic_rune` | Enchant spells |
| Law | `rs:law_rune` | Teleports |
| Blood | `rs:blood_rune` | High-tier combat (ice barrage) |

All runes stack into 1 inventory slot regardless of count. Buy from Aubury's Rune Shop in Varrock. Combat spells cost an elemental + chaos / death; teleports cost law + air + others.

## Ores / Bars / Smithing Chain

| Ore | Bar (after smelt) | Smith Level (smelt) | Mining Pickaxe Required |
|---|---|---|---|
| Copper + Tin | Bronze bar | 1 | Bronze |
| Iron | Iron bar (~50% fail without Ring of Forging) | 15 | Iron |
| Coal | (Used with iron / mithril / adamant / rune) | n/a | Iron+ |
| Silver | Silver bar | 20 | Iron+ |
| Gold | Gold bar | 40 | Iron+ |
| Mithril | Mithril bar (needs 4 coal) | 50 | Mithril |
| Adamantite | Adamant bar (needs 6 coal) | 70 | Adamant |
| Runite | Rune bar (needs 8 coal) | 85 | Rune |

Item ids: `rs:copper_ore`, `rs:tin_ore`, `rs:iron_ore`, `rs:coal`, `rs:silver_ore`, `rs:gold_ore`, `rs:mithril_ore`, `rs:adamantite_ore`, `rs:runite_ore`. Bars: `rs:bronze_bar`, `rs:iron_bar`, `rs:silver_bar`, `rs:gold_bar`, `rs:steel_bar`, `rs:mithril_bar`, `rs:adamant_bar`, `rs:rune_bar`.

## Gems (Crafting)

| Uncut Id | Cut Id | Crafting Level (cut) | Use |
|---|---|---|---|
| `rs:uncut_sapphire` | `rs:sapphire` | 20 | Sapphire ring / amulet (gold + gem) |
| `rs:uncut_emerald` | `rs:emerald` | 27 | Emerald ring / amulet |
| `rs:uncut_ruby` | `rs:ruby` | 34 | Ruby ring / amulet |
| `rs:uncut_diamond` | `rs:diamond` | 43 | Diamond ring / amulet |

Cut uncut gems with `rs:chisel` (right-click chisel → use → gem). Use cut gems on a gold bar at a furnace with a ring / amulet / necklace mould.

## Logs (Woodcutting → Firemaking)

| Log | Id | Woodcutting Level | Firemaking Level |
|---|---|---|---|
| Normal logs | `rs:logs` | 1 | 1 |
| Oak logs | `rs:oak_logs` | 15 | 15 |
| Willow logs | `rs:willow_logs` | 30 | 30 |
| Maple logs | `rs:maple_logs` | 45 | 45 |
| Yew logs | `rs:yew_logs` | 60 | 60 |
| Magic logs | `rs:magic_logs` | 75 | 75 |

Each tier requires both the matching Woodcutting level (to cut) and the matching Firemaking level (to light).

## Herbs / Potions (Herblore)

Unidentified herb → cleaned herb (id at the matching Herblore level). Add cleaned herb to a vial of water, then add a secondary ingredient → unfinished → finished potion.

| Herb | Id | Herblore Level (clean) |
|---|---|---|
| Guam | `rs:guam_leaf` | 3 |
| Marrentill | `rs:marrentill` | 5 |
| Tarromin | `rs:tarromin` | 11 |
| Harralander | `rs:harralander` | 20 |
| Ranarr | `rs:ranarr_weed` | 30 |
| Irit | `rs:irit_leaf` | 40 |
| Kwuarm | `rs:kwuarm` | 54 |

Common secondaries: `rs:eye_of_newt`, `rs:limpwurt_root`, `rs:snape_grass`, `rs:red_spiders_eggs`, `rs:white_berries`.

## Construction Materials

| Plank | Id | Sawmill Cost | Construction Level |
|---|---|---|---|
| Plank | `rs:plank` | 100gp | 1 |
| Oak plank | `rs:oak_plank` | 250gp | 15 |
| Teak plank | `rs:teak_plank` | 500gp | 35 |
| Mahogany plank | `rs:mahogany_plank` | 1500gp | 50 |

Nails: bronze through rune (`rs:bronze_nails` … `rs:rune_nails`). A hammer and saw (`rs:saw`) are required at every construction step.

## Seeds (Farming)

- Allotment seeds: `rs:potato_seed`, `rs:onion_seed`, `rs:cabbage_seed`, `rs:tomato_seed`, `rs:sweetcorn_seed`, `rs:strawberry_seed`, `rs:watermelon_seed`.
- Herb seeds: `rs:guam_seed`, `rs:marrentill_seed`, `rs:tarromin_seed`, `rs:harralander_seed`, `rs:ranarr_seed`.
- Tree seeds: `rs:acorn` (oak), `rs:willow_seed`, `rs:maple_seed`, `rs:yew_seed`, `rs:magic_seed`.
- Flower seeds: `rs:marigold_seed`, `rs:rosemary_seed`, `rs:nasturtium_seed`.

## Quest / Special Items

- `rs:ghostspeak_amulet` — *Restless Ghost* reward. Required to talk to ghosts.
- `rs:cadava_potion` — *Romeo & Juliet* quest item only.
- `rs:insect_repellent`, `rs:bucket_of_wax` — *Cook's Assistant* chain.
- `rs:lobster_pot`, `rs:fishing_bait`, `rs:feather` — Fishing-related but often quest-gated for specific catches.
- `rs:bones`, `rs:big_bones`, `rs:dragon_bones` — Prayer XP via burying; dragon bones are end-game.

## Recovery Heuristics

1. **Lost tool on death**: Lumbridge General Store always restocks tinderbox, pot, jug, bucket, bowl, shears, hammer, needle, spade. Bob's Brilliant Axes always restocks bronze hatchets. Restock before resuming any gathering skill loop.
2. **Out of food**: route to the nearest fishing spot (Lumbridge swamp shrimp, Draynor willows for fly-fishing, Port Sarim for lobster pot), or buy bread at Wydin's Food Store (Port Sarim).
3. **Empty inventory**: bank-withdraw if items are stored; otherwise restart the skill loop from cheap shop tools.
4. **Burnt food**: drop or discard via right-click → `drop`. Burnt items heal 0 and waste a slot.
5. **Lost weapon**: bank for a spare; otherwise buy a bronze scimitar at the Varrock Sword Shop. Unarmed combat is very slow.
6. **No coins for shop tools**: kill cows for cowhide (sells ~100gp each at the Al Kharid tanner indirectly via leather), or net-fish shrimp and sell raw to a player.

## Inventory Signals (Cross-Cutting)

- *"Your inventory is too full"* → withdraw, drop trash, or bank before retrying.
- An item disappearing after an action = consumed (logs disappear into fire; tinderbox does not).
- A new item appearing = success signal. Always verify before retrying.
- An item being replaced in the same slot (raw fish → cooked fish, bar → weapon) is also a success signal.
- A chat line beginning *"You manage to…"* or *"You smelt the…"* confirms skill-action success.
- A chat line beginning *"You accidentally…"* or *"You fail to…"* indicates a non-fatal failure (burnt food, failed iron smelt). Continue the loop.

## Cross-References

- `skills/firemaking.md`, `skills/woodcutting.md`, `skills/mining.md`, `skills/smithing.md`, `skills/cooking.md`, `skills/fishing.md`, `skills/crafting.md`, `skills/herblore.md`, `skills/construction.md`, `skills/farming.md`, `skills/runecrafting.md`, `skills/combat.md`, `skills/prayer.md`.
- `places/lumbridge.md` (General Store stocks, Bob's Axes), `places/varrock.md` (Aubury's runes, Lowe's archery, Horvik's armour), `places/falador.md` (Dwarven Mine, Mining Guild).
- `npcs/lumbridge.md` (Bob, General Store shopkeeper), `npcs/varrock.md` (Aubury, Lowe, Horvik).
- `quests/` for quest-required items and gating.
