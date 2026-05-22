# Mining — Agent Skill Reference

Agent-facing knowledge for training and exploiting Mining in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-mining.md` — that file is for code, not for agents.

Mining is the canonical front half of the gathering-to-product chain: you swing a pickaxe at a rock, ore enters your inventory with XP, and the ore feeds Smithing at a furnace and anvil. Treat Mining as paired with Smithing (and, transitively, Combat — the bars become weapons and armour). A starter agent rooted in Lumbridge can begin Mining within one minute of spawning.

## Find A Rock

Ore rocks are static, named objects in fixed mines. Distinguish them by visual tint before swinging:

1. **Copper** — orange-brown speckle, mostly grey base.
2. **Tin** — pale grey, almost white speckle.
3. **Iron** — rust-red, darker than copper, denser tint.
4. **Coal** — black-flecked grey, unmistakable once seen.
5. **Silver** — bright silver-white speckle, mirror-like.
6. **Gold** — yellow speckle, brighter than copper.
7. **Mithril** — blue speckle, cool tone.
8. **Adamantite** — green speckle, deeper than mithril's blue.
9. **Runite** — turquoise / cyan, brightest tint in the game.

Best starter mines, in order of agent priority:

- **Lumbridge swamp mine** (south of Lumbridge Castle, into the swamp): copper + tin, four rocks each. Closest mine to spawn — default for any new agent.
- **Varrock southeast mine** (just east of Varrock palace, outside the south gate): iron + tin + copper + silver. The biggest mixed starter mine; route here from Lumbridge once iron unlocks at level 15.
- **Mining Guild** (under Falador, entrance in the dwarven mining tunnels): coal + mithril, level 60 Mining required to enter. Out of scope for new agents.

For agents: walk to a known mine before mining. NEVER stand at the spawn anchor and try to mine — there are no rocks there. If unsure which mine is closest, route to Lumbridge swamp by default.

## Pickaxe Tiers

Higher pickaxe tier = faster swing rate = more ore per minute. The pickaxe also gates which ores you can mine — bronze and iron can technically swing at any rock, but the success roll on high-tier ore is so low that effective rate is near zero without the matching pickaxe tier.

1. **Bronze pickaxe** — Mining level 1, also requires Attack 1 to wield. Default starter kit; can hit any ore up to coal at reasonable rate.
2. **Iron pickaxe** — Mining 1, Attack 1. ~20% faster than bronze. Cheap upgrade at the Varrock general store.
3. **Steel pickaxe** — Mining 6, Attack 5.
4. **Mithril pickaxe** — Mining 21, Attack 20.
5. **Adamant pickaxe** — Mining 31, Attack 30.
6. **Rune pickaxe** — Mining 41, Attack 40. The mid-game baseline.

Best-pickaxe rule: equip (or carry in inventory) the highest-tier pickaxe whose Attack and Mining requirements you meet. A held pickaxe in inventory is used automatically if no pickaxe is equipped — useful for keeping a melee weapon in the wielded slot. If you have both, the higher-tier one is preferred regardless of slot.

## The Mining Loop

1. Approach an ore rock — be within one tile (the engine auto-walks to the rock face when you click).
2. Right-click the rock → `mine`, or → `prospect` first if unsure of the rock type (prospect tells you the rock's ore without consuming a swing).
3. Wait. Swings tick every 1-3 ticks depending on pickaxe; success is a per-swing roll against the rock's resistance.
4. On success: ore enters inventory, Mining XP gain in the skill tab, chat message **"You manage to mine some <ore>"**. The rock visual changes to a depleted grey stump.
5. Depleted rocks respawn after a fixed interval (copper/tin ~2s, iron ~5s, coal ~30s, mithril ~2min, adamant ~4min, runite ~12min). Either wait or move to the next rock — the agent default is to **move** unless the rock is rune-tier.
6. When inventory fills (28 slots): bank at the nearest bank (Varrock east bank for the SE mine, Falador east for the south-Falador mine, Draynor bank for Lumbridge-swamp banking) **or** drop low-value ore (copper/tin) on the spot — see *Power-Mining vs Bank-Mining* below.

## Ore Levels And XP

Memorize the Mining-level requirement and XP-per-ore values; they drive route selection.

- **Copper** — level 1, 17.5 XP
- **Tin** — level 1, 17.5 XP
- **Iron** — level 15, 35 XP
- **Silver** — level 20, 40 XP
- **Coal** — level 30, 50 XP
- **Gold** — level 40, 65 XP
- **Mithril** — level 55, 80 XP
- **Adamantite** — level 70, 95 XP
- **Runite** — level 85, 125 XP

Rule of thumb: once you unlock the next tier, swap to it — XP per inventory rises sharply at every step. Iron at 15 is the single biggest jump in early Mining (17.5 → 35 XP doubles your rate per swing).

## Where To Mine (Starter)

Default routing for an agent under Mining level 60:

- **Lumbridge swamp** — copper + tin, levels 1-14. Closest to spawn. No combat hazard.
- **Varrock SE mine** — iron + coal + tin + copper + silver, levels 15-29 on iron, 30+ on coal. Mid-game backbone. Watch for the occasional scorpion (level 14).
- **Falador SW mine** (south of Falador, outside the south gate): rune essence rocks (with a quest unlock) and a coal/mithril seam. Useful once Mining 41+ and the area is reachable.
- **Mining Guild** — coal + mithril at high density, but level 60+ only. Out of scope for starter agents; named here so the routing layer knows it exists.

If a mine is contested (another player or agent already swinging on every rock), walk to the next mine in the list rather than queuing — the engine does not queue swings.

## Mining + Smithing Pair

Mined ore becomes value only after smelting and smithing. The classic skiller route:

1. **Mine** ore at a starter mine.
2. **Smelt** at a furnace (Lumbridge furnace upstairs in the castle, Falador east furnace, Varrock west furnace). Right-click the furnace → `smelt`.
3. **Smith** the resulting bars at an anvil (Varrock west anvil is the standard).

Bar recipes to memorize:

- **Bronze bar** = 1 copper + 1 tin (Smithing level 1, 6.2 XP).
- **Iron bar** = 1 iron (Smithing 15, 12.5 XP). Has a ~50% failure rate without a Ring of Forging — half your iron ore is lost on smelt.
- **Steel bar** = 1 iron + 2 coal (Smithing 30, 17.5 XP).
- **Mithril bar** = 1 mithril + 4 coal (Smithing 50, 30 XP).
- **Adamant bar** = 1 adamantite + 6 coal (Smithing 70, 37.5 XP).
- **Rune bar** = 1 runite + 8 coal (Smithing 85, 50 XP).

Coal demand scales fast — by mithril tier you mine 4× more coal than mithril. Plan inventories accordingly.

## Power-Mining vs Bank-Mining

Two strategies, picked by what the agent wants out of the session:

- **Power-mining** = mine → drop ore on the ground → keep mining. Skips the bank walk entirely. Max Mining XP per hour, zero gp profit. Use for: leveling Mining to a milestone (15, 30, 41, 55) as fast as possible.
- **Bank-mining** = mine → walk to bank → deposit → walk back. Slower XP per hour but preserves every ore for later use (smithing, selling). Use for: gold farming, stockpiling coal for steel/mithril smithing, or any session where the ore has downstream value.

Default for a starter agent: **power-mine copper + tin to level 15**, then **bank-mine iron + coal** from Varrock SE for the smithing chain.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Pickaxe lost (death, drop) | Buy a bronze pickaxe at Varrock general store (~10gp) or Bob's Axes in Lumbridge. Never mine unarmed — the engine refuses the action without a pickaxe in inventory or equipped. |
| Inventory full mid-rock | Stop swinging. Drop low-value ore (copper/tin first, then iron) if power-mining, or walk to the nearest bank if bank-mining. Announce: *"Inventory full — banking iron at Varrock east."* |
| Rock depleted, no swing registered | Normal — wait for respawn or step one tile to the next rock. Do NOT spam-click the depleted rock; the engine queues nothing useful. |
| Unreachable rock (player blocking, terrain glitch) | Walk one tile away and re-target a different rock in the same mine. If every rock is blocked, move to the next mine in the routing list. |
| Mining failure (per-swing miss, no ore) | Expected — the per-swing roll is probabilistic. Just keep swinging; the next tick re-rolls. Do not announce failure unless 10+ consecutive swings on the same rock produce nothing (then check pickaxe tier vs ore tier). |
| Aggressive NPC in the mine (scorpion at Varrock SE) | Disengage by walking 5+ tiles toward the city wall. The scorpion loses aggro at distance. See `combat.md` if engaging. |

## Success Signals

- Ore item appears in the inventory grid.
- Mining XP gain animation in the skill tab.
- Chat line: **"You manage to mine some <ore>"** — exact text, ore name in lowercase.
- Rock visual changes from coloured (live) to grey stump (depleted).
- `progress.jsonl` shows incremental Mining XP entries over the session.

## When To Ask For Help

Speak publicly if:

- A pickaxe is missing and a nearby player might sell or drop one.
- Every rock in the chosen mine is contested for more than ~60s.
- The route to a higher-tier mine is blocked by an unsolved quest gate.

Use phrases the helper can act on: *"Need a bronze pickaxe — anyone selling?"*, not *"Can't mine."*

---

## Cross-references

- **Combat**: `skills/combat.md` — the pickaxe doubles as a low-tier melee weapon in emergencies (slower than a scimitar of equal tier, but better than unarmed). Bronze pickaxe ≈ bronze axe damage.
- **Starter quick reference**: `starter-workflows.md` — minimal mine-and-bank loop for the Brain to dispatch.
- **Server impl** (for code work, not agent reasoning): `feat/skill-mining.md`.
- **Items**: `items.md` for ore + pickaxe item IDs and bank object references.
- **Places**: `places.md` for mine and furnace location coordinates and routing anchors.
