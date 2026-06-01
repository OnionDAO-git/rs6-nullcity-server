# Stack Gateway Repair 1 (2026-05-31)

Packet: `STACK-GATEWAY-REPAIR-1`  
Issue: `QA-20260529-006` / `QA-20260531-047`  
Run date: 2026-05-31

## Goal

Restore the hot controller stack after gateway/socket refusal, then verify ordinary no-drain activity after `S-GP-HARVEST-1`.

## Repair

- Replaced the stale controller process that was emitting gateway/socket refusal errors.
- Restarted the hot stack in screen session `72806.nullcity-controller-stack-gateway-repair-1`.
- Live controller endpoints after restart:
  - MCP: `127.0.0.1:43610`
  - Letters: `127.0.0.1:43596`
  - City: `127.0.0.1:43611`

## Pre-Fix Audit

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/stack-gateway-repair-1/normal_life_audit_20260531T105944Z.json`

Results:

- Window: `2026-05-31T10:39:44.425Z` to `2026-05-31T10:59:44.425Z`
- Active residents: `23`
- Actions: `2485/2485` successful (`100%`)
- `lowHealthWaits=0`
- `deaths=0`, `logouts=0`
- `nervous:starter-gp-harvest=30`

The scan showed story/ambient residents receiving `nervous:starter-gp-harvest` noops despite not running legacy `hybrid-agent` behavior or the enabled `onion.runescape.standard` module. Those stale starter goals could also suppress the visible AP appeal path.

## Fix

`NervousSystem` now only starts starter-GP harvest for residents that can execute it:

- legacy `behavior.kind: hybrid-agent`; or
- enabled `onion.runescape.standard` module.

It also clears stale starter-GP goals from non-executable story/ambient residents before attention handling, restoring the normal `nervous:request-attention` appeal.

## Post-Fix Audit

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/stack-gateway-repair-1-post-fix/normal_life_audit_20260531T111210Z.json`

Results:

- Window: `2026-05-31T11:04:10.917Z` to `2026-05-31T11:12:10.917Z`
- Active residents: `23`
- Actions: `990/990` successful (`100%`)
- `nervous:starter-gp-harvest=0`
- `lowHealthWaits=0`
- `deaths=0`, `logouts=0`
- `combatResupplyActions=52`, `cookingActions=42`, `eatingActions=10`, `xpEvents=19`

## Verification

- `npm test -- --runTestsByPath src/controller/nervous-system/nervous-system.test.ts src/controller/benchmarks/tasks/starter-gp-harvest-choice-5m.test.ts src/controller/benchmarks/cli.test.ts src/controller/benchmarks/autonomous-runtime.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand` passed: `5` suites, `361` tests.
- `npm run fin` passed: boundary check, typecheck, lint/format, `227` suites, `3208` tests.
- `npm run build` passed: `819` files compiled.
- `npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible` passed for all `23` residents after restart; `res:agent` showed `1` action / `1` successful result in the observed minute.

## Next

Continue with trade-closure recurrence and per-resident stuck-churn attribution. The post-fix window proves the false story-resident starter-harvest noops stopped, but it does not prove fresh GP/hour economy or trade closure.
