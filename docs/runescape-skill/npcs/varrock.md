# Varrock NPCs — Agent Reference

Agent-facing knowledge for talking to NPCs in **Varrock** in the 2006 RuneJS world (revision 435). Pair with `places/varrock.md` for coordinates and `skills/` for skill-specific NPCs.

Each section gives you location, role, the right-click action to use, a dialog trigger, and how to tell whether the interaction worked. If a dialog stalls, walk one tile away and re-talk — most stuck-state recovery in 2006 RuneScape is just resetting position.

---

## 1. Romeo

- **Location**: Varrock Square, north end of the fountain area, around `3211, 3424, 0`.
- **Role**: Quest-giver for **Romeo & Juliet** (see `quests/romeo-and-juliet.md`). Asks you to deliver a love message to Juliet.
- **Interact**: right-click → `talk-to`.
- **Trigger phrases**: "Yes, I'll help.", "Where can I find Juliet?".
- **Success signal**: Quest journal entry "Romeo & Juliet" appears as started; Romeo asks you to find Juliet.
- **Failure / recovery**: If he loops on the same line, close the dialog and re-talk. If the quest is already complete, he'll just chatter — no further action needed.

## 2. Juliet

- **Location**: Small house west of Varrock, just outside the city wall at `3158, 3425, 0`. Climb the staircase to reach her on the upper floor.
- **Role**: Receives Romeo's message. Second link in the quest delivery chain.
- **Interact**: right-click → `talk-to`. You must have the **Message** item from Romeo in your inventory.
- **Trigger phrases**: Hand over the message when prompted; "I have a message from Romeo."
- **Success signal**: Juliet reads the message and hands you a **Message** back for Romeo (her reply).
- **Failure / recovery**: If she ignores the message, confirm the message item is actually in your inventory and that the quest stage is correct. Go back to Romeo first if needed.

## 3. Father Lawrence

- **Location**: Varrock Church, north-east, around `3254, 3482, 0`.
- **Role**: Provides the **wedding plan** step in Romeo & Juliet — points you toward the Apothecary and cadava berries.
- **Interact**: right-click → `talk-to`.
- **Trigger phrases**: "I'm helping Romeo and Juliet.", "What should we do?"
- **Success signal**: Dialog explains the cadava potion plan; quest journal updates with next step.
- **Failure / recovery**: If he only offers prayer flavor lines, you haven't returned Juliet's reply to Romeo yet — back to Romeo first.

## 4. Apothecary

- **Location**: Varrock south-west shop row, `3194, 3404, 0`.
- **Role**: Brews the **cadava potion** when given **cadava berries**. Critical NPC for finishing Romeo & Juliet.
- **Interact**: right-click → `talk-to`. Have cadava berries in inventory.
- **Trigger phrases**: "Talk about Romeo and Juliet.", "Can you make a cadava potion?"
- **Success signal**: He takes the berries and hands back a **cadava potion** item.
- **Failure / recovery**: If he refuses, check that the berries are *cadava* (red, picked from cadava bushes south-east of Varrock), not redberries or any other berry. Wrong berry → no potion.

## 5. Aubury

- **Location**: Aubury's Rune Shop, east-central Varrock, `3253, 3401, 0`.
- **Role**: Sells elemental runes (Air, Water, Earth, Fire, Mind, Body) and Rune Essence. Teleports you to the **Rune Essence mine** on request. Vital for any Magic or Runecrafting training.
- **Interact**: right-click → `trade` for the shop; right-click → `teleport` to be sent to the essence mine.
- **Trigger phrases**: Use the `teleport` menu option directly — no chat needed.
- **Success signal**: Shop interface opens (trade) or screen fades and you land in the essence mine (teleport).
- **Failure / recovery**: If `teleport` is missing from the right-click menu, you may be too far away; step onto a tile adjacent to him.

## 6. Lowe

- **Location**: Lowe's Archery Emporium, north-west of the square, `3233, 3424, 0`.
- **Role**: Sells bows, arrows, and crossbows. Default restock point for lost Ranged gear.
- **Interact**: right-click → `trade`.
- **Trigger phrases**: Shop only — no quest dialog.
- **Success signal**: Shop interface opens with shortbows, arrows, and crossbow stock visible.
- **Failure / recovery**: If shelves are empty, the shop stock is depleted by other players — wait a few minutes for restock or try Catherby Archery (long walk).

## 7. Horvik

- **Location**: Horvik's Armour Shop, east of the square, `3229, 3434, 0`.
- **Role**: Sells bronze through steel armour — helmets, chainbodies, platelegs, shields. His shop floor also hosts the **anvils** used for Smithing.
- **Interact**: right-click → `trade` for armour; use the anvils (separate object) for Smithing.
- **Trigger phrases**: Shop only.
- **Success signal**: Shop interface opens. Stock varies — buy when available.
- **Failure / recovery**: If a tier you want is out, switch to Varrock Sword Shop for weapons or wait for restock.

## 8. Thessalia

- **Location**: Thessalia's Fine Clothes, south of the square, `3208, 3415, 0`.
- **Role**: Cosmetic clothing changes only. Useful for blending in or roleplay.
- **Interact**: right-click → `talk-to`, then pick "I'd like to change my clothes."
- **Trigger phrases**: "I'd like to change my clothes."
- **Success signal**: Appearance interface opens; new shirt/legs/colours apply on confirm.
- **Failure / recovery**: If the dialog only sells fabrics, you picked the wrong option — back out and re-select the "change clothes" line.

## 9. Zaff

- **Location**: Zaff's Superior Staves, south-west of the square, `3203, 3424, 0`.
- **Role**: Sells starter staves (Staff of Air, Staff of Water, etc.). Staves provide unlimited runes of their element — saves runes for low-tier mages.
- **Interact**: right-click → `trade`.
- **Trigger phrases**: Shop only.
- **Success signal**: Shop interface opens with elemental staves listed.
- **Failure / recovery**: If you can't afford the staff you want, mine + smelt for coin or train a few Magic levels with bought runes first.

## 10. Sawmill Operator

- **Location**: Sawmill north-east of Varrock, outside the wall, around `3306, 3491, 0`.
- **Role**: Converts logs into **planks** for a fee (logs + coins in → planks out). Important for Construction training.
- **Interact**: right-click → `talk-to` and use the sawmill machine, or right-click the machine directly.
- **Trigger phrases**: "I'd like to buy some planks." / hand logs to the machine.
- **Success signal**: Coins deducted, logs consumed, matching planks added to inventory.
- **Failure / recovery**: If nothing happens, you may be short on coins (normal planks 100gp, oak 250gp, teak 500gp, mahogany 1500gp). Top up at the bank.

## 11. Tea Stall Owner / Stiles / Market Vendors

- **Location**: Varrock Market Square, around `3215, 3413, 0`.
- **Role**: Roving market NPCs offering small trades — tea, fur, silk. Mostly relevant for Thieving (stalls) and minor consumables.
- **Interact**: right-click → `talk-to` for chat; right-click stalls → `steal-from` for Thieving XP.
- **Trigger phrases**: Brief, flavor-only dialog.
- **Success signal**: Stall interaction returns an item; chat exchanges quest hints occasionally.
- **Failure / recovery**: If guards spot a theft, run two screens away and re-approach later.

## 12. Varrock Bankers

- **Location**: West Bank `3185, 3436, 0` and East Bank `3253, 3420, 0`. Two locations cover the whole city.
- **Role**: Standard bank — deposit, withdraw, organise inventory.
- **Interact**: right-click → `bank` on the banker (or `use-quickly` on the bank booth).
- **Trigger phrases**: Menu-driven; no chat required.
- **Success signal**: Bank interface opens with your stored items.
- **Failure / recovery**: If the booth queue is busy, walk to the other Varrock bank — they share inventory.

## 13. King Roald

- **Location**: Varrock Palace throne room, `3220, 3475, 0`.
- **Role**: Quest-giver for several mid-game quests (e.g. **Shield of Arrav** intro, royal errands).
- **Interact**: right-click → `talk-to`. Polite address required — pick the respectful dialog options.
- **Trigger phrases**: "Greetings, your majesty.", "Do you have a task for me?"
- **Success signal**: Quest dialog progresses; he names a quest objective or points you to **Reldo** in the library.
- **Failure / recovery**: If he dismisses you, your combat or quest prerequisites may be too low — check the quest journal for blockers.

## 14. Reldo

- **Location**: Varrock Palace library, `3211, 3492, 0` (south wing of the palace).
- **Role**: Quest helper for **Shield of Arrav** and other lore-knowledge tasks. Points you to specific books on the shelves.
- **Interact**: right-click → `talk-to`.
- **Trigger phrases**: "Tell me about the Shield of Arrav.", "Do you know any legends?"
- **Success signal**: He names the book or faction you need next; you can then search the relevant bookshelf.
- **Failure / recovery**: If his hints are generic, you haven't talked to King Roald yet — start there.

---

## Cross-references

- `places/varrock.md` — coordinates, shops, training routes around the city.
- `quests/romeo-and-juliet.md` — full walkthrough for the Romeo / Juliet / Father Lawrence / Apothecary chain.
- `skills/runecrafting.md` — Aubury teleport routine and essence runs.
- `skills/smithing.md` — Horvik's anvils and Varrock Furnace workflow.

## When To Ask For Help

Speak publicly if an NPC is missing, looping, or your quest stage seems wrong. Use phrasing the helper can act on:

- *"Romeo isn't at the Varrock fountain — has anyone seen him today?"*
- *"Apothecary won't take my berries — am I holding the wrong type?"*
- *"Aubury's teleport option isn't showing — is the shop bugged?"*
