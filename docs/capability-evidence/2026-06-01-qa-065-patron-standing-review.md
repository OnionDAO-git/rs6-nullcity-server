# QA-20260601-065 Patron Standing Review

Date: 2026-06-01 21:50 CDT
Packet: QA-MARSHAL-PATRON-STANDING-ON-GRANT-1

## Verdict

Fixed in source. Live verification is still pending a controller restart onto `agents/wip`.

## What Was Reviewed

- `PATRON-STANDING-ON-GRANT-1` commit `5e52cba9`
- `src/controller/city-integration/service.ts`
- `src/controller/controller-host.ts`
- `src/controller/city-integration/service.test.ts`
- Patron standing/letter stores and producer tests

## Finding

The original `PATRON-STANDING-ON-GRANT-1` fix correctly wired `creditAttention(...cityUserId...)` to:

- call an `onPatronSupport` host callback,
- record patron standing in `StandingLedger`,
- dispatch tier letters through the shared `LettersStore`.

However, a fresh disk reader still saw `0` standing after the city attention grant, because the new callback mutated the in-memory standing ledger but did not persist patron ledgers immediately. Dashboard and patron-standing HTTP readers load from disk, so the visible payoff could still look absent until controller shutdown.

## Red/Green Regression

Added a host-level regression:

- `src/controller/controller-host.test.ts`
- Test: `persists city attention-grant patron standing immediately for dashboard standing reads`

Red result before the fix:

- Expected `standing.points('alice@onion', 'embassy')` to be `10`
- Received `0`

Green fix:

- `ControllerHost` now calls `this.persistPatronLedgers()` after city-side patron support records standing and tier letters.

## Verification

- `npm test -- --runInBand src/controller/controller-host.test.ts -t "persists city attention-grant patron standing"`: pass
- `npm test -- --runInBand src/controller/controller-host.test.ts`: pass, 32 tests
- `npm test -- --runInBand src/controller/city-integration/service.test.ts`: pass, 72 tests
- `npm test -- --runInBand src/controller/patron/standing-ledger.test.ts src/controller/patron/letters-producer.test.ts src/controller/patron/letters-store.test.ts`: pass, 77 tests
- `npm run check:no-ui`: pass
- `npm run build`: pass
- `npm run typecheck`: pass

Note: clean worktree verification reused the main checkout `node_modules` because the temporary worktree does not have its own install.

## Live Follow-Up

After a controller restart onto `agents/wip`, live verify:

1. Call `POST /api/nullcity/residents/:id/attention-grants` with a real `cityUserId`.
2. Confirm AP increases.
3. Confirm `/v1/patron/standing?human=<cityUserId>` shows updated points/tier.
4. Confirm `/v1/inbox?human=<cityUserId>` receives any tier-crossing letter when the grant crosses a tier threshold.

Do not mark this live-verified until that restart and probe happen.
