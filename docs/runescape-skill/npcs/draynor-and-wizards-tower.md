# Draynor Village & Wizards' Tower NPCs — Agent Reference

Agent-facing knowledge for talking to NPCs in **Draynor Village** and at the **Wizards' Tower** (swamp south of Draynor) in the 2006 RuneJS world (revision 435). Pair with `places/draynor-village.md` for coordinates.

NPCs in this region cluster around early F2P quests (**Vampire Slayer**, **Witch's Potion**, **Pirate's Treasure**, **Ernest the Chicken**, **The Restless Ghost**, **Imp Catcher**, **Demon Slayer**, **Rune Mysteries**). Most are non-hostile and respond to a single `talk-to` right-click. Always greet politely — some dialog branches gate behind courteous responses.

---

## Draynor Village

### 1. Wise Old Man

- **Location**: Draynor Village house at `3088, 3253, 0`. South-west corner of the square.
- **Role / Service**: Lore-keeper. Gives quest hints, world history, and advice on mid-game progression.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"Can you give me advice?"*, *"What should I do next?"*, *"Tell me about the world."*
- **Success signal**: Dialog opens with lore prose; advice options branch into quest hints (e.g., references to Draynor Manor, the Wizards' Tower).
- **Failure / recovery**: If he dismisses the player, walk away one tile and re-initiate `talk-to`. Address him politely — he is an elder NPC.

### 2. Diango

- **Location**: Draynor Square at `3079, 3250, 0`.
- **Role / Service**: Reclaims seasonal/holiday items (party hats, easter eggs, lost cosmetic event drops). Also runs Diango's Toy Store.
- **How to interact**: Right-click → `talk-to` (reclaim items) or `trade` (toy store).
- **Useful triggers**: *"Have I lost anything?"*, *"Can I buy a toy?"*
- **Success signal**: Lost holiday item appears in inventory, or trade screen opens with toy inventory (Chronicle, toy horses).
- **Failure / recovery**: Almost never harmful. If reclaim returns *"You haven't lost anything."*, the item was never owned on this account — move on.

### 3. Aggie the witch

- **Location**: Draynor Village south-east house at `3086, 3261, 0`.
- **Role / Service**: Quest NPC for **Witch's Potion**. After quest, brews **red dye**, **yellow dye**, and **blue dye** for Crafting.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"Can you make me a dye?"*, *"I need red dye."* Bring the dye ingredients (red dye: 3 redberries + 5gp; yellow dye: 2 onions + 5gp; blue dye: 2 woad leaves + 5gp).
- **Success signal**: Dye vial appears in inventory after handing over ingredients and coin.
- **Failure / recovery**: If she refuses to brew, check ingredients are present and not noted. For Witch's Potion, ensure rat's tail, eye of newt, onion, and burnt meat are in inventory.

### 4. Ned

- **Location**: Draynor Village near the entrance at `3098, 3258, 0`.
- **Role / Service**: Quest NPC for **Pirate's Treasure** and **Dragon Slayer** (sails the player to Crandor). Makes **rope** from wool (4 wool = 1 rope) or sells it for 15gp.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"Can you make me a rope?"*, *"Can you take me to Karamja?"* (Pirate's Treasure), *"Will you sail me to Crandor?"* (Dragon Slayer).
- **Success signal**: Rope appears in inventory after wool handoff; sail dialog advances quest state.
- **Failure / recovery**: If he says he can't help, the player likely lacks the required quest start item (e.g., Karamja rum for Pirate's Treasure). Re-check quest prerequisites.

### 5. Morgan

- **Location**: Draynor Village house at `3098, 3267, 0`. North-east of the square.
- **Role / Service**: Starts the **Vampire Slayer** quest. Asks the player to kill the vampyre in Draynor Manor basement.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"What's wrong?"*, *"I'll help you."*
- **Success signal**: Quest log entry "Vampire Slayer" opens. He directs the player to Dr. Harlow in Varrock for a stake.
- **Failure / recovery**: If dialog loops, exhaust every option until the quest accept prompt appears. Vampire Slayer requires no prior quests, so the block is purely conversational.

### 6. Veronica

- **Location**: Outside Draynor Manor at `3110, 3327, 0`.
- **Role / Service**: Part of **Ernest the Chicken** quest setup. Tells the player that her fiancé Ernest entered the manor and hasn't returned.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"What's the matter?"*, *"I'll look for him."*
- **Success signal**: Quest log entry "Ernest the Chicken" opens; player is directed inside Draynor Manor.
- **Failure / recovery**: Veronica only triggers the quest start once. If already accepted, talk to Professor Oddenstein on the manor top floor instead.

### 7. Draynor Banker

- **Location**: Draynor Village bank at `3094, 3243, 0`.
- **Role / Service**: Standard bank interface. Closest bank to Draynor willow trees and the fishing spot south of the bank.
- **How to interact**: Right-click → `bank` (preferred) or `talk-to`.
- **Useful triggers**: `bank` action opens the bank booth directly.
- **Success signal**: Bank interface opens; deposit/withdraw works.
- **Failure / recovery**: If the booth is crowded or another player is blocking, walk to an adjacent booth tile. Banks are universally non-hostile.

---

## Wizards' Tower / Swamp (south of Draynor)

### 8. Father Urhney

- **Location**: Small house in the swamp at `3147, 3175, 0`. South-east of the Wizards' Tower.
- **Role / Service**: Gives the **Ghostspeak Amulet** during **The Restless Ghost** quest. Essential — without it the ghost in the Lumbridge churchyard cannot be heard.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"Father Aereck sent me to talk to you."*, *"I need to speak with a ghost."*
- **Success signal**: **Ghostspeak Amulet** appears in inventory.
- **Failure / recovery**: If no amulet is offered, ensure the player has first spoken to Father Aereck in Lumbridge to begin The Restless Ghost. Talking to Urhney out of order returns a brush-off line.

### 9. Wizard Mizgog

- **Location**: Wizards' Tower top floor at `3104, 3162, 2`.
- **Role / Service**: Quest-giver for **Imp Catcher**. Asks for four coloured beads (red, yellow, black, white) dropped by imps.
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"Can I help you?"*, *"I have your beads."* (after collection).
- **Success signal**: Quest accept → "Imp Catcher" appears in log. On handover, an **amulet of accuracy** is rewarded.
- **Failure / recovery**: If he refuses the beads, confirm all four colours are in inventory simultaneously. Beads cannot be noted.

### 10. Wizard Traiborn

- **Location**: Wizards' Tower ground floor at `3112, 3160, 0`.
- **Role / Service**: Quest helper for **Demon Slayer**. Provides one of the three keys to the Silverlight sword (requires 25 bones handed over).
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"I need a key for Silverlight."*, *"I have your bones."*
- **Success signal**: Receives one **bone key**; dialog advances Demon Slayer.
- **Failure / recovery**: If he keeps asking for bones, count carefully — exactly 25 regular bones are needed, not big bones or burnt bones.

### 11. Wizard Grayzag

- **Location**: Wizards' Tower mid-floor at `3105, 3159, 1`.
- **Role / Service**: Minor lore NPC; tangentially involved in Imp Catcher (claims the imps are his summoned familiars).
- **How to interact**: Right-click → `talk-to`.
- **Useful triggers**: *"Hello."*, *"Tell me about the imps."*
- **Success signal**: Lore dialog plays; no inventory change expected.
- **Failure / recovery**: Non-essential NPC. If dialog is empty, move on — Mizgog is the actual Imp Catcher quest-giver.

### 12. Sedridor

- **Location**: Wizards' Tower basement at `3104, 9571, 0`. Reached via the staircase on the ground floor going down.
- **Role / Service**: Teleports the player to the **Rune Essence mine**. Part of **Rune Mysteries** quest; gateway to Runecrafting.
- **How to interact**: Right-click → `talk-to`, then select the teleport option.
- **Useful triggers**: *"Could you teleport me to the Rune Essence?"* (post-quest), *"I have a talisman for you."* (Rune Mysteries handover).
- **Success signal**: Player is teleported to the Rune Essence mine; the mining interface is reachable.
- **Failure / recovery**: If teleport is refused, Rune Mysteries is incomplete — return to Duke Horacio in Lumbridge Castle for the **air talisman** and bring it to Sedridor first.

---

## Cross-references

- `places/draynor-village.md` — coordinates, routing, and local training spots.
- `quests/restless-ghost.md` — full Restless Ghost walkthrough (Father Urhney handoff).
- `skills/runecrafting.md` — what to do after Sedridor's teleport.
- `skills/crafting.md` — uses Aggie's dyes for cape colouring and leather work.

## When To Ask For Help

Speak publicly if an NPC is missing, unreachable, or stuck in dialog. Use phrasing the helper can act on:

- *"Looking for Father Urhney — is the swamp house at 3147, 3175 reachable from Lumbridge?"*
- *"Sedridor refused to teleport me — did I miss a step in Rune Mysteries?"*
- *"Anyone selling four coloured beads for Imp Catcher?"*
