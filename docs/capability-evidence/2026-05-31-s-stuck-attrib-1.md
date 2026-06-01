# S-STUCK-ATTRIB-1 Stuck Attribution (2026-05-31)

Packet: `S-STUCK-ATTRIB-1`
Issue: `QA-20260529-006`
Run date: 2026-05-31

## Goal

Make `normal-life-audit` report which residents produce stuck churn so the next behavior fix can target the real offenders instead of only seeing aggregate `stuck_detected` / `stuck_recovered` counts.

## Change

`normal-life-audit` now emits a top-level `stuckSummary`:

- `stuckDetected`
- `stuckRecovered`
- `unresolved`
- `topResidents[]` with `resident`, `stuckDetected`, `stuckRecovered`, `unresolved`, and `churn`

The field is additive. Existing `recurrenceSummary`, `residentSlices`, and `residentSignalSummary` stay unchanged.

## Verification

- `npm test -- --runTestsByPath src/controller/admin/normal-life-audit.test.ts --runInBand`: `6/6` tests passed.
- `npm run check:no-ui` passed.
- `npm run build` passed: `819` files compiled.
- `npm run fin` passed: `227` suites, `3209/3209` tests.
- Live audit command:

```bash
npm run controller:normal-life-audit -- --duration-ms=3600000 --top=20 --output-dir data/benchmarks/capability-qa-2026-05-31/s-stuck-attrib-1
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/s-stuck-attrib-1/normal_life_audit_20260531T111938Z.json`

## Live Result

- Window: `2026-05-31T10:19:38.414Z` to `2026-05-31T11:19:38.414Z`
- Active residents: `23`
- Actions: `6914/6914` successful (`100%`)
- `lowHealthWaits=0`
- `apGpExchangeEvents=0`
- `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`
- `combatActions=34`, `combatResupplyActions=137`, `eatingActions=68`, `cookingActions=280`, `xpEvents=82`
- `stuckDetected=542`, `stuckRecovered=435`, `unresolved=107`

Top stuck-churn residents:

| Resident | Detected | Recovered | Unresolved | Churn |
|---|---:|---:|---:|---:|
| `res:qa-trader` | 61 | 61 | 0 | 122 |
| `res:agent` | 64 | 55 | 9 | 119 |
| `res:qa-social` | 62 | 55 | 7 | 117 |
| `res:pip` | 53 | 47 | 6 | 100 |
| `res:qa-survivor` | 49 | 48 | 1 | 97 |

## Readout

The stack is active and healthy, but the next behavior work should not be generic. The top churn is concentrated in trader/social/agent/scout-survival style loops, with trade still absent from the window. This points to a combined next packet: inspect `res:qa-trader` and `res:qa-social` trajectory causes, then fix trade/social movement or target-selection loops.
