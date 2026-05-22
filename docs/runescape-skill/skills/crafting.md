# Crafting — Agent Skill Reference

Agent-facing knowledge for training and exploiting Crafting in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-crafting.md` — that file is for code, not for agents.

Crafting is a versatile production skill used to make armor, ranged weaponry (amulets and leather armor), bowstrings, pottery, and cut gems. In revision 435, Crafting is essential for making bowstrings (the main fletching backbone) and armor for ranged and magic combat.

---

## 1. Shearing and Spinning (The Fiber Loop)

The most common early-game training loop is collecting raw fibers and spinning them into useful strings.

### Shearing Sheep
1. **Obtain Shears**: Ensure `shears` (ID 1735) is in your inventory.
2. **Find Sheep**: Route to the Lumbridge sheep pen (just north of the castle, across the river gate).
3. **Shear**: Use `shears` on a sheep, or right-click the sheep → `shear`.
4. **Outcome**: The sheep turns naked/sheared. You receive 1 raw `wool` in your inventory.

### Spinning Wheel Loop
1. **Carry Raw Materials**: Pack your inventory with raw `wool` or `flax`.
2. **Find Spinning Wheel**: The best spinning wheel is located in the Second Floor of Lumbridge Castle.
3. **Interact**: Right-click the spinning wheel → `spin`.
4. **Choose Product**: Click the item in the spinning widget (e.g. Ball of Wool or Bowstring) and select quantity.
5. **Outcome**: The raw fiber is spun into finished balls of wool or bowstrings, granting Crafting XP.

---

## 2. Leather Crafting

Leather crafting transforms raw hides into light defensive armor.

1. **Obtain Tools**: Carry a `needle` (ID 1733) and multiple `thread` (ID 1734) in your inventory. Thread is consumed periodically during crafting.
2. **Obtain Leather**: Acquire `leather` (from tanning cowhides at a tanner, e.g. in Al Kharid or Varrock).
3. **Initiate**: Use `needle` on `leather`.
4. **Select Output**: In the crafting widget, select the item to craft based on your level.
5. **Outcome**: The leather is sewn into defensive gloves, boots, cowls, or armor pieces.

---

## 3. Gem Cutting

Gem cutting turns raw, dull ores mined from rocks into valuable shining gems used for jewelry.

1. **Obtain Chisel**: Carry a `chisel` (ID 1755) in your inventory.
2. **Obtain Uncut Gems**: Mine or obtain uncut gems (Sapphire, Emerald, Ruby, Diamond).
3. **Initiate**: Use `chisel` on uncut gem.
4. **Outcome**: The gem is cut, yielding high Crafting XP. *Note*: In early levels, there is a small chance you will accidentally crush the gem into useless crushed gems, giving only 1 XP.

---

## 4. Pottery Basics

Pottery is used to create vials, pots, and pie dishes from soft clay.

1. **Forming Soft Clay**: Use a bucket of water on `clay` (mined from rocks) to make `soft clay`.
2. **Pottery Wheel**: Use `soft clay` on a pottery wheel to form unfired pots, bowls, or pie dishes.
3. **Pottery Oven**: Use the unfired item on a pottery oven/furnace to bake it into a solid, usable container.

---

## Recipes, Levels, and XP

### Spinning Recipes
- **Ball of wool** — Level 1 | 2.5 XP (requires Wool)
- **Bowstring** — Level 10 | 15.0 XP (requires Flax)

### Leather Crafting Recipes
- **Leather gloves** — Level 1 | 13.8 XP (1 Leather)
- **Leather boots** — Level 7 | 16.25 XP (1 Leather)
- **Leather cowl** — Level 9 | 18.5 XP (1 Leather)
- **Leather vambraces** — Level 11 | 22.0 XP (1 Leather)
- **Leather body** — Level 14 | 25.0 XP (1 Leather)
- **Leather chaps** — Level 18 | 27.0 XP (1 Leather)
- **Coif** — Level 38 | 37.0 XP (1 Leather + Coif Coaming)

### Gem Cutting Recipes
- **Uncut Opal** — Level 1 | 15.0 XP
- **Uncut Jade** — Level 13 | 20.0 XP
- **Uncut Red Topaz** — Level 16 | 25.0 XP
- **Uncut Sapphire** — Level 20 | 50.0 XP
- **Uncut Emerald** — Level 27 | 67.5 XP
- **Uncut Ruby** — Level 34 | 85.0 XP
- **Uncut Diamond** — Level 43 | 107.5 XP

---

## Best Crafting Areas

- **Lumbridge Castle**: The ground/upper floors host sheep pens directly outside, and the second floor contains a spinning wheel. Excellent for absolute starter loop (shear → spin wool).
- **Al Kharid**: Tanner shop is located south of the bank. Ideal for tanning cowhides gathered from killing cows in Lumbridge, then crafting leather items next to the Al Kharid Bank.

---

## Failure Modes and Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| **"You need a needle and thread..."** | Missing needle or thread. | Needles are reusable, but thread is consumed. Purchase both at a crafting store (e.g. Al Kharid) or general store. |
| **"You do not have enough thread..."** | Thread has run out. | Stock up on multiple thread reels. A single thread spool makes ~4-5 items. |
| **Sheep runs away / naked sheep** | The sheep has already been sheared or moved out of range. | Target a different, fully-fleeced sheep in the pen. |
| **Gem cuts into "Crushed Gem"** | Normal early-game failure chance on low-tier gems. | Expected. Keep cutting gems; your success rate scales with your Crafting level. |
| **Unfired pottery breaks in oven** | Failure chance on pottery baking. | Make another unfired piece at the pottery wheel and bake again. |

---

## Success Signals

- finished thread spool decreases, and leather piece changes into gloves/boots/body.
- Cut gem (shiny icon) replaces uncut gem (rough icon) in inventory.
- Crafting XP increases in the skill tab.
- Player character plays the spinning animation at the wheel or chiseling/sewing animation.
- Chat lines: **"You spin the..."** or **"You cut the sapphire"** or **"You sew the leather..."**.

---

## When to Ask for Help

Speak publicly if:
- You lack a chisel, shears, or needle and need someone to buy or trade one.
- You are trying to find the Al Kharid Tanner and need navigation help.
- You have cowhides and need help carrying them to a tanner due to inventory constraints.

---

## Cross-references

- **Mining**: `skills/mining.md` — mines clay for pottery and precious gems for cutting.
- **Fletching**: `skills/fletching.md` — uses bowstrings crafted here to string bows.
- **Combat**: `skills/combat.md` — leather armor crafted here provides crucial Ranged and Magic defense.
- **Items**: `items.md` for thread, needle, chisel, and hide IDs.
