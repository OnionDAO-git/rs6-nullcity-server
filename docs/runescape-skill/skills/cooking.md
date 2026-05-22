# Cooking — Agent Skill Reference

Agent-facing knowledge for training and exploiting Cooking in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-cooking.md` — that file is for code, not for agents.

Cooking is the back half of the food supply chain: raw fish (from Fishing) or assembled ingredients (from shops + farming) become edible heal items when applied to a heat source. Treat Cooking as paired with Fishing on the input side and with Combat on the output side — every cooked fish in inventory is HP that a combat agent will spend later. A starter agent rooted in Lumbridge can begin Cooking within thirty seconds of catching its first shrimp if it walks north to the castle kitchen range.

## Pick A Heat Source

Two heat sources exist; both work for every cookable item but their burn rates differ.

1. **Fire** — built via Firemaking from logs + tinderbox on any unblocked outdoor tile. Temporary: in 2006 a fire lasts roughly 5 minutes (random 30 - 180s depending on log tier — see `firemaking.md`) before it burns out into ashes. Use fires when you are already cooking on-site at a Fishing spot or far from a kitchen.
2. **Range** — a permanent built-in cooker tile. Found in **Lumbridge Castle kitchen** (ground floor north room), **Al Kharid palace kitchen** (south-west corner), and the **Cooking Guild** range north of Varrock west bank (requires level 32 Cooking + a chef's hat to enter). Ranges never burn out; walk to one for any high-volume cooking session.

Rule of thumb: build a fire only when there is no range within a 30-second walk, **or** when the inventory of raw food is small enough to consume before the fire dies. Otherwise walk to a range — the lower burn rate pays back the travel cost within 5-10 catches.

## The Cooking Loop

1. **Get raw food** in inventory — fish caught via Fishing (`fishing.md`), or assembled ingredients bought from a grocer / picked up around Lumbridge (see § *Other Cookables* below).
2. **Approach a heat source** — be within one tile of a fire object or a range tile (the engine auto-walks). Fires and ranges are both highlighted on right-click.
3. **Trigger the cook** — right-click the raw food in inventory → `use` → click the fire or range tile. The character animates a cooking action over the heat source.
4. **Wait one tick per item** — cooked food enters inventory and Cooking XP is awarded on success. On failure the raw food is consumed and **burnt food** appears instead (zero heal value, takes the same inventory slot).
5. **Continue** — the engine auto-repeats the cooking action across all matching raw items in inventory until the stack is exhausted or the heat source is destroyed. Do NOT spam-click; one click cooks the whole stack.

When the inventory is mixed (e.g., raw shrimp + raw trout), use one raw item per type on the heat source — each `use` action processes only that item type.

## Cooking Levels And Burn Rates

Memorize the level requirement, XP-per-cook, and the "stops burning" level. Burn chance falls linearly from the cooking level up to the stop-burn level; above that, the fire/range never burns the food.

- **Shrimps** — level 1 to cook, 30 XP, stops burning ~level 34
- **Sardine** — level 1 to cook, 40 XP, stops burning ~level 38
- **Anchovies** — level 1 to cook, 30 XP, stops burning ~level 34
- **Herring** — level 5 to cook, 50 XP, stops burning ~level 41
- **Trout** — level 15 to cook, 70 XP, stops burning ~level 50
- **Salmon** — level 25 to cook, 90 XP, stops burning ~level 58
- **Tuna** — level 30 to cook, 100 XP, stops burning ~level 63
- **Lobster** — level 40 to cook, 120 XP, stops burning ~level 74
- **Swordfish** — level 45 to cook, 140 XP, stops burning ~level 86
- **Shark** — level 80 to cook, 210 XP, stops burning ~level 99 (never fully stops on a fire)

Rule of thumb: once you unlock the next tier, swap to it for both XP per inventory and food heal value (see `combat.md`). Anchovies are the same level as shrimp but burn at the same rate — pick whichever your Fishing routing supplies, not Cooking.

## Fire vs Range Burn Difference

Ranges have a slightly **lower** burn rate than fires at every level — roughly 2-4 levels of effective Cooking advantage. The Cooks Guild range (north of Varrock west bank, level 32 Cooking required to enter, chef's hat required) has the **lowest** burn rate of any range in the game, an additional 1-2 levels of effective advantage over a Lumbridge / Al Kharid range.

For lobster, swordfish, and shark — where each burn costs hundreds of gp of raw fish — the walk to the Cooks Guild range pays back within 5-10 cooks. For shrimp and sardine, any nearby fire is fine: the burn cost is negligible.

## Where To Cook (Starter)

Default routing for an agent under Cooking level 40:

- **Lumbridge Castle kitchen** — ground floor north room, one range, free, no entry requirement. The default starter cook site. Two tiles from the Lumbridge bank ladder. No combat hazard.
- **Al Kharid palace kitchen** — one range, free, less crowded than Lumbridge. A two-minute walk south-east from Lumbridge across the toll gate (10 gp toll once per session, or zero with the Prince Ali Rescue quest complete).
- **Catherby range** — one range immediately next to the Catherby fishing spots and the Catherby bank. Out of scope for starter agents (long route through Taverley or a teleport) but the canonical mid-game cook site once Fishing routes there.
- **Build a fire** wherever Firemaking output is plentiful — most usefully at the Lumbridge fishing waterfront (cook-on-site for fisher-cookers, see § *Cooking + Fishing Pair* below) and at Barbarian Village (river-side trout cooking).

If a range tile is contested (another player or agent occupying it), walk to the next-nearest kitchen rather than queueing — the engine does not let two cooks share a tile.

## Cooking + Fishing Pair

The classic starter loop, sometimes called *catch-and-cook*:

1. **Catch** at Lumbridge waterfront with a small net until inventory has 27 raw shrimp (one slot reserved for the tinderbox or kept open for a future cooked-shrimp stack).
2. **Walk** north into Lumbridge Castle (the kitchen door is on the ground floor — enter from the south courtyard, head into the north room).
3. **Cook** by using one raw shrimp on the range. The engine auto-cooks the rest of the stack until empty.
4. **Eat** or **bank** the cooked shrimp. Lumbridge bank is one floor up from the kitchen via the spiral staircase.
5. **Repeat** — walk back down to the river, refish, recook. ~10 Fishing XP and ~30 Cooking XP per shrimp; one full inventory yields ~270 Fishing XP and ~810 Cooking XP per cycle.

This is the fastest dual-skill train in the early game. Switch to herring or trout once Cooking and Fishing levels permit, repointing the loop at Draynor or Barbarian Village.

## Other Cookables (Not From Fishing)

- **Bread** (level 1, 40 XP) — `flour` (mill north of Lumbridge — climb the ladder, operate the hopper, then collect from the bin) + `water in jug` (use jug on a water source) → `uncooked dough`. Cook the dough on a fire or range.
- **Stew** (level 25, 117 XP) — `empty bowl` + `cooked chicken` + `cooked potato` → `uncooked stew`. Cook the bowl. Watch for burns up to ~level 50.
- **Pizza** (level 35, 143 XP base) — `pizza base` (flour + water → unbaked base, cook for plain base) + `tomato` + `cheese` → `uncooked pizza`. Cook it. Higher tiers add cooked meat, anchovies, or pineapple chunks for bigger heal values.
- **Cake** (level 40, 180 XP) — `bucket of milk` + `pot of flour` + `egg` used together on a `cake tin` → `uncooked cake`. Cook on a range only (fires do not work for cake).

These assembled recipes are inventory-intensive — never assemble more than you can carry to a range in one trip.

## Food Heal Values

Cooked food becomes HP in combat (`combat.md` food table). Plan inventory by heal value, not by Cooking XP:

- **Shrimp** 3 · **Anchovies** 1 · **Sardine** 4 · **Herring** 5 · **Trout** 7 · **Salmon** 9 · **Tuna** 10 · **Lobster** 12 · **Swordfish** 14 · **Shark** 20

Burnt food: **0 heal**, discard or drop. Stew, pizza, and cake heal in multi-bite stacks — see `combat.md` for the exact per-bite values.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Burnt food in inventory | Normal — burn rate is per-cook, not catastrophic. Drop the burnt item, continue cooking the rest of the stack. Track the burn ratio; if more than 50% are burning, your Cooking level is too low for this fish — switch back one tier. |
| No heat source nearby | If you have logs + tinderbox, build a fire (see `firemaking.md`). Otherwise route to the nearest range: Lumbridge Castle kitchen from the Lumbridge area, Al Kharid kitchen from the south, Catherby range from the west coast. |
| No raw food | Route to Fishing (`fishing.md`). For non-fish recipes, route to the grocer in Lumbridge or the Port Sarim fishing shop for sardines / herring you can buy raw. |
| Inventory full mid-cook | Stop the cooking action. Eat the lowest-heal cooked food first (anchovies, then shrimp) to clear slots, **or** bank a partial stack and return, **or** drop the lowest-tier raw food if power-cooking for XP. |
| Range tile missing or contested | Walk to the next-nearest kitchen. Lumbridge → Al Kharid is the canonical fallback; Al Kharid → Cooks Guild (if level 32+) is the next step up. |
| Fire burned out mid-cook | Build a new fire next to the old ash pile (one tile over). If you ran out of logs, bank the remaining raw food — do NOT abandon it on the ground. |

## Success Signals

- Cooked food item appears in the inventory grid (replacing the raw item).
- Cooking XP gain animation in the skill tab.
- Chat line: **"You manage to cook the <food>"** — exact text, food name lowercase.
- Burn signal: **"You accidentally burn the <food>"** — burnt item appears instead.
- The cooking action auto-repeats on the next raw item in the stack without further input.
- `progress.jsonl` shows incremental Cooking XP entries over the session.

---

## Cross-references

- **Fishing**: `skills/fishing.md` — the raw-food source. The Fishing-level table there tells you what raw fish you can supply your Cooking with.
- **Firemaking**: `skills/firemaking.md` — the heat source when no range is nearby. Logs + tinderbox → fire → cook on it.
- **Combat**: `skills/combat.md` — the demand signal for cooked food. The food heal table there is what you are optimizing the cooked output for.
- **Starter quick reference**: `starter-workflows.md` § *Make A Fire* — minimal heat-source dispatch for the Brain.
- **Server impl** (for code work, not agent reasoning): `feat/skill-cooking.md`.
