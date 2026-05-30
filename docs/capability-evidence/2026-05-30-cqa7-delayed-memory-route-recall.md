# CQA7 - Delayed Memory Route Recall Substrate (2026-05-30)

Packet: `CQA7`  
Lane: `F`  
Date: 2026-05-30

## Scope

Close the explicit delayed route-recall gap from `QA-20260529-012` by adding a dedicated benchmark task that seeds a route memory, asks for delayed recall, and rejects JSON-like prompt-echo replies.

## Changes Landed

1. Added a new benchmark task and verifier:
   - `src/controller/benchmarks/tasks/memory-route-recall-5m.ts`
   - `src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts`
2. Registered the new task in benchmark CLI and suite plumbing:
   - `src/controller/benchmarks/cli.ts`
   - `src/controller/benchmarks/cli.test.ts`

## Verification

- `npm test -- --runInBand src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts src/controller/benchmarks/cli.test.ts`  
  PASS (`29/29` tests)
- `npm run controller:bench -- --task memory-route-recall-5m --module onion.runescape.standard --mode autonomous --dry-run`  
  PASS (task resolves with id/version `memory-route-recall-5m@0.1.0`)
- `npm run controller:bench -- --task memory-route-recall-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-30`  
  FAIL in this sandbox: `connect EPERM 127.0.0.1:43595`

## Outcome

- The delayed memory route-recall benchmark substrate now exists and is test-covered.
- Live autonomous proof artifact is still missing due loopback-gateway restrictions in this environment.

## Next Action

Re-run `memory-route-recall-5m` on loopback-permitted infrastructure and record the artifact id in `docs/resident-capabilities.md` and `docs/issue-register.md` to move `QA-20260529-012` from blocked toward review/closure.
