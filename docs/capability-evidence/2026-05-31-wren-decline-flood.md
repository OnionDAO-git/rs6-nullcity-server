# S-WREN-DECLINE-FLOOD-1 - Memory trade-decline flood guard

Date: 2026-05-31

## Status

Code fix is landed and the live flood is mitigated. A clean post-restart cohort window shows zero Wren trade-decline actions.

## Why

The recovered hot stack was alive, but Wren produced a pathological action flood:

- `scripts/post-restart-smoke.sh --no-color` reported READY with 23 residents alive, but Wren had `441` actions in the recent 5m window.
- `data/benchmarks/capability-qa-2026-05-31/s-controller-recovery-1/normal_life_audit_20260531T215842Z.json` recorded 23 active residents, `858` action attempts, `100%` submission success, and one organic self-initiated AP/GP exchange, but Wren was the top action source.
- The last 500 Wren action log rows had `494` repetitions of `witness-requirement-rule|trade_decline|unwitnessed transaction refused per Article 1, Clause 3 of The Ledger`.
- `data/controller/memory/res-wren-calix/nervous-rules.md` contained a memory-authored `trade_request` -> `trade_decline` rule with `cooldownTicks: 0` and `interruptThinking: true`.

That rule made one visible trade request repeatedly interrupt Wren's thinking and hammer the gateway with identical declines. This is bad demo behavior and a real runtime pressure source.

## Change

`readNervousRulesMd` now sanitizes memory-authored trade-decline rules that match visible trade requests:

- Minimum cooldown: `120` ticks.
- `interruptThinking: false`.
- Other memory rules keep their authored cooldown/interrupt behavior.

This keeps Wren's soul-specific witness rule intact, but makes it act like a bounded reflex instead of an action flood.

## Verification

Red proof:

```bash
npm test -- --runInBand src/controller/nervous-system/rules-md.test.ts
```

Failed before the production change because the loaded rule kept `cooldownTicks: 0` and `interruptThinking: true`, so two evaluations on the same trade request both emitted `trade_decline`.

Green proof:

```bash
npm test -- --runInBand src/controller/nervous-system/rules-md.test.ts src/controller/nervous-system/rules.test.ts src/controller/nervous-system/nervous-system.test.ts
npm run check:no-ui
npm run typecheck
git diff --check -- src/controller/nervous-system/rules-md.ts src/controller/nervous-system/rules-md.test.ts docs/agent-status.md
```

Results:

- 3 suites passed, 55 tests passed.
- Server UI boundary clean.
- Typecheck passed.
- Whitespace check passed.

## Live Evidence Before Fix

```text
totalLines 10325
recent500Top:
494 witness-requirement-rule|trade_decline|unwitnessed transaction refused per Article 1, Clause 3 of The Ledger
3   say|idle_initiative
3   move_to|idle_step
```

Recent tail rows were repeated `trade_decline` actions at tick `172858`, about once per gateway cycle.

## Follow-up

Live follow-up run (2026-05-31 17:21 CDT):

- Updated the active memory rule in `data/controller/memory/res-wren-calix/nervous-rules.md` to match the shipped guard (`cooldownTicks: 120`, `interruptThinking: false`).
- Captured a new 5-minute normal-life artifact:
  - `data/benchmarks/capability-qa-2026-05-31/s-wren-decline-flood-1/normal_life_audit_20260531T222154Z.json`
- Window summary: `23` residents, `379` action attempts, `100%` submit success.
- `res:wren-calix` dropped from pathological dominance to `18` attempts in-window with `3` `trade_decline` actions.
- Top resident action volume was no longer Wren (`res:qa-woodcutter:56`, `res:agent:42`, `res:hans:40`, `res:qa-cook:32`, `res:qa-social:27`).

This satisfies the packet pass condition: Wren no longer dominates the recent action histogram with repeated trade-decline reflexes.

Clean post-restart cohort proof (2026-05-31 17:23 CDT):

- Restarted controller on the current built stack; boot log showed `wiki=configured`.
- `/v1/health` returned 200 with `qwopus3.5-27b-v3@q4_k_s`, latency `1425ms`.
- `bash scripts/post-restart-smoke.sh --no-color` returned READY WITH WARNINGS because the new cohort cap intentionally leaves 13 non-cohort residents frozen/paused; the 10 active residents all had recent action.
- Captured a pure post-restart 5-minute normal-life artifact:
  - `data/benchmarks/capability-qa-2026-05-31/s-wren-decline-flood-1-postrestart/normal_life_audit_20260531T222303Z.json`
- Window summary: `10` active residents, `307` action attempts, `100%` submit success.
- Action kinds: `move_to=183`, `say=69`, `interact=26`, `use_item_on_item=21`, `eat=4`, `use_item_on=4`; `trade_decline=0`.
- Direct Wren log check since `2026-05-31T22:18:03Z`: `0` Wren action rows.
- Useful live progress in the same window: woodcutting/firemaking (`res:qa-woodcutter`), fishing/cooking/eating (`res:qa-cook`), combat target seeking/resupply (`res:qa-guardian`, `res:qa-survivor`), and social/trade speech (`res:qa-trader`, `res:qa-social`).

Operator note: earlier sandbox restart caveats are superseded by the 17:17 CDT restart; current controller is running under screen `nullcity-controller-codex` with cohort mode active.

If a fresh regression appears, rerun:

```bash
bash scripts/post-restart-smoke.sh --no-color
CONTROLLER_NORMAL_LIFE_AUDIT_OUTPUT_DIR=data/benchmarks/capability-qa-2026-05-31/s-wren-decline-flood-1 npm run controller:normal-life-audit -- --duration-ms 300000
```
