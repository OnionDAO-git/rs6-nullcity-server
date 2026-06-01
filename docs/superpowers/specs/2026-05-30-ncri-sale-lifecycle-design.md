# NCRI Sale Lifecycle — Design (S-NCRI)

**Status:** Design draft. Pricing model and printer GP cost decisions remain maintainer-blocking.
**Author:** claude (autonomous, D-WEEKEND-DESIGN packet).
**Date:** 2026-05-30.
**Roadmap:** Workstream S, parent task S5. Builds on S5a registry + S5b storyteller-event bridge already in code.
**Read first:**
- `src/controller/ncri/ncri-registry.ts` — existing schema, create/approve/transfer/redeem states, `ncri_sale` and `ncri_redemption` events.
- `docs/2026-05-29-cic-meetup-decisions.md` — "Special RuneScape-themed printable items should require GP so humans have a reason to interact with residents."
- `docs/2026-05-29-weekend-sprint-plan.md` §P2 (NCRI + Printer Utility), and open decisions 5, 6 (first 3 NCRIs and printer GP costs).
- `src/controller/city-integration/service.ts` (EconomyEventLog) for the audit-trail substrate.

---

## Purpose

NCRIs (Null City RuneScape Items) are admin-approved metadata records that bind a real RuneScape item to Null City lore + an optional printable artifact. The registry exists. What is unspec'd: the **economics of a sale** — how a human ends up holding an NCRI in exchange for AP, how the resident gets credit, what the redemption fulfilment loop looks like for the print queue, how operator pricing is enforced, and what the dashboard surface for browsing/buying looks like.

Without this spec, NCRIs are inert metadata. With it, they become the primary GP-bearing reason for a human to spend AP on a resident — which is the simple loop's final closing edge.

## Decisions to make (maintainer-blocking)

1. **First 3 NCRIs.** CIC decision #6 open. Candidates: bronze sword (combat starter), tinderbox (firemaking iconography), small fishing net (skill iconography). Could also include a hero-tied item (e.g. Father Aereck's holy symbol). Decision sets the seed data.
2. **3D-printer GP costs.** CIC decision #5 open. Per-NCRI GP cost is the print-redemption price the human pays in real RuneScape gold to actually receive a physical print. Default proposal: tier by complexity (small ≤ 500 GP, medium ≤ 2k GP, large ≤ 10k GP).
3. **AP sale price model.** Options: admin-set fixed AP price; resident-set with floor/ceiling; auction with N-minute window. Default proposal: admin-set per NCRI with a `pricingMode: 'admin-fixed' | 'resident-quoted'` flag so we can evolve to resident-quoted later without schema break.
4. **Sale failure refund policy.** If sale fails after AP debit (resident loses item, redemption errors), is AP auto-refunded, frozen for operator review, or credited as in-store-credit? Default: frozen → operator review.

## Proposed approach

NCRI sales become the canonical AP-for-value transaction. Every sale links an `ApLedger` debit, an `EconomyEvent` of kind `ncri_sale` (already emitted), an NCRI ownership transition, and an optional later `ncri_redemption` event (when the print actually ships).

### State machine

```
        admin creates                       sale offered                  human pays AP
draft ─────────────────▶ approved ─────────────────▶ listed ─────────────────▶ sold
                              │                          │                       │
                              │                          ▼                       ▼
                              │                       delisted              awaiting_redemption
                              │                                                   │
                              │                                                   ▼
                              │                                              redeemed (print fulfilled)
                              │                                                   │
                              │                                                   ▼
                              ▼                                              archived
                          revoked
```

- `draft` and `approved` already exist in the registry.
- `listed` is new: the NCRI now has a price and is visible on the marketplace JSON route.
- `sold` is the moment AP is debited and ownership transfers from the resident (or city) to the human; emits `ncri_sale`.
- `awaiting_redemption` is the gap between AP payment and physical print being produced; the human owes GP to redeem.
- `redeemed` fires when GP is paid AND the print queue marks fulfilment; emits `ncri_redemption`.
- `revoked` is admin-only (e.g. accidental approval); only valid from `approved`.

### Pricing record

```ts
interface NcriPricing {
  ncriId: string;
  pricingMode: 'admin-fixed' | 'resident-quoted';
  apPrice: number;            // what the human pays to buy
  gpRedemptionCost: number;   // what the human pays in real GP to claim the print
  quotedBy?: string;          // resident id if resident-quoted
  quotedAt?: string;          // ISO timestamp
  floor?: number;             // resident-quoted-only: admin price floor
  ceiling?: number;           // resident-quoted-only: admin price ceiling
}
```

Pricing lives in `data/controller/ncri/pricing.jsonl` (append-only). Latest row per `ncriId` wins. Admin price changes are auditable.

### Sale flow (substrate)

1. Dashboard or admin CLI calls `POST /api/nullcity/ncri/:id/buy` with `{ humanId, apPrice }`.
2. Server validates: NCRI state == `listed`, `apPrice` matches latest pricing record (prevent stale offer), human has enough AP.
3. Atomic transaction:
   - Debit AP via existing `ApLedger`.
   - Transition NCRI `listed → sold`.
   - Credit AP to the resident (less optional treasury cut configured per-NCRI).
   - Emit `EconomyEvent {kind: 'ncri_sale', ncriId, humanId, residentName, apAmount, gpRedemptionCost, ...}` (S5b already does this if we feed it the new fields).
4. If anything fails: rollback, no debit, no transition, emit `EconomyEvent {kind: 'ncri_sale_failed', reason, ...}` for audit.

### Redemption flow (print queue handoff)

- The print queue lives in the dashboard repo; this server exposes the read/write contract.
- `POST /api/nullcity/ncri/:id/redeem-intent` records "human commits GP for print" and transitions `sold → awaiting_redemption`.
- `POST /api/nullcity/ncri/:id/redeem-complete` requires real GP-burn evidence (item `995` deducted from the resident or treasury account) and transitions `awaiting_redemption → redeemed`. Emits `ncri_redemption`.
- The 3D printer / fulfilment side polls `GET /api/nullcity/ncri/print-queue?status=awaiting_redemption|redeemed`.

### Audit trail

Every transition appends to `data/controller/ncri/audit.jsonl`:

```
{ ts, ncriId, fromState, toState, actor, reason, evidenceRefs[] }
```

The Storyteller (via S-STORY spec) reads `ncri_sale` and `ncri_redemption` to narrate "Duke Horacio sold the Bronze Sword of First Light to traveler@example for 150 AP" without invention because both sides are evidenced.

### Treasury cut

Optional per-NCRI config: `treasuryCutBps` (default 0). When set, that fraction of the AP sale goes to a city treasury account instead of the resident. Lets the operator fund city-wide infra without taxing every resident equally.

## Definition of done

- `NcriRegistry` gains `listed`, `awaiting_redemption`, `redeemed`, `revoked` states with focused transition tests.
- `NcriPricingStore` (new) is append-only JSONL, with `setPrice` and `latestPrice` API.
- `POST /api/nullcity/ncri/:id/list`, `/buy`, `/redeem-intent`, `/redeem-complete`, `/revoke` HTTP routes added; route tests cover happy + reject paths.
- Sale flow is atomic across AP debit, NCRI transition, and event emission; rollback proven by a failure-injection test.
- `data/controller/ncri/audit.jsonl` records every transition with evidence refs.
- `docs/city-dashboard-integration.md` documents marketplace and print-queue routes.
- `npm run check:no-ui` passes (no UI in this repo).
- A focused capability test: a fresh fixture goes draft → approved → listed → sold → awaiting_redemption → redeemed with the right events and ledger deltas.

## Open questions

- **OQ-1:** Should an NCRI be allowed to have multiple physical copies (printable=true; each redemption a new physical instance) or is each NCRI a unique 1:1 token? Default: 1:1 token; each redemption is a new ownership step on the same token. Multi-copy would require a separate `NcriEdition` substrate.
- **OQ-2:** Can a resident hold an NCRI and choose to keep it forever (never list)? Default: yes — owning is the right of the resident; only listed NCRIs are for sale.
- **OQ-3:** What happens to an NCRI when the holding resident dies/saves? Default: returns to city treasury, ready to be re-approved or re-listed; needs maintainer call.
- **OQ-4:** Should NCRI redemption GP burn happen on a resident, the human, or the operator? Real coin item `995` lives in-game; the human does not have their own RS account. Default: the **resident** burns the GP (which the human's AP previously bought from them), so the GP cost is symbolic of the value flow.

## Out of scope

- Physical print queue UI (lives in dashboard repo).
- Resident-resident NCRI trading (only resident↔city↔human in this spec).
- NCRI as wagerable item in resident-resident PvP (CIC scope cut).
- Royalties on resale (no secondary market in v1).
- Time-limited NCRIs / expiring offers.

## Packet decomposition

- **S-NCRI-1: Listing + pricing substrate** (cloud-doable). Add `listed` state, `NcriPricingStore`, `POST /api/nullcity/ncri/:id/list`, marketplace `GET /api/nullcity/ncri?status=listed`. Tests: pricing replay, list/delist transitions, stale price rejection. DoD: an admin can price + list an NCRI; the dashboard sees it via JSON. **No live stack needed.**

- **S-NCRI-2: Sale + atomic ledger linkage** (cloud-doable). Add `POST /api/nullcity/ncri/:id/buy`, atomic AP debit + ownership transfer + event emission, failure injection rollback test, treasury cut. DoD: a buy call moves a listed NCRI to `sold` with linked AP debit/credit + `ncri_sale` event; failure injection rolls back. **No live stack needed.**

- **S-NCRI-3: Redemption + print-queue contract** (needs print queue side). Add `redeem-intent`/`redeem-complete` routes with GP-burn evidence requirement, `awaiting_redemption` → `redeemed` transitions, audit JSONL, dashboard handoff doc. DoD: a sold NCRI can move through redemption end-to-end with both AP and GP burns linked; dashboard print queue can read the queue. **Cloud-doable for substrate; live print run needs hot stack.**

- **S-NCRI-4: Seed data + admin CLI** (cloud-doable). Ship the first 3 NCRI fixtures (per maintainer pick), per-NCRI GP cost, `npm run ncri:list/price/approve` admin CLI, dry-run sale walk-through for demo script. DoD: `npm run storyteller:dry-run` produces a digest with a seed NCRI sale event without paid model call. **No live stack needed.**
