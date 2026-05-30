# AP/GP Economy Live View — Design (S-ECON-VIEW)

**Status:** Design draft. Server JSON contract spec; dashboard repo owns the visualization.
**Author:** claude (autonomous, D-WEEKEND-DESIGN packet).
**Date:** 2026-05-30.
**Roadmap:** Workstream S, parent task S11 (Dashboard contract handoff). Builds on S6b EconomyEventLog + S11a/S11b JSON contracts already shipped.
**Read first:**
- `src/controller/city-integration/{service.ts, http-server.ts}` — EconomyEventLog and existing AP/GP routes.
- `docs/city-dashboard-integration.md` — current JSON contract surface.
- `docs/2026-05-29-weekend-sprint-plan.md` §P2 + §Dashboard repo work.
- `docs/2026-05-29-cic-meetup-decisions.md` — visible cohesion is the goal of the OnionDAO viewer surface.

---

## Purpose

We now have the substrate (EconomyEventLog, AP ledger, GP burn evidence, NCRI sales, soul births, exchanges). The dashboard's current Storyteller feed (D5) shows what *one* digest narrates, and the resident detail page (D3) shows what *one* resident holds. What is missing is a **city-wide live economy view**: AP balance across all residents, GP earned/traded in the last N minutes, pending Soul proposals, active NCRI listings, and a stream of economy events as they happen. This is the "see the city breathing" surface for OnionDAO viewers and Chicago CIC attendees.

This spec defines the **server-side JSON contract** (no UI in this repo; D9 in the dashboard repo will consume it). The aim: any dashboard agent can build the live view from these JSON endpoints alone.

## Decisions to make (maintainer-blocking)

1. **Streaming vs polling.** SSE (Server-Sent Events) gives smooth live updates; polling at 2-5s intervals is simpler and fine for ~30 residents. Recommendation: **expose both — polling JSON first, SSE as a follow-up packet** once dashboard adopts.
2. **Public vs operator data split.** Should the live view show resident names directly (public OK because residents are pseudonymous) or redact like the Storyteller does? Recommendation: **resident names public; human/patron handles redacted** (consistent with existing Storyteller verifier rules).
3. **Time window for "live."** Default lookback for the events stream — 5 min? 15 min? 1 hour with cursor pagination? Recommendation: **15 min default with `?since=<ts>` for cursor pagination**, max 1 hour lookback per request.
4. **Granularity for AP totals.** Aggregate by resident, by hour, by event-kind? Recommendation: **expose all three as separate summary routes**, let the dashboard pick.

## Proposed approach

Six new (or extended) JSON routes under `/api/nullcity/economy/`, all polling-friendly, all JSON-only, all sourced from the existing EconomyEventLog and city-integration stores. No new persistence; this is read-model assembly.

### Route catalog

```
GET /api/nullcity/economy/live              # roll-up of all the below in one call
GET /api/nullcity/economy/totals            # AP grand totals (city, top-N residents, treasury cut)
GET /api/nullcity/economy/events?since=...  # event stream tail (default 15 min)
GET /api/nullcity/economy/residents         # per-resident AP balance + GP observed + recent activity flag
GET /api/nullcity/economy/listings          # active NCRI listings (depends on S-NCRI-1)
GET /api/nullcity/economy/heartbeat         # liveness signal: last event ts, last digest ts, controller uptime
```

### Schema sketch

```ts
interface LiveEconomySnapshot {
  asOf: string;                          // ISO timestamp at server-build time
  windowMs: number;                       // lookback used (default 900000 = 15 min)
  city: {
    apTotal: number;                      // sum across all resident balances
    apDelta: number;                      // net change in window
    gpObserved: number;                   // sum coin item 995 across residents
    gpDelta: number;
    residentCount: number;                // alive in window
    activeResidentCount: number;          // produced any action in window
  };
  topResidentsByAp: Array<{ residentName: string; apBalance: number; gpObserved: number; lastActionTs: string }>;
  eventCounts: Record<EconomyEventKind, number>; // ap_topup, gp_observed, gp_burn, ap_for_gp_exchange, ncri_sale, ncri_redemption, soul_born, attention_exhausted
  recentEvents: EconomyEvent[];           // tail, default last 20, redacted
  activeListings: Array<{ ncriId: string; residentName: string; apPrice: number; listedAt: string }>;
  pendingProposals: Array<{ proposalId: string; goal: string; apFunded: number; apThreshold: number }>;
  heartbeat: { lastEventTs: string; lastDigestTs: string; controllerUptimeSec: number; degradedFlags: string[] };
}
```

### Redaction

Reuse the existing Storyteller verifier helper that strips raw human handles. Resident names (`res:hans`, `res:duke`) flow through unredacted; human/patron identifiers (`@email`, `0xaddress`) are replaced with `<patron #N>` keyed per-snapshot so the dashboard can group without revealing PII.

### Caching

The roll-up is build-from-source on every request (read EconomyEventLog tail, AP ledger snapshot, NcriRegistry listings, SoulProposal queue). At ~30 residents this is cheap. Cache with `Cache-Control: max-age=2` to avoid hammering on a 1-Hz dashboard refresh.

### Performance bound

Sized for **10-30 concurrent residents** (per sprint plan guardrail). At that scale `/economy/live` is <50ms even on cold reads. If it exceeds 100ms, the implementation should add an in-memory `LiveEconomyCache` with 2-second TTL, but ship without it first.

### SSE follow-up (optional)

`GET /api/nullcity/economy/stream` (SSE) would push `EconomyEvent`s as they're appended, plus periodic `heartbeat` frames. Same redaction. Behind a feature flag because some hosting layers strip SSE headers. Not in the v1 packet; recorded as S-ECON-VIEW-3.

### Demo script benefit

For the June 1 CIC demo, opening the dashboard's economy live view in a browser and watching AP totals tick up as a patron funds a Soul proposal, then a resident earns GP, then an NCRI sale fires, would be the *single best* visual proof that the simple loop is real and observable.

## Definition of done

- Six new routes (`live`, `totals`, `events`, `residents`, `listings`, `heartbeat`) registered in `http-server.ts` with route tests.
- `LiveEconomySnapshot` type exported from a shared place the dashboard repo can mirror.
- Redaction reuses Storyteller helper; focused test proves a raw human handle never appears in any response.
- Cache-Control header on `live` is `max-age=2`.
- `docs/city-dashboard-integration.md` documents every new route with example JSON payloads.
- `npm run check:no-ui` passes.
- A fixture-fed integration test proves end-to-end: seed AP/GP/NCRI/Proposal fixtures → call `GET /api/nullcity/economy/live` → assert all sections populated and consistent.

## Open questions

- **OQ-1:** Should `recentEvents` ever include events older than the window (e.g. the resident's last action 30 min ago, for context)? Default: no — strict window; dashboard can fetch with `?since` for backfill.
- **OQ-2:** Should `topResidentsByAp` be capped (top 10? top 30?) or return all? Default: top 10 with `?limit=N` override up to 100.
- **OQ-3:** Does the live view need a "what's about to happen" section (proposals near threshold, listings near expiry)? Default: yes for proposals (`pendingProposals` already covers); NCRI listings don't expire in v1 (out of scope of S-NCRI).
- **OQ-4:** Should events expose action source (which Brain decision triggered the AP debit)? Default: no in v1; that's traceable through Library and would bloat the payload.

## Out of scope

- The dashboard UI itself (lives in `../rs6-nullcity-residents-dashboard` as packet D9).
- Historical analytics (this is *live*; deep-time analysis is a separate report tool).
- Cross-controller aggregation (single controller assumed).
- Per-human leaderboards or "biggest patron" surface (privacy-sensitive; needs separate decision).
- Editing economy state via the live view (read-only).

## Packet decomposition

- **S-ECON-VIEW-1: Roll-up route + totals + events + residents** (cloud-doable). Implement `/live`, `/totals`, `/events`, `/residents` with route tests, redaction, fixture-fed integration test. DoD: a curl on `/api/nullcity/economy/live` returns the full snapshot from fixture data; no UI files added. **No live stack needed.**

- **S-ECON-VIEW-2: Listings + heartbeat + dashboard contract doc** (cloud-doable). Implement `/listings` (depends on S-NCRI-1 schema or stubs the field), `/heartbeat`, document all routes in `docs/city-dashboard-integration.md`. DoD: dashboard agents can build D9 from the doc alone. **No live stack needed.**

- **S-ECON-VIEW-3: SSE stream + feature flag** (cloud-doable substrate, needs live stack for tail-latency proof). Add `/stream` SSE route behind `economy.liveView.sseEnabled` config flag, focused test with mock client. DoD: SSE test connects, receives heartbeat + injected event, disconnects cleanly. **Substrate cloud-doable; latency benchmark needs hot stack.**

- **D9: Dashboard live economy view** (dashboard repo). Consume the routes above and render in the dashboard. Out of this repo's scope but tracked in roadmap for visibility. **Dashboard repo only.**
