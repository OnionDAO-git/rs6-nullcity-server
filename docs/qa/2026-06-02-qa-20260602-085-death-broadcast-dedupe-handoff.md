# QA-20260602-085 Death Broadcast Dedupe Handoff

Dashboard SHA: `b87a3c6`

## Issue

Live `/api/overview` showed 12 duplicate `[Broadcast] On the passing of res:qa-social` letters while the same payload and controller truth showed `res:qa-social` alive, online, `hp.current=10`, and current Library state `living`.

## Fix

Dashboard `RuntimeRepository.recentLetters()` now supports:

- `dedupeBroadcasts`: collapses identical broadcast kind/sender/subject/timestamp rows that were sent to multiple inboxes.
- `livingResidents`: suppresses death/passing/epitaph letters when the sender resident is currently visible as living/online.

`/api/overview` passes the currently online resident rows into `recentLetters(12, { dedupeBroadcasts: true, livingResidents })`.

## Verification

- Red/green regression: `bun test packages/server/src/runtime.test.ts` (`30/30`).
- Dashboard gates: `bun run typecheck`, `bun run check`, `bun run build` all passed.
- Temp patched BFF on `:8798` using live read-only roots returned `passingSubjects=0` for `res:qa-social` while the same payload showed `res:qa-social online=true`, `hp.current=10`, and AP present.

## Remaining

The live dashboard BFF on `:8787` still needs steward-approved restart/deploy to pick up dashboard commits `7a5171c`, `69d8fce`, `0faf2f7`, and `b87a3c6`.
