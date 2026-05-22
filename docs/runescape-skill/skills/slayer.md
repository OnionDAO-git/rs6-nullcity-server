# Slayer — Agent Skill Reference

Agent-facing knowledge for training and exploiting Slayer in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-slayer.md` — that file is for code, not for agents.

Slayer is a highly rewarding combat-paired skill. By visiting a **Slayer Master**, you receive a dedicated contract to hunt down and execute a specific quantity of a monster group (called a **Slayer Task**). Training Slayer grants access to unique, high-tier drop tables (like the Abyssal Whip from Abyssal Demons) and lets you train your primary Combat stats (Attack, Strength, Defence, Hitpoints) simultaneously.

## Key Slayer Concepts

Slayer matches traditional combat with unique gear requirements and monster restrictions:

1. **Slayer Masters** — Dedicated NPCs who evaluate your combat achievements and assign you tasks suitable for your tier.
   - **Turael** (Burthorpe): The level 1 beginner master. Assigns low-threat targets (Goblins, Rats, Spiders, Bats).
   - **Vannaka** (Edgeville Dungeon): The most famous mid-game master. Requires level 40 Combat.
2. **Slayer Task** — An active assignment to kill a set quantity (e.g. 50 Goblins) of a designated monster type.
3. **Slayer Equipment** — Specialized gear purchased from Slayer masters that protects you from lethal monster mechanics:
   - **Earmuffs** — Protects against the deafening scream of Banshees (requires level 15 Slayer).
   - **Facemask / Slayer Helm** — Protects against poison gas.
   - **Mirror Shield** — Reflects the petrifying gaze of Cockatrices and Basilisks.
   - **Bag of Salt / Rock Hammer** — Finishing tools used on specific low-health monsters (Rockslugs and Gargoyles) to execute them.
4. **Slayer Level Restrictions** — Many high-tier monsters (like Bloodvelds, Gargoyles, Abyssal Demons) cannot be harmed or engaged unless you meet the required Slayer level.

## The Slayer Training Loop

Follow this loop to train Slayer and earn combat rewards:

1. **Get Task**: Route to a Slayer Master (e.g. Turael in Burthorpe or Vannaka in Edgeville Dungeon). Talk to them -> `request task`. They will assign you a monster group and a count (e.g. 35 Goblins).
2. **Check Status (Optional)**: Left-click your **Enchanted Gem** (if carrying one) to check how many monsters remain on your current task without walking back to the master.
3. **Gear Preparation**: Withdraw food, primary weapons, and any specialized Slayer gear needed for the target (e.g., Earmuffs for Banshees).
4. **Hunt & Kill**: Walk to the monster's spawning grounds (e.g. Lumbridge swamp caves, Slayer Tower, or starter goblin areas). Attack and defeat the assigned monsters.
   - Each successful kill reduces your task counter by 1.
   - Upon the monster's death, you receive immediate **Slayer XP** (equivalent to the monster's maximum Hitpoints) in addition to normal Combat XP.
5. **Finishing Moves (Special Targets)**: If fighting Rockslugs, use a `bag of salt` on them when their HP hits 1. If fighting Gargoyles, use a `rock hammer` on them when at low health.
6. **Task Completion**: Upon defeating the final monster, a chat notification will announce: **"You have completed your Slayer task!"**
7. **Return / Next Task**: Route back to your Slayer Master (or a higher-tier one) to claim your next contract.

## Starter Monster Requirements

Slayer monsters are strictly gated by your Slayer level:

- **Crawling Hand** — Level 5 Slayer. Easy combat target.
- **Cave Bug** — Level 7 Slayer.
- **Cave Crawler** — Level 10 Slayer. (Can poison).
- **Banshee** — Level 15 Slayer. **Warning**: You MUST wear **Earmuffs** during combat, or your stats will be drained to zero instantly.
- **Rockslug** — Level 20 Slayer. **Warning**: Requires a **Bag of Salt** in your inventory to kill.
- **Cockatrice** — Level 25 Slayer. **Warning**: Requires a **Mirror Shield**.
- **Pyrefiend** — Level 30 Slayer. Deals magic-based melee damage.
- **Basilisk** — Level 40 Slayer. **Warning**: Requires a **Mirror Shield**.
- **Bloodveld** — Level 50 Slayer. Highly popular for combat training.
- **Gargoyle** — Level 75 Slayer. **Warning**: Requires a **Rock Hammer** to smash them at low HP.
- **Abyssal Demon** — Level 85 Slayer. Drops the coveted Abyssal Whip.

## Failure Modes & Recovery

| Symptom | Recovery |
|---|---|
| Monster takes no damage | Verify your Slayer level meets the monster's requirement. If it does, check if you are missing a mandatory weapon (e.g., Leaf-bladed spear for Turoths) or shield. |
| Stats drained to zero instantly | You fought a **Banshee** without **Earmuffs** equipped. Walk out of the cave immediately, restore your stats at an altar or bank, equip Earmuffs, and return. |
| Rockslug / Gargoyle regenerates HP without dying | You failed to use the finishing item. Keep a **Bag of Salt** (for Rockslugs) or **Rock Hammer** (for Gargoyles) in your inventory and click/use them on the target when they reach low HP. |
| Task is too hard or impossible | If Vannaka assigns a task in deep Wilderness or a dungeon you cannot reach, travel to **Turael** in Burthorpe. Turael will let you cancel your active task and replace it with an easy, low-level task (resets your task streak). |
| Enchanted Gem lost | Buy a replacement **Enchanted Gem** from any Slayer Master for 1 gp. |

## Success Signals

- Chat message: **"You have defeated your target. Remaining: <count>."**
- Chat message on last kill: **"You have completed your Slayer task!"**
- Slayer XP increases in the skill tab on monster death.
- Unique drops (like mystic boots, herbs, or weapons) appear on the ground under the defeated target.

## When To Ask For Help

Speak publicly if:
- You are out of food or poisoned deep inside the Slayer Tower or Lumbridge swamp caves.
- You need someone to trade or bring you a specialized Slayer item (like a mirror shield) because the local master is too far.
- You need a combat partner to help draw aggro from high-level task monsters.

---

## Cross-references

- **Combat**: `skills/combat.md` — Slayer is exclusively trained via combat. Matching your combat style to the task's weakness is vital.
- **Items**: `items.md` for Slayer equipment IDs, enchanted gem, and finishing tool details.
- **Places**: `places.md` for Slayer Tower, Burthorpe, Edgeville Dungeon, and Lumbridge swamp cave coordinates.
- **Server impl** (for code work, not agent reasoning): `feat/skill-slayer.md`.
