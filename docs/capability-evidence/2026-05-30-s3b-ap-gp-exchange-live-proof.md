# S3b AP-for-GP Exchange Live Proof Attempt (2026-05-30)

Packet: `S3b`  
Lane: `B`  
Owner: `codex`  
Status: `Blocked (sandbox loopback EPERM)`

## What Landed

- Upgraded `ap-gp-exchange-5m` from a stub into an autonomous verifier task.
- Added deterministic benchmark-side exchange injection in the autonomous runtime driver:
  - Inspects real RuneScape coin item `995` via gateway.
  - Burns real GP via gateway.
  - Credits AP through `CityIntegrationService.exchangeApForGp`.
  - Records a benchmark action attempt (`kind: city_exchange_ap_gp`) with AP/GP evidence payload.
- Added focused tests for the new verifier behavior and runtime injection path.

## Verification

- `npm test -- --runInBand src/controller/benchmarks/tasks/ap-gp-exchange-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts src/controller/benchmarks/cli.test.ts` (PASS)
- `npm run check:no-ui` (PASS)
- `npm run build` (PASS)
- `npm run fin` (FAIL: unrelated loopback `listen EPERM` in HTTP/WS test suites in this sandbox)

## Live Benchmark Attempt

- Command:
  - `npm run controller:bench -- --task ap-gp-exchange-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-30`
- Result:
  - Failed before benchmark execution with `connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`.

## Current Blocker

- This environment cannot reliably open/connect loopback ports for live benchmark execution.
- Until loopback is available, `S3b` cannot produce a fresh artifact id proving live AP-for-GP completion.

## Next Step

- Re-run the same `controller:bench` command on a loopback-permitted host.
- On pass, record artifact id and update:
  - `docs/resident-capabilities.md`
  - `docs/issue-register.md` (`S3b` blocker row)
  - packet board + roadmap notes
