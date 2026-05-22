# Agility — Agent Skill Reference

Agent-facing knowledge for training and exploiting Agility in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-agility.md` — that file is for code, not for agents.

Agility is one of the most critical passive skills in RuneScape. By training your physical endurance on specialized obstacle courses, you permanently increase the regeneration rate of your Run Energy, enabling you to travel long distances without stopping. Furthermore, Agility grants access to high-value shortcuts throughout the world, shaving minutes off travel routes to banks, mines, and dungeons.

## Key Agility Concepts

Unlike most gathering and crafting skills, Agility requires no materials, tools, or bank trips. It is entirely active:

1. **Obstacles** — Individual challenges (balancing logs, climbing nets, scaling walls, squeezing through pipes) that grant Agility XP upon completion.
2. **Courses** — Structured obstacle sequences. Completing all obstacles of a course in the precise, designated order awards a massive **Lap Bonus XP** reward.
3. **Shortcuts** — Structural cracks, stiles, tunnels, stepping stones, or ropes in the overworld that let you bypass geographical blockades (e.g. Falador wall crumble, Varrock fence stile) if you meet the level requirement.
4. **Run Energy Regeneration** — The higher your Agility level, the faster your run energy refills. At 1 Agility, energy regenerates slowly; at 99, it refills several times faster, making transport extremely efficient.

## The Training Loop (Course Laps)

To train Agility effectively:

1. **Route to Course**: Travel to the chosen course (e.g. Gnome Stronghold Agility Course inside the Tree Gnome Stronghold).
2. **Start Obstacle**: Right-click the starting obstacle -> `climb-over`, `balance-on`, or `squeeze-through` (e.g., the log balance).
3. **Execute Obstacles in Sequence**: Move from obstacle to obstacle in the strict canonical order. If you skip an obstacle or run away mid-lap, you lose your lap progress.
4. **Lap Completion**: Click the final obstacle (e.g., the obstacle pipe). Upon crossing, you receive the final obstacle XP plus the **Lap Bonus XP** notification.
5. **Repeat**: Walk back to the starting obstacle and begin the next lap immediately.

## Agility Course & Shortcut Reference

### Agility Courses
- **Gnome Stronghold Course** (Level 1 Agility, 86.5 XP total per lap):
  - Location: Tree Gnome Stronghold.
  - Obstacles: Log balance -> Obstacle net -> Balancing branch -> Balance rope -> Obstacle net -> Obstacle pipe.
  - Notes: 100% safe (cannot fail any obstacle). The premier level 1-35 training spot.
- **Agility Pyramid** (Level 30 Agility, ~1,000 XP per lap):
  - Location: Deep Kharidian Desert (south of Sophanem).
  - Notes: High hazard (frequent failures, heat damage, requires carrying waterskins). Excellent GP profit by selling gold pyramids to Simon Templeton.
- **Barbarian Outpost Course** (Level 35 Agility, 139.5 XP total per lap):
  - Location: North of Baxtorian Falls (requires completing Alfred Grimhand's Barcrawl).
  - Obstacles: Rope swing -> Log balance -> Obstacle net -> Balancing ledge -> Crumbling wall.
- **Wilderness Agility Course** (Level 52 Agility, 571.4 XP total per lap):
  - Location: Deep Wilderness (Level 50+).
  - Notes: Extremely high hazard due to PKers and aggressive NPCs. Highest XP rate in the early game.

### Essential Overworld Shortcuts
- **Falador Wall Crumble** (Level 5 Agility): Bypasses the long walk around the Falador west wall to reach the mining site.
- **Varrock South Fence Jump** (Level 13 Agility): Jump the fence near the champions' guild.
- **Grand Exchange Underwall Tunnel** (Level 21 Agility): Squeeze through the northwest wall of Varrock into the Grand Exchange grounds.
- **Draynor Manor Fence Jump** (Level 31 Agility): Bypasses the gate maze to enter Draynor Manor directly.

## Failure Modes & Recovery

| Symptom | Recovery |
|---|---|
| Failed obstacle / fell down | Some obstacles (like balancing ledges or ropes) have a chance of failing. You will fall, take minor hitpoint damage, and be teleported back to the floor. Eat food to recover HP, walk back to the start of that obstacle, and try again. |
| Lap sequence broken | If you walk away, logout, or skip an obstacle, the lap tracker resets. Start again from the very first obstacle of the course to re-enable the lap bonus. |
| Dehydration in desert | Training at the Agility Pyramid causes rapid thirst. Always carry 4+ full **Waterskins** and drink whenever they dry out. |
| Wilderness PKers | If attacked while training in the Wilderness, immediately run south to escape or use protection prayers. Do not carry valuable items when training there. |
| "You are too heavy" / run energy empty | Agility training consumes no run energy, but heavy inventory makes you tire faster when running between courses. Keep your inventory empty during training. |

## Success Signals

- Obstacle crossing animation plays.
- Chat message: **"You balance/climb/squeeze across safely."**
- Chat message on final obstacle: **"You have completed the lap!"**
- Agility XP increases in the skill tab.
- Run energy refills visibly faster over time.

## When To Ask For Help

Speak publicly if:
- You fell and are dangerously low on Hitpoints without food.
- You are lost inside a high-level course (like Ape Atoll or Wilderness) and need routing assistance.
- You need a trade for waterskins in the desert to avoid heatstroke.

---

## Cross-references

- **Combat**: `skills/combat.md` — high Agility lets you run away from lethal encounters and dodge hits in dangerous areas.
- **Places**: `places.md` for specific course coordinates and shortcut landmarks.
- **Items**: `items.md` for weight-reduction gear and desert survival items.
- **Server impl** (for code work, not agent reasoning): `feat/skill-agility.md`.
