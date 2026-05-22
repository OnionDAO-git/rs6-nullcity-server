# Romeo & Juliet — Agent Quest Reference

Agent-facing knowledge for completing the starter quest *Romeo & Juliet* in the 2006 RuneJS world (revision 435 / build #435). For server implementation details of quest scripting, see `feat/quest-romeo-and-juliet.md` — that file is for code, not for agents.

Romeo & Juliet is a mid-traversal **starter** quest with **no skill requirements**, **no combat checkpoints**, and **no XP reward** — only **5 Quest Points** and a darkly comic ending. The reward looks underwhelming on paper, and the quest is widely criticized for delivering no XP, but the 5-QP haul is the single largest quest-point-per-effort payout at this level and gates several mid-tier quests that require minimum QP totals. Treat it as a 15-25 minute walking errand (~10 minutes if any teleport unlocks are available) and run it after `quests/cooks-assistant.md` and `quests/restless-ghost.md`.

## Quest At A Glance

- **Start NPC**: **Romeo**, wandering **Varrock Square** (the open plaza in the center of Varrock city, near the central fountain).
- **Requirements**: none. No skill levels, no prior quests, no items required to start.
- **Reward**: **5 Quest Points**. **No XP** in any skill. No follow-up unlocks beyond QP progress.
- **Length**: ~15-25 minutes walking; ~10 minutes if Varrock teleport or amulet of glory is available.
- **Recommendation**: run it third in the starter chain — after Cook's Assistant and Restless Ghost — to bank the quest-cape track's largest early QP award.

## The Pickup

1. From Lumbridge spawn, take the **north road** out of town. Pass the **windmill** on the west side of the path.
2. Continue north through goblin territory. Enter Varrock via the **south gate**.
3. Walk to the open plaza at the center of the city — **Varrock Square**.
4. **Romeo** paces the square (he wanders — relocate by line-of-sight if not on the first tile). Right-click **Romeo** → `talk-to`.
5. He explains he's smitten with **Juliet** and asks the resident to pass a message to her. Agree to help. The quest is now started and tracked in the quest journal.

## Find Juliet

1. Exit Varrock through the **west gate**.
2. Continue **west** along the road toward Falador.
3. Before reaching Falador, take the **path north** off the main road. **Juliet's house** is a small two-story estate on the **north side of the road**, well before the Falador gates.
4. Enter the house. Climb the stairs if Juliet is not on the ground floor (she spawns on the upper floor in revision 435).
5. Right-click **Juliet** → `talk-to`.
6. She writes a return letter. Inventory now contains: **a letter** (literally named "a letter" — flat, no flavor suffix).

## Deliver The Letter

1. Walk **east back to Varrock**. Re-enter through the **west gate**.
2. Return to Varrock Square. Locate **Romeo** again (still wandering — relocate by line-of-sight).
3. Right-click **Romeo** → `talk-to`. The dialogue auto-hands over the letter.
4. Romeo reads it. He learns **Juliet's father wants her to marry another man**. He despairs aloud.

## Find Father Lawrence

1. Romeo suggests consulting **Father Lawrence**, who lives in the **Varrock church** (just **east of Varrock Square** — the church building with the steeple visible from the square).
2. Walk east into the church. Right-click **Father Lawrence** → `talk-to`.
3. He proposes a **fake-death potion**: Juliet drinks it, appears dead, the family lets her go, and she escapes with Romeo. To brew it he needs **Cadava berries**.

## Get Cadava Berries

1. Exit the church south. Walk **southeast out of Varrock** toward the wilderness boundary.
2. The **Cadava bush** is in a small clearing **south of Varrock**, just south of the city wall. Look for a visually distinct bush with dark berries.
3. Right-click the bush → `pick`. One **Cadava berry** enters inventory. (One is sufficient; no need to over-pick.)
4. **CAUTION**: this area is close to the **wilderness boundary**. Do NOT walk further north past the wilderness ditch — the wilderness allows PvP attacks with no escape (see `skills/combat.md` § *Run When Outmatched*).

## Return To Father Lawrence

1. Walk **north back into Varrock**.
2. Return to the Varrock church (east of the square).
3. Right-click **Father Lawrence** → `talk-to`. The dialogue auto-hands the Cadava berry over.
4. He brews the potion. Inventory now contains: **Cadava potion**.

## Give Potion To Juliet

1. Exit Varrock west again through the **west gate**.
2. Walk **west** along the road and take the **path north** to **Juliet's house** (same building as before).
3. Right-click **Juliet** → `talk-to`. The dialogue auto-hands the potion over and progresses the script — do **not** use the potion on yourself or try to manually `drink` it.
4. Juliet "dies" — actually fake. The script triggers her family's reaction off-screen.

## Final Conversation With Romeo

1. Walk **east back to Varrock**, return to the square.
2. Right-click **Romeo** → `talk-to`. He's heartbroken (and, in true dark-comic fashion, mentions finding another love almost immediately).
3. **Quest complete!** message appears in chat. **+5 Quest Points** are awarded. No XP drop occurs — the QP counter is the only signal.

## Inventory Plan

Minimal inventory — the quest hands its own items out as the script progresses:

- **Empty inventory** to start (script will populate slots with letter / berry / potion in sequence).
- 1 × **basic weapon** (bronze sword / scimitar / axe) for highwaymen on the Lumbridge → Varrock road.
- 2-4 × **cooked shrimp / sardine** for the same road's goblins and the occasional level-5 highwayman.
- Optional: a handful of **coins** for the **Varrock general store** if a forgotten item needs purchase.

Do **not** bring high-value loot. The Cadava bush area is one tile-step from the wilderness boundary — death there is recoverable but inconvenient.

## Combat Risk

Two soft hazards along the walking route:

1. **Lumbridge → Varrock north road**: occasional **goblins** (level 2-5, trivial) and **level 5 highwaymen** who can hit 2-3 damage. Eat food if HP drops; keep a weapon equipped to deter aggro.
2. **Cadava bush clearing (south of Varrock)**: the wilderness boundary is **immediately north**. If aggro pulls the resident north, walk **south immediately** — do NOT cross the ditch. PvP in the wilderness has no opt-out (`skills/combat.md` § *Run When Outmatched*).

No mandatory combat. A combat-level 5+ resident can complete the entire quest without unsheathing a weapon if they pick a quiet world.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Dropped the **letter** (death, accidental drop) | Return to **Juliet** in her house. Right-click → `talk-to` — she writes a replacement at no cost. |
| Dropped the **Cadava berry** before reaching Father Lawrence | Return to the **Cadava bush** south of Varrock. Right-click → `pick` for another. The bush respawns berries on a timer. |
| Dropped the **Cadava potion** | Return to **Father Lawrence** with another **Cadava berry** in inventory. He'll re-brew. |
| Confused which house is Juliet's | **North side of the road** between Varrock west gate and Falador. Two-story estate, well before the Falador gates. If the road slopes downward into the Falador walls, you've gone too far. |
| Wilderness drift while picking Cadava | Walk **south immediately**. Do not engage anything north of the ditch. Eat food en route if a PKer hit lands. |
| Tried to drink the potion yourself | The script handles consumption — talk to Juliet, do not `drink` from inventory. If the potion was wasted by misclick, return to Father Lawrence with another berry. |
| Quest journal stuck mid-stage | Re-open the journal to confirm the current stage's NPC. The script gates strictly on dialogue — talking to NPCs out of order is a no-op, not a soft-lock. |

## Success Signals

- Quest journal entry **Romeo & Juliet** flips to **complete** (green tick).
- Chat line: **"Quest complete!"** in the standard quest-completion typography.
- **+5 Quest Points** in the quest tab counter (no floating XP drop — the QP delta is the only signal).
- Romeo's dialogue from this point forward is post-quest filler (no plea for help).
- Juliet, on revisit, is back in her house — the "death" was, of course, fake.

## Why Do It

1. **5 Quest Points** — the **highest QP-per-effort award available at this level**. Several mid-tier quests gate on minimum QP totals; this one quest delivers as much QP as five smaller quests would.
2. **Quest-cape track progress** — completes the early starter triad (Cook's Assistant + Restless Ghost + Romeo & Juliet) and clears the path to the next quest tier.
3. **Varrock geography drill** — the walking route teaches **Varrock Square**, **west gate**, **south gate**, **Varrock church**, the **Lumbridge → Varrock road**, and the **wilderness boundary south of Varrock**. All five locations are essential for later quests and skill training (see `places.md`).
4. **Universally recommended** — every starter-track resident does this third, despite the no-XP reward. The 5 QP alone justifies the walking time.

---

## Cross-references

- **Places**: `places.md` — Varrock geography (Square, gates, church) and the Lumbridge → Varrock road; the Cadava bush is one of the closest near-wilderness landmarks.
- **Starter routing**: `starter-workflows.md` — Romeo & Juliet fits third in the starter chain, after Cook's Assistant and Restless Ghost.
- **Cook's Assistant**: `quests/cooks-assistant.md` — sibling starter quest; run first.
- **Restless Ghost**: `quests/restless-ghost.md` — sibling starter quest; run second.
- **Server impl** (for code work, not agent reasoning): `feat/quest-romeo-and-juliet.md`.
