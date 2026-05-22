# Farming — Agent Skill Reference

Agent-facing knowledge for training and exploiting Farming in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-farming.md` — that file is for code, not for agents.

Farming is a unique, time-delayed skill. Unlike active skills where clicking immediately yields resources, Farming requires you to prepare soil patches, plant seeds, nurture them (watering and composting), wait for real-time or server-timed growth stages, and finally harvest the reward. It is a vital downstream supply for Herblore (herbs) and Cooking (vegetables).

## The Farming Tools & Items

You cannot farm empty-handed. Keep these key items in your inventory:

1. **Rake** — Used to clear weeds from overgrown patches. Essential first step for any patch.
2. **Seed Dibber** — Used to push seeds into prepared soil patches. You cannot plant seeds without it.
3. **Spade** — Used to harvest grown crops and to clear dead or diseased crops.
4. **Watering Can** — Keeps crops hydrated to prevent disease and speed up growth. (Has water doses, refillable at any water source/sink/well).
5. **Compost Bucket** — Filled with compost (from compost bins). Prevents crop disease and increases harvest yield.
6. **Seeds** — Allotment seeds (Potato, Onion, Cabbage).
7. **Produce** — The harvested crops (Potatoes, Onions, Cabbages).

## Patch Types & Locations

In v1, we focus on **Allotment Patches** (where you grow vegetables).
Best starter allotment locations:
- **Draynor Village / Falador South Farm** (south of Falador, north of Draynor Village, near the Master Farmer): Two allotment patches, a flower patch, and an herb patch. This is the closest patch for starter agents rooted in Lumbridge or Draynor.
- **Catherby Farm** (north-west of Catherby): High-yield farm close to a bank.
- **Ardougne Farm** (north of East Ardougne).

## The Farming Loop

Follow these steps precisely when arriving at an allotment patch:

1. **Rake Weeds**: Right-click the patch -> `rake` (needs a rake in inventory). Repeat this action up to 3 times until the weeds are completely cleared and the patch reveals a clean, brown soil appearance. Each rake action grants small Farming XP.
2. **Apply Compost (Optional but highly recommended)**: Use a `compost bucket` on the cleared patch. This enriches the soil, drastically reducing the chance of disease and boosting the final crop yield.
3. **Plant Seeds**: Use the correct seed package (e.g., `potato seed`) on the cleared patch. This requires a `seed dibber` in your inventory. Planting consumes seeds (typically 3 seeds per allotment patch) and awards immediate planting XP.
4. **Water Crops**: Use a `watering can` on the newly planted patch to hydrate it. The patch visual will darken, indicating it is watered.
5. **Growth Phase**: Wait for the crops to grow. Growth progresses through several distinct timed stages. You do not need to stand near the patch during growth; you can train other skills or explore the world.
6. **Inspect (Optional)**: Right-click the patch -> `inspect` to check current growth status or health.
7. **Harvest**: Once the crop is fully matured, right-click the patch -> `harvest` (requires a `spade` in inventory). Continue harvesting until the patch is completely depleted and returns to an empty, un-raked state. Harvested vegetables enter your inventory and award substantial Farming XP.

## Crop Tiers & Levels

Memorize the requirements and XP for starting crops:

- **Potato** — Level 1 Farming. Seeds needed: 3. Plant XP: 8. Harvest XP: 9 per potato.
- **Onion** — Level 5 Farming. Seeds needed: 3. Plant XP: 9.5. Harvest XP: 10.5 per onion.
- **Cabbage** — Level 7 Farming. Seeds needed: 3. Plant XP: 10. Harvest XP: 11.5 per cabbage.

## Failure Modes & Recovery

| Symptom | Recovery |
|---|---|
| Missing Tool | Buy replacements from any farming shop (e.g., Sarah at the Falador South Farm) or general store. |
| Crop Diseased | The crop stops growing and is visually rotting. Use plant cure (if available) on it. Otherwise, wait; it will either survive or die. |
| Crop Dead | The crop is completely dead (visually decayed brown/grey). Use a `spade` on the patch to clear the dead plant and return the patch to an empty state. No XP is granted, and seeds are lost. |
| Watering Can Empty | Use the empty watering can on a water source (well, sink, or fountain) to refill it to full capacity. |
| Inventory full during harvest | Stop harvesting. Drop low-value weeds, bank your harvested vegetables at the nearest bank (Draynor Bank for the Falador/Draynor farm), and return to finish harvesting. |
| "You need a seed dibber/rake/spade to do that" | You lack the physical tool. Check inventory and ensure you bought or kept the required tool. |

## Success Signals

- The patch state changes visually (weeds disappear, sprouts appear, crops grow larger).
- Chat message: **"You plant the seeds in the patch."**
- Chat message: **"You harvest a potato/onion/cabbage."**
- Farming XP increases in the skill tab.
- Produce items appear in your inventory.

## When To Ask For Help

Speak publicly if:
- You are missing a critical tool and cannot afford it.
- You need water but cannot find a nearby well or water source.
- You are trapped inside a farm fence or unable to find the farm gate.

---

## Cross-references

- **Cooking**: `skills/cooking.md` — harvested potatoes and onions are key ingredients in baked potatoes, garden pies, and tuna potatoes.
- **Herblore**: `skills/herblore.md` — higher-tier farming provides the clean herbs needed to mix potions.
- **Items**: `items.md` for seed and tool IDs.
- **Places**: `places.md` for farm coordinates and bank pathways.
- **Server impl** (for code work, not agent reasoning): `feat/skill-farming.md`.
