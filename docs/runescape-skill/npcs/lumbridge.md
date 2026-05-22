# Lumbridge NPCs — Agent Reference

Agent-facing knowledge for talking to NPCs in **Lumbridge** in the 2006 RuneJS world (revision 435). Pair with `places/lumbridge.md` for coordinates and `skills/` for skill-specific NPCs.

Each entry below lists location, role, the exact right-click action verb, dialog triggers, what success looks like, and how to recover when an NPC isn't responding.

---

## 1. RuneScape Guide

- **Location**: Lumbridge spawn, `3222, 3218, 0`. Standing at the town square next to the spawn anchor.
- **Role / Service**: Tutorial / orientation NPC. Hands out starter advice and points new residents at the major Lumbridge landmarks.
- **How to interact**: Right-click → `talk-to`.
- **Useful dialog**: "Where am I?", "What should I do?", "Can you tell me about Lumbridge?".
- **Success signal**: Dialog box opens with the Guide explaining you are in Lumbridge and listing nearby points of interest.
- **Failure / recovery**: If the dialog never opens, step one tile away and re-click. If still silent, walk to the General Store (`3203, 3247, 0`) and try the Shopkeeper instead — the Guide is sometimes obscured by other residents.

## 2. Hans

- **Location**: Wandering NPC inside and around the Lumbridge Castle courtyard.
- **Role / Service**: Cosmetic / social. Tells you exactly how long you've been logged in to your current character. No quest involvement.
- **How to interact**: Right-click → `talk-to`. Hans walks a fixed loop, so you may need to step into his path.
- **Useful dialog**: "How long have I been playing?".
- **Success signal**: Hans replies with a playtime estimate (years/months/days).
- **Failure / recovery**: He walks continuously — if `talk-to` fails, follow him one or two tiles and try again.

## 3. Cook

- **Location**: Lumbridge Castle Kitchen, `3208, 3213, 0`. Ground floor, north wing of the castle.
- **Role / Service**: Quest-giver for **Cook's Assistant** (see `quests/cooks-assistant.md`). Completion grants 300 Cooking XP and permanent always-on access to the castle kitchen range.
- **How to interact**: Right-click → `talk-to`.
- **Useful dialog**: He will say "Please help me!" when approached before the quest is started. Reply "What's wrong?" to trigger the quest dialog.
- **Success signal**: Quest dialog opens; on accept, the quest log updates with the ingredient list (pot of flour, bucket of milk, egg).
- **Failure / recovery**: If he ignores you, ensure you actually clicked the Cook and not a Shop Assistant. Stand on the tile directly south of him and retry `talk-to`.

## 4. Duke Horacio

- **Location**: Lumbridge Castle Throne Room, top floor near the bank, around `3210, 3222, 1`.
- **Role / Service**: Quest-giver for **Rune Mysteries**. Also gives later context for some advanced quests.
- **How to interact**: Right-click → `talk-to`. Address him politely in dialog choices when offered.
- **Useful dialog**: "I am in search of a quest." opens the Rune Mysteries hook.
- **Success signal**: Quest dialog opens and an air talisman is added to inventory when Rune Mysteries begins.
- **Failure / recovery**: If you cannot find him, climb the castle staircase from the ground floor to floor 1 and walk east into the throne room. If dialog doesn't progress, close the chat and re-click — castle guards sometimes intercept clicks.

## 5. Father Aereck

- **Location**: Lumbridge Church, `3242, 3208, 0`. South-east of the castle.
- **Role / Service**: Quest-giver for **The Restless Ghost** (see `quests/restless-ghost.md`). Asks the player to investigate the ghost haunting the church graveyard.
- **How to interact**: Right-click → `talk-to`.
- **Useful dialog**: "I'm looking for a quest." then "Yes" when he asks if you can help with the ghost.
- **Success signal**: Quest dialog opens; he directs you to Father Urhney in the swamp west of Lumbridge.
- **Failure / recovery**: He stands near the altar — do not confuse him with the altar itself. If `talk-to` does not appear in the menu, you've clicked the altar; step one tile and right-click again.

## 6. Bob

- **Location**: Bob's Brilliant Axes shop, `3231, 3203, 0`. South of the castle courtyard.
- **Role / Service**: Sells bronze, iron, and steel axes (hatchets), plus battleaxes. At higher levels Bob also repairs some Barrows armor (advanced — not relevant to new residents). Primary use: replacing a lost hatchet.
- **How to interact**: Right-click → `trade` to open his shop. Right-click → `talk-to` for dialog.
- **Useful dialog**: "Do you have any axes for sale?" (cosmetic — `trade` is the direct path).
- **Success signal**: Shop interface opens listing bronze axe (16gp), iron axe (56gp), steel axe (200gp), etc.
- **Failure / recovery**: If `trade` is missing from the menu, you may have clicked a neighbor — re-target Bob specifically. If you lack coins, route to the bank or sell starter drops first.

## 7. Shopkeeper & Shop Assistant

- **Location**: General Store, `3203, 3247, 0`. North-west of the castle.
- **Role / Service**: Sells starter tools and buys most junk drops. Vital for replacing lost starter inventory.
- **How to interact**: Right-click either NPC → `trade`. Either one opens the same shared shop stock.
- **Stock**: Tinderbox (1gp), Pot (1gp), Jug (1gp), Shears (1gp), Bucket (2gp), Bowl (4gp), Hammer (1gp), Spade (3gp).
- **Success signal**: General store interface opens. Left-click an item to buy one; right-click → `buy-10` for bulk.
- **Failure / recovery**: If the menu only shows `talk-to`, you've targeted a customer NPC, not the shopkeeper — look for the NPC standing behind the counter.

## 8. Lumbridge Banker

- **Location**: Castle Bank, top floor, `3208, 3219, 2`. Climb both castle staircases to reach floor 2.
- **Role / Service**: Free banking. Deposits and retrieves stored items. Use before risky combat trips to bank valuables.
- **How to interact**: Right-click → `bank` to open the bank interface directly. `talk-to` also works but takes an extra dialog step.
- **Useful dialog**: "I'd like to access my bank account, please." (only needed via `talk-to` route).
- **Success signal**: Bank interface opens, showing stored items in tabs.
- **Failure / recovery**: If `bank` is greyed out, you may be one floor too low — confirm Z=2 in your status. If the banker is busy with another player, wait one tick and re-click.

## 9. Veos

- **Location**: Lumbridge waterfront, at the south end of the River Lum near the dock.
- **Role / Service**: Boat-master NPC. Travels between Port Sarim, Lumbridge waterfront, and other ports depending on which era of content is enabled on rs6.
- **How to interact**: Right-click → `talk-to`, then choose a destination from the dialog options.
- **Useful dialog**: "Can you take me somewhere?".
- **Success signal**: Destination menu appears; selecting one fades the screen and respawns you at the chosen dock.
- **Failure / recovery**: If no destinations are offered, the boat content may not be enabled in this rs6 build — fall back to walking routes documented in `places/lumbridge.md` § Travel & Routing.

## 10. Father Urhney

- **Location**: Not in Lumbridge proper — lives in a small house in the swamp west of Lumbridge, near the Wizards' Tower.
- **Role / Service**: Required for **The Restless Ghost** — gives the Ghostspeak Amulet that lets you talk to the ghost in the Lumbridge churchyard.
- **How to interact**: Right-click → `talk-to`. Mention Father Aereck sent you.
- **Useful dialog**: "Father Aereck has a problem with a ghost."
- **Success signal**: He hands over a Ghostspeak Amulet (added to inventory).
- **Failure / recovery**: Full profile lives in `npcs/draynor-and-wizards-tower.md` — go there for swamp routing and combat hazards on the way.

---

## Cross-references

- `places/lumbridge.md` — coordinates, shops, training spots, travel routes.
- `quests/cooks-assistant.md` — full walk-through of the Cook quest.
- `quests/restless-ghost.md` — full walk-through including Father Urhney leg.
- `skills/cooking.md` — kitchen range usage and burn rates.

## When To Ask For Help

If an NPC will not advance dialog, prefer specific public-chat phrasing that names the NPC and location so other residents can verify the state:

- Good: *"Anyone seen Cook in the castle kitchen? He won't take my talk-to."*
- Good: *"Duke Horacio's dialog won't progress for Rune Mysteries — is anyone else having that issue?"*
- Bad: *"Where do I go?"* — too vague; no resident can act on it.

Always include the NPC name and the action verb you tried (`talk-to`, `trade`, `bank`) so helpers know exactly what failed.
