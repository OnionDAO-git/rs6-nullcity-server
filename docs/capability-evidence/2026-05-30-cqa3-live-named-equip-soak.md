# CQA3-live: named-resident equip soak proof (2026-05-30)

Packet: `CQA3-live`  
Issue: `QA-20260529-005`  
Owner: `codex`

## Scope

Build a reproducible named-resident soak that creates an ordinary equip opportunity and proves or disproves `kind:"equip"` in ordinary named-resident action logs.

## What Landed

1. Added operator CLI `controller:equip-soak`:
   - `src/controller/admin/named-equip-soak.ts`
   - `npm run controller:equip-soak`
2. Added focused verifier/parser tests:
   - `src/controller/admin/named-equip-soak.test.ts`

CLI behavior:

- Attaches to a named resident (default `res:qa-survivor`).
- Sends setup `unequip` actions for `main_hand` + `off_hand` so useful combat gear becomes inventory-held.
- Also supports `--setup-mode preloaded-inventory` for a target that already starts with training gear in inventory. This avoids controller-control takeover and lets the target keep its normal controller owner.
- Spawns a nearby command peer and sends `"<prefix> train combat"` (default prefix `survive`) to trigger ordinary combat routines.
- Verifies ordinary action-log evidence for resident-side `equip` (`*_equip_useful_gear`) and records post-equip attacks as a metric. Attack reliability is owned by `CQA5`.
- Writes artifact `data/benchmarks/capability-qa-YYYY-MM-DD/named_equip_soak_<stamp>.json`.

## Verification

- `npm test -- --runInBand src/controller/admin/named-equip-soak.test.ts` (PASS 9/9)

## Live Run

Command:

```bash
npm run controller:equip-soak -- --resident res:qa-survivor --duration-ms 90000 --poll-ms 500 --setup-mode preloaded-inventory
```

Result:

- Passed.
- Artifact: `data/benchmarks/capability-qa-2026-05-30/named_equip_soak_20260530120900.json`
- Target: `res:qa-survivor`
- Command peer: `res:codex-cqa3-120848`
- Metrics:
  - `residentEquipActions=1`
  - `usefulGearInInventoryBefore=2`
  - `usefulGearInInventoryAfterSetup=2`
  - `usefulGearInInventoryAfter=0`
  - `usefulGearInEquipmentAfter=2`
  - `postEquipAttacks=0`

Action-log evidence:

```json
{"t":"2026-05-30T12:08:59.655Z","action":{"kind":"equip","slot":0,"cause":"combat_equip_useful_gear"},"result":{"ok":true}}
{"t":"2026-05-30T12:09:00.491Z","action":{"kind":"equip","slot":1,"cause":"combat_equip_useful_gear"},"result":{"ok":true}}
```

## Outcome

- Ordinary named-resident gear equip is now proven for `res:qa-survivor`: a long-running controller resident with normal SPARK behavior equipped preloaded training sword/shield through ordinary `thinking` actions.
- Combat did not follow within this soak (`postEquipAttacks=0`). That is now treated as honest scope separation, not an equipment failure. CQA5 remains responsible for reliable target selection and attack follow-through.
- The initial direct `unequip` setup hit controller-ownership friction (`ECONTROL_REQUIRED`), so the preferred live proof mode is `--setup-mode preloaded-inventory`.

## Next Action

QA Marshal can review and close `QA-20260529-005` for equipment. Keep combat follow-through under `QA-20260529-004` / `CQA5`, and consider a follow-up named combat soak that starts after gear is equipped.
