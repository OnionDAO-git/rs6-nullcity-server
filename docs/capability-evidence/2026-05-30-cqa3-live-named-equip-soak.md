# CQA3-live: named-resident equip soak substrate (2026-05-30)

Packet: `CQA3-live`  
Issue: `QA-20260529-005`  
Owner: `codex`

## Scope

Build a reproducible named-resident soak that creates an ordinary equip opportunity (unequipped training gear in inventory) and proves or disproves `kind:"equip"` before combat in ordinary action logs.

## What Landed

1. Added operator CLI `controller:equip-soak`:
   - `src/controller/admin/named-equip-soak.ts`
   - `npm run controller:equip-soak`
2. Added focused verifier/parser tests:
   - `src/controller/admin/named-equip-soak.test.ts`

CLI behavior:

- Attaches to a named resident (default `res:qa-survivor`).
- Sends setup `unequip` actions for `main_hand` + `off_hand` so useful combat gear becomes inventory-held.
- Spawns a nearby command peer and sends `"<prefix> train combat"` (default prefix `survive`) to trigger ordinary combat routines.
- Verifies ordinary action-log evidence for resident-side `equip` (`*_equip_useful_gear`) followed by `attack`.
- Writes artifact `data/benchmarks/capability-qa-YYYY-MM-DD/named_equip_soak_<stamp>.json`.

## Verification

- `npm test -- --runInBand src/controller/admin/named-equip-soak.test.ts` (PASS 5/5)

## Live Run Attempt

Command:

```bash
npm run controller:equip-soak -- --duration-ms 30000 --poll-ms 500
```

Result:

- Failed in this sandbox before gateway handshake:
  - `connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`

## Outcome

- Ordinary equip proof is still not available in this environment.
- The packet now has a concrete, repeatable live-proof tool for loopback-permitted hosts.

## Next Action

Run `controller:equip-soak` on a host where the agent gateway loopback port is reachable, then fold artifact metrics into `docs/resident-capabilities.md` and close or keep `QA-20260529-005` based on observed `equip`/`attack` evidence.
