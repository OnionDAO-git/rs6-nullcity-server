# QA-20260530-027 — combat recovery food-resupply route

Packet: `QA-20260530-027`

Resident target: `res:qa-survivor`

## Question

After QA026 proved that a hurt, foodless combat resident can survive but strand in
`low_health_heal_wait`, can the resident choose a concrete food-resupply route
instead of waiting forever?

## Finding

Root cause: low-health recovery could eat carried food, cook carried raw fish, net
a visible fishing spot, or pick up visible cooked food. Once the resident reached
the recovery waypoint with no carried food and no visible food source, it did not
route toward a food source. The hybrid thinking layer then yielded into
`low_health_heal_wait`.

## Fix

- `lowHealthRecoveryAction` now uses the existing `starterFishingRouteAction`
  when the resident is low-health, foodless, not threatened, and has a small
  fishing net.
- `starterFishingRouteAction` now accepts target-failure cooldowns and current
  tick so the recovery path does not bypass existing failed-target guards.
- `res:qa-survivor` fresh spawns now carry a small fishing net (`itemId: 303`) in
  addition to starter shrimp.

## Verification

```bash
npm test -- --runInBand \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  src/controller/soul/soul-loader.test.ts
```

Result: `3` suites passed, `420` tests passed.

New regression coverage:

- Low HP + small net + no visible food routes toward Lumbridge starter fishing
  with cause `low_health_fish_food`.
- Low HP + small net + nearby combat threat still retreats to the recovery
  waypoint instead of fishing.
- A stranded combat resident with a small net chooses the starter-fishing route
  instead of `low_health_heal_wait`.
- The `res:qa-survivor` starter soul includes a small fishing net for future fresh
  spawns.

## Live-Proof Caveat

This is not yet a full live re-engage pass. The already-running
`res:qa-survivor` save had an empty inventory from earlier tests, so changing the
starter soul does not retroactively add a net to that live save.

A full proof still needs a fresh or intentionally repaired survivor save, then:

```bash
npm run build
npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --prefix survive \
  --duration-ms=300000 \
  --poll-ms=500 \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa027-combat-resupply
```

Pass condition: no deaths, no unsafe attacks, visible `low_health_fish_food`
recovery toward starter fishing, food/cook/eat evidence, then a later safe attack.

## Status

Code-level blocker is fixed. Capability remains **partially proven** until the
fresh-save live soak shows the full hurt -> resupply -> eat -> re-engage chain.
