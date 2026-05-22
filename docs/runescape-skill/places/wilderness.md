# The Wilderness — World Geography & Playbook

Agent-facing knowledge for navigating **The Wilderness** in the 2006 RuneJS world (revision 435).

The Wilderness is a massive, high-risk PvP (Player vs Player) zone covering the northern region of the RuneJS world. It is highly dangerous, featuring aggressive monsters and allowing players to attack each other depending on the depth level. Agents must exercise extreme caution, follow survival protocols, and only enter the Wilderness when specifically authorized.

---

## 1. Coordinates & Key Locations

| Location | Coordinates (X, Y, Z) | Description / Notes |
|---|---|---|
| **Edgeville Ditch Jump** | `3093, 3520, 0` | Boundary north of Edgeville Bank. The safest entry point. |
| **Varrock Ditch Jump** | `3222, 3520, 0` | Boundary north of Varrock Palace. High-risk entry point. |
| **Dark Warriors' Fortress** | `3030, 3630, 0` | Mid-level multi-combat castle. Level 14 Wilderness. |
| **Lesser Demon Ruins** | `3286, 3886, 0` | Deep wilderness ruins. Level 45+ Wilderness. |
| **Mage Arena** | `3107, 3934, 0` | Deepest safe zone and rune shop. Level 55 Wilderness. |

---

## 2. Wilderness Mechanics & Danger Levels

### The Wilderness Ditch
- **Strategy**: Jump the ditch to enter the Wilderness. Jumping is a distinct, non-cancelable action.
- **Ditch Locations**:
  - **Edgeville**: `3093, 3520, 0` (immediately north of Edgeville bank, recommended for fast escapes).
  - **Varrock**: `3222, 3520, 0` (north of Varrock palace church/east bank).

### Wilderness Levels (1 to 55)
- **Combat Level Bracket**: In the Wilderness, players can only attack and be attacked by other actors whose combat levels are within the range of the current Wilderness Level.
  - **Calculation**: `Target Combat Level Range = [Your Combat Level - Wilderness Level, Your Combat Level + Wilderness Level]`.
  - **Implication**: At level 1 Wilderness (just past the ditch), a Level 30 player can only fight Level 29–31 actors. At level 50 deep Wilderness, a Level 30 player can fight Level 3–80 actors.
  - **Action**: Always monitor the current Y-coordinate. Wilderness levels increase as you travel further north (higher Y-coordinates).

### Multi-Combat vs. Single-Combat Zone
- Most of the southern Wilderness is **Single-Combat** (only one opponent can attack you at a time).
- Deep Wilderness and specific structures (e.g., Dark Warriors' Fortress) are **Multi-Combat** zones where multiple aggressive monsters or players can attack you simultaneously. **AVOID multi-combat zones unless fully geared and authorized.**

---

## 3. Key Threats & Monsters

### Low-Level Wilderness Threats (Levels 1–15)
- **Wilderness Goblins (Level 25)**: Patrol the ruins north-east of the Edgeville ditch jump. Aggressive targets that can overwhelm low-level agents.
- **Thugs (Level 10)**: Found inside the Edgeville Wilderness dungeon segment. Highly aggressive.
- **Skeletons (Level 19 / 22)**: Patrol just north of the Varrock ditch. Very aggressive.

### High-Level Wilderness Threats (Levels 15–55)
- **Dark Warriors (Level 8–18)**: Located inside the Dark Warriors' Fortress. Aggressive in multi-combat.
- **Lesser Demons (Level 82)**: Found in deep wilderness ruins. Extremely high damage output.
- **PKers (Player Killers)**: Other human players or advanced combat agents patrolling hot spots. Always assume any visible player in the Wilderness is hostile.

---

## 4. Rules of Survival & Escape Protocols

To minimize risk and prevent catastrophic gear loss during autonomous runs:

### A. Pre-Entry Checklist
1. **Bank All Valuables**: Never enter the Wilderness carrying expensive armor, weapons, or large stacks of runes/coins. Keep only necessary food, low-cost training gear (e.g., bronze/iron), and a single weapon.
2. **Turn Auto-Retaliate OFF**: Auto-retaliate can pull your agent deeper into the Wilderness or lock you in combat, preventing you from escaping or running.
3. **Maintain High Run Energy**: Ensure run energy is above 70% before crossing the ditch so you can outrun aggressive monsters and PKers.

### B. Escape and Recovery Rules
1. **Head South Immediately**: If attacked, do not attempt to fight back. Immediately click south towards the nearest ditch jump or safe zone boundary.
2. **Use the Edgeville Route**: Edgeville is the preferred escape zone. The distance from the ditch to the safe-zone Edgeville Bank is only 26 tiles.
3. **Eat and Run**: Bind your food eating triggers. Eat food (e.g., Lobsters, Swordfish) while moving south. Do not stop walking/running to eat.
4. **Log Out in Safe Spots**: If you manage to lose threat/aggro, immediately attempt to walk/run south of the ditch or to a single-combat zone and log out to completely clear threat.

---

## 5. Travel & Routing

- **To Edgeville Bank (Safe South-West)**: Jump south over the Edgeville Wilderness ditch at `3093, 3520, 0` and walk directly south to the bank.
- **To Varrock Palace (Safe South-East)**: Jump south over the Varrock Wilderness ditch at `3222, 3520, 0`.
- **Deep Wilderness Travel (North)**: Follow the single-combat corridors. Avoid traversing through multi-combat zones unless pathing forces it.
