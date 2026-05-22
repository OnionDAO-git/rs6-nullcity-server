# Woodcutting — Agent Skill Reference

Agent-facing playbook for harvesting lumber in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-woodcutting.md` — that file is for code, not for agents.

Woodcutting is a gathering skill that allows you to chop down trees using an axe (hatchet) to obtain logs and bird nests. The logs you harvest feed directly into **Firemaking** and **Fletching**.

## Pick A Tree

Choose a tree based on your Woodcutting level and location. Chopping higher-tier trees yields more XP per log but takes longer per attempt.

| Tree Type | Level Required | XP Per Log | Primary Locations |
|---|---|---|---|
| **Normal / Dead** | 1 | 25.0 | Everywhere (Lumbridge Castle courtyard, Varrock streets) |
| **Achey** | 1 | 25.0 | Feldip Hills (south of Yanille) |
| **Oak** | 15 | 37.5 | Behind Lumbridge Castle, Varrock West bank, Draynor Village |
| **Willow** | 30 | 67.5 | Draynor Village bank (extremely close to bank), Lumbridge River |
| **Teak** | 35 | 85.0 | Uzer, Jungle areas |
| **Maple** | 45 | 100.0 | Sinclair Mansion (north of Camelot), Seers' Village |
| **Mahogany** | 50 | 125.0 | Jungle areas, Ape Atoll |
| **Yew** | 60 | 175.0 | South of Falador, behind Varrock Palace, Lumbridge Churchyard |
| **Magic** | 75 | 250.0 | Mage Training Arena (Al Kharid), Seers' Village |

## Equipment And Hatchets

To chop trees, you must have an axe (hatchet) in your inventory or equipped in your weapon slot. 

1. **Wield vs. Inventory:** Keeping the axe in your inventory only requires the Woodcutting level. Wielding the axe requires the matching **Attack** level (e.g., 40 Attack for a Rune axe). Keeping it in your inventory is the recommended default.
2. **Axe Tiers:** Always use the best axe your Woodcutting level allows to maximize chop speed:
   - **Bronze Axe** (Level 1 Woodcutting)
   - **Iron Axe** (Level 1 Woodcutting)
   - **Steel Axe** (Level 6 Woodcutting)
   - **Black Axe** (Level 11 Woodcutting)
   - **Mithril Axe** (Level 21 Woodcutting)
   - **Adamant Axe** (Level 31 Woodcutting)
   - **Rune Axe** (Level 41 Woodcutting)
   - **Dragon Axe** (Level 61 Woodcutting)

## Chopping Loop

1. Equip your axe or ensure it is in your inventory.
2. Walk to the tree. Right-click the tree → `Chop down` or `Chop`.
3. Your character will begin swinging the axe (chopping animation).
4. The action is an auto-repeating loop: stay still and let your character continue chopping.
5. The loop automatically stops when:
   - Your inventory is completely full of logs.
   - The tree is depleted and turns into a temporary stump.
   - You click to move or engage in another interaction.

## Bird Nests

While chopping trees, a **bird's nest** may occasionally fall out of the tree onto the ground with a rustling sound.

1. **Act Fast:** Drop everything you are doing and pick up the nest immediately! World items expire quickly.
2. **Check the Nest:** Search the nest in your inventory to see what is inside:
   - **Colored Eggs** (Red, Blue, Green): Keep for special uses or show them off.
   - **Seeds** (Acorn, Willow, Maple, Yew, Magic): Feeds Farming.
   - **Jewelry** (Gold/Silver rings): Can be sold or worn.
3. Once searched, you can drop the empty nest or keep it as a brewing ingredient.

## Failure Modes And Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| `You do not have an axe...` | Missing tool | Walk to the nearest bank to retrieve your axe, or buy a Bronze Axe from Bob's Axes in southern Lumbridge. |
| `You need a Woodcutting level of...` | Level too low | Chop lower-tier trees (e.g. Normal or Oak) until your Woodcutting level matches the tree. |
| Character swings but no logs | Low success rate | Ensure you are using the best possible axe for your level. Normal trees are fast, but Oaks/Willows take patience. |
| Chop stops immediately | Full inventory | Walk to the nearest bank to store your logs, burn them using Firemaking, or fletch them using Fletching. |
| Tree vanishes / turns to stump | Tree depleted | Wait for the tree to respawn (Oaks respawn quickly, Yews take longer), or walk to a nearby tree of the same type. |

## Success Signals

- Character repeatedly performing the axe-swinging animation.
- Rustling chopping sounds playing.
- `You get some [type] logs.` appearing in the chat box.
- A new log icon appearing in your inventory.
- Woodcutting XP showing up in your progress log (`progress.jsonl`).

## When To Ask For Help

Speak publicly or message a peer if:
- You are stuck behind a gate or fence near a premium tree grove (e.g., the Varrock Palace Yews or Draynor Willows).
- You need a better axe but lack the GP or Smithing level to obtain one: *"Looking to buy an Iron or Steel hatchet near Lumbridge!"*
- Your inventory is full of high-value logs and you want to trade them to a player training Fletching or Firemaking instead of banking.

---

## Cross-references

- **Firemaking**: Use a tinderbox to burn logs on the spot for rapid Firemaking XP. See `skills/firemaking.md`.
- **Fletching**: Use a knife on logs to craft arrows, bows, and shafts. See `skills/fletching.md`.
- **World Geography**: Refer to `places.md` for banking locations near major woodcutting groves (like Draynor bank or Varrock East bank).
- **Server Woodcutting impl**: `feat/skill-woodcutting.md`.
