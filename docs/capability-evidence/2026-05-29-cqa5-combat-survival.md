# CQA5: Combat survival verifier hardening + rerun attempt (2026-05-29)

Packet: `CQA5`  
Issue: `QA-20260529-004`  
Owner: `codex`

## Scope

Run the combat-survival follow-up for `combat-prayer-10m` with a focus on repeated unsafe-loop failures, then rerun benchmark evidence if possible.

## What changed

1. Added a regression test showing a false failure mode: repeated safe attacks followed by successful bones pickup, bury, and Prayer gain should not fail purely on loop count.
2. Updated `combat-prayer-10m` metrics so `unsafeLoops` is suppressed when the full safe chain is completed (`attack -> combat-supplied bones -> bury -> Prayer success`).

Changed files:

- `src/controller/benchmarks/tasks/combat-prayer-10m.ts`
- `src/controller/benchmarks/tasks/combat-prayer-10m.test.ts`

## Verification

Focused test:

```bash
npm test -- --runInBand src/controller/benchmarks/tasks/combat-prayer-10m.test.ts
```

Result: PASS (14 tests)

Repo gates:

```bash
npm run check:no-ui
npm run build
npm run fin
```

Results:

- `check:no-ui`: PASS
- `build`: PASS
- `fin`: FAIL in sandbox due loopback bind restrictions (`listen EPERM 127.0.0.1` / `0.0.0.0`) in unrelated HTTP/WebSocket suites

## Live rerun attempt

Attempted live autonomous rerun:

```bash
npm run controller:bench -- --task combat-prayer-10m --module onion.runescape.standard --mode autonomous --output data/benchmarks/cqa5-combat-rerun-2026-05-29
```

Result: blocked in sandbox with `connect EPERM 127.0.0.1:43595`.

## Artifact re-score note (existing 2026-05-27 triplet set)

Using existing triplet artifacts in `data/benchmarks/model-intelligence-paid-2026-05-27`:

- Qwen: `0/6` pass, `6/6` loop-flagged, `2/6` had loop flag despite Prayer success evidence.
- Qwopus: `3/6` pass, `3/6` loop-flagged, `1/6` had loop flag despite Prayer success evidence.
- Haiku: `3/6` pass, `3/6` loop-flagged, `1/6` had loop flag despite Prayer success evidence.

This indicates part of prior loop-failure surface was verifier strictness rather than pure resident survival failure.

## Conclusion

`CQA5` made a concrete verifier fix and test hardening, but live combat reruns remain blocked by sandbox loopback restrictions. `QA-20260529-004` should stay open until triplet reruns are executed on loopback-permitted infra and fresh artifacts are scored.
