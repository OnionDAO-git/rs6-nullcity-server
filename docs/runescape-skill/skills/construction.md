# Construction — Agent Skill Reference

Agent-facing knowledge for training and exploiting Construction in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-construction.md` — that file is for code, not for agents.

Construction is the ultimate player-customization skill. It allows you to purchase a private, instanced estate called a **Player-Owned House (POH)**. By gathering wood (planks), mining stone (limestone, marble), and refining steel (nails), you construct rooms, layout gardens, craft functional furniture, and set up powerful utilities (like teleport altars, repair stands, and healing pools) that benefit your entire gameplay.

## Key Construction Concepts

Construction requires a major monetary investment but rewards you with unparalleled utility:

1. **Player-Owned House (POH)** — An instanced, pocket-dimension estate owned by you. Access it via overworld portals (starter portal at Rimmington).
2. **Build Mode** — A special building setting toggled in your house settings. When enabled, translucent white **Hotspots** appear throughout your house indicating where furniture can be built.
3. **Planks & Nails** — The absolute backbone materials for training. Planks are created by taking cut logs to the Sawmill operator (Varrock NE) and paying a coin fee. Nails are forged using Smithing.
4. **Tools** — You must carry a **Hammer** and a **Saw** in your inventory to perform any construction.
5. **Rooms** — You purchase entire room templates (Parlor, Garden, Kitchen, Workshop) at doors or boundary hotspots for a coin fee, unlocking new furniture hotspots.

## The Training & Building Loop

The standard power-leveling loop (commonly called "Larder" or "Table" training):

1. **Logistics**: Bank at a nearby bank (e.g. Falador East for Rimmington portal training). Fill your inventory with:
   - Hammer + Saw.
   - Baskets or notes of Planks and Nails (or hire a servant/butler to unnote them for you).
   - Coins for room/furniture fees.
2. **Enter House**: Left-click the overworld Portal -> `enter house (build mode)`.
3. **Build Room**: Walk to a door hotspot -> click -> choose a room template (e.g. Kitchen, requires level 15 and coins).
4. **Build Furniture**: Right-click a furniture hotspot (e.g. Larder hotspot) -> `build`. A menu of eligible furniture will appear. Choose the highest tier you can build. Your character will play an animation, consume planks/nails, and award large Construction XP.
5. **Remove Furniture**: To continue training on the same hotspot, right-click the built furniture -> `remove`. Confirm the removal to empty the hotspot.
6. **Repeat**: Re-build the furniture on the empty hotspot immediately.

## Materials Reference

- **Normal Plank** — Level 1 Construction.
- **Oak Plank** — Level 15 Construction. Does not require nails to build (highly preferred for mid-level training).
- **Teak Plank** — Level 35 Construction.
- **Mahogany Plank** — Level 40 Construction.
- **Nails** — Bronze, Iron, Steel, Black, Mithril, Adamant, Rune. Better nails have a lower chance of bending/breaking during construction. (Oak and higher planks do not use nails).

## Room Types & Unlock Milestones

- **Garden** — Level 1, Cost: 1,000 gp. Features the exit portal.
- **Parlor** — Level 1, Cost: 1,000 gp. Features chairs, bookcase, and fireplace.
- **Kitchen** — Level 15, Cost: 5,000 gp. Features larders, sinks, stove (essential for Cooking training).
- **Dining Room** — Level 10, Cost: 5,000 gp.
- **Workshop** — Level 15, Cost: 10,000 gp. Features the workbench (used to craft flatpacks, repair armor, or paint shields).
- **Bedroom** — Level 20, Cost: 10,000 gp. (Allows hiring a butler).

## Failure Modes & Recovery

| Symptom | Recovery |
|---|---|
| Nails bent/broken | Normal event when using cheap nails. Always bring spare nails (steel or better) or switch to Oak Planks which do not require nails. |
| Out of Planks mid-build | Stop building. Talk to your butler to fetch planks from your bank, or leave the house to withdraw more from a bank (Rimmington house portals can use Phials to unnote items for a small gp fee). |
| "You need a hammer/saw to do that" | Verify both a hammer and a saw are in your inventory. You cannot build without them. |
| Cannot build outside Build Mode | Left-click the portal -> leave -> enter in Build Mode, or open your House Settings tab and toggle `Build Mode` to `On`. |
| Room misplaced | In Build Mode, right-click the green door boundary of the incorrect room -> `remove room`. This deletes the room and all its furniture (no refunds on cost). |

## Success Signals

- Hammering animation plays.
- Translucent hotspot replaces with solid, functional furniture (e.g. Oak Larder).
- Construction XP increases in the skill tab.
- Planks and nails are consumed from inventory.

## When To Ask For Help

Speak publicly if:
- You need a hammer or saw and cannot find a nearby shop.
- You need someone to sell you steel/mithril nails or planks.
- You are locked out of your house because you cannot afford the initial 1,000 gp plot fee.

---

## Cross-references

- **Woodcutting**: `skills/woodcutting.md` — cuts the raw logs (oak, teak, mahogany) that feed the sawmill.
- **Smithing**: `skills/smithing.md` — smiths the iron/steel nails used in early construction.
- **Cooking**: `skills/cooking.md` — kitchens provide ranges and larders that accelerate cooking training.
- **Places**: `places.md` for sawmill locations, house portals, and Phials (unnoter).
- **Server impl** (for code work, not agent reasoning): `feat/skill-construction.md`.
