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

## Post-Restart Quick Check

After commit `d303f627`, the controller was rebuilt and restarted onto the new `dist/` output.

Verification:

```bash
npm run -s controller:smoke -- --observe-seconds 45 --allow-recent-visible
npm run -s controller:normal-life-audit -- \
  --start=2026-05-31T07:19:53.000Z \
  --end=2026-05-31T07:24:53.000Z \
  --top=20 \
  --output-dir=data/benchmarks/capability-qa-2026-05-31/qa004-post-restart-quick-audit
```

Artifacts:

- `data/benchmarks/capability-qa-2026-05-31/qa004-post-restart-quick-audit/normal_life_audit_20260531T072454Z.json`

Key signals:

| Signal | Value |
|---|---:|
| Active residents | 23 |
| Action attempts | 615 |
| Successful submissions | 615 |
| `low_health_heal_wait` actions | 0 |
| `attack` actions | 15 |
| `eat` actions | 7 |
| `low_health_cook_food` actions | 11 |
| `first_xp` timeline events | 37 |

The quick check is encouraging: after restart, residents were attacking, eating, and cooking for low-health recovery without re-entering the old wait flood.

## 20-Minute Post-Restart Soak

The longer soak passed for the specific QA004 failure mode.

Verification:

```bash
npm run -s controller:normal-life-audit -- \
  --start=2026-05-31T07:27:39.000Z \
  --end=2026-05-31T07:47:39.000Z \
  --top=30 \
  --output-dir=data/benchmarks/capability-qa-2026-05-31/qa004-post-restart-20m-audit
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-31/qa004-post-restart-20m-audit/normal_life_audit_20260531T074740Z.json`

Key signals:

| Signal | Value |
|---|---:|
| Active residents | 23 |
| Action attempts | 2677 |
| Successful submissions | 2677 |
| Failed submissions | 0 |
| `low_health_heal_wait` actions | 0 |
| `combat_resupply_food` actions | 40 |
| `attack` actions | 2 |
| `eat` actions | 32 |
| `use_item_on` actions | 30 |
| `use_item_on_item` actions | 80 |
| `combat_loot_pickup` actions | 1 |
| `combat_bury_looted_bones` actions | 1 |
| `stuck_detected` / `stuck_recovered` | 592 / 590 |

Interpretation:

- The original wait flood is fixed/narrowed. `low_health_heal_wait` stayed at `0` for a 20-minute ordinary-life window.
- The new combat guard is active: `combat_resupply_food=40` shows residents were routed to food supply paths before continuing risky starter `Man` combat.
- The broader live behavior remains routine-heavy. Combat did not flood, but only 2 attacks occurred in this window, and stuck churn is still high.

## Remaining Risk

The specific food/tool-exhaustion `low_health_heal_wait` loop can be closed as of this evidence. Keep the broader combat/survival parent issue open until later ordinary-life windows prove:

- named combat residents can resupply or pause safely without flooding noops,
- combat still produces safe attacks, bones, Prayer XP, and no deaths.
- stuck churn drops enough that combat residents are not spending most of their life in movement recovery.

Next recommended packet: run a fresh CQA10 ordinary-life recurrence window after QA004, focused on whether AP/GP exchange, trade closure, combat, eating/cooking, and stuck recovery all recur naturally without any one cause dominating.
