# Combat — Agent Skill Reference

Agent-facing knowledge for fighting safely in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-combat.md` — that file is for code, not for agents.

Combat in RuneScape covers seven skills: **Attack**, **Strength**, **Defence**, **Hitpoints**, **Ranged**, **Magic**, **Prayer**. Melee XP routes through Attack / Strength / Defence based on the chosen combat style; Hitpoints accrues passively from any combat XP.

## Pick A Safe Target

1. Prefer level-appropriate aggressive low-HP targets near the spawn anchor.
2. Safe starter targets in the Lumbridge area: **chicken** (level 1, 3 HP), **rat** (level 1, 2 HP), **cow** (level 2, 8 HP), **goblin** (level 2-5, 5-12 HP).
3. Avoid: **giant rat** (level 6) until combat level ≥10, **dark wizard**, **highwayman**, anything labeled "(level XX+)" where XX is more than 2× your combat level.
4. NEVER engage anything past the wilderness ditch unless explicitly told. The wilderness allows player-vs-player attacks and dropped items.
5. If the only visible target is too strong, walk to a new area before announcing failure.

## Engage And Sustain

1. Right-click the target → `attack`. Wait for combat to begin (HP bar appears).
2. Auto-retaliate handles most fights — let the combat loop run.
3. Watch HP after every hit message:
   - HP > 60% of max: keep fighting.
   - HP 30-60%: finish current swing, then eat.
   - HP < 30%: eat immediately, even mid-swing.
4. Switch combat style if XP allocation is wrong (Attack accuracy, Strength damage, Defence durability, Controlled splits all three).
5. If the target moves out of range, walk back to it once; if it keeps moving, switch targets.

## Eat And Heal

1. Eat one food item per heal cycle. Food heal values to know:
   - **Shrimp** (raw → cooked): heals 3
   - **Sardine**: 4
   - **Anchovies**: 1 each (eat several)
   - **Trout**: 7
   - **Salmon**: 9
   - **Lobster**: 12
   - **Swordfish**: 14
   - **Tuna**: 10
   - **Cake** (3 bites): 4 per bite
2. Always carry food before any combat. If inventory has none, route to a fishing spot, range, or shop first.
3. Burnt food has no heal value — discard it.
4. Eating takes one tick and does NOT interrupt auto-retaliate.

## Run When Outmatched

1. Trigger conditions: HP < 20%, no food left, **or** an unexpected aggressor of much higher level.
2. Click far away (toward a known safe POI: Lumbridge bank, embassy atrium, faction home).
3. Run mode if energy > 30% (toggle the run icon).
4. While moving, narrate publicly: *"Retreating — too strong / out of food / low HP."*
5. Once safe, log the encounter as a memory entry so the Brain doesn't immediately re-engage.

## Loot And Tidy

1. Most starter monsters drop **bones** (always pick up if inventory has space — see Prayer workflow).
2. Cow drops: cowhide, raw beef, bones. Chicken: feathers, raw chicken, bones.
3. Goblin drops: bronze items (dagger, spear), copper ore, raw rat meat, or coins.
4. Only loot what you have inventory space for, and only when no enemy is hitting you.
5. Drop tradeable junk (e.g., bronze daggers if you already have one) before banking trips.

## Combat Styles And XP

| Style | XP routing | When to use |
|---|---|---|
| Accurate | Attack only | Hit reliability matters; early levels |
| Aggressive | Strength only | Max damage; once Attack ≥10 |
| Defensive | Defence only | Survivability training; once Strength ≥10 |
| Controlled (spear) | All three evenly | Balanced; spears only |

Change style via the combat icon in the interface. Tell the player which style you're using when reporting status.

## Weapons By Tier

Starter → mid progression:

1. **Bronze** (level 1): default starting kit. Bronze dagger, bronze sword, bronze axe (also a hatchet substitute).
2. **Iron** (level 1, light upgrade): iron scimitar in the Varrock Sword Shop for ~50gp.
3. **Steel** (level 5 Attack): noticeably faster kills than bronze/iron.
4. **Mithril** (level 20 Attack): mining + smithing pays off here; mithril scimitar is a long-time favorite.
5. **Adamant** (level 30 Attack): noticeable jump in damage.
6. **Rune** (level 40 Attack): mid-game baseline.

Stick to scimitars for melee — fast attack speed beats slashing alternatives at every tier.

## Prayer Basics (paired with combat)

1. Pray for **Burst of Strength** (level 4 Prayer, +5% Strength) on tough fights.
2. Pray for **Clarity of Thought** (level 7, +5% Attack accuracy) when missing too much.
3. Pray for **Sharp Eye** for Ranged, **Mystic Will** for Magic at low levels.
4. Prayers drain Prayer points. To restore: pray at an altar (Lumbridge Church, Edgeville Monastery).
5. Bury bones immediately after combat to bank Prayer XP (see Prayer workflow).

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| HP at 0 (death imminent) | Stop attacking. Eat the highest-heal food in inventory. If none, type `retreating — dying` and run to a bank/altar. |
| Target keeps walking away | Engage once more; if it keeps moving, mark target invalid and pick a new one within 5 tiles. |
| No food in inventory | Do NOT engage. Route to fishing/cooking/shop first. Announce: *"No food — restocking before combat."* |
| Lost weapon (death) | Bank for spare or buy bronze scimitar at Varrock Sword Shop. Combat without a weapon is unarmed and very slow. |
| Aggressive monster locked-on outside intended fight | Run toward a player-safe POI (Lumbridge Castle, embassy). Don't fight back; just disengage by distance. |

## Success Signals

- Hit messages appearing in chat (damage numbers, "You miss"...).
- XP gains in combat skills' tab.
- Target HP bar shrinking.
- Bones / loot appearing where the target was.
- Combat XP histogram shows progress in `progress.jsonl`.

## When To Ask For Help

Speak publicly if:

- A specific item is missing (food, weapon, charged jewelry) and a nearby player might have one.
- A fight is blocked by an obstacle (gate, door, water).
- A player has been hostile or named you in chat — clarify before engaging back.

Use phrases the helper can act on: *"I need food — anyone selling cooked shrimp?"*, not *"I'm hungry."*

---

## Cross-references

- **Prayer**: pair with combat; bury bones for XP. See Prayer workflow (forthcoming `skills/prayer.md`).
- **Cooking**: feeds combat. See `starter-workflows.md` § Catch Shrimp + Make A Fire.
- **Fishing**: supplies food. See `starter-workflows.md` § Catch Shrimp.
- **Server combat impl** (for code work, not agent reasoning): `feat/skill-combat.md`.
