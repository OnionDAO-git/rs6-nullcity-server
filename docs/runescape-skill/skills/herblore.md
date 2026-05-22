# Herblore — Agent Skill Reference

Agent-facing knowledge for training and exploiting Herblore in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-herblore.md` — that file is for code, not for agents.

Herblore is a premier utility skill. By cleaning grimy herbs, grinding raw materials, and mixing ingredients into vials of water, you brew powerful potions that boost combat stats, restore prayer points, cure poison, or replenish run energy. It has a high synergy with Farming (for herbs), Mining/Combat (for secondary ingredients), and Combat survival.

## Key Herblore Items & Tools

To brew potions, you need a variety of raw ingredients and processing tools:

1. **Grimy Herbs** — Harvested from Farming or dropped by NPCs (like Goblins, Chaos Druids). Cannot be used in potions until cleaned.
2. **Clean Herbs** — Cleaned grimy herbs. Ready for mixing.
3. **Vial of Water** — The baseline liquid substrate for all standard potions. Created by filling empty vials at a water source.
4. **Pestle and Mortar** — A reusable tool used to grind certain secondary ingredients (like chocolate bars or unicorn horns) into fine powders.
5. **Secondary Ingredients** — Raw or processed items combined with unfinished potions to finish them (e.g., Eye of Newt, Red Spider's Eggs, Limpwurt Root).
6. **Unfinished Potion (Unf)** — The intermediate product of a clean herb mixed into a vial of water. Grants no XP and cannot be consumed.
7. **Finished Potion** — The final 3-dose consumable potion that grants substantial Herblore XP upon creation.

## The Herblore Brewing Loop

The complete process to manufacture a potion from scratch:

1. **Clean Herbs**: Right-click a `grimy <herb>` in your inventory -> `clean` (or left-click it). If your Herblore level is sufficient, you clean it instantly, granting small Herblore XP.
2. **Process Secondary Ingredients (If needed)**: If your recipe requires a ground powder (like `chocolate dust` or `ground unicorn horn`), use a `pestle and mortar` on the raw ingredient (e.g., `chocolate bar`) to grind it.
3. **Mix Unfinished Potion**: Use a `clean <herb>` on a `vial of water`. They combine into an `unfinished potion` (e.g., `guam potion (unf)`). This step does not require a level check or grant XP.
4. **Complete Potion**: Use the `secondary ingredient` on the `unfinished potion`. If your Herblore level is high enough, you perform a mixing animation, consume both items, and gain the completed `finished potion` (3-dose) and significant Herblore XP.

## Recipe & Level Reference

Use this reference to choose your training route and verify potion ingredients:

### Herb Cleaning Levels & XP
- **Guam** — Level 1 Herblore, 2.5 XP
- **Marrentill** — Level 5 Herblore, 3.8 XP
- **Tarromin** — Level 11 Herblore, 5 XP
- **Harralander** — Level 20 Herblore, 6.3 XP
- **Ranarr** — Level 25 Herblore, 7.5 XP

### Finished Potion Recipes
- **Attack Potion** (Level 3 Herblore, 25 XP): `Guam potion (unf)` + `Eye of newt`. (Boosts Attack).
- **Antipoison** (Level 5 Herblore, 37.5 XP): `Marrentill potion (unf)` + `Ground unicorn horn` (requires pestle and mortar on `unicorn horn`). (Cures poison).
- **Strength Potion** (Level 12 Herblore, 50 XP): `Tarromin potion (unf)` + `Limpwurt root`. (Boosts Strength).
- **Restore Potion** (Level 22 Herblore, 62.5 XP): `Harralander potion (unf)` + `Red spider's eggs`. (Restores depleted stats).
- **Energy Potion** (Level 26 Herblore, 67.5 XP): `Harralander potion (unf)` + `Chocolate dust` (requires pestle and mortar on `chocolate bar`). (Restores 20% run energy).
- **Defence Potion** (Level 30 Herblore, 75 XP): `Ranarr potion (unf)` + `White berries`. (Boosts Defence).
- **Prayer Potion** (Level 38 Herblore, 87.5 XP): `Ranarr potion (unf)` + `Snape grass`. (Restores Prayer points).

## Failure Modes & Recovery

| Symptom | Recovery |
|---|---|
| Level too low to clean | You cannot clean the herb. Stockpile grimy herbs in the bank until you reach the required Herblore level by mixing lower-tier potions. |
| Level too low to mix potion | You cannot combine the secondary ingredient. The unfinished potion remains safe in your inventory. Train Herblore using lower-tier recipes first. |
| "Nothing interesting happens" | You are trying to mix incompatible items (e.g., using a grimy herb, or using a secondary ingredient directly on a vial of water). Ensure you mixed the clean herb with water first to create the `unfinished potion`. |
| Out of water / empty vials | Fill empty vials on a water source (fountain, sink, or pump) to create `vials of water`. |
| Inventory full during mixing | Mixing potions decreases inventory pressure (combines 2 items into 1). However, if your inventory is full of single ingredients and you lack space for the tools, drop or bank low-value items to make space. |

## Success Signals

- Chat message: **"You clean the grimy <herb>."**
- Chat message: **"You mix the <ingredient> into your potion."**
- Potion mixing animation plays.
- Herblore XP increases in the skill tab.
- A 3-dose potion item appears in your inventory.

## When To Ask For Help

Speak publicly if:
- You need a `pestle and mortar` and cannot find a shop selling it.
- You are farming secondary ingredients (like Limpwurt roots from Hobgoblins) and need combat assistance.
- You want to trade grimy herbs for finished potions with higher-level players.

---

## Cross-references

- **Farming**: `skills/farming.md` — the primary domestic source for raw herbs.
- **Combat**: `skills/combat.md` — potions are crucial for surviving high-level boss fights or maximizing XP rates.
- **Items**: `items.md` for herb, vial, and secondary ingredient IDs.
- **Places**: `places.md` for shops selling vials (e.g., Taverley Herblore shop) and herb-dropping NPC locations (e.g., Chaos Druids in Taverley dungeon).
- **Server impl** (for code work, not agent reasoning): `feat/skill-herblore.md`.
