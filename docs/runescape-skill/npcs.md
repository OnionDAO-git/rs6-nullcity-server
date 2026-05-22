# Non-Player Characters (NPCs) Index

The concise, agent-readable reference for locating, talking to, trading with, and resolving dialogue flows with Non-Player Characters (NPCs) in the 2006 RuneJS world (revision 435).

---

## 1. Regional Playbooks (Detailed NPC Guides)

Use the regional playbooks in the `npcs/` directory to lookup coordinate lists, exact interaction verbs, dialogue trigger phrases, inventory requirements, and recovery procedures for regional NPCs.

| Region / Area | Key NPCs Covered | Playbook Document |
|---|---|---|
| **Lumbridge** | RuneScape Guide, Hans, Cook, Duke Horacio, Father Aereck, Bob, Shopkeeper, Banker, Veos | [lumbridge.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/npcs/lumbridge.md) |
| **Varrock** | Romeo, Juliet, Father Lawrence, Apothecary, Aubury, Lowe, Horvik, Thessalia, Zaff, Sawmill Operator, Stiles, Varrock Bankers, King Roald, Reldo | [varrock.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/npcs/varrock.md) |
| **Draynor & Wizards' Tower** | Wise Old Man, Diango, Aggie the Witch, Ned, Morgan, Veronica, Draynor Banker, Father Urhney, Wizard Mizgog, Wizard Traiborn, Wizard Grayzag, Sedridor | [draynor-and-wizards-tower.md](file:///Users/james/Code/OnionDAO/rs6-nullcity-server/docs/runescape-skill/npcs/draynor-and-wizards-tower.md) |

---

## 2. Core Heuristics & Dialogue Guidelines

### Common Interaction Verbs
NPCs in the 2006 RuneJS engine support distinct right-click menu verbs. Choosing the correct verb is essential for efficient action pipeline execution:
1. **`talk-to`**: The default option for starting quests, obtaining instructions, requesting lore, or advancing story loops.
2. **`trade`**: Opens the NPC's shop inventory screen immediately. This bypasses the introductory dialogue chat frames and is highly recommended when purchasing supplies.
3. **`bank`**: Used exclusively on Bankers. Immediately opens the Bank Vault screen, bypassing the banker's standard dialogue screen.
4. **`teleport`**: Used on Aubury (Varrock) and Sedridor (Wizards' Tower). Teleports the resident straight to the Rune Essence mine, bypassing all chat.

### Dialogue Navigation Rules
Dialogue flows are synchronous, stateful interfaces that lock the resident in place:
- **Advancing Text**: Click the `Click here to continue` bar at the bottom of the chat interface, or press `Space` / `Enter` to scroll through NPC text pages.
- **Selecting Branches**: When presented with choices (e.g., *"What's wrong?"* or *"No, I'm busy"*), click the exact text string of the option, or send key presses representing the option number (e.g. `1` for Option 1, `2` for Option 2).
- **Interface Locks**: Moving the character, getting attacked, or attempting an inventory action while dialogue is open will immediately close the interface, resetting any uncompleted conversation progress.

### Stuck Dialogue & Error Recovery Heuristics
If dialogue stalls or the NPC fails to respond, execute the following recovery procedures:
- **The One-Tile Step**: In the 2006 server, dialogue packets occasionally drop. Step exactly one tile away, wait 1 tick, and re-initiate the interaction.
- **Target Verification**: Roving NPCs (like Hans, Veos, or Romeo) can walk behind decorative objects or merge with other players. Always right-click first to verify that the click matches the exact NPC target name and is not hitting an obstacle, guard, or neighboring player.
- **Roving Intercepts**: Roving NPCs move in random or semi-fixed loops. If a `talk-to` action fails because they walked out of range, step directly into their path of movement and wait for them to walk adjacent to you before re-clicking.
- **Item De-noting**: NPCs who require items for quests (such as the Cook requiring flour, or the Apothecary cadava berries) will *reject* noted versions of the items. Ensure all ingredients are raw, unnoted, and occupying separate slots in your active inventory.
- **Dialogue Reset**: If a quest step does not update in the quest log, you may have missed an optional dialogue branch. Talk to the NPC again, exhaust all conversation topics, and wait until they return to their short standard greeting line before leaving.
