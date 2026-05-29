# City Dashboard Integration

The controller can expose an internal HTTP API for the city dashboard. Start it only on a private network or behind the dashboard BFF.

Required controller env/flags:

- `CONTROLLER_CITY_HTTP_PORT`, or `--city-http-port <port>`
- `CONTROLLER_CITY_HTTP_TOKEN`, or `CITY_DASHBOARD_NULLCITY_TOKEN`, or `--city-http-token <token>`
- Optional: `CONTROLLER_CITY_HTTP_HOST` / `--city-http-host`, default `127.0.0.1`
- Optional: `CONTROLLER_CITY_HTTP_PATH_PREFIX` / `--city-http-path-prefix`, default `/api/nullcity`

Every request must send `Authorization: Bearer <token>`.

Routes:

- `POST /api/nullcity/residents`: birth a resident from a funded proposal payload.
- `POST /api/nullcity/residents/:id/attention-grants`: credit resident attention with `idempotencyKey`.
- `GET /api/nullcity/residents/:id/wealth`: inspect resident RuneScape gold, item `995`.
- `POST /api/nullcity/residents/:id/gold-burns`: burn resident gold item `995` with `idempotencyKey`.
- `POST /api/nullcity/residents/:id/messages`: deliver an attendee inbox message to a resident.
- `GET /api/nullcity/residents/:id/public-snapshot`: runtime state plus latest Library projection.
- `GET /api/nullcity/residents/:id/log` and `/library-events`: recent Library timeline events.
- `GET /api/nullcity/residents/:id/death`: runtime death marker and Library state.

Idempotency and audit records are persisted under `memory.dir/city-integration/`.

## Soul Proposal Routes (S4a — substrate ready, HTTP wiring PENDING)

Soul proposals live in `memory.dir/city-integration/proposals/<id>.json`. The `SoulProposalStore` class handles persistence and state transitions. HTTP routes exposing these are planned for S4b.

**Planned routes (dashboard contract):**

- `POST /api/nullcity/proposals` — create a proposal
  - Body: `{ residentName, soulMarkdown, goalText, binaryCompletionCondition?, apThreshold, proposerCityUserId, proposerDisplayName? }`
  - Response: `SoulProposal` JSON (status: `"proposed"`)
- `POST /api/nullcity/proposals/:id/fund` — add AP funding
  - Body: `{ amount, cityUserId }`
  - Response: updated `SoulProposal` (status advances to `"funding"` or `"threshold_crossed"`)
- `POST /api/nullcity/proposals/:id/approve` — admin approve (requires `threshold_crossed`)
  - Body: `{ adminNotes? }`
  - Response: updated `SoulProposal` (status: `"approved"`)
- `POST /api/nullcity/proposals/:id/reject` — admin reject
  - Body: `{ adminNotes? }`
  - Response: updated `SoulProposal` (status: `"rejected"`)
- `GET /api/nullcity/proposals` — list all proposals, sorted by `createdAt`
  - Response: `SoulProposal[]`
- `GET /api/nullcity/proposals/:id` — get one proposal
  - Response: `SoulProposal`

**SoulProposal JSON shape:**

```json
{
  "schemaVersion": 1,
  "id": "<uuid>",
  "residentName": "res:ada",
  "soulMarkdown": "---\nname: res:ada\narchetype: achiever\n---\n...",
  "goalText": "Find a reliable way to make 100 GP/hour and write the strategy into the Library.",
  "binaryCompletionCondition": "quest:cooks_assistant",
  "apThreshold": 100,
  "apFunded": 110,
  "proposerCityUserId": "user:alice",
  "proposerDisplayName": "Alice",
  "status": "threshold_crossed",
  "adminNotes": null,
  "createdAt": "2026-05-29T12:00:00.000Z",
  "updatedAt": "2026-05-29T12:05:00.000Z",
  "bornAt": null
}
```

**Status transitions:**

```
proposed → funding (first fund below threshold)
proposed | funding | threshold_crossed → threshold_crossed (fund at/over threshold)
threshold_crossed → approved (admin approve)
proposed | funding | threshold_crossed → rejected (admin reject)
approved → born (S4b: after birthResident succeeds, idempotent)
```

AP is tracked as `apFunded` (AP = Attention Points, not GP). GP is real RuneScape coin item `995` tracked separately via resident game state.
