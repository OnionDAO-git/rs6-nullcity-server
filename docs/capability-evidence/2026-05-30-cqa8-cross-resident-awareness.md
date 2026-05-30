# CQA8 — Cross-Resident Awareness (World Event Memory Routing)

Date: 2026-05-30  
Packet: CQA8  
Owner: codex

## Goal

Improve the weak cross-resident awareness row by ensuring LoreBus `world_event` signals are not transient-only. Residents should retain durable memory facts from nearby resident world events.

## What changed

- Added `world_event` durable-fact routing in `MemoryRouter`:
  - New durable path: `facts/world-events.md`
  - `fire_lit` world events now produce explicit first-person-usable facts with source and position.
  - Malformed world events (missing `loreKind` or `source`) are ignored to avoid noisy memory pollution.

## Verification

Focused tests:

- `npm test -- --runInBand src/controller/memory/memory-router.test.ts`
  - Pass: `7/7`
  - Includes two new assertions:
    - `world_event fire_lit` -> writes to `facts/world-events.md`
    - malformed `world_event` -> no durable write

Repo checks:

- `npm run check:no-ui` (pass)
- `npm run build` (pass)

## Result

Cross-resident world events now persist as durable memory facts instead of only transient perception events, improving continuity for future planning/chat loops.

## Remaining gap

This packet improves memory substrate, not live reaction proof. A live benchmark/log pass is still needed to prove residents consistently act on these world-event memories in ordinary controller life.
