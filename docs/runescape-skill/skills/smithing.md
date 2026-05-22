# Smithing — Agent Skill Reference

Agent-facing knowledge for training and exploiting Smithing in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-smithing.md` — that file is for code, not for agents.

Smithing is the second half of the gathering-to-production chain: it transforms ores gathered from Mining into valuable metal bars (at a furnace), and then into weapons, tools, and armor (at an anvil with a hammer). Training Smithing is the most direct route to supplying yourself with high-tier pickaxes, axes, and defensive equipment without paying store prices or player markups.

---

## The Smelting Loop (Ores to Bars)

Smelting is performed at a **furnace**. Smelting consumes raw ores and outputs a metal bar, granting Smithing XP.

1. **Equip or carry a Hammer** (not strictly required for smelting, but mandatory for the forging stage, so keep one in inventory).
2. **Obtain correct Ores**: Ensure you have the exact type and quantity of ore in your inventory (e.g., 1 copper + 1 tin for bronze; 1 iron + 2 coal for steel).
3. **Walk to a Furnace**: Route to a known furnace (e.g., upstairs in Lumbridge Castle, east Falador, or west Varrock).
4. **Use/Interact with the Furnace**: Right-click the furnace → `smelt`, or use an ore on the furnace.
5. **Select Bar and Quantity**: In the furnace widget, click the desired bar. Select `smelt 1`, `smelt 5`, `smelt 10`, or `smelt X` to begin production.
6. **Wait**: The agent will automatically process the ores into bars tick-by-tick.
7. **Verify Outcome**: On success, you receive a chat message: **"You smelt the <ore> into a <metal> bar"** (or similar) and earn Smithing XP.

---

## Bar Recipes, Levels, and XP

Ores must be combined in precise ratios. Note that coal is a primary fuel element starting at steel.

- **Bronze bar** — Level 1 | 6.2 XP
  - Ingredients: 1 Copper Ore + 1 Tin Ore
- **Iron bar** — Level 15 | 12.5 XP
  - Ingredients: 1 Iron Ore
  - *Warning*: Iron smelting has a **~50% failure rate** in revision 435. Half of all iron ore is lost as burnt slag unless wearing a *Ring of Forging*.
- **Silver bar** — Level 20 | 13.7 XP
  - Ingredients: 1 Silver Ore
- **Steel bar** — Level 30 | 17.5 XP
  - Ingredients: 1 Iron Ore + 2 Coal
- **Gold bar** — Level 40 | 22.5 XP
  - Ingredients: 1 Gold Ore
- **Mithril bar** — Level 50 | 30.0 XP
  - Ingredients: 1 Mithril Ore + 4 Coal
- **Adamant bar** — Level 70 | 37.5 XP
  - Ingredients: 1 Adamantite Ore + 6 Coal
- **Rune bar** — Level 85 | 50.0 XP
  - Ingredients: 1 Runite Ore + 8 Coal

---

## The Forging Loop (Bars to Equipment)

Forging is performed at an **anvil** and requires a **hammer** in your inventory or equipped.

1. **Carry a Hammer**: Ensure item `hammer` (ID 2347) is in your inventory.
2. **Carry Metal Bars**: Pack your inventory with the metal bars of your chosen tier.
3. **Walk to an Anvil**: Route to an anvil (the absolute best starter location is the anvil room in west Varrock, just south of the bank).
4. **Interact with the Anvil**: Use a metal bar on the anvil, or right-click the anvil → `smith`.
5. **Select Output in Anvil Widget**: The forging interface will display all equipment you can make with your current Smithing level. Higher-tier equipment (like platebodies or two-handed swords) requires more bars (up to 5 bars).
6. **Choose Quantity**: Click the widget button for the desired item (make-1, 5, 10, or X) to begin hammering.
7. **Wait**: The agent will play the hammer swing animation and sound on each tick, replacing bars with the completed equipment and granting XP.

---

## Smithable Products and Bar Requirements

The number of bars required determines the product category:

- **1 Bar**: Daggers, Hatchets, Mace, Medium Helm, Bolts, Arrowtips, Nails.
- **2 Bars**: Sword, Scimitar, Longsword, Full Helm, Shield, Warhammer, Dart tips, Knives.
- **3 Bars**: Battleaxe, Two-Handed Sword, Chainbody, Kiteshield.
- **5 Bars**: Platelegs, Plateskirt, Platebody.

*Note on Hatchets and Pickaxes*: Forging your own Woodcutting hatchets and Mining pickaxes is the primary self-sufficiency loop for early-game agents.

---

## Best Smithing Areas

- **Varrock West Anvil & Furnace**: The supreme training site. The furnace is a short walk west, and the anvils are directly adjacent to the Varrock West Bank.
- **Lumbridge Castle Furnace**: Located on the ground floor (upstairs in some server configurations). Great for smelting the copper and tin mined in Lumbridge Swamp, but lacks nearby anvils. Smelt here, then carry bars to Varrock or Falador to smith.
- **Falador East Furnace & Anvil**: A reliable smelting and smithing hub with a bank nearby. Excellent secondary location.

---

## Failure Modes and Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| **"You need a hammer..."** | Missing hammer in inventory. | Ensure you carry a `hammer` (ID 2347) in inventory. Buy one at a general store for ~1gp. |
| **"You don't have enough bars..."** | Insufficient bars in inventory for the selected item. | Smelt more bars or choose a smaller item (e.g. dagger instead of platebody). |
| **Iron smelting fails repeatedly** | Standard ~50% iron ore burn rate. | Expected. Keep smelting; the roll is probabilistic. If resources permit, acquire and wear a *Ring of Forging*. |
| **Anvil widget doesn't open** | Missing hammer or bar, or lag. | Re-check inventory for `hammer` and matching bars. Re-click the anvil. |
| **Widget buttons don't respond** | Lag or level too low for clicked item. | Check the skill guide to verify you meet the level requirement for that specific item. |

---

## Success Signals

- A completed metal bar appears in inventory after smelting.
- A weapon, tool, or armor piece replaces bars in the inventory grid after forging.
- Smithing XP increases in the skill tab.
- Player character plays the hammering animation (forging) or bending animation (smelting).
- Chat lines: **"You smelt the ore into a bar"** or **"You make a..."**.

---

## When to Ask for Help

Speak publicly if:
- You lack a hammer and need a nearby player or agent to drop or trade one.
- You have run out of coal and need to purchase some from local players to process your iron/mithril ore.
- The anvil area is completely crowded, causing clicks to target players instead of the anvil.

---

## Cross-references

- **Mining**: `skills/mining.md` — gathers the copper, tin, iron, coal, and higher-tier ores needed for smelting.
- **Combat**: `skills/combat.md` — weapons and armor forged here are immediately usable to improve combat stats.
- **Woodcutting**: `skills/woodcutting.md` — forge hatchets to chop higher-level trees.
- **Items**: `items.md` for hammer and bar item IDs.
- **Places**: `places.md` for Varrock West and Falador coordinates.
