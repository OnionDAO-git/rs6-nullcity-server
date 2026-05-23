# Ranged — Agent Skill Reference

Agent-facing knowledge for fighting with bows, crossbows, and thrown weapons in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-ranged.md` if it exists — that file would be for code, not for agents. Pair with `skills/combat.md` for the combat triangle and `items.md` for ammo costs.

Ranged is one corner of the combat triangle (strong vs. Magic, weak vs. Melee). XP routes to **Ranged** (and **Hitpoints** passively) on every hit. Unlike melee, Ranged consumes ammo per shot — supply chain matters as much as the bow itself.

## Ranged Basics

1. Ranged uses **bows + arrows**, **crossbows + bolts**, or **thrown weapons** (knives, darts, javelins) to hit from 7-10 tiles away.
2. Open the inventory tab, equip the weapon + ammo, right-click target → `attack`. Auto-fire continues until ammo runs out or target dies.
3. Ammo drops on the ground when fired. Walk over the tile to pick it back up (no level requirement). Most arrows survive most shots.
4. Success signal: damage number appears over target, ammo count drops, Ranged XP gained.
5. Failure: "You do not have enough ammo" / "You need a Ranged level of X to wield this" / "You can't reach there" (re-position).

## Bows And Arrows

### Bow Tiers

| Bow | Level | Speed | Max Range | Source |
|---|---|---|---|---|
| Shortbow | 1 | Fast (4-tick) | 7 tiles | Lowe's Archery (Varrock), spawns |
| Longbow | 1 | Slow (6-tick) | 10 tiles | Lowe's Archery |
| Oak Shortbow | 5 | Fast | 7 | Fletching: oak logs + bowstring |
| Oak Longbow | 5 | Slow | 10 | Fletching |
| Willow Shortbow | 20 | Fast | 7 | Fletching |
| Willow Longbow | 20 | Slow | 10 | Fletching |
| Maple Shortbow | 30 | Fast | 7 | Fletching |
| Maple Longbow | 30 | Slow | 10 | Fletching |
| Yew Shortbow | 40 | Fast | 7 | Fletching |
| Yew Longbow | 40 | Slow | 10 | Solid mid-game pick |
| Magic Shortbow | 50 | Fast | 7 | Top non-quest shortbow |
| Magic Longbow | 50 | Slow | 10 | Fletching |

### Arrow Tiers

| Arrow | Level | Source | Notes |
|---|---|---|---|
| Bronze | 1 | Lowe's, spawns, drops | Cheap; weak |
| Iron | 1 | Lowe's, drops | Default early-game arrow |
| Steel | 5 | Smith / drops | Matches Oak bow tier |
| Mithril | 20 | Smith / drops | Matches Willow tier |
| Adamant | 30 | Smith / drops | Matches Maple tier |
| Rune | 40 | Smith (expensive) / drops | Top common arrow |

Rule of thumb: arrow tier should match or exceed bow tier — a Yew bow with bronze arrows wastes the bow's bonus.

## Crossbows And Bolts (brief)

1. **Crossbow** (level 1): slower than shortbows but usable one-handed (frees shield slot).
2. **Bronze Bolts** (level 1) through **Rune Bolts** (level 61) follow the same metal-tier progression.
3. Crossbows are niche in 2006; most rangers use shortbows. Pick a crossbow only if you specifically need a shield equipped for the Defence bonus.
4. Bolts stack the same as arrows; "use bolt on crossbow" or right-click → `wield` to equip.

## Thrown Weapons (brief)

1. **Knives**, **Darts**, **Javelins** in metal tiers (bronze→rune). Single-slot stackables.
2. Fastest attack speed (1-2 tick); great for low-HP rapid clears.
3. No bow needed — just equip the stack. The weapon and the ammo are the same item.
4. Throwing items do NOT always drop on the ground after a hit — budget more per session than you would for arrows.

## Training Routes

1. **Levels 1-20** — equip bronze shortbow + iron arrows. Shoot chickens (`3232, 3299`, Lumbridge farm) or cows in Lumbridge cow field. Loot dropped arrows.
2. **Levels 20-40** — willow shortbow + steel/mithril arrows. Train on cows, goblins, or low-level monsters in safe POIs.
3. **Levels 40-60** — yew shortbow + adamant arrows on yaks, dagannoths, or low-level demons. Use food / Prayer for survival.
4. **Levels 60-80+** — magic shortbow + rune arrows. Hill giants, moss giants, or chinchompa training in late game.
5. **Cannoneer setup** (advanced): dwarf multi-cannon scatters damage at any range tile. Expensive; use when training in monster crowds.

## Range Walking And Safespots

1. **Safespots**: a tile separated from the target by an unwalkable obstacle (rock, pillar, fence). The monster can't reach you while you fire freely.
2. Always check the path before engaging — if no safespot, the target will close to melee and you'll take damage.
3. Common starter safespots: behind the chicken-pen fence in Lumbridge farm; behind pillars in the Stronghold of Security; behind low rocks in the Wilderness.
4. Verify the safespot by waiting one full attack cycle without re-positioning — if the target stops closing, you're safe.

## Equipment And Ranged Bonus

1. **Leather Armour** (Coif, Vambraces, Body, Chaps): +ranged bonus, low Defence penalty. Coif at level 1, Studded at 20, Snakeskin at 30, Green/Blue/Red/Black D'hide at 40/50/60/70.
2. **Amulet of Power**: +6 ranged bonus, top non-quest neck slot.
3. **Ava's Accumulator** (post-Animal Magnetism): magnetically attracts fired arrows back to inventory. Saves 70-80% of ammo.
4. **Quivers** are NOT in 2006 — arrows go in inventory slots and the equip slot (ammo).
5. Activate **Sharp Eye** (Prayer level 7, +5% Ranged Attack) before the first shot of a serious session. See `skills/prayer.md`.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Out of ammo mid-fight | Switch to melee weapon (sword) or run to safety. Buy/loot ammo next. |
| "You need a Ranged level of X" | Train one tier below until you can wield the target bow. |
| Arrows not in equip slot | Re-equip the ammo via inventory right-click. |
| Target keeps closing the gap | Find a safespot or accept melee trade. Eat food. |
| Monster aggro spreads (multi-zone) | Move to a single-target tile or run to a safe POI. |
| Ammo not appearing on tile after fire | Some special bows (Crystal bow) don't drop arrows; most do — walk over the tile after combat. |

## Success Signals

- Damage numbers over target.
- Ammo count in inventory or equip slot drops.
- Ranged XP gained per hit (~4 XP per damage point).
- Ammo appears on the ground tile near the target when not using Ava's.
- Target HP bar shrinks.

## When To Ask For Help

Speak publicly if:

- Need a specific bow/arrow tier and a player might sell.
- Stuck without ammo near no shop.
- Looking for safespot help in an unfamiliar area.

Use phrases the helper can act on: *"Need 500 iron arrows — anyone selling?"*, not *"out of arrows."*

---

## Cross-references

- **Combat triangle**: `skills/combat.md` (melee + general combat), forthcoming `skills/magic.md`.
- **Fletching**: `skills/fletching.md` to craft your own bows + arrows.
- **Items**: `items.md` § Bows and Arrows for the canonical tier list.
- **NPCs**: `npcs/varrock.md` (Lowe's Archery Emporium).
