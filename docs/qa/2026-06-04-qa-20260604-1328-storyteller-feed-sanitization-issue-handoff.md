# QA Packet `qa-20260604-1328-storyteller-feed-sanitization`

- Time: 2026-06-04 13:28-13:33 CDT
- Classification: READ-ONLY verification plus docs-only issue handoff
- Proposed issue: `QA-20260604-094`
- Severity: P1
- Area: Storyteller / dashboard public truth
- Owner area: dashboard Storyteller digest feed and public copy sanitizer

## Finding

The dashboard projector BFF now sanitizes the latest Storyteller frame before public display, but the Storyteller digest feed still serves the raw canon dispatch copy.

This creates a split where:

- `GET /api/projector/overview` rewrites risky or misleading AP/attention phrasing and recomputes frame freshness.
- `GET /api/storyteller/digests?limit=6` still labels the same canon dispatch as public-safe while exposing raw text such as:
  - `flagged his AP situation: 5000 on the ledger, but fading fast enough`
  - `warned his AP is fading`
  - `make an embassy offering to stabilize AP`
- The rendered `/story` route shows the feed and marks it `PUBLIC-SAFE DISPATCH COPY: NO REVIEW FLAGS ARE PRESENT.`

Public health for the same dispatch says `lowApResidents=0`, so the public feed overstates urgency even though the projector surface has already learned to soften that copy.

## Orientation Evidence

- Server branch: `agents/wip`, behind `origin/agents/wip` by 57 commits.
- Dashboard branch: `codex/storyteller-overview-bff`.
- Expected screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`, `nullcity-storyteller`.
- Expected listeners present: `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`.
- `qmd` unavailable on PATH.
- Dashboard root: `http://127.0.0.1:5174/` returned `200`.
- Overview: readiness `ok`, gateway connected, controller available, `23` residents, `10` online, `27` runtimes.
- Controller status: `HEALTH: ok`, `25` residents, `0` erroring.

## Storyteller Evidence

`GET http://127.0.0.1:8787/api/projector/overview` at `2026-06-04T18:30:17.767Z` returned the latest frame with:

- `digestId=live-20260604181950`
- `source.freshnessMs=627714`
- `source.freshnessStatus=fresh`
- sanitized public body beginning with `flagged his attention: 5000 remains`
- sanitized bullet `mentioned attention-5000 remains`
- sanitized watch item `guide his next move`

The persisted raw frame at `data/controller/storyteller/latest-frame.json` still has write-time/raw text:

- `source.freshnessMs=0`
- `flagged his AP situation: 5000 on the ledger, but fading fast enough`
- `warned his AP is fading`
- `Will Hans make an embassy offering to stabilize AP?`

`GET http://127.0.0.1:8787/api/storyteller/digests?limit=6` returned the canon digest `canon/live-20260604181950` with:

- `needsReview=false`
- `warningCount=0`
- `publicBody` containing the raw `AP situation` / `fading fast` wording
- `publicBullets` containing `warned his AP is fading`
- `operatorSummary` containing `AP fade warning`

Rendered route check:

- `http://127.0.0.1:5174/story` rendered `Storyteller Dispatches`.
- It displayed `PUBLIC-SAFE DISPATCH COPY: NO REVIEW FLAGS ARE PRESENT.`
- The rendered text still matched risky phrases such as `fading fast`, `AP is fading`, or `stabilize AP`.

## Likely Code Path

Dashboard repo:

- `packages/server/src/projector-overview.ts` has `publicProjectorCopy()` and `removeFalseAttentionUrgency()` logic.
- `packages/server/src/storyteller.ts` `readStorytellerDigestFeed()` gates/redacts public dispatch copy, but does not apply the same public-copy sanitizer.
- `packages/server/src/index.ts` serves `/api/storyteller/digests` directly from `readStorytellerDigestFeed(config.memoryRoot, limit)`.
- `packages/web/src/App.svelte` renders `storytellerLatestPreview(cityStoryDigest)` on `/story`, so the feed payload is the source of the visible public dispatch preview.

## Impact

This is not a runtime outage and not the same as `QA-20260603-092`.

- `QA-20260603-092` tracks frozen projector freshness.
- This packet tracks inconsistent public-copy sanitization between projector overview and the Storyteller digest feed.

The result is a human-visible truth gap: one public Storyteller surface has safe copy, while another public Storyteller surface still claims low-risk public safety and displays misleading urgency language.

## Next Action

For the dashboard dev agent:

1. Reuse or extract the projector public-copy sanitizer for `readStorytellerDigestFeed()` before exposing `dispatch.publicTitle`, `dispatch.publicBody`, `dispatch.publicBullets`, and preview-relevant operator text.
2. Add regression coverage where a canon, no-review dispatch with `lowApResidents=0` and raw `AP is fading` / `stabilize AP` language is safe in both:
   - `buildProjectorOverviewSnapshot()`
   - `/api/storyteller/digests` feed mapping / `storytellerLatestPreview()`
3. Re-run read-only verification against:
   - `GET /api/projector/overview`
   - `GET /api/storyteller/digests?limit=6`
   - rendered `http://127.0.0.1:5174/story`

## Collision Note

`docs/issue-register.md` is already dirty in the shared server worktree, so this cycle did not add a canonical row there. Add or merge `QA-20260604-094` into the issue register once that file is safe to edit.
