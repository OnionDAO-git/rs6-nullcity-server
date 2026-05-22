# Runecrafting — Agent Skill Reference

Agent-facing knowledge for training and exploiting Runecrafting in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-runecrafting.md` — that file is for code, not for agents.

Runecrafting is the legendary skill of magic self-sufficiency. It allows you to forge raw, inert essence into magical elemental and catalytic runes using mysterious ruins scattered across the world. Runecrafting is the ultimate backbone for Magic training and combat spells.

## Essence Tiers & Restrictions

You cannot craft runes without essence mined from the Rune Essence mine (or dropped by monsters):

1. **Rune Essence** — The standard starter essence. Can only be crafted into basic elemental and catalytic runes (Air, Mind, Water, Earth, Fire, and Body runes).
2. **Pure Essence** — The higher-tier, dense essence. Can be crafted into **any** rune, and is **strictly required** for advanced runes (Cosmic, Chaos, Nature, Law, and Death) as well as Combination runes.

Always carry as much essence as possible in your inventory when visiting an altar. Crafting consumes **all** eligible essence in your inventory in a single action.

## Altars, Talismans & Tiaras

Each rune type corresponds to a specific mysterious ruins location in the overworld. To access the altar pocket dimension, you must have the matching item:

- **Talisman** — Held in inventory. Use the talisman on the **Mysterious Ruins** object to teleport inside.
- **Tiara** — Equipped in your head slot. Left-clicking the **Mysterious Ruins** will teleport you inside directly, saving one inventory slot.
- **Portal** — The exit portal inside each pocket dimension. Click it to return to the overworld immediately outside the ruins.

### Tiara Creation
To craft a tiara:
1. Carry a **Blank Tiara** (item ID 5525) and the matching **Talisman** to the corresponding altar inside the pocket dimension.
2. Use the Talisman on the **Altar**.
3. Your character will perform an action, consume the talisman and blank tiara, and hand you the finished magical **Tiara** (e.g. `Air Tiara`), granting significant Runecrafting XP.

## Altar Reference Table

| Altar / Rune | Level | Essence Allowed | Ruins Location | Talisman ID | Tiara ID |
|---|---|---|---|---|---|
| **Air** | 1 | Rune or Pure | South of Falador | 1438 | 5527 |
| **Mind** | 2 | Rune or Pure | North of Falador / Wilderness border | 1440 | 5529 |
| **Water** | 5 | Rune or Pure | South of Lumbridge Swamp | 1444 | 5531 |
| **Earth** | 9 | Rune or Pure | North-east of Varrock | 1442 | 5535 |
| **Fire** | 14 | Rune or Pure | North of Al Kharid | 1446 | 5537 |
| **Body** | 20 | Rune or Pure | South of Edgeville / West of Varrock | 1448 | 5533 |
| **Cosmic** | 27 | **Pure Essence Only**| Zanaris (requires Lost City quest) | 1454 | 5539 |
| **Chaos** | 35 | **Pure Essence Only**| Wilderness (low-level danger) | 1452 | 5543 |
| **Nature** | 44 | **Pure Essence Only**| North of Shilo Village (Karamja) | 1462 | 5541 |
| **Law** | 54 | **Pure Essence Only**| Entrana (no weapons/armour allowed) | 1458 | 5545 |
| **Death** | 65 | **Pure Essence Only**| Temple of Light (Mournings Ends II) | 1456 | 5547 |

## Rune Multipliers

As your Runecrafting level increases, you automatically craft **multiple** runes per single essence block, drastically increasing your yield and profit margin (though XP per essence remains constant):

- **Air Runes**: 2× at Level 11, 3× at 22, 4× at 33, 5× at 44, 6× at 55, 7× at 66, 8× at 77, 9× at 88, 10× at 99.
- **Mind Runes**: 2× at Level 14, 3× at 28, 4× at 42, 5× at 56, 6× at 70, 7× at 84, 8× at 98.
- **Water Runes**: 2× at Level 19, 3× at 38, 4× at 57, 5× at 76, 6× at 95.
- **Earth Runes**: 2× at Level 26, 3× at 52, 4× at 78.
- **Fire Runes**: 2× at Level 35, 3× at 70.
- **Body Runes**: 2× at Level 46, 3× at 92.

## Combination Runes

Combination runes combine two elements (e.g., `Steam runes` = Water + Fire). They are highly valuable for saving inventory space.
To craft combination runes (e.g., Fire runes onto Water Altar):
1. Travel to the target altar (e.g., Water Altar) carrying:
   - **Pure Essence**
   - The opposite elemental runes (e.g. Fire runes)
   - The opposite talisman (e.g. Fire talisman)
2. Use the opposite runes (Fire runes) on the Altar.
3. If successful, you consume your essence and opposite runes, and receive the combination runes (Steam runes) plus high XP.
4. **Warning**: The opposite talisman (Fire talisman) has a 50% chance of being consumed in the reaction unless you wear a binding necklace.

## The Runecrafting Loop (Bank to Altar)

Runecrafting is traditionally trained using an active shuttle loop:

1. **Bank Preparation**: Withdraw a full inventory of Rune or Pure Essence, leaving exactly one space for your talisman (or zero spaces if wearing a tiara).
2. **Travel to Ruins**: Walk to the closest mysterious ruins. (e.g. south of Falador for Air ruins).
3. **Ruins Entry**: Use the talisman on the mysterious ruins (or left-click if wearing the tiara) to teleport inside.
4. **Craft Runes**: Click the large **Altar** in the center of the room. All your essence is consumed, and runes appear in your inventory, accompanied by a sound and visual effect.
5. **Exit & Bank**: Click the **Portal** to teleport back outside. Walk to the nearest bank (e.g. Falador east bank for Air runes) to deposit your runes and reload essence.

## Failure Modes & Recovery

| Symptom | Recovery |
|---|---|
| "Nothing interesting happens" on ruins | You are using the wrong talisman or not wearing the correct tiara. Verify the altar element match. |
| "You need Pure Essence to craft these runes" | You brought normal Rune Essence to a high-tier altar (Cosmic or above) or combination craft. Bank and fetch **Pure Essence** (item ID 7936). |
| Combination craft failed | You have a 50% fail rate by default. Ensure you are wearing a binding necklace to guarantee success. |
| Talisman lost on combination craft | Expected penalty. Bring multiple talismans if you intend to craft combination runes without a binding necklace. |
| Inventory full of runes, cannot load essence | Deposit your crafted runes in the bank first. Runes stack, but essence does not, so keep your inventory clean. |

## Success Signals

- Chat message: **"You bind the temple's power into <runes>."**
- Runecrafting XP increases in the skill tab.
- Elemental or Catalytic runes appear in your inventory.
- Essence blocks disappear from your inventory.

## When To Ask For Help

Speak publicly if:
- You need to buy talismans or blank tiaras from other players.
- You are lost in the Wilderness trying to locate the Chaos Altar.
- You want to hire "runners" (other players who bring you essence in exchange for money/runes) to stay at the altar for max XP rates.

---

## Cross-references

- **Mining**: `skills/mining.md` — the source of raw Rune Essence and Pure Essence.
- **Combat**: `skills/combat.md` — runes crafted here power all Magic offensive and defensive spells.
- **Items**: `items.md` for talisman, tiara, and rune item IDs.
- **Places**: `places.md` for mysterious ruins coordinates and bank paths.
- **Server impl** (for code work, not agent reasoning): `feat/skill-runecrafting.md`.
