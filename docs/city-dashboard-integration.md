# City Dashboard Integration

The controller can expose an internal HTTP API for the city dashboard. Start it only on a private network or behind the dashboard BFF.

Required controller env/flags:

- `CONTROLLER_CITY_HTTP_PORT`, or `--city-http-port <port>`
- `CONTROLLER_CITY_HTTP_TOKEN`, or `CITY_DASHBOARD_NULLCITY_TOKEN`, or `--city-http-token <token>`
- Optional: `CONTROLLER_CITY_HTTP_HOST` / `--city-http-host`, default `127.0.0.1`
- Optional: `CONTROLLER_CITY_HTTP_PATH_PREFIX` / `--city-http-path-prefix`, default `/api/nullcity`

Every request must send `Authorization: Bearer <token>`.

Routes:

- `POST /api/nullcity/proposals`: create a Soul proposal.
- `GET /api/nullcity/proposals`: list Soul proposals.
- `GET /api/nullcity/proposals/:id`: fetch one Soul proposal.
- `POST /api/nullcity/proposals/:id/fund`: add AP funding to a proposal.
- `POST /api/nullcity/proposals/:id/approve`: admin-approve a threshold-crossed proposal.
- `POST /api/nullcity/proposals/:id/reject`: admin-reject a proposal.
- `POST /api/nullcity/residents`: birth a resident from a funded proposal payload.
- `POST /api/nullcity/residents/:id/attention-grants`: credit resident attention with `idempotencyKey`.
- `GET /api/nullcity/residents/:id/wealth`: inspect resident RuneScape gold, item `995`.
- `POST /api/nullcity/residents/:id/gold-burns`: burn resident gold item `995` with `idempotencyKey`.
- `POST /api/nullcity/residents/:id/messages`: deliver an attendee inbox message to a resident.
- `GET /api/nullcity/residents/:id/public-snapshot`: runtime state plus latest Library projection.
- `GET /api/nullcity/residents/:id/log` and `/library-events`: recent Library timeline events.
- `GET /api/nullcity/residents/:id/death`: runtime death marker and Library state.

Idempotency and audit records are persisted under `memory.dir/city-integration/`.

## Soul Proposal Routes (S4a — JSON routes ready)

Soul proposals live in `memory.dir/city-integration/proposals/<id>.json`. The `SoulProposalStore` class handles persistence and state transitions. The city integration service and HTTP server expose the dashboard JSON contract for proposal creation, AP funding, admin approval, rejection, listing, and lookup. Resident materialization from an approved proposal remains the S4b birth-integration step.

**Routes (dashboard contract):**

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

## NCRI Routes (S5a — substrate ready, HTTP wiring PENDING)

NCRI (Null City RuneScape Item) records live in `memory.dir/city-integration/ncri/<id>.json`. The `NcriRegistry` class (`src/controller/ncri/ncri-registry.ts`) handles persistence and state transitions. HTTP routes exposing these are planned for S5b.

**Approval lifecycle:** `pending` → `approved` (admin gate)
**Redemption lifecycle:** `available` → `redeemed` (idempotent)
**Owner transitions:** allowed when `approvalStatus = 'approved'` and `redemptionStatus = 'available'`

**Planned routes (dashboard contract):**

- `POST /api/nullcity/ncri` — admin: create a new NCRI definition
  - Body: `{ itemId, displayName, lore, propertyTags?, printable?, printAssetRef?, owner }`
  - Response: `NcriRecord` JSON (`approvalStatus: "pending"`, `redemptionStatus: "available"`)
- `POST /api/nullcity/ncri/:id/approve` — admin approve
  - Body: `{ adminNotes? }`
  - Response: updated `NcriRecord` (`approvalStatus: "approved"`)
- `POST /api/nullcity/ncri/:id/transfer` — transfer ownership (requires approved + available)
  - Body: `{ newOwner }`
  - Response: updated `NcriRecord`
- `POST /api/nullcity/ncri/:id/redeem` — mark redeemed (idempotent)
  - Body: `{}`
  - Response: updated `NcriRecord` (`redemptionStatus: "redeemed"`)
- `GET /api/nullcity/ncri` — list all NCRIs, sorted by `createdAt`
  - Response: `NcriRecord[]`
- `GET /api/nullcity/ncri/:id` — get one NCRI
  - Response: `NcriRecord`

**NcriRecord JSON shape:**

```json
{
  "schemaVersion": 1,
  "id": "ncri-1748541600000-x9kj2a",
  "itemId": 4151,
  "displayName": "Abyssal Whip of the City",
  "lore": "A legendary weapon inscribed with Null City lore, forged at CIC Chicago.",
  "propertyTags": ["combat", "printable"],
  "printable": true,
  "printAssetRef": "assets/prints/abyssal-whip-v1.svg",
  "owner": "user:alice",
  "approvalStatus": "approved",
  "redemptionStatus": "available",
  "adminNotes": "First NCRI minted for the June 1 event.",
  "createdAt": "2026-05-29T17:00:00.000Z",
  "updatedAt": "2026-05-29T17:05:00.000Z",
  "redeemedAt": null
}
```

**Library events emitted by `LibraryUpdater.observeNcriEvent()`:**

| kind | when | significanceReasons |
|---|---|---|
| `ncri_created` | Admin creates a new NCRI definition | `["ncri:ncri_created"]` |
| `ncri_transferred` | Ownership transferred to a new city user | `["ncri:ncri_transferred"]` |
| `ncri_redeemed` | NCRI marked redeemed by owner | `["ncri:ncri_redeemed"]` |

NCRI Library events appear in the resident's `timeline.jsonl` so the Storyteller digest can cite them. The `CityEventDigest.ncriEvents` field carries these events (see `src/controller/storyteller/types.ts`).

**Important:** NCRI `itemId` is a real RuneScape item id (positive integer). No GP ledger is created by this module; GP pricing for sale/redeem lives in the exchange layer (S3). A `printable: true` NCRI requires a physical print fulfillment step outside this repo.
