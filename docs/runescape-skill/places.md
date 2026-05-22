# World Geography & Places Index

The concise, agent-readable reference for navigating regions, cities, and safe/unsafe zones in the 2006 RuneJS world (revision 435).

---

## 1. Regional Playbooks (Detailed Regional Maps)

Use the regional playbooks in the `places/` directory to lookup coordinate lists, local amenities (banks, furnaces, shops), high-efficiency training spots, and safety boundaries.

| Region / Place | Key Features | Safety Level | Playbook Document |
|---|---|---|---|
| **Lumbridge** | Castle layout, general store recovery tools, river net spots, cooking range. | **100% Safe** (Default Spawn) | [lumbridge.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/lumbridge.md) |
| **Varrock** | East & West banks, Aubury's Rune Shop, Flynn's Sword Shop, mine layouts. | **Safe** (Except Wilderness boundary) | [varrock.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/varrock.md) |
| **Falador** | East & West banks, Dwarven mine ladders, Mining Guild, Yew trees, armor shops. | **Safe** | [falador.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/falador.md) |
| **Edgeville** | Fast bank-to-furnace path, Abbot Langley Monastery prayer altar, Yew logging. | **Safe Borderland** | [edgeville.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/edgeville.md) |
| **Al-Kharid** | Warrior courtyard combat training, leather tanner loops, Karim's kebabs. | **Safe** | [al-kharid.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/al-kharid.md) |
| **Draynor Village** | 5-tile bank-to-willow log runs, Diango's Chronicle teleport, Master Farmer. | **Safe** | [draynor-village.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/draynor-village.md) |
| **The Wilderness** | PvP Combat level brackets, aggressive high-level monsters, ditch boundaries. | **DANGEROUS (PvP Zone)** | [wilderness.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/places/wilderness.md) |

---

## 2. Core Heuristics & Starter Guidelines

### Lumbridge And Visibility Heuristics
- **Lumbridge is the default human-debugging anchor**: When the resident is hard to find or stuck, it should bias toward returning to a known visible anchor in Lumbridge or explain where it is in chat.
- **Report current status**: Report current goal, nearest landmark, and blocker in public chat when asked "status" or when stuck.
- **Anchor returns**: Return near the configured starting/visibility point periodically during long autonomous runs.
- **Prefer open areas**: Prefer open areas for chopping, firemaking, and live demos so pathing failures are obvious and recoverable.

### Tool Sources & Acquisition Heuristics
- **Engine-local shop prioritization**: Starter tool acquisition should prefer engine-local shop/config data.
- **Shop Recovery targets**: The Lumbridge general store and other configured shops are candidate recovery targets when a goal requires a missing tinderbox, axe, pickaxe, fishing net, bait, or food.
- **Shop success signals**:
  - Shop/trade interface opens successfully.
  - Inventory gains the requested tool.
  - Resident explains that the item is unavailable instead of repeatedly trying the same impossible action.

### Starter Heuristic Targets
- **Woodcutting**: Trees or dead trees for logs.
- **Fishing**: Net-capable fishing spots for raw shrimp.
- **Combat**: Chickens, cows, goblins, or rats only when safe and healthy.
- **Prayer**: Bones from inventory or safe loot for prayer.
- **Rule of thumb**: Avoid escalating to quests, dangerous travel, or risky combat until the benchmark and dashboard can show what happened.
