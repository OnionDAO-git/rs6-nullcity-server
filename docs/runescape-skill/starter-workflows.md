# Starter Workflows

Each workflow should be executable enough for Brain to choose a goal, Body to pick the next action, and the Nervous system to interrupt unsafe behavior. Workflow numbering matches the vocabulary used in `src/controller/knowledge/knowledge-retriever.ts` `ENGINE_KNOWLEDGE_ENTRIES` (currently 47 entries) so the LLM, the controller, and humans reading this doc all describe the same steps.

## Make A Fire

1. Check inventory for `rs:tinderbox` and `rs:logs`.
2. If both are present, `item_action use_item_on_item` (tinderbox on logs).
3. Wait for evidence: logs consumed, fire object nearby, firemaking message, or Firemaking XP change.
4. If logs are missing, switch to **Chop Logs**.
5. If tinderbox is missing, route to Lumbridge General Store (`3203,3247,0`) or ask a nearby player.

## Chop Logs

1. Check for a hatchet/axe (e.g., `rs:bronze_hatchet`) in inventory or equipment.
2. Pick a reachable ordinary Tree or Dead tree.
3. `move_to` interaction range and `interact` with the `chop down` or `chop` option.
4. Wait for `rs:logs`, Woodcutting XP, or depletion evidence.
5. If unreachable, choose a different visible tree and report the blocked target after repeated failures.

## Catch Shrimp

1. Check for `rs:small_fishing_net` (5 gp at fishing shops).
2. Find a net-capable fishing spot (this server's Lumbridge river starters are around `3239,3244` and `3241,3242`).
3. `move_to` the spot and `interact` with the matching fishing option (e.g., `net`).
4. Wait for `rs:raw_shrimps` or Fishing XP.
5. If the spot is missing, explore known water edges or report that no spot is visible.

## Cook Shrimp

1. Check for raw food (`rs:raw_shrimps`, `rs:raw_anchovies`, etc.) in inventory.
2. Find a nearby fire (your own from **Make A Fire**) or the Lumbridge Castle kitchen range (`3208,3213,0`).
3. `move_to` adjacent tile, then `item_action use_item_on_item` (raw food on fire/range) — or right-click the range with `cook`.
4. Wait for raw item → cooked equivalent and Cooking XP change.
5. Burnt items have no heal value; right-click → `drop` to discard. Repeat until inventory is cooked.

## Bury Bones

1. If `rs:bones` are in inventory, `item_action bury`.
2. Wait for bones to leave inventory or Prayer XP to change.
3. If bones are missing, **Safe Starter Combat** produces bones, but survival has priority.

## Safe Starter Combat

1. Fight only low-risk nearby targets while healthy (HP > 60%).
2. Prefer chickens (level 1, 3 HP), cows (level 2, 8 HP), goblins (level 2-5, 5-12 HP), or rats (level 1, 2 HP) over unknown or stronger enemies.
3. Eat food (`item_action eat`) at 50% HP or retreat at 20% HP.
4. Loot useful drops (bones, raw meat, hides) only when no enemy is hitting you.
5. Explain danger in chat if a fight is blocked by low health or missing food.

## Combat → Prayer Chain Loop

1. **Safe Starter Combat** with the highest-tier monster you can safely kill.
2. After each kill, `item_action loot bones`.
3. `item_action bury` immediately to bank Prayer XP per bone.
4. Inventory holds ~25 bones + 3 food before banking. When full, bank or drop trash.
5. Stop when HP drops below safe threshold or all food is consumed; eat/flee per **Eat When Hurt** / **Flee When Outmatched** rules.

## Trade With Player

1. `move_to` close to the target player (within 1 tile).
2. Right-click the player → `trade`. Wait for the trade interface to open.
3. `trade_offer_item` for each item you want to exchange; counterparty must reciprocate.
4. Both press `trade_accept` (twice for confirmation in 2006 mechanics).
5. If the deal is unfair or counterparty changes the offer after accept, `trade_decline`. NEVER finalize a trade you have not personally verified.

## Cast A Spell (Magic)

1. Open the spellbook tab (Magic icon on the interface bar).
2. Verify rune count: e.g., Wind Strike needs 1 `rs:air_rune` + 1 `rs:mind_rune`.
3. Click the spell name in the spellbook — for combat, the spell auto-targets the highlighted NPC.
4. Wait for damage number, rune count decrement, and Magic XP change.
5. If "you do not have enough runes" — route to Aubury's Rune Shop in Varrock (`3253,3401,0`).

## Shoot With Bow (Ranged)

1. Equip a bow (e.g., `rs:shortbow`) in the weapon slot and matching arrows (e.g., `rs:bronze_arrow`) in the ammo slot.
2. Right-click target NPC → `attack`. Auto-fire continues until ammo or target ends.
3. Walk over the tile after combat to recover dropped arrows (most ammo persists).
4. If "you need a Ranged level of X" — train one tier down until level reached.
5. Out of ammo: switch to melee weapon to finish current fight, then route to Lowe's Archery (Varrock, `3233,3424,0`) or fletch your own.

## Smith A Bar

1. Check ore: copper + tin → bronze (level 1); iron → iron (15); 1 mithril + 4 coal → mithril (50); etc.
2. `move_to` a furnace (e.g., Lumbridge `3227,3258,0` or Edgeville).
3. `item_action use_item_on_item` (ore on furnace) to smelt. Bar appears in inventory.
4. With `rs:hammer` equipped and bars in inventory, `move_to` an anvil and `interact` to forge weapon/armor.
5. Watch for Smithing XP change after each smelt and forge.

## Eat When Hurt

1. Monitor HP after every hit. Thresholds:
   - HP > 60%: keep fighting.
   - HP 30-60%: finish current swing, then `item_action eat`.
   - HP < 30%: eat immediately, even mid-swing.
   - HP < 20%: eat AND prepare to **Flee When Outmatched**.
2. Eat the highest-heal food in inventory first (swordfish 14 > lobster 12 > tuna 10 > salmon 9 > trout 7 > shrimp 3).
3. Eating takes 1 tick and does NOT interrupt auto-retaliate.
4. Burnt items have no heal value; do not rely on them.

## Flee When Outmatched

1. Trigger: HP < 20% **or** no food left **or** aggressor combat level > 2× yours.
2. `move_to` nearest safe POI: Lumbridge bank `3208,3219,2`, embassy atrium, Edgeville bank, or known faction home.
3. Toggle run mode if energy > 30%.
4. `say` publicly: *"Retreating — too strong / out of food / low HP."* — so Brain logs the encounter and does not re-engage immediately.
5. Once safe, eat or bank before any new engagement.

## Follow And Report

1. Listen for direct player mentions (name in chat) and simple commands.
2. Acknowledge mentions within 2 ticks (use `communication-respond-to-mention` rules).
3. Answer "status" queries with current goal, next action, and nearest landmark.
4. Follow configured players when asked, staying close enough to be visible.
5. If stuck or far away, return to the visibility anchor or explain location and intended route.

---

## Cross-references

Workflow numbering above corresponds to `ENGINE_KNOWLEDGE_ENTRIES` in `src/controller/knowledge/knowledge-retriever.ts`:

- Per-skill: `skill-firemaking-basic`, `skill-woodcutting-basic`, `skill-fishing-basic`, `skill-cooking-basic`, `skill-prayer-basic`, `combat-safe-basic`, `skill-magic-basic`, `skill-ranged-basic`, `skill-smithing-basic`, `skill-trading-basic`.
- Multi-skill chains: `workflow-woodcutting-firemaking-chain`, `workflow-fishing-cooking-chain`, `workflow-combat-prayer-chain`.
- Survival: `survival-eat-when-hurt`, `survival-flee-when-outmatched`, `death-and-recovery`.
- Social: `social-follow-codex`, `communication-public-chat-rules`, `communication-help-request-pattern`, `communication-respond-to-mention`.
- World: `place-lumbridge-anchor`, `place-varrock-hub`, `place-falador`, `place-edgeville`, `place-al-kharid`, `place-draynor-village`, `place-wilderness-danger`.

When adding a new workflow here, also add or update the matching `ENGINE_KNOWLEDGE_ENTRIES` entry so the LLM and human design doc stay aligned.
