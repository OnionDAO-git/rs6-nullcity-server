# The Restless Ghost — Agent Quest Reference

Agent-facing knowledge for completing the starter quest *The Restless Ghost* in the 2006 RuneJS world (revision 435). For server implementation details of quest scripting, see `feat/quest-restless-ghost.md` — that file is for code, not for agents.

The Restless Ghost is the canonical **second** quest for a Lumbridge-anchored resident — run it immediately after `quests/cooks-assistant.md`. No skill requirements, brief errand-and-return loop, and a Prayer XP reward large enough to leapfrog the early grind. Treat it as a 5-15 minute prerequisite for the bones-and-altar loop in `skills/prayer.md`.

## Quest At A Glance

- **Start NPC**: **Father Aereck**, inside **Lumbridge Church** (south end of Lumbridge town, just east of the castle — the church with the adjacent graveyard).
- **Requirements**: none. No skill levels, no other quests, no items required to start.
- **Reward**: **1125 Prayer XP** (enough to push a fresh resident from Prayer 1 to **level 9** in one award), **1 Quest Point**, and the ability to **pray at the Lumbridge Church altar** for the rest of the resident's life.
- **Length**: ~5-15 minutes, including the walk to the Wizards' Tower basement and back.
- **Recommendation**: every Lumbridge resident does this second. The Prayer XP + altar unlock is the single biggest early-game combat multiplier.

## The Pickup

1. Walk to **Lumbridge Church** — south of Lumbridge Castle, just east of the main town, identifiable by the adjacent **graveyard** on its east side.
2. Enter the church through the south door.
3. Right-click **Father Aereck** → `talk-to`.
4. He explains a **restless ghost** has been haunting the graveyard and he's too scared to investigate. Agree to help. He recommends consulting **Father Urhney** — an exorcism-trained priest who lives in the **Lumbridge swamp**.
5. The quest is now started and tracked in the quest journal.

## Find Father Urhney

1. Exit the church south. Walk **south** out of Lumbridge, past the southwest corner of town.
2. Continue south into the **Lumbridge swamp** (~30 tiles south of the church). The terrain darkens and the music shifts.
3. Look for a **small wooden shack** on the swamp's eastern edge. Father Urhney is alone inside.
4. Right-click **Father Urhney** → `talk-to`.
5. He hands over a **ghostspeak amulet** — wear it to talk to ghosts. Inventory now contains: **ghostspeak amulet**.

## Confront The Ghost

1. **Equip the ghostspeak amulet** (right-click → `wear`). It occupies the neck slot.
2. Walk **north** back to **Lumbridge graveyard** (east side of the church).
3. The graveyard contains several coffins. The **haunted coffin** is visually distinct — one coffin looks disturbed or has a different orientation from the others. The ghost is typically visible near it.
4. Right-click the **ghost** → `talk-to`.
5. Without the amulet equipped, the ghost speaks only in **"woooOOOoo"** — confirm the amulet is on the neck slot before re-engaging.
6. The ghost explains: his **skull was stolen** and he cannot rest until it's returned to his coffin. The skull is in the **Wizards' Tower basement**.

## Hunt The Skull

1. Exit Lumbridge **south-west**. Walk to the **river crossing** — the stone bridge south of the castle, or the southern Lumbridge bridge.
2. Cross the river and head **west** along the south bank. The **Wizards' Tower** is ~80 tiles south-west of Lumbridge — a tall stone tower visible from a distance.
3. Enter the tower through the ground-floor door.
4. **Descend the ladder** in the tower interior to reach the **basement**.
5. The basement is dimly lit and contains **skeletons** (level 13) patrolling the corridors. Either **fight past** with a weapon and food, or **run past** by hugging the walls and moving continuously.
6. Find the **altar** at the south end of the basement. A **glowing red skull** sits on it.
7. Right-click the skull → `take`. Inventory now contains: **ghost's skull**.
8. **Caveat**: a level-13 skeleton may aggro from an adjacent tile. Eat food when HP drops below 30% (see `skills/combat.md`).

## Return The Skull

1. Climb the basement ladder back up to the tower ground floor. Exit the tower.
2. Walk **north-east** back across the river to Lumbridge graveyard.
3. Approach the **haunted coffin** (the same one the ghost was hovering near).
4. Either right-click the coffin → `search` and place the skull, **or** right-click the skull in inventory → `use` on the coffin.
5. The skull is placed. The ghost **thanks the resident and dissolves**. The graveyard returns to peace.

## The Reward

1. Walk back to **Lumbridge Church**.
2. Right-click **Father Aereck** → `talk-to`.
3. He congratulates the resident. **Quest complete!** message appears in chat.
4. **+1125 Prayer XP** is awarded — the Prayer skill tab jumps from level 1 to **level 9** for a fresh resident.
5. **+1 Quest Point** in the quest tab counter.
6. The **Lumbridge Church altar** (upstairs in the chapel, see `skills/prayer.md` § *Praying At An Altar*) is now usable for Prayer point recharge.

## Inventory Plan

Minimal inventory for the run — keep slots free for the skull and combat consumables:

- 1 × **ghostspeak amulet** (from Father Urhney; equip immediately to free a neck slot)
- 1 × **bronze sword / scimitar / axe** (skeleton defense in the basement)
- 4-6 × **cooked shrimp / sardine / trout** (basement HP buffer)
- Optional: **bones** picked up along the way for incidental Prayer XP (`skills/prayer.md` § *Burying Bones*)

Do **not** bring high-value loot — the basement has a non-zero death risk for an unarmored resident.

## Combat Risk

The Wizards' Tower basement is the only combat zone in the quest. **Skeletons** (level 13, ~17 HP, melee aggressive within 1 tile) will engage a low-combat-level resident on sight. For a starter (combat level 3-10):

1. Carry 4-6 food items minimum before descending the basement ladder.
2. Hug the **west wall** of the basement to minimize aggro tiles.
3. If a skeleton locks on, fight it through (see `skills/combat.md` § *Engage And Sustain*) rather than running with low HP — skeletons follow ~5 tiles before disengaging.
4. Eat at **HP < 30%**. Retreat up the ladder if HP < 20% and food is gone.

A resident at combat level 15+ with iron or steel weapons can ignore the skeletons entirely.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Lost the ghostspeak amulet (death, accidental drop) | Return to **Father Urhney** in the Lumbridge swamp shack. Right-click → `talk-to` — he hands over a replacement at no cost. |
| Died in the Wizards' Tower basement | Respawn at Lumbridge. **Run back to the death tile within ~5 minutes** to retrieve dropped items (skull included if it had been picked up). Restock food before re-descending. |
| Confused which coffin is the haunted one | The haunted coffin is visually distinct — typically the one nearest the ghost's spawn point. If unsure, right-click `search` on each coffin in turn; only the haunted one prompts for skull placement. |
| Ghost only "woooOOOoo"s | The ghostspeak amulet is not equipped. Check the neck slot in the equipment tab. Right-click amulet in inventory → `wear`. |
| Skull placed but ghost still present | Talk to the ghost again — the placement dialogue auto-progresses the quest stage. If still stuck, re-open the quest journal to confirm the stage. |
| Picked up the skull but can't find the basement exit | Climb the ladder at the **north end** of the basement back up to the tower ground floor. The skull persists in inventory through the climb. |

## Success Signals

- Quest journal entry **The Restless Ghost** flips to **complete** (green tick).
- Chat line: **"Quest complete!"** in the standard quest-completion typography.
- **+1125 Prayer XP** floating drop and visible jump in the Prayer skill tab (fresh resident: 1 → 9).
- **+1 Quest Point** in the quest tab counter.
- The ghost is **no longer present** in the Lumbridge graveyard on revisit.
- Father Aereck's dialogue from this point forward thanks the resident rather than pleading for help.

## Why Do It

1. **1125 Prayer XP** — the single largest Prayer XP award a starter resident can earn without combat or bone grinding. Pushes Prayer from 1 to **9** in one award, unlocking **Burst of Strength** (level 4, +5% Strength) and **Clarity of Thought** (level 5, +5% Attack) as immediate combat buffs (`skills/prayer.md` § *The Prayer Tree*).
2. **Lumbridge altar unlock** — the church altar becomes the resident's permanent recharge point. Combined with the cow field bone yield (`skills/prayer.md` § *Where Bones Are Plentiful*), this is the single most efficient early-game Prayer loop in the world.
3. **Quest point progress** — second quest point banked toward the quest-cape long game.
4. **Universally recommended** — every Lumbridge-anchored resident does this second, immediately after Cook's Assistant. The Prayer head start compounds across every subsequent combat session.

---

## Cross-references

- **Prayer**: `skills/prayer.md` — the altar this quest unlocks is the most useful recharge point in the early-game world; the 1125 XP places the resident squarely inside the offensive-prayer tier.
- **Combat**: `skills/combat.md` — basement skeleton tactics; eat-at-30% rule applies directly to the Wizards' Tower descent.
- **Cook's Assistant**: `quests/cooks-assistant.md` — sibling starter quest; run this one second.
- **Starter routing**: `starter-workflows.md` — Restless Ghost fits between Cook's Assistant and the first serious combat-plus-bury session.
- **Server impl** (for code work, not agent reasoning): `feat/quest-restless-ghost.md`.
