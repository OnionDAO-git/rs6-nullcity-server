# QA030 — Low-health eating must ignore raw and burnt fish

Date: 2026-05-30 CDT
Branch: `agents/wip`
Resident: `res:qa-survivor`

## Why This Ran

QA029 proved the repaired low-health survivor could leave `low_health_heal_wait`, route to the Lumbridge starter fishing spot, and net raw shrimp. The next live window exposed a bad survival loop: the nervous system treated `rs:raw_shrimp` as edible because its food predicate matched `shrimp`, so the resident repeatedly submitted `nervous:eat-when-low-health` against raw fish.

This blocked the larger combat capability claim: a hurt resident needs to fish, cook, eat, and then safely re-engage. Eating raw fish is incoherent and hides the real cook/eat planning gap.

## Root Cause

`src/controller/nervous-system/nervous-system.ts` had a local `FOOD_KEY_PATTERN` that matched raw and burnt fish-shaped keys. The body routine already treated raw/burnt fish as not ready-to-eat, but the higher-priority nervous reflex bypassed that body logic and submitted `eat` first.

Live log proof before the fix:

- `2026-05-31T01:57:24.986Z` — `item_received` `rs:raw_shrimp`.
- `2026-05-31T01:57:25.632Z` — controller submitted `eat` slot 1.
- `2026-05-31T01:57:26.145Z` — final `action_result` arrived for that request.
- The pattern repeated across many raw-shrimp receipts in `data/agent-logs/res:qa-survivor/2026-05-31.jsonl`.

The gateway was returning final `action_result` frames; this was not missing result accounting. It was the wrong edible-food predicate.

## Fix

Changed the nervous-system food predicate so emergency eating only selects ready-to-eat food:

- Rejects generic raw keys such as `rs:raw_sardine`.
- Rejects starter raw fish item ids `317` and `321` plus `rs:raw_shrimp` / `rs:raw_anchovies`.
- Rejects burnt fish/food keys and starter burnt fish item ids.
- Still selects cooked starter fish such as `rs:shrimps`.

Added regression tests in `src/controller/nervous-system/nervous-system.test.ts`:

- Low health + raw starter fish does not fire `nervous:eat-when-low-health`.
- Low health + cooked starter fish still eats.
- Raw fish before cooked fish skips raw and eats the cooked slot.
- Generic raw fish such as `rs:raw_sardine` is not edible.
- Burnt food is not edible.

## Verification

Red test first:

```bash
npm test -- --runInBand src/controller/nervous-system/nervous-system.test.ts -t "raw starter fish|cooked starter fish|burnt food"
```

Initial result: failed for raw starter fish and burnt food because both still emitted `nervous:eat-when-low-health`.

Focused green tests:

```bash
npm test -- --runInBand src/controller/nervous-system/nervous-system.test.ts -t "raw starter fish|cooked starter fish|burnt food|raw fish|generic raw fish"
```

Result: PASS, 5 matching tests.

Broader regression suite:

```bash
npm test -- --runInBand src/controller/nervous-system/nervous-system.test.ts src/controller/resident-runtime.test.ts src/controller/spark/runescape-body-routines.test.ts
```

Result: PASS, 3 suites, 249 tests.

Other gates:

```bash
npm run check:no-ui
npm run typecheck
npm run build
npx biome lint src/controller/nervous-system/nervous-system.ts src/controller/nervous-system/nervous-system.test.ts
```

Results: all PASS. Build compiled 805 files. Biome checked 2 files with no fixes.

`npm run fin` was not run in this QA030 slice because parallel S-ECON files were already dirty in the server worktree.

## Live Hot-Stack Evidence

Controller was rebuilt and restarted against the patched `dist`. Then:

```bash
npm run controller:ensure-inventory -- --resident res:qa-survivor --item 303 --amount 1
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible --resident res:qa-survivor
```

Inventory ensure returned `ok: true` and confirmed one small fishing net.

Smoke result:

```text
OK res:qa-survivor tick=160 actions=5 results=6 success=5 timeout=1 fail=0 says=1 observed=60000ms/+92t actions=3 results=3 success=2 timeout=1 fail=0 says=1 lastAction=move_to lastResult=timeout:timeout
```

The smoke kept the resident alive and acting, but it did capture one movement timeout. That timeout is a follow-up, not part of the raw-food classifier fix.

Post-restart log scan from `2026-05-31T02:10:30Z` onward:

- Many `item_received` events for `rs:raw_shrimp` appeared between `02:10:34Z` and `02:11:14Z`.
- No `nervous:eat-when-low-health` actions were emitted in the post-restart controller action window.
- The survivor moved and spoke instead: `combat_seek_safe_target`, `stuck_move_recovery`, `continue_move`, and one status `say`.

Cause histogram after restart:

```json
{
  "total": 8,
  "counts": {
    "combat_seek_safe_target": 5,
    "stuck_move_recovery": 1,
    "continue_move": 1,
    "say": 1
  }
}
```

This proves the raw-shrimp eat spam was removed from the live loop.

## Remaining Open Work

QA030 does not prove the full food-resupply combat loop. It proves the resident stops treating raw fish as edible.

Next targeted packet:

1. Put `res:qa-survivor` in a low-health, raw-fish, nearby-range state.
2. Prove it cooks raw fish into edible food.
3. Prove the nervous reflex eats the cooked fish.
4. Prove it safely returns to low-risk combat without death or unsafe targets.

Also observed during restart: `MaxListenersExceededWarning` on `GatewayClient` action-result listeners. This suggests a separate action-result listener cleanup/backpressure QA packet should follow if it recurs.
