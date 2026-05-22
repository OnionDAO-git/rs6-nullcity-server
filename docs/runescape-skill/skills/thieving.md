# Thieving — Agent Skill Reference

Agent-facing knowledge for training and exploiting Thieving in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-thieving.md` — that file is for code, not for agents.

Thieving is the quintessential skiller gold-making and utility skill. It allows agents to acquire coins, seeds, raw food, and valuable trade goods directly from NPCs (via Pickpocketing) and town stalls (via Stall Stealing). It operates on a high-risk, quick-reward loop: failures result in combat-free damage and temporary stuns, while successes supply instant cash and resources.

---

## 1. The Pickpocketing Loop

Pickpocketing is performed by approaching a target citizen or guard and pocketing their wealth.

1. **Verify Health**: Never pickpocket with less than **5 HP**. A failed attempt deals damage and could result in death.
2. **Verify Inventory**: Ensure you have at least 1 free inventory slot (or a stack of coins if pickpocketing coins).
3. **Approach Target**: Walk to the targeted NPC (e.g. Man or Woman in Lumbridge).
4. **Interact**: Right-click the NPC → `pickpocket`.
5. **Wait and Resolve**:
   - **On Success**: Coins or items appear in your inventory, and you receive Thieving XP.
   - **On Failure**: The NPC screams, stuns you for a few ticks (you cannot move or act), and inflicts small damage. No XP or items are awarded.
6. **Repeat**: There is a short internal tick cooldown between pickpocket attempts. Spam-clicking does not bypass this.

---

## 2. The Stall Stealing Loop

Stall stealing is performed in town marketplaces by lifting merchandise when the shopkeepers or guards are looking away.

1. **Positioning**: Stand directly adjacent to the target stall (e.g. Baker's Stall in Varrock).
2. **Interact**: Right-click the stall → `steal-from` or `steal`.
3. **Wait for Respawn**: Once stolen from, the stall displays a depleted visual state (empty racks). You must wait for the stall items to respawn (usually 5 to 30 seconds depending on the stall tier) or move to another stall.
4. **Guard Avoidance**: If a guard or the shopkeeper witnesses you stealing, they will immediately attack you. Only steal when guards are out of sight or blocked behind walls.

---

## Targets, Levels, and XP

### Pickpocket Targets
- **Man / Woman** — Level 1 | 8.0 XP
  - Reward: 3 Coins
  - Damage on Fail: 1 HP | Stun: 5 ticks (3.0 seconds)
- **Farmer** — Level 10 | 14.5 XP
  - Reward: 9 Coins, Potato Seed, Onion Seed, or other starter seeds
  - Damage on Fail: 1 HP | Stun: 5 ticks
- **Guard** — Level 40 | 46.8 XP
  - Reward: 30 Coins
  - Damage on Fail: 2 HP | Stun: 5 ticks

### Stall Stealing Targets
- **Vegetable Stall** — Level 2 | 10.0 XP (Tomato, Onion, Cabbage)
- **Baker's Stall** — Level 5 | 16.0 XP (Cake, Bread, Chocolate Cake)
- **Tea Stall** — Level 5 | 16.0 XP (Cup of Tea)
- **Silk Stall** — Level 20 | 24.0 XP (Silk - *great Al Kharid money maker*)

---

## Best Thieving Areas

- **Lumbridge Town & Courtyard**: Abundant with Men and Women wandering near the castle gate. The absolute best starter location for levels 1-9. Safe from hostile NPCs.
- **Draynor Village**: Great for Farmers (level 10+) and contains the Seed Stall. Watch out for aggressive market guards.
- **Varrock East Market**: Packed with Baker's Stalls (level 5+). Excellent for stealing cakes, which double as high-quality healing food for early-level combat!
- **Al Kharid Palace**: Home to Al Kharid Warriors (level 25+) and Silk Stalls. Silk stolen here can be sold back to tanners/merchants in other cities for pure profit.

---

## Failure Modes and Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| **"You are stunned!"** | A failed pickpocket attempt occurred. | You are locked in place and cannot act. Wait 5 ticks (~3 seconds) for the stun effect to fade, then resume. |
| **Too low health / low HP** | Repeated failed pickpocket damage has depleted your HP. | **STOP THIEVING IMMEDIATELY**. Eat food (like stolen cakes or cooked fish) until you are above 10 HP before resuming. |
| **"Your inventory is too full..."** | No space for the stolen items. | Eat a food item, bank the loot, or drop low-value seeds (like potato seeds) to free up space. |
| **Guard attacks you mid-theft** | A city guard saw you steal from a stall. | Run away 10+ tiles until the guard loses interest, or defeat the guard in combat if you are sufficiently geared (see `combat.md`). |
| **Stall is empty / depleted** | Another player or agent recently stole from it. | Wait for the stall to respawn (marked by merchandise reappearing on the counter) or step to the next stall. |

---

## Success Signals

- Coins or stole item (e.g. bread, cake, silk) appears in inventory.
- Thieving XP increases in the skill tab.
- Player character plays the quick reach-out animation.
- Chat lines: **"You pickpocket the..."** or **"You steal a..."**.

---

## When to Ask for Help

Speak publicly if:
- Your health is critically low (under 3 HP), you have no food, and you need someone to trade or drop food to save you.
- A guard is permanently stuck blocking the stall and you cannot steal safely.
- You have accumulated a full inventory of high-value seeds/silk and need an escort to the bank.

---

## Cross-references

- **Combat**: `skills/combat.md` — failed thieving deals damage; having high defense and hitpoints makes thieving runs much safer.
- **Cooking**: `skills/cooking.md` — stolen raw ingredients (like dough or vegetables) can be cooked; stolen cakes are ready-to-eat high-tier food.
- **Farming**: `skills/farming.md` — seeds pickpocketed from Farmers are the primary source of early-game planting materials.
- **Items**: `items.md` for seed and food item IDs.
