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
- `POST /api/nullcity/proposals/:id/birth`: materialize an approved proposal into a resident (idempotent).
- `POST /api/nullcity/residents`: birth a resident from a funded proposal payload.
- `POST /api/nullcity/residents/:id/attention-grants`: credit resident attention with `idempotencyKey`.
- `GET /api/nullcity/residents/:id/wealth`: inspect resident RuneScape gold, item `995`.
- `POST /api/nullcity/residents/:id/ap-gp-exchanges`: atomically burn resident GP item `995` and credit AP in one linked exchange record.
- `POST /api/nullcity/residents/:id/gold-burns`: burn resident gold item `995` with `idempotencyKey`.
- `POST /api/nullcity/residents/:id/messages`: deliver an attendee inbox message to a resident.
- `GET /api/nullcity/residents/:id/public-snapshot`: runtime state plus latest Library projection.
- `GET /api/nullcity/residents/:id/log` and `/library-events`: recent Library timeline events.
- `GET /api/nullcity/residents/:id/death`: runtime death marker and Library state.
- `POST /api/nullcity/ncri`: admin: create a new NCRI definition.
- `GET /api/nullcity/ncri`: list all NCRIs, sorted by `createdAt`.
- `GET /api/nullcity/ncri/:id`: fetch one NCRI by id.
- `POST /api/nullcity/ncri/:id/approve`: admin-approve a pending NCRI.
- `POST /api/nullcity/ncri/:id/transfer`: transfer NCRI ownership (requires approved + available).
- `POST /api/nullcity/ncri/:id/buy`: idempotent listed-sale purchase with AP price-match guard.
- `POST /api/nullcity/ncri/:id/redeem-intent`: move a sold NCRI into the dashboard print queue.
- `POST /api/nullcity/ncri/:id/redeem-complete`: burn GP item `995` and complete print redemption.
- `POST /api/nullcity/ncri/:id/redeem`: mark NCRI as redeemed (idempotent).
- `GET /api/nullcity/ncri/print-queue`: read print queue entries (`status=awaiting_redemption|redeemed|all`).
- `GET /api/nullcity/economy/digest`: current AP/GP/NCRI/exchange economy digest for dashboard/Storyteller.
- `GET /api/nullcity/economy/live`: city-wide live AP/GP rollup with residents/events/proposals (cacheable JSON).
- `GET /api/nullcity/economy/totals`: live AP/GP totals and top resident balances.
- `GET /api/nullcity/economy/events`: live redacted event tail.
- `GET /api/nullcity/economy/residents`: live per-resident AP/GP summary.
- `GET /api/nullcity/economy/listings`: active NCRI listings (`saleStatus=listed`, approved + available).
- `GET /api/nullcity/economy/heartbeat`: live liveness/readiness signal for economy/dashboard polling.
- `GET /api/nullcity/storyteller/latest`: latest grounded digest+dispatch artifact summary for dashboard read models.
- `GET /api/nullcity/storyteller/canon`: published Storyteller canon queue snapshots.
- `GET /api/nullcity/storyteller/review`: review-required Storyteller queue snapshots.

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
- `POST /api/nullcity/proposals/:id/birth` — birth approved proposal into a resident
  - Body: `{}`
  - Response: `{ ok: true, proposalId, resident, created, connected, fundedAttention }`
  - Notes: idempotent; repeated calls return the same birth record and do not birth twice.
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

## NCRI Routes (S5a/S11b — JSON routes ready)

NCRI (Null City RuneScape Item) records live in `memory.dir/city-integration/ncri/<id>.json`. The `NcriRegistry` class (`src/controller/ncri/ncri-registry.ts`) handles persistence and state transitions. HTTP routes are live in `src/controller/city-integration/http-server.ts`.

**Approval lifecycle:** `pending` → `approved` (admin gate)
**Redemption lifecycle:** `available` → `redeemed` (idempotent)
**Sale lifecycle:** `unlisted` → `listed` → `sold` → `awaiting_redemption` → `redeemed` (or `delisted`)
**Owner transitions:** allowed when `approvalStatus = 'approved'` and `redemptionStatus = 'available'`

**Routes (dashboard contract):**

- `POST /api/nullcity/ncri` — admin: create a new NCRI definition
  - Body: `{ itemId, displayName, lore, propertyTags?, printable?, printAssetRef?, owner }`
  - Response: `NcriRecord` JSON (`approvalStatus: "pending"`, `redemptionStatus: "available"`)
- `POST /api/nullcity/ncri/:id/approve` — admin approve
  - Body: `{ adminNotes? }`
  - Response: updated `NcriRecord` (`approvalStatus: "approved"`)
- `POST /api/nullcity/ncri/:id/transfer` — transfer ownership (requires approved + available)
  - Body: `{ newOwner, reason? }` where `reason` is one of `sale | gift | admin_transfer`
  - Response: updated `NcriRecord`
- `POST /api/nullcity/ncri/:id/buy` — atomic listed-sale transition with idempotency key
  - Body: `{ idempotencyKey, cityUserId, apPrice, sourceId? }`
  - Response: `{ ok, ncriId, buyerCityUserId, previousOwner, apPrice, gpRedemptionCost, record, idempotent? }`
  - Rejects when the NCRI is not listed, is already redeemed, or the submitted AP price is stale.
- `POST /api/nullcity/ncri/:id/redeem-intent` — move a sold NCRI into the dashboard print queue
  - Body: `{ cityUserId, sourceId? }`
  - Response: `{ ok, ncriId, cityUserId, record, printQueueEntry, sourceId? }`
  - Rejects when the caller does not own the sold NCRI or the NCRI has no active pricing.
- `POST /api/nullcity/ncri/:id/redeem-complete` — burn real RuneScape GP item `995` and complete print redemption
  - Body: `{ idempotencyKey, cityUserId, gpAmount, residentName?, sourceId? }`
  - `gpAmount` must equal the active `gpRedemptionCost`; by default the GP is burned from the NCRI source resident.
  - Response: `{ ok, ncriId, cityUserId, residentName, gpAmount, gpEvidence, record, sourceId?, idempotent? }`
- Redemption intent and completion append transition evidence to `memory.dir/city-integration/ncri/audit.jsonl`; completion also persists idempotency/audit records under `memory.dir/city-integration/`.
- `GET /api/nullcity/ncri/print-queue?status=awaiting_redemption|redeemed|all` — dashboard/print-bridge queue
  - Response: `{ asOf, items }`
  - Each item includes `{ ncriId, itemId, displayName, cityUserId, status, gpRedemptionCost?, printable, printAssetRef?, createdAt, updatedAt, redeemedAt? }`.
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
  "saleStatus": "awaiting_redemption",
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

**Important:** NCRI `itemId` is a real RuneScape item id (positive integer). `redeem-complete` burns real GP item `995` through the city inventory authority before marking the NCRI redeemed. The physical print UI still lives in the dashboard repo; this server owns the queue contract and audit evidence.

## Goal Contracts (S9a)

Resident binary goals. When a goal is marked `achieved`, the service writes a durable `goal_achieved` event to the resident's Library timeline.

### Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/nullcity/goals` | `{ residentName, goalText, completion? }` | `GoalContract` |
| `GET` | `/api/nullcity/goals` | — | `GoalContract[]` |
| `GET` | `/api/nullcity/goals/:id` | — | `GoalContract` |
| `POST` | `/api/nullcity/goals/:id/achieve` | `{ evidence, tick?, apAtCompletion?, gpAtCompletion? }` | `GoalContract` |

### GoalContract payload

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "residentName": "res:agent",
  "goalText": "Find a reliable way to make 100 GP/hour and write the strategy into the Library",
  "completion": { "condition": "gp_hour >= 100", "evidenceSource": "runtime:bank-balance" },
  "status": "active | achieved | abandoned",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "achievedAt": "ISO8601",
  "achievedEvidence": "runtime:bank-balance"
}
```

`POST /goals/:id/achieve` is idempotent: a second call with the same id returns the existing achieved record without writing a duplicate Library event.

The `goal_achieved` Library timeline event is a `resolve`-phase arc event visible in `inferStoryArc` and the `CityEventDigest.goalEvents` bucket (via `goalContractsToDigestGoalEvents`). The Storyteller verifier checks for `goal_completed` evidence before narrating a goal completion in public canon.

## AP Attention-Grants (S11a)

Credit AP (Attention Points) to a live resident. AP is the Null City life-force currency — not RuneScape gold.

**Route:** `POST /api/nullcity/residents/:id/attention-grants`

**Request body:**

```json
{
  "idempotencyKey": "patron-topup-2026-05-30-001",
  "amount": 50,
  "cityUserId": "user:alice",
  "sourceType": "patron_topup",
  "sourceId": "checkout:abc123",
  "note": "Alice topped up res:ada for the June 1 event."
}
```

- `idempotencyKey` (required): caller-chosen key; repeat calls with the same key return the cached result.
- `amount` (required): positive integer AP to credit.
- `cityUserId`, `sourceType`, `sourceId`, `note`: optional audit metadata.

**Response 200:**

```json
{
  "ok": true,
  "resident": "res:ada",
  "attentionBefore": 120,
  "attentionAfter": 170,
  "creditedAmount": 50
}
```

**Side effects:**

- Appends a `city_attention_credit` event to the resident's Library timeline.
- Appends an `ap_topup` entry to the shared `EconomyEventLog` so the next `/economy/digest` reflects the credit.

**Error 404** `{ "error": "resident_not_found" }` — resident not online in the controller.

**Error 409** `{ "error": "idempotency_payload_mismatch" }` — same key was previously used with different body fields.

## GP Wealth Inspection and Gold Burns (S11a)

GP is real RuneScape gold (coin item `995`). These routes read or consume actual in-game inventory; no Null City ledger is created.

### GET `/api/nullcity/residents/:id/wealth`

Inspect how much GP (item `995`) a resident currently holds.

**Response 200:**

```json
{
  "ok": true,
  "resident": "res:ada",
  "itemId": 995,
  "amount": 1250
}
```

**Side effects:** Appends a `city_gold_observed` Library event and a `gp_observed` economy log entry.

### POST `/api/nullcity/residents/:id/gold-burns`

Burn (consume) GP from a resident's RuneScape inventory — used as the GP leg of an AP-for-GP exchange.

**Request body:**

```json
{
  "idempotencyKey": "exchange-2026-05-30-007",
  "amount": 200,
  "cityUserId": "user:bob",
  "sourceType": "city_trade",
  "sourceId": "apgp:res:ada:exchange-2026-05-30-007"
}
```

**Response 200** (sufficient gold):

```json
{
  "ok": true,
  "resident": "res:ada",
  "itemId": 995,
  "burnedAmount": 200,
  "remainingAmount": 1050
}
```

**Response 409** (insufficient gold — resident does not have enough coins):

```json
{
  "ok": false,
  "resident": "res:ada",
  "itemId": 995,
  "error": "insufficient_gold",
  "requestedAmount": 200
}
```

A `409` never mutates inventory. The caller can retry with a lower amount or a new idempotency key. This is the guard that prevents residents from paying GP they do not have.

### POST `/api/nullcity/residents/:id/ap-gp-exchanges`

Complete an AP-for-GP exchange in one linked record: burn real RuneScape coin item `995` from the resident, then credit AP to that same resident.

Use this route for dashboard/operator exchanges so Storyteller and economy views can cite one exchange id with both sides of evidence. Use `gold-burns` only for lower-level diagnostics or non-AP GP spends.

**Request body:**

```json
{
  "idempotencyKey": "exchange-2026-05-30-007",
  "apAmount": 50,
  "gpAmount": 25,
  "cityUserId": "user:bob",
  "sourceType": "operator_exchange",
  "sourceId": "dashboard-trade-007"
}
```

**Response 200** (both GP burn and AP credit succeeded):

```json
{
  "schemaVersion": 1,
  "exchangeId": "apgp:res:ada:exchange-2026-05-30-007",
  "idempotencyKey": "exchange-2026-05-30-007",
  "resident": "res:ada",
  "apAmount": 50,
  "gpAmount": 25,
  "cityUserId": "user:bob",
  "sourceType": "operator_exchange",
  "sourceId": "dashboard-trade-007",
  "status": "complete",
  "apEvidence": {
    "creditedAmount": 50,
    "attentionBefore": 3000,
    "attentionAfter": 3050
  },
  "gpEvidence": {
    "itemId": 995,
    "burnedAmount": 25,
    "remainingAmount": 100
  },
  "createdAt": "2026-05-30T18:30:00.000Z",
  "completedAt": "2026-05-30T18:30:00.000Z"
}
```

**Response 409** (`status: "failed_gp"`): the resident does not hold enough real coin `995`. No AP is credited and no GP is burned.

Other non-complete statuses are server-side operator failures (`failed_ap` or `failed_unknown`) and should be shown as review-required. If `failed_ap` occurs, GP evidence may already exist and an operator should reconcile before retrying.

**Side effects on success:** appends a `city_ap_gp_exchange` Library event and an `ap_gp_exchange` economy log entry. `/economy/live`, `/economy/events`, `/economy/digest`, Storyteller digests, and the dashboard economy panel can all display the exchange without inventing either side.

## Economy Digest (S11a)

`GET /api/nullcity/economy/digest` — aggregate AP/GP/NCRI/goal activity for the Storyteller and dashboard D5 panel.

**Optional query params:**

| Param | Type | Meaning |
|---|---|---|
| `since` | ISO 8601 string | Include only events at or after this timestamp. |
| `until` | ISO 8601 string | Include only events at or before this timestamp. |

**Response 200 — `CityEventDigest`:**

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-30T14:00:00.000Z",
  "windowStart": "2026-05-30T12:00:00.000Z",
  "windowEnd": "2026-05-30T14:00:00.000Z",
  "totalEvents": 12,
  "countsByKind": {
    "ap_grant": 2,
    "ap_topup": 1,
    "ap_decay": 5,
    "ap_fade": 0,
    "gp_observed": 2,
    "gp_earned": 1,
    "gp_traded": 1,
    "ap_gp_exchange": 0,
    "ncri_sale": 0,
    "ncri_redemption": 0
  },
  "apGrantedTotal": 120,
  "apDecayedTotal": 45,
  "gpEarnedTotal": 150,
  "gpTradedTotal": 200,
  "residents": [
    {
      "residentName": "res:ada",
      "apGranted": 70,
      "apDecayed": 20,
      "apNet": 50,
      "gpEarned": 150,
      "gpTraded": 200,
      "eventCount": 8
    }
  ],
  "notable": [
    {
      "ts": "2026-05-30T13:45:00.000Z",
      "kind": "gp_traded",
      "residentName": "res:ada",
      "summary": "res:ada traded 200 GP"
    }
  ],
  "goals": {
    "active": 3,
    "achieved": 1,
    "abandoned": 0,
    "recentlyAchieved": [
      {
        "residentName": "res:ada",
        "goalText": "Find a reliable way to make 100 GP/hour and write the strategy into the Library.",
        "achievedAt": "2026-05-30T11:00:00.000Z"
      }
    ]
  }
}
```

**Important vocabulary:**

- `apGrantedTotal` and `apDecayedTotal` track **AP** (Attention Points — the Null City ledger). They have no connection to RuneScape coins.
- `gpEarnedTotal` and `gpTradedTotal` track **real RuneScape GP** (coin item `995`). They are **not** a second Null City ledger.
- `notable` events include high-GP transactions (≥ 100 GP by default) and NCRI redemptions.

The dashboard D5 Storyteller feed should consume this endpoint; the CLI `npm run storyteller:dry-run -- --memory-root <path>` builds the full narrative-layer `StorytellerDigest` from this data (no model call). `npm run storyteller:run` adds a model-backed narrative on top.

## Economy Live View (S-ECON-VIEW-1 / S-ECON-VIEW-2)

These routes provide a polling-friendly live AP/GP read model for dashboard packet D9 and viewer surfaces.

### GET `/api/nullcity/economy/live`

Returns the complete live snapshot (`city`, `countsByKind`, `topResidentsByAttention`, `residents`, `recentEvents`, `pendingProposals`) with:

- `Cache-Control: max-age=2`
- redacted human handles (`user:*`, `city-user:*`, `@mentions`) in `recentEvents`
- default 15-minute window, max 1-hour lookback

**Optional query params:**

| Param | Type | Meaning |
|---|---|---|
| `since` | ISO 8601 string | Window start (clamped to at most 1 hour old). |
| `limit` | positive int | Max `recentEvents` returned (default 20, max 200). |
| `residentLimit` | positive int | Max `topResidentsByAttention` rows (default 10, max 100). |

### GET `/api/nullcity/economy/totals`

Same window semantics as `/economy/live`, but returns only aggregate sections:

- `asOf`, `window`
- `city`
- `countsByKind`
- `topResidentsByAttention`
- `pendingProposals`

### GET `/api/nullcity/economy/events`

Same window semantics as `/economy/live`, but returns:

- `asOf`, `window`
- `countsByKind`
- `recentEvents` (redacted)

### GET `/api/nullcity/economy/residents`

Same window semantics as `/economy/live`, but returns:

- `asOf`, `window`
- `city`
- `residents` (all known residents from runtime state + economy events + proposal queue)
- `topResidentsByAttention`

### GET `/api/nullcity/economy/listings`

Returns active marketplace NCRIs (`saleStatus=listed`, approved and not redeemed) for dashboard economy/operator panels. Sold or redemption-queue NCRIs leave this marketplace route and appear through `/api/nullcity/ncri/print-queue` instead.
Only `saleStatus === "listed"` entries are returned; `sold` and `delisted` records are excluded.

- `asOf`
- `listings[]` with:
  - `ncriId`, `itemId`, `displayName`
  - `owner`, `sourceResidentName` (when known)
  - `approvalStatus` (`approved`), `redemptionStatus` (`available`)
  - `createdAt`, `updatedAt`
  - `listed: true`

### GET `/api/nullcity/economy/heartbeat`

Returns a compact liveness/readiness snapshot for dashboard polling loops.

- `Cache-Control: max-age=2`
- payload fields:
  - `asOf`
  - `controllerUptimeSec`
  - `residentCount`, `activeResidentCount` (online runtime residents or residents with recent economy events)
  - `economyEventCount`
  - `lastEconomyEventTs`, `lastEconomyEventKind`
  - `lastDigestBuiltAt` (when Storyteller artifacts exist)
  - `degradedFlags[]` (`no_economy_events`, `no_active_residents`, `storyteller_missing`)

This route is read-only and does not mutate controller/runtime state.

## Resident Routes (S11a)

These routes expose live runtime state and Library timelines for individual residents.

### GET `/api/nullcity/residents/:id/public-snapshot`

Current runtime snapshot plus Library index and recent events. Use for the dashboard D3 resident detail panel.

**Response 200:**

```json
{
  "ok": true,
  "resident": "res:ada",
  "online": true,
  "state": {
    "resident": "res:ada",
    "attention": 170,
    "tick": 14203,
    "budgets": { "requestsThisMinute": 2, "requestsToday": 87 }
  },
  "position": { "x": 3222, "y": 3218, "level": 0 },
  "library": {
    "residentName": "res:ada",
    "currentState": "active",
    "soulPath": "docs/souls/res-ada.md"
  },
  "portrait": { "name": "res:ada", "description": "A determined achiever." },
  "recentLibraryEvents": [
    { "kind": "city_attention_credit", "ts": "2026-05-30T13:55:00.000Z", "amount": 50 }
  ],
  "deceased": false
}
```

- `online: false` when the resident is not running in the current controller session.
- `state` and `position` are `undefined` when offline.
- `recentLibraryEvents` contains the last 50 events.

### GET `/api/nullcity/residents/:id/library-events` (alias: `/log`)

Last 200 Library timeline events for the resident — sorted oldest first.

**Response 200:**

```json
{
  "ok": true,
  "resident": "res:ada",
  "events": [
    { "kind": "city_attention_credit", "ts": "2026-05-30T13:55:00.000Z", "amount": 50 }
  ]
}
```

### GET `/api/nullcity/residents/:id/death`

Check whether a resident has faded/died.

**Response 200:**

```json
{
  "ok": true,
  "resident": "res:ada",
  "deceased": false,
  "libraryState": "active"
}
```

`libraryState` is `"ended"` when the resident's Library arc has been resolved (e.g. after a fade or binary goal save).

### POST `/api/nullcity/residents/:id/messages`

Deliver an attendee inbox message to a live resident. The resident receives it as a perception event on the next controller tick.

**Request body:**

```json
{
  "messageId": "msg-2026-05-30-001",
  "threadId": "thread-ada-alice",
  "cityUserId": "user:alice",
  "senderDisplayName": "Alice",
  "body": "Hey Ada, how is the fishing going?",
  "idempotencyKey": "msg-2026-05-30-001"
}
```

**Response 200:**

```json
{
  "ok": true,
  "resident": "res:ada",
  "delivered": true,
  "event": {
    "kind": "human_inbox_message",
    "ts": "2026-05-30T14:00:00.000Z",
    "text": "Hey Ada, how is the fishing going?",
    "threadId": "thread-ada-alice",
    "messageId": "msg-2026-05-30-001",
    "from": { "id": "city-user:user:alice", "kind": "human", "name": "Alice" }
  }
}
```

**Error 404** — resident not online. The dashboard should poll `/public-snapshot` to confirm online status before delivering a message.

## Storyteller Dispatch (S11b — latest endpoint + CLI runs)

Storyteller generation remains CLI-driven to avoid unattended paid-model calls:

- `npm run storyteller:dry-run -- --memory-root <path>` — deterministic digest from live AP/GP/NCRI/goal evidence; no model call.
- `npm run storyteller:dry-run -- --fixture` — deterministic digest from test fixtures; no model call.
- `npm run storyteller:run -- --latest` — model-backed narration from the most recent dry-run digest.
- `npm run storyteller:run -- --digest-id <id>` — model-backed narration from a specific digest artifact.

Artifacts are written to `data/controller/storyteller/<run-id>/digest.json` and `dispatch.json`.

For dashboard bridges, the controller HTTP API now exposes:

- `GET /api/nullcity/storyteller/latest`
- `GET /api/nullcity/storyteller/canon?limit=<n>`
- `GET /api/nullcity/storyteller/review?limit=<n>`

Returns the newest run by `dispatch.generatedAt` fallback `digest.builtAt/windowEnd/windowStart`:

```json
{
  "ok": true,
  "runId": "run-2026-05-30T120500Z",
  "digestId": "digest-2026-05-30T120000Z",
  "builtAt": "2026-05-30T12:00:00.000Z",
  "windowStart": "2026-05-30T11:45:00.000Z",
  "windowEnd": "2026-05-30T12:00:00.000Z",
  "topEventCount": 9,
  "residentCount": 5,
  "summary": "Residents traded GP and requested AP support.",
  "dispatch": {
    "dispatchId": "dispatch-2026-05-30T120500Z",
    "generatedAt": "2026-05-30T12:05:00.000Z",
    "modelProfile": "haiku",
    "needsReview": false,
    "warningCount": 0,
    "publicTitle": "City pulse",
    "publicBody": "Residents sustained AP and traded GP with grounded evidence.",
    "publicBullets": ["..."],
    "operatorSummary": "No unsupported claims detected.",
    "operatorWarnings": [],
    "reviewReasons": [],
    "eventRefCount": 6,
    "eventRefsUsed": ["event:..."],
    "estimatedCostUsd": null
  }
}
```

If no storyteller artifacts exist yet, the route returns `404 { "error": "storyteller_not_found" }`.

Queue routes return bounded snapshots for operator feeds:

```json
{
  "ok": true,
  "queue": "canon",
  "count": 3,
  "entries": [
    {
      "ok": true,
      "runId": "run-2026-05-30T121500Z",
      "digestId": "digest-2026-05-30T121000Z",
      "builtAt": "2026-05-30T12:10:00.000Z",
      "topEventCount": 6,
      "residentCount": 4,
      "dispatch": {
        "dispatchId": "dispatch-2026-05-30T121500Z",
        "needsReview": false,
        "warningCount": 0,
        "eventRefCount": 5
      }
    }
  ]
}
```

Notes:

- `queue` is either `canon` (auto-published/approved) or `review` (operator review needed).
- `count` is the full queue length; `entries` respects `limit` (default `20`, max `50`).
- Missing queue folders return `200` with empty `entries`.
- S-STORY-2 can hold publication when already-recorded dispatch cost would exceed the daily cap. It does **not** invoke paid models, so spend-preflight enforcement before model calls remains part of S-STORY-3/watch-mode.
