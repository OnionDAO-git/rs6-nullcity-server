# Prayer — Agent Skill Reference

Agent-facing knowledge for training and using Prayer in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-prayer.md` — that file is for code, not for agents.

Prayer is the canonical tail of every combat session: kills produce bones, bones bury for XP, and the resulting Prayer points feed offensive prayers that make the next fight faster. Treat Prayer as paired with Combat, not a standalone grind.

## Burying Bones (XP Loop)

1. Finish a fight. If the target dropped bones, walk one tile onto the drop and pick them up — bones occupy one inventory slot per stack of one (they do not stack).
2. Right-click the bones in inventory → `bury`. The character kneels for one tick.
3. Watch for the chat line **"You bury the bones"** and a Prayer XP gain.
4. Repeat for every bone in the inventory before moving to the next target. Do NOT carry bones into the bank — bury where you stand.
5. Bone XP values to memorize:
   - **Bones** (chicken, cow, rat, goblin, man): 4.5 XP
   - **Big bones** (giants, hill giants, ogres): 15 XP
   - **Baby dragon bones**: 30 XP
   - **Dragon bones**: 72 XP
6. Drop bones (do NOT bury) only if Prayer level has already passed the session's goal and inventory space is needed for higher-value loot.

## Praying At An Altar

When Prayer points reach 0, offensive prayers shut off and cannot re-activate until points are restored. To recharge:

1. Walk to a known altar. Starter-region altars:
   - **Lumbridge Church** (upstairs in the chapel just east of Lumbridge Castle): recharges to current Prayer level cap.
   - **Edgeville Monastery** (south of Edgeville bank): recharges to **+2 above** Prayer level cap — preferred for serious training once the Monastery is reachable.
   - **Falador White Knights Castle** chapel: recharges to cap, useful as a Falador-area fallback.
2. Approach the altar tile, right-click → `pray-at`. Character kneels for one tick.
3. Verify the Prayer points meter jumped to (level) or (level + 2) at Edgeville.
4. If the altar is busy, no queue is needed — `pray-at` does not lock the object.
5. If the route to an altar is blocked (locked door, hostile zone), pick a closer altar before draining the last few points elsewhere.

## Prayer Drain Rate

Each active prayer drains 1 Prayer point on a fixed tick interval. Rules of thumb:

- **Thick Skin / Burst of Strength / Clarity of Thought / Sharp Eye / Mystic Will**: ~1 point per 60 ticks (≈36 seconds). Low cost — safe to leave on for a whole fight.
- **Rock Skin / Superhuman Strength / Improved Reflexes**: ~1 point per 30 ticks (≈18s).
- **Steel Skin / Ultimate Strength / Incredible Reflexes**: ~1 point per 20 ticks (≈12s).
- **Eagle Eye / Hawk Eye / Mystic Lore**: drain faster than their level-tier-matched melee equivalents — budget accordingly.
- **Protect-from prayers (40+)**: ~1 point per 3 ticks. Reserve for emergencies; never leave running between fights.
- **Smite (50+)**: ~1 point per 1.5 ticks — the most expensive prayer in the book.

Rule of thumb for starter agents: low-level offensive prayers eat roughly 1 point every 30 seconds. A full 99-point bar with one low-tier prayer up lasts about 50 minutes of continuous combat.

## The Prayer Tree

Unlock level → prayer → effect:

- **Level 1**: Thick Skin (+5% Defence)
- **Level 4**: Burst of Strength (+5% Strength)
- **Level 5**: Clarity of Thought (+5% Attack)
- **Level 7**: Sharp Eye (+5% Ranged Attack)
- **Level 8**: Mystic Will (+5% Magic Attack + Magic Defence)
- **Level 10**: Rock Skin (+10% Defence)
- **Level 13**: Superhuman Strength (+10% Strength)
- **Level 16**: Improved Reflexes (+10% Attack)
- **Level 19**: Rapid Restore (Stats restore 2× faster)
- **Level 22**: Rapid Heal (Hitpoints regen 2× faster)
- **Level 25**: Protect Item (keep 1 extra item on death)
- **Level 31**: Steel Skin (+15% Defence)
- **Level 34**: Ultimate Strength (+15% Strength)
- **Level 37**: Incredible Reflexes (+15% Attack)
- **Level 40**: Protect from Magic
- **Level 43**: Protect from Missiles (Ranged)
- **Level 46**: Protect from Melee
- **Level 50**: Smite (drains target Prayer alongside damage)

Only one prayer per "category" (Defence, Strength, Attack, Ranged, Magic, Protect) may run at a time — activating Rock Skin auto-deactivates Thick Skin.

## When To Activate

Match the prayer to the fight, not to the level cap:

1. **Burst of Strength** on tough melee training (cows-with-aggro, hobgoblins, hill giants) — the +5% Strength shortens fights enough to save more food than the prayer costs.
2. **Sharp Eye** on Ranged training; **Mystic Will** on Magic training. Activate before the first cast/shot, not after.
3. **Eagle Eye / Mystic Lore** at higher Prayer levels for serious Ranged or Magic sessions only — drain rate makes them wasteful on weak targets.
4. Turn prayer **OFF** before the killing blow lands. Running prayers on the walk between fights wastes points; the kill XP arrives whether prayer is up or not.
5. Never run two offensive prayers from the same category. Stack across categories (Burst of Strength + Clarity of Thought + Thick Skin) for full-body buffs.

## Prayer + Combat Pairing

Bones-after-combat is the canonical loop:

1. Engage target (see `combat.md`).
2. Kill target → bones drop.
3. Walk onto drop → pick up bones.
4. Right-click → `bury` → confirm "You bury the bones".
5. Re-engage or move to next target.

Every combat session ends in bury actions. If carrying valuable loot already and bones won't fit, prioritize loot — bones from low-tier kills (4.5 XP each) are not worth a banking trip.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Prayer points at 0, prayer auto-shut-off mid-fight | Finish the fight without prayer if HP is safe; otherwise disengage. Walk to nearest altar — do NOT re-toggle the prayer with 0 points. |
| Altar unreachable (locked door, wilderness route, dead) | Re-route to Lumbridge Church as the universally reachable fallback. Announce: *"Routing to Lumbridge altar — Edgeville blocked."* |
| Inventory full, can't pick up bones | Drop or bury the oldest bone first. If holding valuable loot, skip the bones this fight. |
| Dropped bones disappeared before bury | Bones de-spawn after ~60 seconds on the ground if owned by you, ~30s if owned by another player. Bury immediately; do not loot-walk. |
| Prayer flicker requested (rapid on/off per tick) | OUT OF SCOPE for starter agents. Reserve for human-driven optimization. |

## Success Signals

- **XP gain in the Prayer tab** after every bury action.
- Chat message: **"You bury the bones"** — exact text, no variation.
- Prayer points meter (top of interface) ticks up at an altar — visible numeric jump from current to (level) or (level + 2) at Edgeville.
- Prayer icon glows on the interface when an offensive prayer is active.
- `pray-at` chathead / animation completes without an interrupt.

## Bone Sources Ranked

Cheapest to best XP per bone (matched to agent capability):

1. **Chicken / cow / rat / goblin / man bones** — 4.5 XP. Lumbridge area, no risk. Bread-and-butter starter source.
2. **Big bones** (hill giants, ogres) — 15 XP. Requires combat level ~30+ for safe kills.
3. **Baby dragon bones** (baby blue/red/black dragons) — 30 XP. Combat level 60+; non-starter.
4. **Dragon bones** (adult dragons) — 72 XP. End-game tier. Out of scope for starter agents.

For any agent below combat level 30, regular bones (4.5) are the only realistic source — focus on volume, not bone tier.

## Where Bones Are Plentiful

- **Lumbridge cow field** (east of Lumbridge Castle, across the river): cows respawn in ~30s, drop bones + cowhide. Best volume for low-level training.
- **Goblin huts west of Lumbridge** (across the river toward Draynor): goblins level 2-5, drop bones plus occasional bronze gear.
- **Chicken coop north of Lumbridge** (just past the Lumbridge cow field gate): chickens level 1, fastest kills, drop bones + feathers + raw chicken.
- **Rat-infested areas under Lumbridge Castle** (cellar) and Varrock sewers: rats drop bones, but routing cost is higher than the field.

For a starter agent rooted in Lumbridge, the cow field is the default — high bone yield, low risk, short walk to the Lumbridge Church altar.

---

## Cross-references

- **Combat**: `skills/combat.md` — bury-after-combat is the canonical loop; this file assumes you've read it.
- **Starter quick reference**: `starter-workflows.md` § *Bury Bones* — the minimal version for the Brain to dispatch.
- **Server impl** (for code work, not agent reasoning): `feat/skill-prayer.md`.
- **Items**: `items.md` for bone item IDs and altar object references.
- **Places**: `places.md` for altar location coordinates and routing anchors.
