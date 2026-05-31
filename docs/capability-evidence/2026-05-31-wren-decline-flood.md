# S-WREN-DECLINE-FLOOD-1 - Memory trade-decline flood guard

Date: 2026-05-31

## Status

Code fix landed locally. Post-restart live proof is pending because the clean inference audit was already queued on the running controller.

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

After the pending `controller:inference-audit` completes, rebuild/restart the controller so this code and the S-WIKI config are both live, then run:

```bash
bash scripts/post-restart-smoke.sh --no-color
CONTROLLER_NORMAL_LIFE_AUDIT_OUTPUT_DIR=data/benchmarks/capability-qa-2026-05-31/s-wren-decline-flood-1 npm run controller:normal-life-audit -- --duration-ms 300000
```

Pass condition: Wren no longer dominates the recent action histogram with repeated `witness-requirement-rule` declines, and the stack remains READY.
