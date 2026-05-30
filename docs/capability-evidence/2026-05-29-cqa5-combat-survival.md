# CQA5: Combat survival verifier hardening + live rerun (2026-05-29/30)

Packet: `CQA5`  
Issue: `QA-20260529-004`  
Owner: `codex`

## Scope

Run the combat-survival follow-up for `combat-prayer-10m` with a focus on repeated unsafe-loop failures, then rerun benchmark evidence on local loopback once available.

## What changed

1. Added a regression test showing a false failure mode: repeated safe attacks followed by successful bones pickup, bury, and Prayer gain should not fail purely on loop count.
2. Updated `combat-prayer-10m` metrics so `unsafeLoops` is suppressed when the full safe chain is completed (`attack -> combat-supplied bones -> bury -> Prayer success`).
3. Added a second regression test for the 2026-05-30 live failure: once combat evidence and combat-supplied bones are observed, the benchmark should keep running toward pickup/bury instead of aborting immediately as an unsafe loop.
4. Updated `unsafeLoops` so repeated attacks still fail before meaningful combat/bones progress, but combat+bones progress receives more runway to complete the chain.

Changed files:

- `src/controller/benchmarks/tasks/combat-prayer-10m.ts`
- `src/controller/benchmarks/tasks/combat-prayer-10m.test.ts`

## Verification

Focused test:

```bash
npm test -- --runInBand src/controller/benchmarks/tasks/combat-prayer-10m.test.ts
```

Result: PASS (15 tests)

Repo gates:

```bash
npm run check:no-ui
npm run build
npm run fin
```

Results after the 2026-05-30 fix:

- `check:no-ui`: PASS
- `build`: PASS
- `fin`: PASS (`2834/2834`)

## Live reruns

Initial 2026-05-29 live autonomous rerun was blocked in the prior sandbox with `connect EPERM 127.0.0.1:43595`.

On 2026-05-30 local loopback was available. I ran:

```bash
npm run controller:bench -- --task combat-prayer-10m --module onion.runescape.standard --mode autonomous --output data/benchmarks/cqa5-combat-rerun-2026-05-30
npm run controller:bench -- --task combat-prayer-10m --module onion.runescape.standard --mode autonomous --output data/benchmarks/cqa5-combat-rerun-2026-05-30-fix
```

Observed artifacts:

| Artifact | Status | Notes |
|---|---|---|
| `data/benchmarks/cqa5-combat-rerun-2026-05-30/bench_20260530121708_combat_prayer_10m.json` | PASS | Safe combat, combat-supplied bones, pickup, bury, Prayer XP, no death. |
| `data/benchmarks/cqa5-combat-rerun-2026-05-30/bench_20260530121749_combat_prayer_10m.json` | FAIL | False early abort: combat and bones evidence existed, but `unsafeLoops=1` stopped the run at ~12s before pickup/bury. |
| `data/benchmarks/cqa5-combat-rerun-2026-05-30-fix/bench_20260530122158_combat_prayer_10m.json` | PASS | Post-fix autonomous rerun passed in 23.1s: 10 safe attacks, 2 pickup actions, 2 bury actions, Prayer XP, no death. |
| `data/benchmarks/cqa5-combat-rerun-2026-05-30-fix/bench_20260530122229_combat_prayer_10m.json` | PASS | Post-fix autonomous rerun passed in 29.1s: 12 safe attacks, 2 pickup actions, 2 bury actions, Prayer XP, 2 survival actions, no death. |

Post-fix metrics snapshot:

- `2/2` fresh autonomous reruns passed after the verifier runway fix.
- Both runs used selected `onion.runescape.standard` module actions, not benchmark-submitted scripted actions.
- Both observed `combatEvidence=1`, `bonesEvidence=1`, `orderedActionChain=1`, `prayerSuccess=1`, `deathEvents=0`, `unsafeLoops=0`.
- Runtime logs emitted knowledge suggestions for `safe-combat` and `train-prayer`, confirming the resident was touching the relevant workflow concepts.

## Artifact re-score note (existing 2026-05-27 triplet set)

Using existing triplet artifacts in `data/benchmarks/model-intelligence-paid-2026-05-27`:

- Qwen: `0/6` pass, `6/6` loop-flagged, `2/6` had loop flag despite Prayer success evidence.
- Qwopus: `3/6` pass, `3/6` loop-flagged, `1/6` had loop flag despite Prayer success evidence.
- Haiku: `3/6` pass, `3/6` loop-flagged, `1/6` had loop flag despite Prayer success evidence.

This indicates part of prior loop-failure surface was verifier strictness rather than pure resident survival failure. The post-fix live reruns also show the local standard module can complete the full safe combat -> bones -> Prayer chain when the benchmark does not abort too early.

## Conclusion

`CQA5` now has local live proof for the basic safe combat -> combat-supplied bones -> pickup -> bury -> Prayer XP chain: `2/2` post-fix autonomous loopback reruns passed with no deaths or unsafe targets. This upgrades the capability from "blocked" to "in review / partially proven."

Keep `QA-20260529-004` open until a longer named-resident combat soak and/or model triplet rerun proves reliability outside this bounded benchmark. The remaining risk is not "can the resident do the loop at all"; it is whether hard combat remains stable under ordinary long-running goals, varied targets, and weaker model profiles.
