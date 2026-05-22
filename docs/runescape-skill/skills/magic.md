# Magic — Agent Skill Reference

Agent-facing knowledge for casting spells in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-magic.md` if it exists — that file would be for code, not for agents. Pair with `skills/combat.md` for the combat triangle and `items.md` for rune costs.

Magic is the third corner of the combat triangle (strong vs. Melee, weak to Ranged) and the only skill that doubles as a transit network. Casting consumes runes from the inventory; XP arrives the moment the spell resolves (damage, teleport, or utility effect). Treat Magic as a budget skill — every cast has a measurable rune cost, and the agent should know the price before committing.

## Spellbook Basics

1. Magic uses **runes** (consumable single-slot stackables) to cast spells from the spellbook (interface tab — Magic icon).
2. Three spell categories: **Combat spells** (damage NPCs/players), **Teleport spells** (move to fixed locations), **Utility spells** (alchemy, telegrab, lumbridge home tele).
3. Open the spellbook → click a spell name → if Magic level + runes are sufficient, the spell is cast. Auto-cast option available for combat.
4. Success signal: rune count drops, target takes damage (combat) or animation plays (utility/teleport).
5. Failure: "You do not have enough runes" / "You need a Magic level of X" / "You cannot teleport here" — read the message before retrying.

## Combat Spell Tiers

| Spell | Level | Runes | Max Hit | Notes |
|---|---|---|---|---|
| Wind Strike | 1 | 1 Air, 1 Mind | 2 | Cheapest. Train from level 1. |
| Water Strike | 5 | 1 Water, 1 Air, 1 Mind | 4 | |
| Earth Strike | 9 | 2 Earth, 1 Air, 1 Mind | 6 | |
| Fire Strike | 13 | 3 Fire, 2 Air, 1 Mind | 8 | |
| Wind Bolt | 17 | 2 Air, 1 Chaos | 9 | |
| Water Bolt | 23 | 2 Water, 2 Air, 1 Chaos | 10 | |
| Earth Bolt | 29 | 3 Earth, 2 Air, 1 Chaos | 11 | |
| Fire Bolt | 35 | 4 Fire, 3 Air, 1 Chaos | 12 | |
| Wind Blast | 41 | 3 Air, 1 Death | 13 | |
| Water Blast | 47 | 3 Water, 3 Air, 1 Death | 14 | |
| Earth Blast | 53 | 4 Earth, 3 Air, 1 Death | 15 | |
| Fire Blast | 59 | 5 Fire, 4 Air, 1 Death | 16 | |
| Wind Wave | 65 | 5 Air, 1 Blood | 17 | |
| Water Wave | 70 | 7 Water, 5 Air, 1 Blood | 18 | |
| Earth Wave | 75 | 7 Earth, 5 Air, 1 Blood | 19 | |
| Fire Wave | 80 | 7 Fire, 5 Air, 1 Blood | 20 | |

Within a tier, Fire > Earth > Water > Wind on max hit, but Fire is also the most rune-expensive. Pick the cheapest tier you can still kill the target with — overshooting damage burns runes that could fund another hour of training.

## Teleport Spells

| Spell | Level | Runes | Destination |
|---|---|---|---|
| Home Teleport | 1 | none (5-min cooldown) | Lumbridge spawn |
| Varrock Teleport | 25 | 1 Law, 3 Air, 1 Fire | Varrock Square |
| Lumbridge Teleport | 31 | 1 Law, 3 Air, 1 Earth | Lumbridge Castle courtyard |
| Falador Teleport | 37 | 1 Law, 3 Air, 1 Water | Falador Square |
| Camelot Teleport | 45 | 1 Law, 5 Air | Camelot |
| Ardougne Teleport | 51 | 2 Law, 2 Water (Plague City quest) | Ardougne |
| Watchtower Teleport | 58 | 2 Law, 2 Earth (Watchtower quest) | Watchtower |

Teleports cancel if the caster is in combat or moving — stand still, clear aggressors, then cast. Home Teleport is the universal emergency button; even an agent with 1 Magic can fall back to Lumbridge once every 5 minutes.

## Utility / Curse Spells

1. **Bones to Bananas** (level 15, 2 Earth, 2 Water, 1 Nature): converts every bone in inventory to a banana. Useful when no fire/altar nearby.
2. **Low Alchemy** (level 21, 3 Fire, 1 Nature): converts inventory item to coins at 40% of high-alch value. Slow XP, mediocre profit.
3. **High Alchemy** (level 55, 5 Fire, 1 Nature): converts item to 60% of merchant value coins. Standard money-maker.
4. **Telekinetic Grab** (level 33, 1 Air, 1 Law): grabs an item from a tile out of reach.
5. **Curses** (Confuse, Weaken, Curse, Vulnerability, Enfeeble, Stun): reduce target stats. Niche — usually skipped for direct damage.

## Training Routes

1. **Levels 1-13** (Strike spells): cast Wind/Water/Earth/Fire Strike on chickens, rats, cows. Cheap runes, slow but reliable.
2. **Levels 13-55** (Bolt → Blast): cast highest-tier Strike/Bolt on safe monsters until enough chaos/death runes affordable.
3. **Splashing** (early-mid game): equip negative-magic gear (e.g., full iron armor) → cast Curse spells repeatedly on a low-level target. Spells miss (0 damage) but yield ~1/5 the XP. Used by AFK trainers.
4. **High Alchemy** (level 55+): bank nature runes + low-value items (e.g., unstrung yew longbows). Alch every ~3 seconds. ~65k XP/hour, profits ~50-100 gp/cast.
5. **Splashing** considered borderline AFK; not appropriate when residents are roleplaying actively.

## Rune Sources (cross-ref items.md)

1. **Aubury's Rune Shop** (Varrock, see `npcs/varrock.md`) — stock: Air, Water, Earth, Fire, Mind, Body. Limited per-day stock.
2. **Lumbridge Magic shop** — minimal stock, restock slow.
3. **Runecrafting** — craft your own (see `skills/runecrafting.md`). Best for Air/Water/Earth/Fire from Rune Essence at altars.
4. **Drops from monsters** — Wizards drop runes occasionally; goblins drop bronze items only.
5. **Trade with other residents** — see `skills/trading.md`.

## Equipment And Magic Bonus

1. **Wizard Robes** (top + bottom): cheap, +3 to +5 magic bonus each.
2. **Staves** (Air/Water/Earth/Fire Staff): provide unlimited respective elemental runes when wielded. Buy from Zaff (Varrock).
3. **Amulet of Magic** / **Amulet of Power**: +10 magic bonus.
4. **Magic damage boost** is minimal in 2006 — pick the staff that saves the most expensive rune type for your spell.

A Fire Staff wielded while casting Fire Wave eliminates the 7 Fire rune cost per cast — that single equipment choice halves the per-cast price at high tiers. Always wield the staff matching the spell's most-used element.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| "You need a Magic level of X" | Train one tier below the target spell until you can cast it. |
| "You do not have enough runes" | Bank/buy more runes or switch to a cheaper spell. |
| Spell misses repeatedly (combat) | Switch to higher-bonus equipment or a higher-tier spell. |
| Target out of range | Walk closer (combat spells have ~8-tile range). |
| Spellbook tab doesn't open | Click the small Magic icon on the interface bar; do not double-click. |
| Teleport interrupted | Check for nearby combat — teleports cancel if you're in combat or moving. |

## Success Signals

- Damage number appears over target on combat-spell cast.
- Rune count in inventory drops by exact recipe amount.
- XP gain animation on Magic skill icon.
- Teleport: screen-fade + position change to fixed destination.
- High Alchemy: item leaves inventory, coins appear, XP gained.

## When To Ask For Help

Speak publicly if:

- Runes are needed: *"Anyone selling chaos runes? I can pay 100gp each."*
- Stuck on a quest requiring a specific spell.
- Aubury is missing or out of stock and you're far from Varrock.

Use phrases the helper can act on: *"Need 25 air runes — anyone in Varrock?"*, not *"out of runes."*

---

## Cross-references

- **Combat triangle**: `skills/combat.md` (melee + general combat), forthcoming `skills/ranged.md`.
- **Runecrafting**: `skills/runecrafting.md` for self-supply.
- **Items**: `items.md` § Runes for the canonical rune list.
- **NPCs**: `npcs/varrock.md` (Aubury, Zaff), `npcs/draynor-and-wizards-tower.md` (Mizgog, Sedridor).
