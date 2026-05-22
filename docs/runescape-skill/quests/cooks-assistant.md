# Cook's Assistant — Agent Quest Reference

Agent-facing knowledge for completing the starter quest *Cook's Assistant* in the 2006 RuneJS world (revision 435). For server implementation details of quest scripting, see `feat/quest-cooks-assistant.md` — that file is for code, not for agents.

Cook's Assistant is the canonical first quest for a Lumbridge-anchored resident: no skill requirements, no combat, three errands inside the Lumbridge-area walking radius, and a reward that immediately unlocks the most-used cook site in the game. Treat it as a 5-10 minute prerequisite for any Cooking workflow — finish it before the first serious cook session.

## Quest At A Glance

- **Start NPC**: the **Cook**, ground floor of **Lumbridge Castle kitchen** (north room, ground floor — same room as the range).
- **Requirements**: none. No skill levels, no other quests, no items required to start.
- **Reward**: **300 Cooking XP** (enough to push a fresh resident to ~Cooking level 4), **1 Quest Point**, and **permission to use the Lumbridge Castle range** (paired with `skills/cooking.md` — the range becomes the default cook site).
- **Length**: ~5-10 minutes of walking, no combat required.
- **Recommendation**: every resident attempts this first. The range unlock alone pays back the time inside the first cooking session.

## The Pickup

1. Enter Lumbridge Castle from the south courtyard. Walk to the north ground-floor room (the kitchen — the range tile is visible).
2. Right-click the **Cook** NPC → `talk-to`.
3. He's panicked: the duke's birthday cake is due and he's missing ingredients. He needs **one egg**, **one pot of flour**, and **one bucket of milk**.
4. Agree to help. The quest is now started and tracked in the quest journal.

## Get An Egg

1. Walk **north out of Lumbridge Castle** through the main gate.
2. Continue ~50 tiles north to the **chicken coop** (fenced enclosure on the east side of the path north of the castle, before the cow field).
3. **Eggs spawn on the ground** inside the coop on a respawn timer. Walk the coop floor and pick up any visible egg.
4. If no eggs are visible: kill a chicken (level 1, 3 HP — trivial). Chicken kills occasionally drop an egg directly. Repeat until an egg is in inventory.
5. One egg is sufficient. Do not over-collect — inventory slots are precious for the windmill step.

## Get A Bucket Of Milk

1. **Empty bucket required** first. Pick one up from the Lumbridge Castle kitchen (a bucket spawns on the kitchen floor; if missing, check the adjacent rooms or the dairy itself).
2. Walk **east of Lumbridge** — exit the castle east, cross the river via the stone bridge, continue east into the cow field.
3. The **dairy cow** is a specific cow tethered next to a milking churn (south-east of the cow field — visually distinct from the wandering combat cows). Right-click it → `milk`.
4. The bucket fills. Inventory now contains: **bucket of milk**.
5. If your bucket was lost or full of something else, return to the castle kitchen for a replacement empty bucket.

## Get A Pot Of Flour

1. **Empty pot required** first. Pots spawn on the Lumbridge Castle kitchen floor and shelves — pick one up before leaving.
2. Walk **north** past the chicken coop and cow field to the **windmill** (large stone building with rotating sails, north of the cow field, west of the road to Varrock).
3. Enter the windmill. Walk to the **wheat field** immediately south of the windmill. Right-click a wheat plant → `pick`. Take **one grain of wheat**.
4. Re-enter the windmill. Climb the **ladder up** to the first floor. Climb the **second ladder up** to the top floor (the windmill has **three levels** — ground, middle, top; the hopper is on the top).
5. Right-click the **hopper** at the top → `fill`. Use the wheat on the hopper. The wheat is ground.
6. **Operate the hopper controls** (right-click → `operate`) to push the flour into the bin below.
7. Climb **both ladders back down** to the ground floor. The **flour bin** is on the ground floor — right-click → `empty` with the empty pot in inventory. Inventory now contains: **pot of flour**.

## The Handoff

1. Walk back **south to Lumbridge Castle kitchen**.
2. Inventory check before talking: **egg**, **bucket of milk**, **pot of flour** — all three must be present simultaneously.
3. Right-click the **Cook** → `talk-to`. He thanks you. The dialogue auto-hands the items over.
4. The cake bakes in cutscene flavor text. **Quest complete!** message appears in chat. 300 Cooking XP and 1 Quest Point are awarded.

## Inventory Plan

Minimal inventory for the run — keep slots free for the three deliverable items:

- 1 × **empty bucket** (kitchen pickup)
- 1 × **empty pot** (kitchen pickup)
- 1 × **small amount of patience** (the windmill ladders are the slowest step)

Do **not** bring a fishing rod, logs, tinderbox, or extra food. The quest has no combat that requires food. Leaving inventory slots open avoids a mid-quest bank trip.

## Combat Risk

None directly. Chickens in the coop are level 1 and aggressive only in the sense that they will retaliate if hit — they cap at 1 damage per hit and almost always miss a resident with any Defence at all. Bring a basic weapon (bronze dagger or fists) only if you intend to kill chickens for the egg drop. No food is required for the quest; bring one cooked shrimp as paranoia insurance, no more.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Dropped or lost an item (death, accidental drop) | Revisit the source location. Egg → chicken coop. Milk → dairy cow east of Lumbridge. Flour → windmill, regrind from a new wheat. |
| Confused at the windmill (which floor?) | The windmill has **three** levels. The hopper is on the **top** floor; the flour bin is on the **ground** floor. Climb both ladders up, fill + operate the hopper, climb both ladders back down, then `empty` the bin into the pot. |
| Empty bucket lost en route | Walk back to the Lumbridge Castle kitchen — a spare bucket spawns on the kitchen floor. Cheaper than buying one. |
| Empty pot lost en route | Same recovery as the bucket — kitchen pickup. |
| Tried to milk the wrong cow | Only the **dairy cow** (tethered, next to a milking churn) responds to the `milk` action. Wandering combat cows in the field give cowhide, not milk. Walk to the south-east corner of the cow field. |
| Cake won't complete despite all three items | Verify exact item names: **egg** (not raw chicken), **bucket of milk** (not empty bucket), **pot of flour** (not pot of grain or empty pot). Re-derive any wrong one. |

## Success Signals

- Quest journal entry **Cook's Assistant** flips to **complete** (green tick).
- Chat line: **"Quest complete!"** in the standard quest-completion typography.
- **+300 Cooking XP** appears as a floating XP drop and in the Cooking skill tab.
- **+1 Quest Point** in the quest tab counter.
- World map: a small cake icon appears next to Lumbridge (cosmetic — slight visual variation by client revision; the journal tick is the load-bearing signal).
- The Cook's dialogue from this point forward thanks the resident rather than asking for help.

## Why Do It

1. **Range unlock** — the Lumbridge Castle range becomes the default cook site for the resident. Without the quest, the engine still allows range use in revision 435 (the quest is canonically the cinematic justification), but the dialogue flag is what some downstream quest chains check. Do it once, never think about it again.
2. **300 Cooking XP** — enough to push a fresh resident from Cooking 1 to roughly **level 4** in one award. That's a meaningful head start on the catch-and-cook loop in `skills/cooking.md`.
3. **First quest point** — banks toward the long-term quest-cape goal. Quest points are also a soft gating signal for some mid-game content.
4. **Universally recommended** — every Lumbridge-anchored resident does this first. If a player asks "what should I do first?", *Cook's Assistant* is the always-correct answer.

---

## Cross-references

- **Cooking**: `skills/cooking.md` — the range unlock is the practical reward; the catch-and-cook loop there assumes the Lumbridge range is available.
- **Fishing**: `skills/fishing.md` — pairs with Cooking on the input side. Run Cook's Assistant before the first fishing trip so the cooked-shrimp loop has its destination range ready.
- **Starter routing**: `starter-workflows.md` — Cook's Assistant fits between "spawn at Lumbridge" and the first Cooking session.
- **Server impl** (for code work, not agent reasoning): `feat/quest-cooks-assistant.md`.
