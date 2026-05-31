# QA023 Survivor Combat Reengage After Recovery (2026-05-31)

## Goal

Verify that `res:qa-survivor` reengages safe combat in ordinary named-resident flow after the low-health cook/eat recovery chain fixes.

## What changed

- Tightened combat waypoint arrival to `range: 1` with explicit route steps (`3222,3218 -> 3230,3226 -> 3238,3230 -> 3245,3234 -> 3249,3238`) so survivor movement no longer treats distant prayer-range arrival as "good enough."
- Added route-forwarding helper logic so combat target search advances through waypoints instead of jumping/backtracking after a miss.
- Filtered defeated NPCs (`hpFraction === 0`) from exploration NPC chat targeting to reduce false "talk to dead Man" churn near combat loops.
- Hardened named-combat-soak low-health refusal detection so generic scout copy ("stop when hurt") is not miscounted as a refusal.

## Verification

- `npm test -- --runInBand src/controller/spark/runescape-body-routines.test.ts src/controller/admin/named-combat-soak.test.ts` (PASS)
- `npm run check:no-ui` (PASS)
- `npm run build` (PASS)
- `npm run fin` (sandbox-limited FAIL in unrelated socket-bind suites: `letters-http-server`, `city-integration/http-server`, `gateway-client` with `listen EPERM`)

## Live evidence

Existing hot-stack artifacts for this packet remain **failed**:

- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery/named_combat_soak_20260531174954.json`
  - Failed: low-health refusal before any safe attack.
- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-after-fix/named_combat_soak_20260531175735.json`
  - Failed: no safe attack observed.
- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-dead-skip/named_combat_soak_20260531180425.json`
  - Failed: still no safe attack observed (bones evidence present, attack evidence absent).

Attempted rerun from this sandbox:

- `npm run controller:combat-soak -- --resident res:qa-survivor --target goblin --duration-ms=90000 --output data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-final`
  - Failed to connect to gateway in this environment: `connect EPERM 127.0.0.1:43595`.

## Outcome

QA023 lands useful combat-route and verifier hardening, but **does not close** the named-resident reengage proof yet. The capability gap remains open under `QA-20260529-004` until a fresh live soak records ordinary safe attack evidence after recovery.
