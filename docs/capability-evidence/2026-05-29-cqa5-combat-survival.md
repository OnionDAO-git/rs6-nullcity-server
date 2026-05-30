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
- `src/controller/admin/named-combat-soak.ts`
- `src/controller/admin/named-combat-soak.test.ts`
- `package.json`

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

## Named-resident soak substrate

On 2026-05-30 I added `npm run controller:combat-soak`, a reusable named-resident operator soak for ordinary controller life. It attaches to a named resident, creates a nearby command peer, asks the resident to attack a safe target, and verifies ordinary action-log evidence rather than benchmark-submitted actions.

Verifier coverage:

```bash
npm test -- --runInBand src/controller/admin/named-combat-soak.test.ts
```

Result: PASS (`11/11` after the low-health diagnostic cases below).

The verifier requires:

- a command peer prompt,
- at least one ordinary safe `attack` action against a low-risk target such as a goblin,
- combat event evidence or repeated safe attacks,
- no unsafe target attack,
- no death event.

It records bones/prayer evidence when present but does not require a bones drop in a short operator soak.

First live attempt:

```bash
npm run controller:combat-soak -- --duration-ms=45000 --poll-ms=500 --resident res:qa-survivor --target goblin
```

Result: BLOCKED because the local controller gateway was not running: `connect ECONNREFUSED 127.0.0.1:43595`.

Hot-stack rerun after restarting the game/controller and fixing the default command prefix from `combat` to `survive`:

```bash
npm run controller:combat-soak -- --resident res:qa-survivor --target goblin --prefix survive --duration-ms=180000 --output-dir data/benchmarks/capability-qa-2026-05-30
```

Result: PASS (`data/benchmarks/capability-qa-2026-05-30/named_combat_soak_20260530171822.json`).

Metrics:

- `ordinaryActionEntries=3`
- `attackActions=2`
- `safeAttackActions=2`
- `unsafeAttackActions=0`
- `combatEvidence=1`
- `deathEvents=0`

The resident first attempted a direct chat attack against one visible Goblin that had despawned (`target_not_found`), then immediately selected a live safe Goblin via `combat_attack_safe_target` and landed a successful attack. The soak is short, so it does not require bones/prayer proof; the bounded benchmark artifacts above remain the proof for the full attack -> bones -> bury -> Prayer chain.

Strict diagnostic rerun after that fight:

```bash
npm run controller:combat-soak -- --resident res:qa-survivor --target goblin --prefix survive --duration-ms=45000 --output-dir data/benchmarks/capability-qa-2026-05-30
```

Result: FAIL-DIAGNOSTIC (`data/benchmarks/capability-qa-2026-05-30/named_combat_soak_20260530173035.json`).

Metrics:

- `ordinaryActionEntries=2`
- `safeAttackActions=0`
- `lowHealthRefusals=2`
- `perceptionCount=76`
- `deathEvents=0`

This was not a contradiction of the starter-combat pass. It started after the survivor had already fought multiple Goblins, gained Attack/Hitpoints/Prayer XP, looted/buried bones, retreated, and moved to safety. The resident then said its health was too low and refused to re-engage. The soak CLI now writes this diagnostic artifact instead of timing out invisibly, so future QA can separate "cannot fight" from "survived and correctly refused while hurt."

Hot-stack engine hardening from the same investigation:

- Fixed `Pathfinding.pathTo` positive-edge bounds so a destination exactly on the exclusive search boundary throws `Out of range.` instead of dereferencing an undefined point (`_cost` crash).
- Increased `CombatTask` pursuit pathing radius to `Math.max(5, distance + 2)` for targets it is already allowed to track up to 16 tiles, reducing repeated out-of-range aborts during ordinary combat pursuit.
- Focused tests: `src/engine/world/actor/pathfinding.test.ts` and `src/engine/world/actor/combat/combat-task.test.ts` passed `4/4`.

## Conclusion

`CQA5` now has two complementary proof types:

- Bounded autonomous loopback proof for the full safe combat -> combat-supplied bones -> pickup -> bury -> Prayer XP chain: `2/2` post-fix reruns passed with no deaths or unsafe targets.
- Ordinary named-resident hot-stack proof for a real safe Goblin attack: `named_combat_soak_20260530171822.json` passed with 2 safe attack actions, combat evidence, no unsafe attacks, and no deaths.
- Ordinary named-resident survival gating proof: `named_combat_soak_20260530173035.json` records the same survivor refusing to fight while hurt after prior combat instead of dying or looping unsafe attacks.

This upgrades combat from "blocked / partially proven" to "in review with ordinary live proof for starter combat." Keep `QA-20260529-004` open only for broader reliability work: model triplet reruns, longer ordinary combat soaks, explicit heal/eat/re-engage proof, flee/retreat proof, and varied targets beyond the Lumbridge starter field.
