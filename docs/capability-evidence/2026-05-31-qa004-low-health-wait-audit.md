# QA004 low-health wait audit

Date: 2026-05-31

## Summary

The 2026-05-31 hot stack was active, but ordinary-life combat QA was being dominated by three residents that had fought until their starter supplies were gone. They were not dying or submitting failed actions; they were stuck in the intended low-health safe hold state because they had no carried food and no tool/path to get more food.

Fix direction:

- Live ops unblock: restocked `res:qa-survivor`, `res:qa-priest`, and `res:qa-guardian` with cooked shrimp plus a small fishing net.
- Code guard: starter `Man`-class combat now requires carried food, visible edible food, a raw-fish/cooking path, or a starter fishing route before the resident starts attacking.
- If a foodless resident carries a small net, combat routes them to starter fishing with `combat_resupply_food` before fighting.

## Root Cause

Pre-fix normal-life audit:

```bash
npm run controller:normal-life-audit -- \
  --start=2026-05-31T06:45:08.000Z \
  --end=2026-05-31T07:05:08.000Z \
  --top=20 \
  --output-dir=data/benchmarks/capability-qa-2026-05-31/qa004-low-health-wait-audit
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/qa004-low-health-wait-audit/normal_life_audit_20260531T070509Z.json`

Key signals:

| Signal | Value |
|---|---:|
| Active residents | 23 |
| Action attempts | 5285 |
| Successful submissions | 5285 |
| Failed submissions | 0 |
| `low_health_heal_wait` actions | 3021 |
| `attack` actions | 10 |
| `eat` actions | 26 |
| `stuck_detected` timeline events | 549 |
| `stuck_recovered` timeline events | 515 |

The wait flood was concentrated in three residents:

| Resident | `low_health_heal_wait` in audit window |
|---|---:|
| `res:qa-survivor` | 1539 |
| `res:qa-priest` | 1318 |
| `res:qa-guardian` | 164 |

Live state before restock:

| Resident | State |
|---|---|
| `res:qa-survivor` | HP 3/13, carried bones only, no food, no net |
| `res:qa-priest` | HP 3/13, empty inventory |
| `res:qa-guardian` | HP 6/13, empty inventory |

Read-only subagent review (`Pauli`) agreed with the local diagnosis: the residents had real combat progress, but after starter food/tool exhaustion the low-health recovery routine could only wait. It found no evidence that threat filtering itself was the remaining root cause.

## Live Ops Unblock

Command:

```bash
for r in res:qa-survivor res:qa-priest res:qa-guardian; do
  npm run -s controller:ensure-inventory -- --resident "$r" --item 315 --amount 5
  npm run -s controller:ensure-inventory -- --resident "$r" --item 303 --amount 1
done
```

Result:

- All three residents received cooked shrimp (`315`) and a small fishing net (`303`).
- Some shrimp were eaten immediately because the residents were already hurt.
- Post-restock saves showed each resident alive with net plus remaining shrimp.

Post-restock normal-life audit:

```bash
npm run controller:normal-life-audit -- \
  --start=2026-05-31T07:13:03.000Z \
  --end=2026-05-31T07:16:03.000Z \
  --top=20 \
  --output-dir=data/benchmarks/capability-qa-2026-05-31/qa004-low-health-wait-audit-post-restock
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/qa004-low-health-wait-audit-post-restock/normal_life_audit_20260531T071604Z.json`

Key signals:

| Signal | Value |
|---|---:|
| Active residents | 23 |
| Action attempts | 367 |
| Successful submissions | 367 |
| Failed submissions | 0 |
| `low_health_heal_wait` actions | 5 |
| `attack` actions | 23 |
| `eat` actions | 4 |
| `combat_attack_safe_target` actions | 23 |

This is a short post-restock window, so it is proof of immediate recovery rather than a closure of long-run combat cadence.

## Code Guard

Changed:

- `src/controller/spark/runescape-body-routines.ts`
- `src/controller/spark/runescape-body-routines.test.ts`

New behavior:

- A healthy resident can still attack `Man` targets when carrying food.
- A resident with no food and no food path says: `I need food or a way to get food before I train combat safely.`
- A resident with no food but with a small net routes to starter fishing before starting `Man` combat.
- Existing goblin/chicken combat behavior is preserved; the guard is intentionally scoped to `Man`-class targets that had produced the low-health wait loop.

Verification:

```bash
npm test -- --runTestsByPath src/controller/spark/runescape-body-routines.test.ts --runInBand
npm run check:no-ui
npm run build
```

Results:

- Focused body routine tests: 158/158 passing.
- `check:no-ui`: PASS.
- `build`: PASS, 815 files compiled.

## Remaining Risk

The code guard is not live in the running controller until the controller is restarted onto the rebuilt `dist/` output.

QA004 should remain open until a longer post-restart ordinary-life audit proves:

- `low_health_heal_wait` is no longer a dominant cause,
- named combat residents can resupply or pause safely without flooding noops,
- combat still produces safe attacks, bones, Prayer XP, and no deaths.

Next recommended packet: restart the controller on this build, run a 20-30 minute `controller:normal-life-audit`, and close or narrow QA004 based on the new cause histogram.
