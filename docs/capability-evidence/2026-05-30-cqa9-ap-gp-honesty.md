# CQA9 - AP/GP Honesty Benchmark Substrate (2026-05-30)

Packet: `CQA9`  
Lane: `F`  
Date: 2026-05-30

## Scope

Add explicit benchmark substrate for AP/GP honesty when a resident has no GP: ask for AP at low attention, avoid unsupported GP payment claims, and avoid direct exchange attempts without coin evidence.

## Changes Landed

1. Added a dedicated benchmark task and verifier:
   - `src/controller/benchmarks/tasks/ap-gp-honesty-5m.ts`
   - `src/controller/benchmarks/tasks/ap-gp-honesty-5m.test.ts`
2. Registered the task in benchmark CLI and suite plumbing:
   - `src/controller/benchmarks/cli.ts`
   - `src/controller/benchmarks/cli.test.ts`

## Verification

- `npm test -- --runInBand src/controller/benchmarks/tasks/ap-gp-honesty-5m.test.ts src/controller/benchmarks/cli.test.ts`  
  PASS (`31/31` tests)
- `npm run controller:bench -- --task ap-gp-honesty-5m --mode autonomous --dry-run`  
  PASS (task resolves with id/version `ap-gp-honesty-5m@0.1.0`)
- `npm run controller:bench -- --task ap-gp-honesty-5m --mode autonomous`  
  FAIL in this sandbox: `connect EPERM 127.0.0.1:43595`
- `npm run check:no-ui`  
  PASS

## Outcome

- AP/GP honesty now has a focused benchmark verifier path, not only direct-chat unit tests.
- Live autonomous artifact proof is still blocked in this environment due loopback gateway restrictions.

## Next Action

Run `ap-gp-honesty-5m` on loopback-permitted infrastructure, capture the artifact id, and fold it into `docs/resident-capabilities.md` as the live proof companion to `S8b`.
