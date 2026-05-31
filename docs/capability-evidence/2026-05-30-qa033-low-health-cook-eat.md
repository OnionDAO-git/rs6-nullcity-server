# QA033 low-health cook/eat handoff evidence

Date: 2026-05-30 / 2026-05-31 UTC

## Question

After a combat resident has already acquired raw fish, does low-health recovery progress toward cook/eat instead of staying trapped behind stale nervous/combat state?

## Verdict

**Partially fixed, still not fully closed.**

This packet fixes two real blockers:

- A busy resident carrying raw fish can now cook it while low on health instead of returning `resident_busy`.
- A low-health resident with only a stale, non-current combat target can now fall through to recovery/cooking instead of retreating from an already-ended fight.
- Combat target seeking now includes the Lumbridge courtyard waypoint, which let `res:qa-survivor` resume safe starter combat from the RuneScape Guide area.

The full strict live chain `fish -> cook -> eat -> re-engage` is still **not proven**. The latest strict run improved to 16 safe attacks, 0 unsafe attacks, and 0 deaths, but did not cross the ordered recovery-chain verifier. A read-only sidecar also found that the rerun likely did not drive `res:qa-survivor` below the low-health threshold during the observed window, so the negative artifact is useful but not a clean post-fix failure.

## Commands and evidence

Pre-fix/stale-priority regression:

```bash
npm test -- --runInBand src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "stale combat target" --no-coverage
```

Result before the fix: failed. The module returned `combat_retreat` from a stale `resident.combatTarget` instead of `low_health_cook_food`.

Post-fix focused tests:

```bash
npm test -- --runInBand \
  src/controller/thinking/hybrid-agent-thinking-module.test.ts \
  src/controller/spark/runescape-body-routines.test.ts \
  src/controller/nervous-system/nervous-system.test.ts \
  src/controller/resident-runtime.test.ts \
  src/controller/admin/named-combat-soak.test.ts \
  --no-coverage
```

Result: PASS, 5 suites / 533 tests.

Additional gates:

```bash
npm run check:no-ui
npm run typecheck
npm run build
```

Result: PASS. Build compiled 805 files.

Strict live rerun after the first QA033 fixes and before the stale-target fix:

```bash
npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target man \
  --prefix survive \
  --duration-ms=180000 \
  --poll-ms=500 \
  --require-low-health-recovery-chain \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa033-low-health-cook-eat-rerun
```

Artifact: `data/benchmarks/capability-qa-2026-05-30/qa033-low-health-cook-eat-rerun/named_combat_soak_20260531032210.json`

Result:

- `status: failed`
- `safeAttackActions: 16`
- `unsafeAttackActions: 0`
- `deathEvents: 0`
- `combatEvidence: 1`
- `bonesEvidence: 1`
- `lowHealthFishActions: 0`
- `lowHealthCookActions: 0`
- `lowHealthEatActions: 0`
- `lowHealthRecoveryChain: 0`

Useful details from that artifact:

- It proved the new `{x:3222,y:3218}` combat waypoint works: `res:qa-survivor` moved to Lumbridge courtyard and performed repeated safe `Man` attacks.
- It did not cleanly prove a post-fix low-health cook/eat failure. The sidecar found the final survivor chat reported `hpFraction: 0.8333333333333334`, and the artifact did not preserve inventory snapshots.
- Local save inspection after the run showed `res:qa-survivor` had a small fishing net and a full inventory of raw shrimp, so the remaining design concern is the handoff from raw food to cooking/eating, not the ability to acquire raw shrimp.

Post-restart hot-stack smoke after this packet's build:

```bash
bash scripts/post-restart-smoke.sh
npm run controller:smoke -- --observe-seconds 45 --allow-recent-visible
```

Results:

- `post-restart-smoke.sh`: READY; all 23 residents alive; every resident had recent trajectory activity.
- `controller:smoke`: all residents OK. `res:qa-survivor` had 3 actions in the 45s window, 2 successful recent results, and no failures; `res:qa-angler` and `res:qa-cook` remained active.
- Controller runtime log during the same restarted window showed live cooking/eating substrate proof from the fishing workflow:
  - `res:qa-angler` `use_item_on` with cause `starter_fishing_cook_catch`, outcome `success`, changed `skills,inventory`.
  - `res:qa-angler` `eat` with cause `starter_fishing_eat_cooked_fish_for_space`, outcome `success`, changed `inventory`.
  - `res:qa-survivor` safe-combat attack, bone pickup, and bone bury suggestions with runtime-observed success.

## Code changes

Files changed:

- `src/controller/nervous-system/nervous-system.test.ts`
- `src/controller/spark/runescape-body-routines.ts`
- `src/controller/spark/runescape-body-routines.test.ts`
- `src/controller/thinking/hybrid-agent-helpers.ts`
- `src/controller/thinking/hybrid-agent-thinking-module.ts`
- `src/controller/thinking/hybrid-agent-thinking-module.test.ts`

Behavioral changes:

- Raw starter fish no longer triggers a nervous low-health eat reaction; thinking/body recovery gets a chance to cook it.
- Low-health recovery runs before generic busy noops, while still suppressing repeated ranged `move_to` recovery spam during a busy action.
- Combat reaction ignores a stale non-current combat target when the resident is low on health and has no cooked food, allowing body recovery to cook or fish.
- Starter combat fallback routing can use the Lumbridge courtyard before the eastern goblin-field fallback.

## Remaining blocker

The strict named-resident verifier still requires a clean ordered `fish -> cook -> eat -> re-engage` chain from one live window. The next packet should either:

1. Add a dedicated low-health recovery soak that starts from a controlled raw-fish state and verifies `cook -> eat -> re-engage`, or
2. Extend `controller:combat-soak --require-low-health-recovery-chain` to capture initial inventory and accept a raw-fish baseline as a valid chain start.

The live substrate is stronger after QA033, but this capability should remain open until the strict chain passes.
