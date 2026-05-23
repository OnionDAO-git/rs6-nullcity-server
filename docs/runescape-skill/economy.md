# Economy & Currency Reference

Agent-facing knowledge for earning coins, banking valuables, and pricing trades in the 2006 RuneJS world (revision 435). Pair with `items.md` for item drop sources and `skills/trading.md` for player-to-player trade mechanics.

## Coin Basics

1. Coins are stored as `rs:coins` (1 inventory slot regardless of count, stackable).
2. The 2006 RuneScape coin display caps the visible stack at "999,999,999" coins; balances above that are still tracked but only visible via inventory examine.
3. There is NO Grand Exchange in 2006; all trades are direct player-to-player (see `skills/trading.md`) or shop-mediated.

## Bank Basics

1. Banks are free to use and have unlimited slot capacity (counted in tabs).
2. Right-click any banker NPC → `bank` to open the bank interface (see `npcs/lumbridge.md` / `npcs/varrock.md` / `npcs/draynor-and-wizards-tower.md` for banker coords).
3. Drag items from inventory into bank to deposit; click stored items + amount to withdraw.
4. Banked items survive death; inventory items do NOT (you lose all but 3 in non-wilderness deaths).
5. Key banker coord list:
   - Lumbridge Castle (top floor): `3208,3219,2`
   - Varrock east bank: `3253,3420,0`
   - Varrock west bank: `3185,3436,0`
   - Falador east bank: `3013,3355,0`
   - Falador west bank: `2946,3369,0`
   - Edgeville bank: `3094,3243,0`
   - Draynor Village bank: `3094,3243,0`
   - Al-Kharid bank: `~3270,3167,0`

## Early Gp Sources (Tier 1: 1-10 gp/min)

1. **Chicken farming** (Lumbridge farm `3232,3299`): kill chickens, sell `rs:feather` stacks to fletchers / hoard for own arrows. 5gp/100 feathers.
2. **Cow farming** (Lumbridge cow field `3253,3275`): drop `rs:cowhide` → tan at Al-Kharid tanner (`3273,3192,0`) for 1gp/hide → sell soft leather to fletchers / craft into armour. Each cowhide nets ~5gp profit.
3. **Highwayman drops** (south of Falador on Port Sarim road): kill highwayman → loot `rs:coins` (5-25gp per kill); risk of HP damage.
4. **General store flipping** (Lumbridge General Store `3203,3247,0`): buy underpriced restocked items, sell to players. Slow but safe.

## Mid Gp Sources (Tier 2: 10-100 gp/min)

1. **Bronze → Steel smithing**: mine ore at Lumbridge swamp `3228,3148,0` or Dwarven Mine `3018,3450,0`; smelt at Lumbridge furnace `3227,3258,0`; smith into platebody/scimitar; sell. Profit scales with Smithing level.
2. **Iron longsword chain** (Smithing 15+): mine iron ore + 1 coal → iron bar → forge iron longsword (~150gp at Varrock players).
3. **Druid drops** (Taverley `2920,3475,0`, Druid 7): kill druid → loot `rs:unidentified_herb` → clean for Herblore + sell as guam/marrentill/tarromin to alchemists.
4. **Lobster fishing + cooking** (Catherby pier or Karamja `2923,3179,0`): fish 28 raw lobsters → cook → sell cooked lobsters at 100gp each to combatants.

## Late Gp Sources (Tier 3: 100+ gp/min)

1. **Rune ore mining** (Mining Guild `3017,9740,0` requires Mining 60): rune ore is ~10kgp per. Need at least adamant pickaxe.
2. **Yew tree chopping** (multiple locations; Woodcutting 60): yew logs ~300gp each, scales with batched runs.
3. **Quest rewards**: starter quests give XP not gp, but mid-game quests like Heroes' Quest reward 2.5k-3k+ gp.

## What To Sell vs Drop

| Item | Worth Selling? | Reasoning |
|---|---|---|
| Bronze dagger / spear | Drop | <10gp each; not worth inventory slot |
| Iron 2h sword | Sell | ~25gp at any sword shop |
| Steel scimitar | Sell | ~50gp at Varrock Sword Shop or player trade |
| Mithril+ weapons | Bank | Worth >100gp; bank then sell strategically |
| Cowhide | Tan then sell | Tan to soft leather +5gp per hide |
| Raw chicken | Drop | <2gp; eat or drop |
| Cooked lobster | Sell or eat | 100gp player trade; eat in combat |
| Bones (any) | Bury for Prayer XP | Never sell — Prayer XP is the value |
| Coins (any) | Bank | Always bank above 1k threshold |
| Quest items | Bank or use | Never drop — some quests retest |

## Trade Pricing Rules Of Thumb

1. **Bones**: 5-10 gp each (player demand for Prayer training).
2. **Cooked shrimp**: 5-10 gp each (low-tier food).
3. **Cooked lobster**: 100-150 gp each (combat food standard).
4. **Cooked swordfish**: 200-300 gp each (premium combat food).
5. **Rune essence**: 25-50 gp each (Runecrafting demand).
6. **Air/Mind runes**: 5 gp each from Aubury (Varrock), ~10 gp each from players.
7. **Death runes**: 200-300 gp each (high-tier combat magic).
8. **Yew logs**: 200-400 gp each (firemaking / fletching demand).
9. **Pure essence** (post-Rune Mysteries): higher than rune essence; ask before trading.

When uncertain about price, ask publicly: *"What's a fair price for X?"* — see `communication-help-request-pattern`.

## Starter Wealth Milestones

1. **100 gp**: enough for a tinderbox + small fishing net + bronze hatchet replacement after death (recovery cushion).
2. **1,000 gp**: enough for an iron scimitar + leather armour set + Lumbridge General Store restock kit.
3. **10,000 gp**: enough for mithril gear, rune supplies for Magic training (~250 chaos runes), or basic Construction starter.
4. **100,000 gp**: comfortable mid-game. Can fund yew log batched runs, adamant gear, mid-tier herbs.
5. **1,000,000 gp**: late-game baseline. Rune gear + Prayer altar restocks + Slayer task supplies.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Inventory full of low-value drops mid-combat | Drop bronze junk; keep bones + raw beef + cowhide |
| Lost everything in death | See `death-and-recovery` runtime entry; Lumbridge General Store + Bob's restock the basics for <50gp |
| Trade scammed (counterparty changed offer) | Trade-decline; never finalize without verifying current offer (see `skills/trading.md`) |
| Stuck below 100gp with no gear | Cow farm → tan → sell loop until 100gp recovery cushion |

## Success Signals

- Coin count rises in inventory after each kill / sale / quest completion.
- Bank holds at least 1 hatchet, 1 tinderbox, 1 small fishing net, 100gp cushion as recovery insurance.
- Per-session gp/hr rate logged in `progress.jsonl` (use to decide when to switch revenue source).

## When To Ask For Help

Speak publicly if:
- You need a specific item and no shop nearby: *"Need 1k for an iron scimitar — any players selling at Varrock?"*
- You don't know a fair price: *"What's a fair price for cooked lobster right now?"*
- You're locked out of banking by a stuck NPC or quest: report so a player can help unstick.

---

## Cross-references

- `items.md` § Recovery Heuristics — what shops restock starter tools.
- `skills/trading.md` — player-to-player trade FSM and safety rules.
- `skills/crafting.md` — cowhide → soft leather chain.
- `skills/smithing.md` — bronze → rune smithing pricing.
- `skills/cooking.md` — raw → cooked food markup.
- `npcs/lumbridge.md`, `npcs/varrock.md`, `npcs/draynor-and-wizards-tower.md` — banker coord lists.
- `monsters.md` — drop values per starter monster.
