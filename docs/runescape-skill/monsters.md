# Starter Monsters — Agent Combat Reference

Agent-facing knowledge for fighting monsters in the 2006 RuneJS world (revision 435). Pair with `skills/combat.md` for combat mechanics, `skills/ranged.md` and `skills/magic.md` for non-melee approaches, `places/` for spawn locations, and `items.md` for drop value lookups.

## How To Use This Reference

Levels listed are approximate combat levels as the engine reports them. HP is the hitpoint pool you must whittle to zero to score the kill. Aggressive monsters will attack on sight if you stand within their combat range and your combat level is low enough to register as prey; passive monsters wait for you to swing first. The training viability column on each entry calls out the realistic level band where the monster is worth fighting — outside that band you are wasting time or risking death.

## Combat Safety Ladder

Never engage a monster whose combat level is more than 2x your own, always carry food before any swing, and never cross the wilderness ditch unless explicitly told.

## Level 1-2 Starter Monsters

| Monster | Combat Level | HP | Max Hit | Aggressive? | Location |
|---|---|---|---|---|---|
| Chicken | 1 | 3 | 1 | Passive | Lumbridge farm 3232,3299; Falador farm |
| Rat | 1 | 2 | 1 | Passive | Lumbridge cellar, Varrock sewers |
| Cow | 2 | 8 | 1 | Passive | Lumbridge cow field 3253,3275; Falador cow field |
| Cow Calf | 2 | 8 | 1 | Passive | Same as cow |
| Man / Woman | 2 | 7 | 1 | Passive | Cities (Lumbridge, Varrock); drops coins |

### Chicken

- Drops: `rs:feather`, `rs:raw_chicken`, `rs:bones`, occasional eggs.
- Why fight: training Combat skills 1-5; feathers are stackable and useful for Fletching arrows.
- Approach: walk into the Lumbridge farm coop, right-click chicken → `attack`. Auto-retaliate handles the rest. Loot bones + feathers.
- Stop conditions: HP at 80%+, inventory has 20+ feathers banked or you have 100+ bones, or you reach Attack 5.

### Rat

- Drops: `rs:bones`, sometimes `rs:raw_rat_meat`.
- Best for: lowest-HP target = fastest kills for beginner Combat.
- Approach: Lumbridge cellar (trap door near the castle bank) or Varrock sewers.
- Stop conditions: reach Attack 3-5, then graduate to cows.

### Cow

- Drops: `rs:cowhide` (no G.E. in 2006 — tan to leather at the Al-Kharid tanner for ~5gp each, then craft into leather armour), `rs:raw_beef`, `rs:bones`.
- Why fight: one-stop shop for Combat XP + Crafting (cowhide → leather → soft leather) and food (cook beef → 3 HP heal).
- Approach: Lumbridge cow field east of the castle. Cows often crowd — pick one, attack, finish before others wander in (they will not aggro, but pace yourself).
- Stop conditions: 20-30 cowhide banked, or you've trained combat to 5-10.

### Man / Woman

- Drops: small `rs:coins` piles, occasional bronze items.
- Why fight: starter coin source if you are stuck with no inventory and need to fund shop tools.
- Approach: any city street. Be aware that nearby guards (Varrock especially) will retaliate if you attack civilians in their line of sight.

## Level 2-5 Mid-Starter Monsters

| Monster | Combat Level | HP | Max Hit | Aggressive? | Location |
|---|---|---|---|---|---|
| Goblin (level 2) | 2 | 5 | 1 | Aggressive (low-level only) | Lumbridge goblin houses; Goblin Village north of Falador |
| Goblin (level 5) | 5 | 12 | 2 | Aggressive | Goblin Village; mixed-level spawns |
| Imp | 2 | 8 | 1 | Passive | Wandering everywhere; rare to fight intentionally |

### Goblin

- Drops: `rs:bones` always; sometimes `rs:bronze_dagger`, `rs:bronze_spear`, `rs:copper_ore`, `rs:raw_rat_meat`, small coin piles.
- Why fight: useful Combat training step up from cows; loot bronze gear you can wield, sell, or smelt down.
- Approach: Goblin Village around `2956, 3500` (north of Falador). Multiple spawn levels mixed — be ready to retreat.
- Safety: avoid level 5 goblins until your combat is at least 4. Level 2 goblins are fine at combat 2-3.

### Imp

- Drops: small chance of `rs:beads` (red / yellow / black / white — needed for the Imp Catcher quest), small coins.
- Why fight: usually NOT worth it; very low XP, rarely killed intentionally except for Imp Catcher.
- Approach: imps teleport between tiles, so chase only if you can land a Magic spell before they vanish.

## Level 6-10 Caution Monsters

| Monster | Combat Level | HP | Max Hit | Aggressive? | Location |
|---|---|---|---|---|---|
| Giant Rat | 6 | 7 | 1 | Aggressive | Lumbridge cellar (lower); Wilderness fringe; some lairs |
| Highwayman | 6 | 12 | 2 | Aggressive | South of Falador on road to Port Sarim; wears a black mask |
| Dark Wizard | 7-20 | 17-44 | varies | Aggressive (magic ranged) | Dark Wizards' Tower south of Varrock |
| Druid | 7 | 28 | 3 | Aggressive | Taverley northwest of Falador |

### Giant Rat

- Drops: `rs:bones` always.
- Why fight: Combat training step beyond goblin once you're combat 6+. Watch HP closely; their hits stack when multiple aggro.
- Approach: avoid until combat 8+; use food and check an escape route before engaging in cellars.

### Highwayman

- Drops: `rs:coins` (usually 5-25), sometimes nothing.
- Why fight: profitable at low levels for starter cash. The black mask is a cosmetic item.
- Approach: south of Falador on the road. Stand in clearings, not in their attack arcs. Bring 3-5 cooked shrimp.
- Stop conditions: 100+ gp accumulated or you've taken too much damage.

### Dark Wizard

- Drops: `rs:bones`, occasional runes (Air / Water / Earth / Fire / Mind, low chance Chaos), sometimes black robes.
- Why fight: rune drops fund Magic training; black robes are mage equipment.
- Approach: Dark Wizards' Tower south of Varrock. They cast spells from range — close to melee distance fast or safespot.
- Safety: avoid until combat 15+ unless you can safespot with Ranged or Magic.

### Druid

- Drops: `rs:herb (unidentified)` — useful for Herblore.
- Why fight: starter herb source for Herblore training.
- Approach: Taverley druid circle. Watch HP; their max hit can be 3 and they cluster.

## Avoid Until High Level

| Monster | Combat Level | Why Avoid |
|---|---|---|
| Hill Giant | 28 | High HP (35), max hit 4. Drops `rs:big_bones` (Prayer) + `rs:limpwurt_root` (Herblore). Fight only at combat 30+ with food. |
| Moss Giant | 42 | Drops `rs:big_bones`. Combat 45+ recommended. |
| Lesser Demon | 82 | Quest-only target until very high level. |
| Greater Demon | 92 | Quest-only target until very high level. |
| Anything in Wilderness | varies | Player-vs-player attack zone; lose items on death. NEVER engage past the ditch unless explicitly told. |

## Combat Triangle Reminders

- **Melee** (chicken, cow, goblin): use scimitar + bronze / iron armour. See `skills/combat.md`.
- **Ranged** (chicken, cow, rat) is excellent with a shortbow + bronze arrows. See `skills/ranged.md`.
- **Magic** (chicken, cow, rat) with Wind Strike works at level 1. See `skills/magic.md`.
- **Prayer**: ALWAYS bury bones after kills. See `skills/prayer.md`.

## Drop-Value Recovery

1. Bones go to Prayer training (bury OR offer at altar).
2. Hides / feathers / raw meat feed crafting / cooking / fletching loops.
3. Bronze items from goblins: keep one to wield, drop the rest unless you want to bank.
4. Coins: bank or spend on shop tools / food restock.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| HP dropping fast (multi-monster aggro) | Run to a safe POI (Lumbridge bank, embassy). |
| No food left mid-fight | Disengage immediately; route to fishing spot or shop. See `items.md` § Recovery Heuristics. |
| Killed unexpectedly | Respawn in Lumbridge; bank for spare gear or buy a bronze scimitar at the Varrock Sword Shop. |
| Target keeps walking | Pick a new target within 5 tiles; do not chase across regions. |
| Aggressive monster locked-on outside intended fight | Run toward a player-safe POI (Lumbridge Castle, embassy). |

## When To Ask For Help

Speak publicly if:

- You're stuck on a specific monster and need tips: *"Anyone know a safespot for dark wizards?"*
- Need a specific weapon or food and a nearby player might trade: *"Need 10 cooked lobster — anyone selling?"*
- You're being PvP'd in wilderness (don't go there without permission).

---

## Cross-references

- `skills/combat.md` — combat mechanics, eating, retreat.
- `skills/ranged.md`, `skills/magic.md` — alternative damage types.
- `skills/prayer.md` — bone burying.
- `skills/cooking.md` — turn raw meat into food.
- `skills/crafting.md` — cowhide → leather.
- `places/lumbridge.md`, `places/falador.md`, `places/varrock.md` — region NPCs and amenities.
- `items.md` — exact drop and shop prices.
- `npcs/lumbridge.md`, `npcs/varrock.md`, `npcs/draynor-and-wizards-tower.md` — friendly NPCs (not monsters).
