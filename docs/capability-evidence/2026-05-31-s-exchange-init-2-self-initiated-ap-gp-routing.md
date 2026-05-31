# S-EXCHANGE-INIT-2: Self-Initiated AP-for-GP Routing

Date: 2026-05-31
Packet: S-EXCHANGE-INIT-2
Area: AP/GP survival economy

## Goal

Close the routing seam left by S-EXCHANGE-INIT-1: a resident with low AP and real RuneScape GP should initiate an AP-for-GP exchange itself, without a patron/operator triggering the exchange.

## Code Changes

- `src/controller/nervous-system/nervous-system.ts`
  - Wires `selfInitiatedApGpExchangeAction` into the built-in nervous path before final-testament/request-attention fallback.
  - Emits `city_exchange_ap_gp` with cause `nervous:self-initiated-ap-gp-exchange`.
- `src/controller/resident-runtime.ts`
  - Adds `cityExchange` runtime dependency.
  - Intercepts `city_exchange_ap_gp` inside controller runtime, calls `exchangeApForGp`, and never sends the action to the RuneScape gateway.
- `src/controller/controller-host.ts`
  - Owns one shared `CityIntegrationService` and passes it to every `ResidentRuntime`.
- `src/controller/index.ts`
  - Reuses the host-owned city service for city HTTP routes.
- `src/controller/benchmarks/autonomous-runtime.ts`
  - Passes a benchmark-local city exchange service into autonomous residents.
  - Gives `self-initiated-ap-gp-exchange-5m` a low-AP/floor profile so the reflex can fire.

## Verification

Focused tests:

- `npm test -- --runInBand src/controller/nervous-system/nervous-system.test.ts src/controller/resident-runtime.test.ts src/controller/controller-host.test.ts src/controller/benchmarks/tasks/self-initiated-ap-gp-exchange-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts --no-coverage`
- Result: PASS, `147` tests.

Live hot-stack benchmark:

- Command: `npm run controller:bench -- --task self-initiated-ap-gp-exchange-5m --module onion.runescape.standard --mode autonomous --output-dir data/benchmarks/capability-qa-2026-05-31/self-initiated-ap-gp-routing`
- Result: PASS, score `1`
- Artifact: `data/benchmarks/capability-qa-2026-05-31/self-initiated-ap-gp-routing/bench_20260531054722_self_initiated_ap_gp_exchange_5m.json`
- Run id: `bench_20260531054722_self_initiated_ap_gp_exchange_5m`
- Duration: `23822ms`

Artifact metrics:

- `selfInitiatedAttempts=1`
- `selfInitiatedCompleted=1`
- `apIncreasedExchanges=1`
- `gpDecreasedExchanges=1`
- `fullyProvenExchanges=1`
- `coinItemId=995`
- `selectedModuleActions=2`
- `selectedModuleInferences=1`
- `trajectoryActions=3`
- `meaningfulProgressTicks=1`

Interpretation:

- The resident-originated nervous action executed through `CityIntegrationService.exchangeApForGp`.
- The exchange completed with AP up and real coin item `995` GP down.
- The action was captured as `source=nervous-system`, `actionKind=city_exchange_ap_gp`, `cause=nervous:self-initiated-ap-gp-exchange`, `finalStatus=success`.
- This closes the previous production routing gap where `city_exchange_ap_gp` was only a pure helper/benchmark idea and would have failed if sent to the RuneScape action gateway.

## Remaining Follow-Ups

- Ordinary named-resident recurrence is still desirable: run a longer normal-life window and confirm a non-benchmark resident initiates the same exchange when low AP and holding GP.
- The benchmark artifact shows a later `nervous:prepare-epitaph` say after the exchange because `50 GP -> 100 AP` still left the resident near the floor. That is not a routing failure, but future tuning may want exchange amount/threshold logic that buys enough AP to leave the final-testament band before asking humans.
