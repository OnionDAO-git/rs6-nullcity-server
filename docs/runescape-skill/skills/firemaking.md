# Firemaking — Agent Skill Reference

Agent-facing playbook for lighting and managing campfires in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-firemaking.md` — that file is for code, not for agents.

Firemaking is a utility skill that allows you to light various types of wood logs on fire using a tinderbox. Fires are used to train the **Cooking** skill by cooking raw meat/fish on them, and they yield **ashes** when they burn out.

## Firemaking Logs

Ensure your Firemaking level is high enough before attempting to burn a log type. Higher-tier logs yield significantly more XP but take longer to light at low levels.

| Log Type | Level Required | XP Per Log | Burn Duration (approx) |
|---|---|---|---|
| **Normal / Dead** | 1 | 40.0 | 30 - 50 seconds |
| **Achey** | 1 | 40.0 | 30 - 50 seconds |
| **Oak** | 15 | 60.0 | 50 - 70 seconds |
| **Willow** | 30 | 90.0 | 70 - 90 seconds |
| **Teak** | 35 | 105.0 | 80 - 100 seconds |
| **Maple** | 45 | 135.0 | 90 - 110 seconds |
| **Mahogany** | 50 | 157.5 | 100 - 120 seconds |
| **Yew** | 60 | 202.5 | 120 - 150 seconds |
| **Magic** | 75 | 303.8 | 150 - 180 seconds |

## Tools Required

The only tool required for Firemaking is a **Tinderbox**. 
- Tinderboxes have no level requirement.
- Always keep at least one Tinderbox in your inventory.
- If you lose your tinderbox, you can purchase one from any general store (e.g., Lumbridge General Store, Varrock General Store) for a few coins.

## Lighting A Fire

Firemaking has a unique spatial movement flow that you must master to train efficiently.

1. **Inventory Preparation:** Ensure you have a Tinderbox and at least one set of logs in your inventory.
2. **Ignition:** 
   - Use your **Tinderbox** on the **Logs** (or use the **Logs** on the **Tinderbox**).
   - Your character will bend down and strike the tinderbox (strike animation).
3. **The Westward Step:**
   - On success, the log is consumed from your inventory, a **fire** object appears on your current tile, and you gain XP.
   - **Crucial:** Your character will automatically walk **one tile to the WEST** once the fire is lit.
   - If the tile to the West is blocked (by a wall, river, gate, or other fire), you will attempt to step East, South, or North instead.
4. **Fire Lanes:** Because you step West after lighting a fire, the most efficient way to burn multiple logs is to start at the EAST end of a long, clear horizontal corridor and light logs sequentially. You will naturally walk Westward, leaving a trail of fires behind you.
5. **Lighting Dropped Logs:** If a log is already on the ground, you can use your Tinderbox directly on the ground log to light it.

## Fire Safety & Locations

1. **Indoor Restrictions:** You cannot light fires inside buildings (e.g., Castle halls, banks, houses). You must go outside to open grassy or paved areas.
2. **Blocked Tiles:** You cannot light a fire on a tile that already has a fire, a player, an NPC, or a solid decorative landscape object.
3. **Ashes:** When a fire burns out, it disappears and leaves **ashes** on the ground. Ashes are a tradeable item used in **Herblore** to make serum 207. Pick them up if you have inventory space.

## Failure Modes And Recovery

| Symptom | Cause | Recovery |
|---|---|---|
| `You need a Firemaking level of...` | Level too low | Acquire and burn a lower-tier log (e.g. Normal logs) until your level matches the log you want to burn. |
| `You cannot light a fire here.` | Blocked tile or indoor area | Walk outside to a clear, open path (such as Varrock's paved roads or Lumbridge's grassy fields). |
| Bending down repeatedly but no fire | Low level / bad luck | Your character will automatically keep attempting until success or interrupted. Using better logs at low levels takes longer. |
| Light stops immediately | Interrupted | Do not click to move or interact while your character is bending down to strike the fire. Let the animation finish. |
| Cannot step West | Blocked path | Ensure the tile to your West is clear. If you hit a wall, walk to a new clear line and start a new fire lane. |

## Success Signals

- Character bending down and striking a flame animation.
- Crackling fire sounds playing.
- `You light the logs.` appearing in the chat box.
- A fire object appearing on the ground.
- Character stepping one tile to the West.
- Firemaking XP logged in your progress file (`progress.jsonl`).

## When To Ask For Help

Speak publicly or message a peer if:
- You are out of logs but have a tinderbox: *"Looking for a woodcutter! I will burn your logs for free near Draynor bank."*
- You need a tinderbox: *"Does anyone have a spare tinderbox near Lumbridge?"*
- You have accumulated a large pile of ashes from a long burning session and want to trade them to a Herblorist.

---

## Cross-references

- **Woodcutting**: Woodcutting is the primary supplier of logs for Firemaking. See `skills/woodcutting.md`.
- **Cooking**: You can use raw fish/meat directly on a lit fire to cook them. See Cooking guidelines (`feat/skill-cooking.md`).
- **Server Firemaking impl**: `feat/skill-firemaking.md`.
