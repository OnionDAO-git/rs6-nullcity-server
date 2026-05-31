# QA032 combat target cooldown evidence

Date: 2026-05-30 / 2026-05-31 UTC

## Question

Can a low-health combat resident avoid replaying the same failed fallback combat/prayer waypoint, while still attacking a visible safe target that happens to stand on a cooled-down waypoint?

## Verdict

**Partially fixed.** The repeated fallback waypoint loop is addressed in code and tests, and the hot-stack rerun showed a much better combat path: 10 safe attacks, combat evidence, bones pickup/bury evidence, Prayer evidence, no unsafe attacks, and no deaths.

The strict fish -> cook -> eat -> safe-combat re-engage chain is still **not proven**. The latest blocker moved downstream: after low-health retreat, `res:qa-survivor` reached starter fishing and netted raw shrimp, but did not cook/eat/re-engage before the 180s verifier window ended.

## Commands and evidence

Pre-fix strict-chain artifact:

```bash
npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --prefix survive \
  --duration-ms=180000 \
  --poll-ms=500 \
  --require-low-health-recovery-chain \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa032-low-health-cook-eat-reengage
```

Artifact: `data/benchmarks/capability-qa-2026-05-30/qa032-low-health-cook-eat-reengage/named_combat_soak_20260531024550.json`

Result:

- `status: failed`
- `safeAttackActions: 0`
- `lowHealthFishActions: 0`
- `lowHealthCookActions: 0`
- `lowHealthEatActions: 0`
- The old repeated `{x:3249,y:3238}` loop stopped after target failure cooldowns started applying; the resident fell into stuck recovery/explore and asked for help.

Post-fix rerun after rebuild/restart:

```bash
npm run controller:ensure-inventory -- --resident res:qa-survivor --item 303 --amount 1

npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --prefix survive \
  --duration-ms=180000 \
  --poll-ms=500 \
  --require-low-health-recovery-chain \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa032-low-health-cook-eat-reengage-rerun
```

Artifact: `data/benchmarks/capability-qa-2026-05-30/qa032-low-health-cook-eat-reengage-rerun/named_combat_soak_20260531025617.json`

Result:

- `status: failed`
- failure reason: `No ordered low-health fish/cook/eat/reengage chain appeared in the named resident action log`
- `safeAttackActions: 10`
- `unsafeAttackActions: 0`
- `combatEvidence: 1`
- `bonesEvidence: 1`
- `prayerEvidence: 1`
- `survivalActions: 3`
- `deathEvents: 0`
- `lowHealthFishActions: 1`
- `lowHealthCookActions: 0`
- `lowHealthEatActions: 0`
- `lowHealthRecoveryReengageAttacks: 0`
- `lowHealthRecoveryChain: 0`

Representative action sequence from the rerun:

- safe attacks against low-level `Man` targets
- `combat_loot_pickup`
- `combat_bury_looted_bones`
- `combat_retreat`
- `low_health_fish_food` movement to `{x:3241,y:3242}`
- `low_health_fish_food` net interaction at `rs:fishing_spot_net_bait`
- repeated raw shrimp receipts in the event stream
- no cook/eat/re-engage before timeout

## Code changes

Files changed:

- `src/controller/spark/runescape-body-routines.ts`
- `src/controller/spark/runescape-body-routines.test.ts`
- `src/controller/thinking/hybrid-agent-helpers.ts`
- `src/controller/thinking/hybrid-agent-chat.ts`
- `src/controller/thinking/hybrid-agent-thinking-module.test.ts`
- `src/controller/resident-runtime.ts`

Behavioral changes:

- Combat and Prayer fallback waypoint selection now filters recently failed target coordinates.
- Active-goal combat/prayer routines, fallback actions, direct chat training commands, and runtime safe-combat routines pass `targetFailureCooldowns` into the body routines.
- Actor-specific cooldown matching stays narrower than waypoint matching, so a visible safe NPC at a cooled-down waypoint coordinate can still be attacked.
- Low-health recovery calls now pass target-failure cooldowns into body recovery.

## Verification

```bash
npm test -- --runInBand \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  -t "cooled-down combat waypoint|failed combat waypoint|failed prayer waypoint|recently timed out|skips a failed prayer"
```

Result: PASS, 6 selected tests.

```bash
npm test -- --runInBand \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  src/controller/resident-runtime.test.ts
```

Result: PASS, 479 tests.

```bash
npm run check:no-ui
npm run typecheck
npm run build
npx biome lint \
  src/controller/spark/runescape-body-routines.ts \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/thinking/hybrid-agent-helpers.ts \
  src/controller/thinking/hybrid-agent-chat.ts \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  src/controller/resident-runtime.ts
```

Result: PASS.

## Remaining blocker

The next root cause is likely the low-health recovery handoff after raw food is acquired. A read-only sidecar found that the low-health nervous path can suppress thinking with `nervous:eat-when-low-health`; the latest rerun also shows the resident continuing to receive raw shrimp without reaching `low_health_cook_food` or `low_health_eat`.

Recommended next packet:

`QA-20260530-033`: make low-health recovery progress from raw-food acquisition to cook/eat, without repeated stale eat suppression.

Suggested target:

- `src/controller/nervous-system/nervous-system.ts`
- `src/controller/nervous-system/nervous-system.test.ts`
- if needed, `src/controller/spark/runescape-body-routines.ts`

Suggested proof:

- regression: repeated stale low-health perception after one eat/fish attempt must not permanently suppress thinking/body recovery
- live: strict `controller:combat-soak --require-low-health-recovery-chain` passes with ordered fish -> cook -> eat -> safe attack re-engage

## Status

QA032 is a successful narrowing step, not a final combat-survival closeout. Directed starter combat is stronger after this work; full low-health cook/eat/re-engage remains open.
