# QA028 - Operator Inventory Ensure

Date: 2026-05-30 CDT / 2026-05-31 UTC

## Result

`QA-20260530-028` shipped the missing operator-safe inventory repair path needed for live capability QA. We can now ensure a resident has a specific item total without deleting/recreating the resident save, preserving identity, XP, location, Library history, and action evidence.

## What Changed

- Added `ResidentRegistry.ensureInventoryItem(name, item, amount)`.
- Added gateway protocol message `ensure_inventory_item` and response `resident_inventory_ensured`.
- Added `GatewayClient.ensureInventoryItem(...)` with the longer inventory timeout budget.
- Added CLI:

```bash
npm run controller:ensure-inventory -- --resident res:qa-survivor --item 303 --amount 1
```

Safety behavior:

- Ensures a desired total, not a blind grant.
- Works for online and offline resident saves.
- Preserves existing inventory entries.
- Rejects full inventories for non-stackable items.
- Rejects impossible stack amounts above `2_147_483_647`.
- Refuses oversized offline inventories instead of silently truncating save data.
- Emits `item_received` evidence for online residents and saves afterward.

## Verification

Focused tests:

```bash
npm test -- --runInBand \
  src/server/agent/resident-registry.test.ts \
  src/server/agent/protocol/messages.test.ts \
  src/server/agent/gateway.test.ts \
  src/controller/transport/gateway-client.test.ts \
  src/controller/admin/ensure-inventory.test.ts
```

Result: `5` suites / `50` tests passed.

Other gates:

```bash
npm run check:no-ui
npm run typecheck
npm run build
```

Results: server UI boundary clean, TypeScript clean, build compiled `805` files.

## Live Proof

Seeded the existing hot-stack resident save without deletion/recreation:

```bash
npm run controller:ensure-inventory -- --resident res:qa-survivor --item 303 --amount 1
```

Result:

```json
{"ok":true,"resident":"res:qa-survivor","itemId":303,"requestedAmount":1,"previousAmount":0,"amount":1,"addedAmount":1}
```

Confirmed the resident was already alive:

```bash
npm run controller:revive -- --resident res:qa-survivor --attention 60000
```

Result: `res:qa-survivor is already living; attention=14639`.

Resident smoke:

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible --resident res:qa-survivor
```

Result: `OK res:qa-survivor`; `28` new actions, `29` successful results, `0` timeouts, `0` failures, `2` new says.

Combat soak:

```bash
npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --prefix qa028-resupply \
  --duration-ms=180000 \
  --poll-ms=500 \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa028-combat-resupply
```

Artifact: `data/benchmarks/capability-qa-2026-05-30/qa028-combat-resupply/named_combat_soak_20260531014147.json`

Result: `passed`, `score=1`, `attackActions=2`, `safeAttackActions=2`, `unsafeAttackActions=0`, `deathEvents=0`, `combatEvidence=1`.

Extra action-log proof after the artifact:

- `combat_attack_safe_target` against Man.
- `combat_retreat`.
- `combat_loot_pickup` for bones owned by `res:qa-survivor`.
- `combat_bury_looted_bones`.
- Later Goblin safe attacks and `low_health_seek_safe_recovery`.

## Remaining Gap

This closes the operator repair substrate and proves the repaired resident can keep acting and safely attack. It does **not** yet prove the full low-health no-food loop:

`hurt -> fish -> cook -> eat -> safe combat re-engage`

That should be the next live soak: force or wait for `res:qa-survivor` to reach the low-health/no-food/no-threat state while carrying the ensured net, then verify `low_health_fish_food` and subsequent cooking/eating before re-engage.
