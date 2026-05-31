# S-ECON-RECURRENCE-3

Date: 2026-05-31

Issues: `QA-20260529-006`, `QA-20260529-011`

## Goal

Root-cause the latest ordinary no-drain AP/GP and trade recurrence gap after controlled AP/GP exchange, self-initiated benchmark recurrence, named trade soaks, and visible cadence fixes were already green.

## Finding

The latest ordinary window did not show a broken economy loop. It showed two missing preconditions:

- AP/GP exchange was dormant because every GP-holding resident had AP above the no-floor runway threshold (`300 AP`), so no resident both held spendable GP and needed self-funding.
- Trade was alive but target-gated. `res:qa-trader` repeatedly emitted `trade_keepalive`, but did not emit `trade_starter_offer` or `trade_request` because no eligible visible `codex`/operator target appeared in the ordinary window.

## Change

`normal-life-audit` now emits more specific recurrence fields:

- `recurrenceSummary.tradeStarterOffers`
- `recurrenceSummary.tradeKeepaliveActions`
- `recurrenceSummary.followListenHolds`
- `economySummary.aboveRunwayThresholdWithGpResidents`

It also tracks `trade_starter_offer`, `trade_keepalive`, and `follow_listen_hold` in global and per-resident `trackedCauseCounts`.

## Tests

```bash
npm test -- --runTestsByPath src/controller/admin/normal-life-audit.test.ts --runInBand --no-coverage
npm run check:no-ui
npm run build
npm run fin
```

Results:

- Focused normal-life audit suite: `6/6` passed.
- `check:no-ui`: passed.
- `build`: passed (`825` files).
- `fin`: passed (`3304/3304` tests).

## Live Proof

Command:

```bash
npm run -s controller:normal-life-audit -- --duration-ms=600000 --top=20 --output-dir=data/benchmarks/capability-qa-2026-05-31/s-econ-recurrence-3
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/s-econ-recurrence-3/normal_life_audit_20260531T134842Z.json`

Results:

- Window: `2026-05-31T13:38:42.913Z` to `2026-05-31T13:48:42.913Z`.
- Active residents: `23`.
- Actions: `938/938` successful (`100%`).
- `lowHealthWaits=0`, `deaths=0`, `logouts=0`.
- `tradeKeepaliveActions=12`.
- `tradeStarterOffers=0`, `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`.
- `apGpExchangeActions=0`, `apGpExchangeEvents=0`.
- `lowApWithGpResidents=[]`.
- `requestAttentionWithGpResidents=[]`.
- `aboveRunwayThresholdWithGpResidents` included five spendable-GP residents:
  - `res:agent`: `16924.5 AP`, `24133 GP`
  - `res:qa-trader`: `43338.5 AP`, `1368 GP`
  - `res:qa-social`: `48310.5 AP`, `234 GP`
  - `res:qa-cook`: `41215.5 AP`, `225 GP`
  - `res:qa-forager`: `49608 AP`, `25 GP`
- `res:qa-trader`: `20` actions, `trade_keepalive=12`, `trade_starter_offer=0`, `trade_request=0`.

## Assessment

AP/GP self-funding should not fire in this window; all GP holders were above the configured AP runway trigger. This strengthens the interpretation of prior no-drain windows: absence of exchange is only a failure when a resident is both low-AP and GP-funded, or when an AP/GP pressure benchmark fails.

The trade path remains open for ordinary recurrence: `res:qa-trader` is alive and advertising, but needs a visible eligible operator/player/resident target to move from keepalive to `trade_starter_offer`. The next packet should either create an automated visible `codex`-matching peer for recurrence proof or run a true human/player operator pass.
