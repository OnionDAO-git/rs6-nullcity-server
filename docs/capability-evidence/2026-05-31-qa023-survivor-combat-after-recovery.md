# QA023 Survivor Combat Reengage After Recovery (2026-05-31)

## Goal

Verify that `res:qa-survivor` reengages safe combat in ordinary named-resident flow after the low-health cook/eat recovery chain fixes.

## What changed

- Tightened combat waypoint arrival to `range: 1` with explicit route steps (`3222,3218 -> 3230,3226 -> 3238,3230 -> 3245,3234 -> 3249,3238`) so survivor movement no longer treats distant prayer-range arrival as "good enough."
- Added route-forwarding helper logic so combat target search advances through waypoints instead of jumping/backtracking after a miss.
- Filtered defeated NPCs (`hpFraction === 0`) from exploration NPC chat targeting to reduce false "talk to dead Man" churn near combat loops.
- Hardened named-combat-soak low-health refusal detection so generic scout copy ("stop when hurt") is not miscounted as a refusal.
- Hardened `GatewayClient.connectResident` to use the longer resident-connect timeout instead of the generic 10s request timeout; this prevents controller startup from dying while a full roster is connecting under runtime load.

## Verification

- `npm test -- --runInBand src/controller/spark/runescape-body-routines.test.ts src/controller/admin/named-combat-soak.test.ts src/controller/transport/gateway-client.test.ts` (PASS)
- `npm run check:no-ui` (PASS)
- `npm run build` (PASS)
- `npm run fin` (sandbox-limited FAIL in unrelated socket-bind suites: `letters-http-server`, `city-integration/http-server`, `gateway-client` with `listen EPERM`)

## Live evidence

Diagnostic hot-stack artifacts for this packet failed before the final route/stack hardening:

- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery/named_combat_soak_20260531174954.json`
  - Failed: low-health refusal before any safe attack.
- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-after-fix/named_combat_soak_20260531175735.json`
  - Failed: no safe attack observed.
- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-dead-skip/named_combat_soak_20260531180425.json`
  - Failed: still no safe attack observed (bones evidence present, attack evidence absent).

Final live reruns on the running stack:

- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-final/named_combat_soak_20260531184146.json`
  - Failed narrowly: `safeAttackActions=1`, `unsafeAttackActions=0`, `deathEvents=0`, but `combatEvidence=0` because the first safe attack landed one second before the soak ended.
  - Useful evidence: route hardening worked. The action log shows `res:qa-survivor` moving through `3222,3218` and `3230,3226`, resupplying/cooking, then attacking a safe `Man`.
- `data/benchmarks/capability-qa-2026-05-31/qa023-survivor-combat-after-recovery-followup/named_combat_soak_20260531184233.json`
  - Passed: `score=1`, `safeAttackActions=1`, `unsafeAttackActions=0`, `combatEvidence=1`, `bonesEvidence=1`, `prayerEvidence=1`, `deathEvents=0`, `lowHealthRefusals=0`.

## Outcome

QA023 now closes the immediate named-resident safe-combat reengage proof: after the route and startup-timeout fixes, `res:qa-survivor` can return to safe combat on the live stack and produce combat/bones/prayer evidence without unsafe attacks or death.

The narrower "forced low-health fish/cook/eat/reengage in the same named-resident soak" remains a follow-up confidence packet under `QA-20260529-004`; strict disposable benchmark proof for that chain already exists in QA036/QA038.
