# QA029 - Low-Health Fishing Recovery Near Passive NPCs

Date: 2026-05-30 CDT / 2026-05-31 UTC

## Question

After QA028 safely gave the live `res:qa-survivor` a small fishing net, why did the hot stack keep emitting `low_health_heal_wait` instead of routing to food?

## Finding

The resident was at the Lumbridge recovery area with a nearby passive `Man` NPC (`combatLevel: 2`). `hasNearbyRecoveryThreat` treated every alive NPC with `combatLevel > 1` inside 24 tiles as a threat. That blocked `starterFishingRouteAction`, and because the resident was already near the recovery waypoint, the recovery move also returned `undefined`. Hybrid thinking then fell through to `low_health_heal_wait`.

## Fix

The recovery threat heuristic now keeps named/high-risk threats conservative while allowing passive low-level Lumbridge NPCs:

- `Man` / other low-level passive NPCs no longer suppress emergency starter fishing.
- `Goblin`, `spider`, `zombie`, `skeleton`, and `guard` names still count as recovery threats.
- Any visible alive NPC with `combatLevel >= 5` still counts as a recovery threat.

## Verification

Red/green regression tests:

```bash
npm test -- --runInBand \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  -t "starter fishing"
```

Red result before fix:

- Body routine returned `undefined`.
- Hybrid thinking returned `low_health_stranded`.

Green result after fix: `2` suites passed; `14` matching tests passed.

Full focused suites:

```bash
npm test -- --runInBand \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts
```

Result: `2` suites passed; `408` tests passed.

Other checks:

```bash
npm run check:no-ui
npm run typecheck
npm run build
git diff --check -- src/controller/spark/runescape-body-routines.ts \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  docs/agent-status.md
```

Results: server UI boundary clean, TypeScript clean, build compiled `805` files, patch whitespace clean.

## Live Proof

Restarted the controller against the rebuilt `dist` and re-ensured the live survivor still had the net:

```bash
npm run controller:ensure-inventory -- --resident res:qa-survivor --item 303 --amount 1
```

Result:

```json
{"ok":true,"resident":"res:qa-survivor","itemId":303,"requestedAmount":1,"previousAmount":1,"amount":1,"addedAmount":0}
```

Resident smoke:

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible --resident res:qa-survivor
```

Result: `OK res:qa-survivor`; `8` new actions, `8` successful results, `0` timeouts, `0` failures, last action `eat`.

Action-log proof after restart:

```json
{"t":"2026-05-31T01:57:06.220Z","tick":215,"action":{"kind":"move_to","target":{"x":3241,"y":3242,"level":0},"range":7,"cause":"low_health_fish_food"}}
{"t":"2026-05-31T01:57:21.512Z","tick":241,"action":{"kind":"interact","target":{"key":"rs:fishing_spot_net_bait","name":"Fishing spot","position":{"x":3241,"y":3242,"level":0}},"option":"net","cause":"low_health_fish_food"}}
{"t":"2026-05-31T01:57:26.128Z","tick":246,"source":"nervous-system","ruleId":"eat-when-low-health","action":{"kind":"eat","slot":1,"cause":"nervous:eat-when-low-health"}}
```

## Remaining Gap

This packet proves the live resident now leaves `low_health_heal_wait`, walks to the starter fishing spot, nets fish, and attempts to eat under the survival reflex.

It does **not** yet prove the full chain:

`hurt -> fish -> cook -> eat -> safe combat re-engage`

The latest smoke showed repeated `nervous:eat-when-low-health` submissions after the netting step. Next best work is to inspect whether that is normal queued-action/perception lag or an eat/result accounting bug, then rerun a longer combat re-engage soak.
