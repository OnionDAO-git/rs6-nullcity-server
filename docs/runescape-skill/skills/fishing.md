# Fishing — Agent Skill Reference

Agent-facing knowledge for training and exploiting Fishing in the 2006 RuneJS world (revision 435). For server implementation details, see `feat/skill-fishing.md` — that file is for code, not for agents.

Fishing is the canonical front half of the food supply chain: you use the right tool on the right water tile, raw fish enters your inventory with XP, and the raw fish feeds Cooking on a fire or range. Treat Fishing as paired with Cooking (and, transitively, Combat — cooked fish is the food a combat agent eats between swings). A starter agent rooted in Lumbridge can begin Fishing within thirty seconds of spawning if a small net is already in inventory.

## Find A Fishing Spot

Fishing spots are dynamic water tiles with a visible ripple animation. They are not labeled — distinguish them by the animation pattern and the right-click options the engine offers:

1. **Small net spots** — gentle ripple, two options `net` and `bait`. Yield shrimp (level 1) and anchovies (level 15).
2. **Bait spots** — wider ripple, options `bait` and `lure`. Yield sardine (level 5) and herring (level 10). Require fishing bait in inventory.
3. **Fly fishing spots** — long flowing ripple along a river, options `lure` and `bait`. Yield trout (level 20) and salmon (level 30).
4. **Cage spots** — slow heavy ripple along a coast, options `cage` and `harpoon`. Yield lobster (level 40).
5. **Harpoon spots** — same coastal slow ripple as cage, but the agent's intent decides which option to click. Yield tuna (level 35) and swordfish (level 50).
6. **Big net spots** — wide deep-water ripple, found only at Catherby and Karamja docks. Yield mackerel, cod, and bass via the `net` option (a different "big net" interaction internally).

Best starter location: **Lumbridge Castle riverbank** (small net spot, shrimp and anchovies). Walk south from the castle to the riverbank, click the rippling tile, choose `net`.

For agents: the spot animation looks similar across cage and harpoon — read the right-click menu, do NOT assume from the ripple alone. If the wrong option is selected, the engine returns *"You need a <tool> to fish here."*

## Fishing Equipment Per Spot

The tool gates the fish; the level gates the catch roll. Carry the matching tool before walking to the spot.

- **Small net** (Lumbridge fishing shop, ~5gp) — shrimp (level 1), anchovies (level 15). The default starter tool.
- **Fishing bait** (any fishing or bait shop; tackle shop in Port Sarim) — sardine (level 5), herring (level 10). Bait is consumed per catch — buy in stacks of 50+.
- **Fly fishing rod + feathers** — trout (level 20), salmon (level 30). Feathers come from chicken kills or feather merchants. Feathers are consumed per catch.
- **Lobster cage** — lobster (level 40). No consumable; reusable forever.
- **Harpoon** — tuna (level 35), swordfish (level 50). No consumable; reusable forever.
- **Big net** — mackerel / cod / bass at Catherby docks. The net is heavier than the small net but interaction is identical.

Best-tool rule: hold the highest-tier tool whose level you meet, plus the one tier below as a fallback (a small net while training trout, in case a net-only spot is the only one visible at the bank you stop at).

## The Fishing Loop

1. Approach a fishing spot — be within one tile of the water edge (the engine auto-walks).
2. Right-click the rippling tile → matching fishing option (`net`, `bait`, `lure`, `cage`, `harpoon`).
3. Wait. Catches tick every 2-5 ticks depending on tool and fish tier; success is a per-tick roll against the fish's level threshold.
4. On success: raw fish enters inventory, Fishing XP gain in the skill tab, chat message **"You catch a <fish>"** (or *"some shrimps"* / *"an anchovy"* — quantity word varies).
5. The spot may move occasionally — the ripple disappears and re-spawns 1-5 tiles along the water edge after a random interval. Either follow it (walk to the new ripple) or find a different active spot in the same waterline.
6. When inventory fills (28 slots): either **cook on-site** (need logs + tinderbox — see Firemaking workflow) or **bank** the raw fish for later cooking + selling.

## Fish Level And XP

Memorize the Fishing-level requirement and XP-per-fish; they drive route selection.

- **Shrimp** — level 1, 10 XP
- **Sardine** — level 5, 20 XP
- **Herring** — level 10, 30 XP
- **Anchovies** — level 15, 40 XP
- **Trout** — level 20, 50 XP
- **Salmon** — level 30, 70 XP
- **Tuna** — level 35, 80 XP
- **Lobster** — level 40, 90 XP
- **Swordfish** — level 50, 100 XP
- **Shark** — level 76, 110 XP (requires harpoon + Cooking 80 to use the food at all)

Rule of thumb: once you unlock the next tier, swap to it — XP per inventory rises sharply at every step. Anchovies at 15 in a small-net spot is the cheapest XP bump in early Fishing (10 → 40 XP, same tool, same spot, no equipment cost).

## Where To Fish (Starter)

Default routing for an agent under Fishing level 40:

- **Lumbridge Castle riverbank** — small net spot, shrimp + anchovies, levels 1-19. Closest to spawn. No combat hazard, no equipment cost beyond the 5gp net.
- **Draynor Village wharf** — small net spot **and** a harpoon spot at the end of the pier. Levels 1-19 on net; levels 35+ on harpoon once tuna unlocks. Two-minute walk from Lumbridge along the south road.
- **Barbarian Village fishing** — fly fishing spots (trout + salmon), levels 20-29. A river run north from Lumbridge through the Lumbridge swamp to the south Barbarian Village riverbank. No combat hazard once Barbarians are walked past.
- **Catherby docks** — every spot type in one location. Out of scope for starter agents (route requires the long walk through Taverley or a teleport).

If a spot is contested (another player or agent on every active ripple), walk one waterline tile in either direction — spots respawn along the bank, not exactly where you stood. The engine does not queue casts.

## Fishing + Cooking Pair

Caught raw fish becomes food value only after cooking. Raw fish has zero heal value — eating it is a no-op (the engine still consumes the item). The classic starter route:

1. **Fish** at the chosen spot until inventory fills.
2. **Cook** on a fire or range. Right-click the raw fish → `use` → click the fire/range tile. Use a range (Lumbridge Castle kitchen, Catherby range) for a lower burn rate than an open fire.
3. **Eat** the cooked fish during combat (see `combat.md` food heal table) or bank it.

Burn rate by fish:

- **Shrimp** — level 1 to cook, level 34 stops burning on a fire. Easy starter.
- **Sardine** — level 1 to cook, 38 stop-burn.
- **Trout** — level 15 to cook, 50 stop-burn on a range.
- **Salmon** — level 25 to cook, 58 stop-burn.
- **Lobster** — level 40 to cook, often burn until ~60 Cooking on a fire; ~55 on a range.
- **Swordfish** — level 45 to cook, burn until ~80+ Cooking.

If the agent does not have a tinderbox + logs (fire) or is not standing on a range tile, banking the raw fish is the correct move — never abandon raw fish on the ground unless power-fishing.

## Power-Fishing vs Bank-Fishing

Two strategies, picked by what the agent wants out of the session:

- **Power-fishing** = catch → drop raw fish on the ground → keep catching. Skips the bank walk entirely. Max Fishing XP per hour, zero gp profit, zero food output. Use for: leveling Fishing to a milestone (15, 20, 40, 50) as fast as possible.
- **Bank-fishing** = catch → walk to bank → deposit → walk back. Slower XP per hour but preserves every raw fish for cooking and selling. Use for: stockpiling food for a combat agent, gp farming (lobsters and swordfish are high-value).

Default for a starter agent: **power-fish shrimp toward level 20**, then **transition to bank-fishing + cooking** (trout at Barbarian Village, lobster at Karamja once accessible) to feed combat sessions.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Net lost (death, drop) | Buy a small net at the Lumbridge fishing shop (~5gp). Never cast unarmed — the engine refuses the action without the matching tool in inventory. |
| Spot vanished mid-cast | Normal — spots migrate along the waterline. Walk 1-3 tiles in either direction and re-target. Do NOT spam-click the empty water; the engine queues nothing. |
| Inventory full mid-catch | Stop casting. If power-fishing, drop the lowest-XP fish first (shrimp before anchovy). If bank-fishing, walk to the nearest bank (Draynor for Lumbridge riverbank, Varrock west for Barbarian fishing). Announce: *"Inventory full — banking raw trout at Draynor."* |
| No cooking method available (no tinderbox + logs, no nearby range) | Bank the raw fish — do NOT eat it raw (no heal value). Route to a range before the next combat session. |
| Spot pattern recognition failure (clicked cage on a small-net spot) | Engine returns *"You need a <tool> to fish here."* Read the right-click menu, not the ripple. Re-target with the correct option. |
| Bait or feathers ran out | Stop bait/lure spots and fall back to a small-net or cage spot (no consumable). Restock from a tackle shop before the next bait session. |

## Success Signals

- Raw fish item appears in the inventory grid.
- Fishing XP gain animation in the skill tab.
- Chat line: **"You catch a <fish>"** — exact text, fish name lowercase. Plural fish ("some shrimps") use *"You catch some <fish>"*.
- Spot ripple still animating on the same tile (spot is still active for another cast).
- `progress.jsonl` shows incremental Fishing XP entries over the session.

---

## Cross-references

- **Combat**: `skills/combat.md` — cooked fish is the food a combat agent eats. The food heal table there is the demand signal for this skill.
- **Starter quick reference**: `starter-workflows.md` § *Catch Shrimp* — the minimal version for the Brain to dispatch.
- **Cooking**: forthcoming `skills/cooking.md` — the back half of the raw-to-cooked chain. Until it lands, the burn-rate table above is the canonical agent reference.
- **Server impl** (for code work, not agent reasoning): `feat/skill-fishing.md`.
- **Items**: `items.md` for fish + tool item IDs and shop object references.
- **Places**: `places.md` for fishing spot locations and routing anchors.
