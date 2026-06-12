# QA-20260603-089 Public Wall Death Truth Residual

Packet: `qa-20260603-1333-wall-deathtruth`
Scope: READ-ONLY live verification
Proposed issue: `QA-20260603-089`
Severity: P1
Area: Wall / inbox / Library / graveyard
Owner area: dashboard public event API / wall snapshot, with source-truth checks against Library and graveyard

## Finding

`QA-20260602-085` is verified for the narrow dashboard overview regression: `/api/overview` no longer shows death/passing broadcasts for residents currently online. A residual public-wall bug remains:

- `GET http://127.0.0.1:8787/v1/wall/snapshot?limit=12` returned 12 duplicate `[Broadcast] On the passing of res:loop-check` letters.
- All 12 have the same `senderResident=res:loop-check` and `dispatchedAt=2026-06-01T18:47:33.396Z`, but distinct letter ids / recipients.
- `GET http://127.0.0.1:8787/v1/graveyard` and `GET http://127.0.0.1:43596/v1/graveyard` both returned `total=0`.
- Library has no `res-loop-check` or `res-death-test` entry, and `res-restart-test` Library `index.json` is still `currentState="living"`.
- `GET http://127.0.0.1:8787/api/overview` dedupes the three passing subjects to one each, but still includes passing broadcasts for `res:loop-check`, `res:death-test`, and `res:restart-test` while graveyard truth is empty.

This is not the old online-resident false-death symptom for `res:qa-social`; it is the remaining public wall / graveyard / Library consistency gap.

## Current Evidence

Runtime orientation at `2026-06-03 13:33-13:36 CDT`:

- Screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`.
- Listeners present: `43595`, `43594`, `43610`, `43596`, `43611`, `8787`, `5174`.
- Dashboard web `/` returned `200`.
- `/api/controller/status` returned `available=true`, `residentsWithRuntime=27`.
- `/api/overview` returned readiness `ok`, `23` residents, `10` online.
- `qmd` unavailable.

Public wall evidence:

```bash
curl -fsS 'http://127.0.0.1:8787/v1/wall/snapshot?limit=12' |
  jq '[.letters[]? | {id,kind,subject,senderResident,recipient,dispatchedAt,deliveryChannels}]'
```

Observed repeated rows:

- subject: `[Broadcast] On the passing of res:loop-check`
- senderResident: `res:loop-check`
- dispatchedAt: `2026-06-01T18:47:33.396Z`
- count: `12`

Truth checks:

```bash
curl -fsS 'http://127.0.0.1:8787/v1/graveyard' | jq '{total,deceased}'
curl -fsS 'http://127.0.0.1:43596/v1/graveyard' | jq '{total,deceased}'
```

Both returned `total=0`.

Library checks:

- `data/controller/memory/library/res-loop-check/index.json`: missing
- `data/controller/memory/library/res-death-test/index.json`: missing
- `data/controller/memory/library/res-restart-test/index.json`: `currentState="living"`, no death metadata

## Likely Code Path

`rs6-nullcity-residents-dashboard/packages/server/src/index.ts` passes the fixed filters into overview:

- `/api/overview`: `runtime.recentLetters(12, { dedupeBroadcasts: true, livingResidents })`

`rs6-nullcity-residents-dashboard/packages/server/src/event-public.ts` does not pass equivalent filters into the public wall route:

- `/v1/wall/snapshot`: `context.runtime.recentLetters(limit, { excludeSyntheticSenders: true })`

That explains why overview is improved while public wall still returns duplicate broadcasts.

## Next Action

Add or update a canonical issue-register row for `QA-20260603-089` once `docs/issue-register.md` is safe to edit.

Fix direction for dev agents:

- Apply broadcast dedupe to `/v1/wall/snapshot`.
- Filter death/passing/epitaph letters against public truth, not only online-resident truth: if a sender is missing from Library/graveyard or has Library state `living`, public wall should not present it as a current death.
- Add regression tests in `packages/server/src/event-public.test.ts` covering duplicate broadcast recipients and missing/living/non-graveyard senders.
- Re-run read-only live verification against `/api/overview`, `/v1/wall/snapshot`, `/v1/graveyard`, and Library index state.

## Collision Note

`docs/issue-register.md` and `docs/agent-status.md` were already dirty from `qa-20260603-1318-dashboard-death-truth`; this handoff avoids editing the issue register and only appends a compact status pointer.
