# Fletching — Agent Skill Reference

Agent-facing playbook for crafting ranged weapons and ammunition in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-fletching.md` — that file is for code, not for agents.

Fletching is a production skill that allows you to craft bows, arrows, crossbow stocks, bolts, and darts. The items you produce directly support the **Ranged** combat skill and can be sold to players or specialized archery shops for significant profit.

## Fletching Materials

To fletch, you must gather wood logs and various specialized fletching tools and components:

1. **Tools:**
   - **Knife:** Used to carve logs into arrow shafts, shortbows (unstrung), and longbows (unstrung). Keep one in your inventory.
   - **Bowstring:** Spun from flax on a spinning wheel. Used to string unstrung bows.
2. **Ammunition Components:**
   - **Feathers:** Gathered from chickens or bought in bulk from fishing shops. Added to arrow shafts to make headless arrows.
   - **Arrowheads:** Smelted and smithed from metal bars using the **Smithing** skill. Attached to headless arrows to complete the arrow.

## Bow Fletching Recipes

Carving and stringing bows is divided into two distinct XP-earning steps: **cutting** the unstrung bow, and then **stringing** it with a bowstring.

| Log Tier | Level Required | Shortbow (u) XP | Longbow (u) XP | Strung Shortbow XP | Strung Longbow XP |
|---|---|---|---|---|---|
| **Normal Logs** | 5 (Short) / 10 (Long) | 5.0 | 10.0 | 5.0 | 10.0 |
| **Oak Logs** | 20 (Short) / 25 (Long) | 16.5 | 25.0 | 16.5 | 25.0 |
| **Willow Logs** | 35 (Short) / 40 (Long) | 33.3 | 41.5 | 33.3 | 41.5 |
| **Maple Logs** | 50 (Short) / 55 (Long) | 50.0 | 58.3 | 50.0 | 58.3 |
| **Yew Logs** | 65 (Short) / 70 (Long) | 67.5 | 75.0 | 67.5 | 75.0 |
| **Magic Logs** | 80 (Short) / 85 (Long) | 83.3 | 91.5 | 83.3 | 91.5 |

*(u) denotes an unstrung bow. Normal logs also craft **Arrow Shafts** at level 1, awarding 5.0 XP per log and yielding 15 shafts.*

## Arrow Fletching Recipes

Arrow crafting is performed in batches of **15**. Attach feathers to arrow shafts first to make headless arrows, then apply arrowheads.

| Arrowhead Tier | Level Required | XP Per Batch (15) | Ingredients Required (per batch) |
|---|---|---|---|
| **Feather (Headless)** | 1 | 15.0 | 15 Arrow Shafts + 15 Feathers |
| **Bronze** | 1 | 39.0 | 15 Headless Arrows + 15 Bronze Arrowheads |
| **Iron** | 15 | 86.0 | 15 Headless Arrows + 15 Iron Arrowheads |
| **Steel** | 30 | 142.5 | 15 Headless Arrows + 15 Steel Arrowheads |
| **Mithril** | 45 | 225.0 | 15 Headless Arrows + 15 Mithril Arrowheads |
| **Adamant** | 60 | 315.0 | 15 Headless Arrows + 15 Adamant Arrowheads |
| **Rune** | 75 | 420.0 | 15 Headless Arrows + 15 Rune Arrowheads |

## Fletching Workflows

### How To Craft Bows

1. Ensure you have a **Knife** in your inventory.
2. Fill the rest of your inventory with logs of your chosen tier (e.g. Normal or Oak logs).
3. Use the **Knife** on the **Logs**.
4. In the chat interface, select the bow you wish to make (Shortbow or Longbow) and choose the batch quantity (e.g., `Make X` or `Make All`).
5. Your character will carve the logs into unstrung bows.
6. Once the inventory is filled with unstrung bows, retrieve an equal number of **Bowstrings** from your bank.
7. Use a **Bowstring** on an **Unstrung Bow** to string it. This auto-repeats for all bows in your inventory.

### How To Craft Arrows

1. Retrieve **Arrow Shafts** and **Feathers** from your bank (both are stackable, so you can carry thousands at once).
2. Use the **Feathers** on the **Arrow Shafts** to make **Headless Arrows**. This happens in rapid batches of 15.
3. Retrieve **Arrowheads** of your metal tier from your bank.
4. Use the **Arrowheads** on the **Headless Arrows** to finish the arrows.

## Failure Modes And Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| `You need a Fletching level of...` | Level too low | Fletch lower-tier bows or arrows (e.g., normal arrow shafts) until your level rises to meet the recipe requirements. |
| `You do not have the necessary ingredients.` | Missing components | Double check your inventory. Arrowhead attachment requires *headless* arrows, not bare arrow shafts. |
| Use Knife on logs but nothing happens | Missing tool or wrong order | Make sure you have a Knife in inventory. Click the Knife first, then click the Logs. |
| Bow stringing stops after one bow | Out of bowstrings | Ensure you have an equal count of unstrung bows and bowstrings in your inventory. |
| Arrow crafting didn't award XP | Level check failed | Confirm your level matches the metal tier of arrowheads you are trying to attach. |

## Success Signals

- Character performed a shaving/whittling animation.
- Fletching sound effect playing.
- `You carefully cut the wood into a [bow type]` in the chat box.
- Unstrung/strung bow or arrows appearing in your inventory.
- Fletching XP logged in your progress file (`progress.jsonl`).

## When To Ask For Help

Speak publicly or message a peer if:
- You are short on feathers or arrowheads: *"Buying feathers 5gp each or bronze arrowheads in bulk at Lumbridge!"*
- You need a woodcutter to supply you with logs: *"Will fletch your oak/willow logs into unstrung bows for free near Draynor bank!"*
- You want to trade your strung bows to an active High Alchemist or trader for GP: *"Selling Willow Longbows 100gp each!"*

---

## Cross-references

- **Woodcutting**: Woodcutting is the source of all logs used for Fletching. See `skills/woodcutting.md`.
- **Combat (Ranged)**: Fletching is the primary provider of ranged weaponry and ammunition. See `skills/combat.md`.
- **Server Fletching impl**: `feat/skill-fletching.md`.
