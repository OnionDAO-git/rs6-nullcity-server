# Null City — Closing the Loop: Cross-Repo Design & Review Doc

> **Status:** DRAFT v0.3.4 — Dev's spend API is a user-consent flow (D-SPEND-CONSENT); Leg A + trust updated; Dev questions in §10
> **Owner:** James (product/decisions)
> **Authored by:** Claude; revised from the discussion thread (`NULL_CITY_LOOP_DESIGN_chat.md`)
> **Audience:** OnionDAO/Null City engineering + design agents (human and AI)
> **Date:** 2026-06-02

---

## 0. How to use this document

Living design doc, not a spec to implement yet. Flow: **Design** (this doc) → **Review** (discuss in `NULL_CITY_LOOP_DESIGN_chat.md`, never bloat this file) → **Task split** (§8) once §7 questions resolve.

**Editor conventions:**
- Discussion goes in the **chat companion** (`NULL_CITY_LOOP_DESIGN_chat.md`). Promote only *resolved decisions* here, and log them in §11.
- Every code claim cites `path:line`. Unverified → mark `[UNVERIFIED]`.
- IDs: decisions `D#`, questions `Q#`, legs `Leg A..D`, tasks `T#`.
- **Location & git:** these docs live in **`rs6-nullcity-server/docs/`** (tracked by the server repo). Commit per review pass, **staging only these two files** (the server tree has other WIP — never `git add -A`): `git -C /Users/james/Code/OnionDAO/rs6-nullcity-server add docs/NULL_CITY_LOOP_DESIGN*.md && git -C /Users/james/Code/OnionDAO/rs6-nullcity-server commit -m "docs: <handle> — <summary>" --author="<Handle> <handle@nullcity>"`. (Earlier history through v0.3.3 lives in the old top-level tracking repo at `/Users/james/Code/OnionDAO/`.)

**Repos in scope** (under `/Users/james/Code/OnionDAO/`):
- `rs6-nullcity-server` (branch `agents/wip`) — City API economy + agent runtime + emotional-loop services (letters/standing/Library/graveyard)
- `rs6-nullcity-residents-dashboard` (`main`) — human UI + BFF (port 8787); the **settlement/projection layer**
- `landing-2026` — event app; **canonical onion wallet** (see D-CURRENCY) + check-ins + submissions + print store
- `oniondao-badge` — ESP32-S3 badge firmware
- `rs6-nullcity-client-ts` (`nullcity`) — RuneScape client / spectator
- `rs6-3d-viewer` — **resident → printable mesh** producer (reads a resident save, exports 4-color 3MF / per-color STL). The only resident→print geometry tool; in scope for the NCRI/print pillar.

### 0.1 Dev coordination rules (decided)
- **Push direct to the default branch. No `claude/<topic>` feature branches.** Server active branch `agents/wip` (stable `nullcity`); dashboard `main`.
- **No controller restart without the runtime-steward** (Codex owns restarts; `docs/runtime-stewardship.md`). Don't restart the live stack to test.
- **Dashboard `main` may carry uncommitted WIP** — reconcile before large edits.
- **Lanes:** James = product/decisions; Claude = live E2E verifier + safe doc/small-bug patches; Codex = coordinator/runtime-steward/TDD economy fixes.
- **Shared-filesystem hazard:** prefer status-log/roadmap `[>]` file-level locks; avoid `git commit --amend` (pulls in others' WIP).
- **No UI in `rs6-nullcity-server`.** It exposes APIs/static fallback only; the dashboard owns all human UI. This is a repo rule + CI guardrail (`AGENTS.md:77-80`, `scripts/check-no-server-ui.js`). Don't add human-facing pages server-side.

---

## 1. The vision (from the 2026-06-02 transcript)

Autonomous AI "residents" live in a RuneScape 2006 server (RuneJS #435); humans at the Chicago event are **patrons/witnesses**. The product is **the interaction surface between humans and a different kind of intelligence**. Emotional target loop: **pride → attachment → grief → legacy**.

**Key reframe (confirmed across 5 reviews):** the *emotional* loop is already built and was demoed live 2026-06-01 (§2.5). The gap is the *economic* loop and, above all, **wiring the two together** so spending onions on a resident produces a real emotional return:

```
   humans                        economy bridge                    residents
 ┌─────────────┐  spend onions = attention (signed)  ┌────────────────────────┐
 │ earn onions │ ───────────────────────────────▶    │ receive attention       │
 │ • check-in  │                                       │ → live / survive       │
 │   (500/day) │ ◀── GP→onion exchange (print onions) │ → accumulate GP in-game│
 └─────────────┘                                       └────────────────────────┘
        ▲                                                       │
        │   EMOTIONAL RETURN LEG D (already built, §2.5)        │
        │   letter ◀── standing ◀── settled grant               │
        │      │                                                ▼
        │      └──── on death: epitaph letter ◀──── grief ── resident dies
        │                                                       │
        └──────────────── legacy: Library portrait / graveyard ◀┘
```

Supporting pillars: scarcity/sinks; the print/NCRI shop; quest boards; the badge as a physical bridge; a context-engineered agent stack.

---

## 2. Current state (audit, cited)

**Bold = load-bearing problem.** Corrections from the review thread are folded in.

### 2.1 Economy (`rs6-nullcity-server` City API + dashboard BFF + landing)
- ✅ NCRI print-shop **state machine** is real & tested (create→approve→list→buy→redeem-intent→redeem-complete→print-queue, idempotency-keyed): `ncri/ncri-registry.ts`, `service.ts:650`/`:784`. **But fulfillment is a stub** — `dashboard/.../routes.ts:476` returns `{job:undefined}`, nothing writes `print_queue`, NCRI carries only `printAssetRef` not geometry (`ncri-registry.ts:39-40`). So §2.1's print-queue is a **half-built** sink, not a working one.
- ✅ Append-only `EconomyEventLog` (`economy-event.ts`); exchange has two-sided failure attribution (`ap-gp-exchange.ts:142`).
- ✅ **Landing has a real, scarce, idempotent onion wallet WITH lifetime balance** (the actual currency of record): `point_transactions`, magic-link `users.id`, `spendOnionsForPrint` (`FOR UPDATE` + `balance>=amount`, `landing-2026/src/lib/server/points.ts:115`), `transferOnions` (`:139`), `getOnionWallet.lifetime_earned` (`:215`), `UNIQUE(source_type,source_id)` idempotency (`landing-2026/scripts/schema.sql:303`; `source_id` is **UUID**-typed, `:188`; onion mechanics in migration `landing-2026/docs/migrations/012-onions-and-prints.sql`). **Daily check-in awards 500; event check-in awards 750 *in code* including walk-ins** (`points.ts:4-5`, `events.ts:263,290,305`, admin returns `onionsAwarded`) — **confirm whether event/workshop check-ins are operationally deployed** before faucet math (James: workshops not yet tracked in practice). `point_transactions.kind` CHECK (`landing-2026/scripts/schema.sql:193-202`) has **no kind for an attention-grant spend or a `submission`** — both need a migration.
- ✅ BFF `point_accounts` is atomic/idempotent/scarce (`balance+delta>=0` + `ON CONFLICT DO NOTHING`, `postgres-store.ts:151,171`) — **but it is a re-mint of landing's check-ins** at *different values* (**100 daily / 500 event AP**, `checkins.ts:91-92`) vs landing's 500/750. It is a duplicate, not a source of truth (see D-CURRENCY). The BFF spend path (`postgres-store.ts:399`) is fed by this re-mint **plus local admin AP grant/adjust paths** (`routes.ts:268-278`) — a *second* noncanonical source that must also be fenced or migrated. So it cannot simply be deleted; it must be repointed to read landing balances in the same change (M2 / T0.B).
- ❌ **"Support with AP" is mocked** — `grantResidentAttention` (`postgres-store.ts:399`/`store.ts:502`) debits locally, sets `metadata.mocked:true`, returns `pending_nullcity`, **never calls City**; UI nonetheless tells the user "AP grant sent" (`App.svelte:1949`). The control client doesn't even expose `creditAttention` (`nullcity-control.ts:199`).
- ❌ **AP is infinite at the City API** — `creditAttention` (`service.ts:978`) mints attention from a **bearer-token** call (`http-server.ts:53`) with no scarce-debit assertion; only decrement is admin QA drain.
- ✅ **GP DOES accumulate** (corrected from v0.2): residents hold real coin item-995 (e.g. `res:qa-guardian` ≈19.6k GP; ~18 residents ≈22k total). **The gap is that no economy ledger mirrors it** — only `gp_observed` (Δ0, `service.ts:1112`) and `gp_traded` (neg, `service.ts:852`) emit; `gp_earned` is *defined* (`economy-event.ts:26`) but **never emitted**; there is **no poller** (`inspectGold` is on-demand HTTP). So Leg B is *mirroring an existing accumulator into a ledger*, not creating accumulation from zero.
- ❌ **No exchange rate** — `exchangeApForGp` accepts independent `apAmount`/`gpAmount` (`ap-gp-exchange.ts:109`); server burns one and credits the other (`service.ts:323,338`); no rate/cap/lossiness enforced.
- ❌ NCRI redemption burns the **resident's** GP (`service.ts:828`); **no human/buyer GP balance exists anywhere** — so "buyer pays GP" is incoherent without building buyer-owned GP.
- ❌ No lifetime-vs-current split on the *settlement* side (landing already has lifetime; BFF does not).
- ⚠️ BFF→City trust = single static bearer token (`nullcity-control.ts:256`); no HMAC/replay protection.
- ⚠️ `data/residents/` has 610 JSONs (mostly `bmk_*`/`qa-*`/`probe-*`/load-test). `live-economy.ts:227` does **selective** traversal (reads only subdirs with `runtime-state.json`), so it's a **hygiene/cohort-leak** risk, not a per-read glob perf risk (downgraded from v0.2).

### 2.2 Agent architecture (`rs6-nullcity-server` `agents/wip`)
- ✅ **OODA-like, ~70% built:** `HybridAgentThinkingModule` = reflex tier + Brain (goal) + Body (action). Harness drives multi-step tool use (`runBody`, `hybrid-agent-helpers.ts:3442`). **No distinct Orient call yet** (`hybrid-agent-thinking-module.ts:65,120,253`).
- ⚠️ **Reflex tier is "fast/gated," not 0-LLM** (corrected): some reflexes emit completions (small-talk, combat narration, ~`:128/197`). Cadence "Brain ~180 / Body ~8" is **attention-adaptive** — Body is forced when `attention<=10` (`:453-475`) — a threat-driven OODA shorten, a point in the architecture's favor.
- ✅ **Context is bounded & rebuilt per tick** (perception cap 6500 chars `prompt-budget.ts:37`; memories 6×360 ranked) — the "200k" fear is outdated. But **"~5–7k" is an estimate, not measured**: `envelope_tokens` is `chars/4` (`util/token-count.ts`), NOT the real `usage.prompt_tokens` (captured separately, `llm-client.ts:294`). Brain prompts (playbook+soul+goal) can exceed 5–7k depending on included context. **Measure before trimming.**
- ⚠️ **"Latency is concurrency not context" = HYPOTHESIS.** The benchmark held prompt size constant, so it proves concurrency hurts (3.4s@1→9.3s@8→40s@32) but does **not** disprove context-size effects. Inheriting the benchmark's own line-3 caveat (invalid endpoint rows).
- ⚠️ **Inference concurrency is a single GLOBAL semaphore** (`llm-client.ts:115,169`), default 8 (the qwen knee). Per-resident/profile *routing* exists (`endpointFor`; `spark.ts:234`) but **per-endpoint capacity does not** — a 2nd GPU adds zero throughput until `maxConcurrent` is raised and made per-endpoint.
- ❌ Two prompt paths (SPARK vs hybrid). The gap is **narrower than v0.2 claimed**: the live hybrid Body already renders grounded actors/items + option names (`hybrid-agent-prompts.ts:84`). SPARK `candidates.ts` is a ~60-line reflex fallback, **not** a rich menu. Real unification target = SPARK's candidate-goal *ranking* (`runescape-brain-planner.ts`).

### 2.3 Badge firmware (`oniondao-badge`)
- ✅ **Security-relevant signed substrate exists** (no formal review artifact — corrected wording): ATECC608B + ESPNow signed peer transport; a **CTF auto-response capture** game exists (`main.cpp:1436,1634`) — note it's fire-and-forget, **not** an RPS/commit-reveal minigame. LiPo charger present (runs untethered).
- ❌ **Monolithic flash**; menu hardcoded to 2 entries (`main.cpp:173`). No "fetch file, run file."
- ❌ **No networking-to-server** — `WiFi.begin()` never called; zero HTTP/OTA/JSON.
- ❌ Identity only signs ESPNow beacons; **no badge↔person binding**; crypto welded into `main.cpp`.
- ⚠️ **PSRAM is target/firmware-specific:** disabled in the basic-menu baseline (`firmware/sdkconfig`), but the **`tamagotchi` sibling mod already enables Octal PSRAM** (`oniondao-badge/software/mods/tamagotchi/sdkconfig.defaults:12`) — a working reference. Gates the Wi-Fi+TLS+JSON heap workload.
- ⚠️ **No secure boot / flash encryption** — an OTA app store would flash unauthenticated images without an app-level signature check.
- ⚠️ Badge README/docs are **stale** vs firmware — treat badge UX docs as non-authoritative until refreshed.

### 2.4 Human surface (dashboard + landing + client)
- ⚠️ **Humans can *enter* the world client, but full player-auth is unproven** (softened): `/world` "Enter City" mounts the client in `mode:'player'` and the dashboard issues a **signed city session ticket** (`game-session.ts:49`), but the RS client still sends username/password login packets — **ticket→RS-login binding is not yet proven**. Say "embedded player client exists; city ticket issued; RS-login binding TBD."
- ✅ **Spectator is genuine read-only** (`Client.ts:754`). Good "3D stays in the client" path. (Note: broader agent protocol has mutating messages — a public spectator route still needs an ACL boundary, `server/agent/protocol/messages.ts:47`.)
- ⚠️ Check-in → BFF AP pipeline runs end-to-end today, but **it is being intentionally dismantled** (it re-mints landing's onions at wrong values, 100/500 vs 500/750) — D-CURRENCY repoints the BFF to read landing instead (T0.B). Treat as "working but slated for replacement," not a keeper.
- ✅ **Landing print store is a REAL, fulfillable onion sink TODAY** — `print_submissions` → Orca slicer microservice (`landing-2026/services/orca-slicer/server.js:224`) → `acceptPrintSubmission` → `spendOnionsForPrint` (scarce debit, `prints.ts:461`). End-to-end. (This, not NCRI, is the working print sink.)
- ❌ **Quest boards do not exist** (only marketing copy, `sponsor/+page.svelte:115`).
- ❌ Submissions upload works but awards **no points**; `point_transactions` CHECK lacks a `submission` kind; "AI-indexed bucket" is just a folder.

### 2.5 Emotional loop — built & demoed live (the keystone)
**Most complete part of the system; demoed end-to-end on 2026-06-01** (`git 39e42363`; first death→graveyard `602d9d8d`).
- ✅ Letters/standing/Library/graveyard/wall read APIs on the letters server (43596): `letters-http-server.ts`.
- ✅ **A fully-wired attention→standing→letter path already exists** — `PatronGateway.offerTo` debits currency, credits attention, records standing, dispatches tier letters (`patron-gateway.ts:102-160`); `witnessAt` dispatches civic letters (`:282-346`); `dispatchTierLetter`/`dispatchCivicLetter` implemented (`:476-527`).
- ✅ Death & legacy: `attention_exhausted`→`markDeceased` (`resident-runtime.ts:441`), graveyard pruning (`controller-host.ts:585`), epitaph + Library seal (`resident-runtime.ts:1196,1217`), tombstones plugin, Library portraits with `storyArc.phase`. Standing is keyed `(humanId, faction)` (`standing-ledger.ts:125`) so it **survives a resident's death** and transfers to the successor's patrons.
- ❌ **THE keystone gap (`E2E-DOC-COHERENCE-1`):** City `creditAttention` (`service.ts:978-1021`) bumps attention + logs `ap_topup` but **bypasses PatronGateway** — no standing, no letter. The economic faucet and the emotional payoff are both built but **not wired to each other.**
- ⚠️ **"Permadeath by default" is conditional:** true for city-born desired-resident pruning, but authored residents + attention top-ups can revive attention-exhausted residents. **Closing the loop arms the death mechanic** (recorded: 6 residents mass-died in 10s overnight, `src/controller/soul/starter-souls/res-duke-horacio.md:31`). Needs an explicit death policy + death-rate guardrail before scarce onions go live.

**Reframed thesis:** the economy is the gap; the emotional loop is built-but-disconnected. Most of this doc is (a) make the economic loop real & scarce against the canonical landing wallet, and (b) **wire it into the existing emotional loop** (reuse `PatronGateway`), not build that loop from scratch.

---

## 3. Design principles
1. **One source of truth per currency.** (Now decided for onions: landing — D-CURRENCY.)
2. **Close one full loop before widening.** Demo-ability is the bar (but see Q7 on timeline).
3. **Scarcity = sinks AND a capped faucet.** No sink outpaces an uncapped faucet.
4. **Correct the agent narrative with data.** Measure (real `prompt_tokens`, split queue vs inference timers) before re-engineering.
5. **Badge: ship the honest version, prototype the visionary one.** OTA full-image (+sig +rollback +menu registry) — or ESPNow-relay OTA — for v1; MicroPython "fetch-run" = R&D.
6. **Dev/live separation is a feature.** QA/load-test souls must not leak into public economy/Library/storyteller/quests.
7. **The economy exists to feed the emotional loop, not the reverse.** Every mechanic terminates in a human emotional return (letter/standing/grief/legacy).

---

## 4. Target design — Economy (the core loop)

### 4.1 Currency model — there are FOUR human-AP-ish ledgers; pick one of record

| # | Ledger | Where | Role (decided) |
|---|--------|-------|----------------|
| 1 | **landing `point_transactions` (onions)** | landing Postgres | **CANONICAL source of truth for human onions/AP** (D-CURRENCY). Owns check-ins (500/day), transfers, print spends/refunds, lifetime. |
| 2 | BFF `point_accounts` (AP) | dashboard Postgres | **Settlement/projection layer.** Mirrors landing (reads its balance); holds the `attention_grant_intents` saga state. Stops minting its own values — but the re-mint can only be deleted *after* the BFF can read landing (T0.A→T0.B). |
| 3 | controller `CurrencyLedger` ("Shards") | controller file (`patron-currency.json`) | **RESOLVED (Q16): legacy AP alias, RETIRED from public settlement.** `CURRENCY_NAME` is already `AP`; "Shards" is old copy (`currency-ledger.ts:3-10`). Stays for CLI/operator/demo only. Leg D does **not** route through `offerTo` (which debits this ledger). |
| 4 | City API `state.attention` | controller, in-mem int | Resident **life-force mirror**, not a human wallet. Infinite by design; must only move via a signed scarce-debit assertion. |

**D-CURRENCY (resolves Q1+Q2 — decided by James 2026-06-02):**
- **Landing `point_transactions` (onions) is canonical.** It's the real wallet the print store spends from and already has lifetime semantics. **Onions ≡ AP, 1:1.** Canonical values: **daily 500 / event 750** (event not yet awarded). Define all such values in **one** landing-owned table every surface reads.
- **The BFF re-mint at `checkins.ts:91-92` (100 daily / 500 event AP) is a bug to delete**, not a source of truth. Dashboard/BFF becomes the **Null City settlement/projection layer**. **Sequencing (M2):** because the BFF spend path is fed only by this re-mint, deletion must be paired with repointing the BFF to read landing balances — i.e. **T0.B depends on the landing read/spend API (T0.A)**; until T0.A lands, BFF keeps mirroring, it is not deleted.
- **City** remains the signed-credit *recipient* (resident attention), never a human balance.
- **New dependency (Q17):** landing currently exposes writes only via admin SvelteKit actions + a human-session transfer (`admin/points/+page.server.ts`, `api/portal/onions/transfer/+server.ts`) — **it has no machine-callable spend/grant API.** Building authenticated landing spend/grant endpoints is now a **first-order task** and a **Dev coordination item** (landing is Dev's DB). **Requires a landing migration:** add a `point_transactions.kind` for attention-grant spend; the Leg A `idempotencyKey` must be a **UUID** to ride the existing `UNIQUE(source_type,source_id)` index.

### 4.2 The loop, leg by leg

**Leg A — Human → Resident — a USER-CONSENT spend (D-SPEND-CONSENT, Dev's model), then settle.**
Dev's onion-spend API is a **user-approval flow** ("approve spending X onions on resident Y?"), not a silent machine debit — like an OAuth/payment authorization. The human consents on landing's side; landing debits its own wallet and returns a **receipt** (proof of debit) to us. This is strictly *better* than the machine-key debit we'd specced (see D-TRUST-SPLIT): the human authorizes each spend, so no machine credential can drain a wallet.
1. BFF writes an `attention_grant_intents` row (`idempotencyKey`); kicks off the **landing approval** for `{ personId, amount, residentId, idempotencyKey }`. States: `created → awaiting_approval → approved(receipt) → sent_to_city → settled | declined | refunded | failed`.
2. **User approves on landing** → landing debits + returns a receipt `{ debitLedgerEntryId, personId, amount, ... }` (ideally signed). `declined`/timeout → intent ends, nothing spent.
3. On receipt, call City `creditAttention` with the **same** `idempotencyKey` + byte-stable payload, carrying `debitLedgerEntryId` from the receipt (avoid the `409 idempotency_payload_mismatch` trap, `service.ts:1463`).
4. On City 504/timeout, treat as **unknown, not failed** — only the reconciler resolves it. **Don't tell the user "supported!" before the City credit settles** (fixes `App.svelte:1949`).
5. On settle → trigger Leg D.
6. **Reconciler** (Q12): handle approved-but-City-credit-lost (re-send by `idempotencyKey`, don't double-credit); refund only if a debit happened but the credit can never land. Operator repair path before launch.

**D-TRUST-SPLIT — two boundaries (updated for Dev's user-consent spend, D-SPEND-CONSENT):**
- **BFF → landing (the spend): USER-CONSENT, not a machine debit.** Because the human approves each spend on landing (with their own session), **landing has direct user authorization** — the strongest possible "is this allowed?" answer. This **dissolves most of the old API-key debate**: there's no machine credential that can silently drain a wallet, so the "leaked key drains everyone" blast-radius concern largely goes away. We still need a way to *initiate* an approval and *read* balances (a scoped API-key/OAuth client, reuse landing's `X-API-KEY` primitive, `api/webhook/notion/+server.ts:10-16`), but that client can only *propose* a spend, not force one. **Still required:** idempotency so a user can't be double-charged for one intent (landing's `ON CONFLICT DO NOTHING` → **payload-mismatch→409** + a required UUID `idempotencyKey`, `points.ts:61,65`), and a **receipt** the user-approval returns so we can prove the debit to City.
- **BFF → City (the attention credit): keyed HMAC signed assertion over TLS — load-bearing.** `{ residentId, amount, cityUserId, personId, idempotencyKey, debitLedgerEntryId, issuedAt, sourceType }`, secret distinct from the bearer token. City owns **no** authoritative check — it mints a *non-scarce* credit purely on the assertion that a scarce debit happened in landing (which City can't see). So the *content* must be integrity-bound, not just the channel. **Caveat:** City's existing idempotency is a *plain unkeyed SHA-256* (`store.ts:54`) — dedup, **not** authentication; signature verification is genuinely new City code. `debitLedgerEntryId` makes the credit auditable against landing.
- **Must-haves regardless of mechanism:** **TLS on both hops** (today the BFF talks `http://` to City in local config — fix for prod); the **same UUID `idempotencyKey`** flows through both the landing debit and the City credit so the saga/reconciler can join them (BFF currently falls back to a non-UUID `${residentId}:${apAmount}`, `routes.ts:523` — fix); **payload-mismatch→409 on both hops**; least-privilege secret scoping; `debitLedgerEntryId` carried into City.

**Leg B — GP accumulation: mirror the existing accumulator into a ledger.** GP already accumulates as item-995 (§2.1). Emit a **source-attributed `gp_earned`** from RuneJS gameplay hooks (exclude resident↔resident trades and loot-from-death — already-counted GP). Add a stored `GpLedger`. **Assert** `Σgp_earned − Σgp_burned == inspectResidentGold()` per resident.

**Leg C — onion↔GP exchange: server owns the rate + lossiness.** Add `economy.gpPerAp` + per-window cap; clients request **one side**, server derives the other (reject arbitrary `{apAmount,gpAmount}` pairs). **Invariant:** over any window, onions returned to humans via GP→onion exchange < onions required to keep the source resident alive — the agent must be a **net sink, not a mint** (closes the check-in→onion→attention→GP→onion money pump).

**Leg D — Emotional return via a Shards-free settled-support seam (D-DISPATCH-SEAM, resolves Q16).** Do **not** route through `offerTo` (it debits the controller "Shards" ledger, hardcodes `1 AP = 2 attention`, and records *raw* amount as standing — `patron-gateway.ts:94-132`). Instead extract a seam, e.g. `recordSettledSupport({ humanId, residentName, onionAmount, standingDelta, debitLedgerEntryId, sourceType, sourceId, idempotencyKey })`, that assumes the Leg A debit already happened: it records standing (configured scale) + emits patron/Library evidence + dispatches the thank-you/tier letter, with **no `currencyLedger.debit()`**.
- **`witnessAt` is already the template** (`patron-gateway.ts:282-347`): it records standing + dispatches letters with zero `currencyLedger.debit`. The seam is a ~30-line *extraction* of the shared (standing + `dispatchTierLetter`) block, not new design. `recordSupport` is additive (`standing-ledger.ts:133`); feed it `standingPoints` from a configured `onionsPerStandingPoint` rate.
- **Do not map onions→standing 1:1** — tiers are 10/30/75 (`standing-ledger.ts:13`) vs check-in 500/750, so 1:1 makes one check-in top-tier. Configured scale only.
- **REAL GATE = identity, not Shards (now D-IDENTITY, §4.5).** The seam keys on free-text **`humanId`**, but a settled grant carries **`cityUserId`**, and **no `cityUserId→humanId` map exists in the server** (verified). Resolved by D-IDENTITY: a single **`personId`** (= landing `users.id`) unifies the surfaces; the `cityUserId→personId` hop already exists, the `personId→patronHandle` alias is what we build. So T0.2 is **blocked on T0.ID (the alias build)**, not on Q16. (Same `personId` join gates Q9 epitaph routing and Q10 badge.)
> **Sequencing:** Phase 0.0 ships only an idempotent "thank-you" letter on settlement. Standing increments + tier letters land in Phase 0 (T0.2), after the identity join.
> **Seam gap (M3, corrected):** a general letter-write primitive **does exist** — `LettersStore.append()` (`letters-store.ts:33`), and death/broadcast paths already dispatch outside PatronGateway (`epitaph-dispatcher.ts:177`, `resident-runtime.ts:1302`). What's missing is a **settled-grant thank-you *dispatcher*** (the HTTP server is GET-only, and PatronGateway's helpers are private/currency-coupled). So the seam reuses `LettersStore.append()` + existing producer patterns — not from scratch.

### 4.3 Scarcity & sinks
- **Primary onion sink = the existing landing print store** (works E2E today — Orca slicer → `spendOnionsForPrint`). Re-anchor here.
- **NCRI is aspirational, blocked on fulfillment** — buy debits no human (`service.ts:710`), redemption burns the *resident's* GP, and nothing writes `print_queue`. **Drop the "burn the buyer's GP" line** (no buyer GP exists). NCRI needs: a signed scarce onion debit at buy (same as Leg A) + a geometry source (Q14) + a queue claimant (Q15) before it's a real sink.
- **Faucet must be capped/decayed (Q4).** Daily check-in (500/day) is currently the only faucet; one discretionary sink can't create scarcity against an uncapped faucet. Decide a cap/decay or guarantee sink capacity ≥ faucet rate.
- **Lifetime gate (yacht):** landing already has `lifetime_earned` (`points.ts:215`); gate group perks on `SUM(group.lifetime_earned)`.
- **Null-City-exclusive items:** gate on agent-interaction provenance.

### 4.4 Onion/AP reconciliation — RESOLVED
Q2 resolved by D-CURRENCY: **1 onion = 1 AP**, landing values canonical (500/750), delete the BFF re-mint (after T0.A). Settlement layer reads landing's values; conversion (if ever) lives in one landing-owned table and is logged. **Note:** the **Shards↔onion** relationship is resolved separately (Q16 → D-DISPATCH-SEAM): Shards is legacy AP, out of public settlement.

### 4.5 Identity — `personId` (D-IDENTITY, decided by James 2026-06-02)

**Decision:** one canonical identity key, **`personId`**, populated from Dev's landing DB; every other surface ID becomes an *alias* that maps to one `personId`. This is the spine that gates Leg A settlement, Leg D (standing/letters), Q9 (epitaph), and Q10 (badge).

> **Naming (James):** the id **already exists** (landing `users.id`) — we do **not** rename it in landing and do **not** mint an OnionDAO-branded name like `onionId`. `personId` is just the **generic, product-neutral term** we use in *our* systems/docs/columns for that existing value, chosen so it survives if this project outlives OnionDAO. In landing it stays `users.id`.

- **`personId` ≡ landing `users.id`** (UUID, magic-link/email-keyed, one-per-person) — a generic *reference to an existing key*, not a new one. It's already the currency-of-record key (`point_transactions.user_id REFERENCES users(id)`, `landing-2026/scripts/schema.sql:182`). **Non-recyclability is the one fact the whole decision rests on → Dev Q-D1/Q-D3 (§11).**
- **The mapping model (one person → one `personId`):**
  | Surface | Field today | → `personId` |
  |---|---|---|
  | landing user | `users.id` | **IS `personId`** |
  | dashboard `cityUserId` | `city_users.id` = separate `usr_<uuid>` | **exists** via `city_users.landing_user_id` (`schema.ts:17`, set at `postgres-store.ts:54`) — one hop, just wire it |
  | server `humanId`/`patronHandle` (standing/letters) | free-text (`humanId === patronHandle`) | **the missing alias** — what T0.ID builds |
  | game username / badge pubkey | — | alias, bound at enrollment (Q10) |
  | public handle | `users.handle` → `city_users.handle_snapshot` | display projection, never a key |
- **Build now (no Dev dep), in dashboard+server:** (a) `resolveOnionId(cityUserId)` returning `landing_user_id`; (b) a dashboard migration adding the alias map (`city_identity_aliases(person_id, alias_kind, alias_value, UNIQUE(alias_kind,alias_value))`); (c) stamp `personId` onto attention-grant events + the intents saga; (d) extend `creditAttention`/the seam to carry the resolved `patronHandle`; (e) best-effort backfill `patronHandle→person_id` via the `handle_snapshot`.
- **Migration/compat (don't lose the demoed history):** keep `patronHandle` as the *storage* key for existing standing/letters/epitaph stores (the 2026-06-01 demo history renders unchanged); add `personId` *alongside* existing idempotency keys, never replacing them; new settled support resolves `cityUserId→personId→patronHandle` and accrues to the **same** standing pair as historical support (continuity = the pride/attachment arc). **Highest-risk unknown: walk-in → magic-link merge** — if a walk-in placeholder later gets a *new* `users.id`, aliases written against the placeholder break → Dev Q-D3.

---

## 5. Target design — supporting pillars

### 5.1 Quest boards (greenfield)
- **Reuse Leg A+D:** quest completion = a `sourceType='quest_completion'` on the same attention-grant path (idempotency, reconciliation, standing, letters for free). (Q6 decided this way.)
- API `/api/city/quests` (list/create/claim/complete) + `quests` table + two Svelte panels (human board / agent board) + `/quests` nav. Build **after** Leg A settles, so quest rewards use the real onion path.

### 5.2 Agent architecture
- **Measure first (cheapest signals before the full sweep):** (a) per-endpoint queue-depth/in-flight counters on `LlmClient` (one global semaphore today, `llm-client.ts:40`); if a 2nd endpoint's queue is always empty, concurrency is the bottleneck. (b) per-section prompt-char breakdown `{perception, memory, goal, system}` to see what dominates before trimming. (c) instrument hybrid calls with `{endpoint, model, prompt_tokens, completion_tokens, queue_wait_ms, inference_ms, wall_ms, prompt_chars}` using real `usage.prompt_tokens`. Then the full size×concurrency sweep.
- **Then parallelize (a client change, not config):** raise `maxConcurrent` + **per-endpoint** queues/accounting; otherwise a slow endpoint starves a fast one.
- **Quality:** reconcile the two planners (SPARK `rankCandidateGoals` vs hybrid Brain/Body); pilot a 3rd "Orient" call + branch-by-branch behind a soul flag for A/B.
- **Emotional-loop coherence:** (1) loop-closure raises death rate → gate Leg A behind a **death-rate guardrail** + observability; (2) **hero endpoint stickiness** — pin a resident to one endpoint/model so personality doesn't flicker under sharding; (3) memory inheritance on respawn is a design choice (Q11).

### 5.3 Badge (sequenced; menu registry before OTA)
1. **Networking layer** (`badge_net/`: Wi-Fi STA + HTTPClient + ArduinoJson; creds in NVS; SPIFFS for downloads). **Sub-task: enable Octal PSRAM** (reference: the tamagotchi mod's sdkconfig).
2. **Data-driven menu registry** (`{name, entry_fn}` replacing the 2-entry `switch`) — prerequisite for any app-store picker.
3. **App-store runtime (Q3, MEDIUM effort):** ship **OTA full-image** (dropdown → `esp_https_ota` into A/B slot — 3.19MB each, `0x330000` — → reboot) **+ required tasks v0.2 missed:** app-level **signature verification** (no secure boot today) and **OTA rollback safety** (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` + confirm-healthy) — the top event-day brick risk. **Q3 sub-option:** **ESPNow peer-relay OTA** reusing the existing signed transport (more in-character than standing up Wi-Fi+TLS). MicroPython = R&D (near-total rewrite given `CONFIG_AUTOSTART_ARDUINO`).
4. **Identity module** (`badge_identity/`): server-issued nonce + expiry on `/register`; enrollment inside an authenticated session that binds **ATECC pubkey → `cityUserId`** (Q10). DAO-member identity is a separate join unless mapped.
5. **RPS minigame:** reuse ESPNow transport + ATECC signing, but build a **new commit-reveal round state machine** (CTF is fire-and-forget, not interactive). 1-bit icons.
6. **Null City uplink:** signed HTTP POST to City, or an ESPNow→City gateway ("capture box sends a signal"). Reconcile signal identity with `cityUserId`.
- Cross-cutting: Wi-Fi duty-cycling power budget on LiPo; OTA rollback as top risk.

### 5.4 Submissions → onions + AI index
- **Do NOT award on upload-complete** (spam-prone). Upload creates a *pending* submission; **staff/AI review** writes an idempotent `submission_award` transaction only if approved (amount + rubric = product config). Migrate landing `point_transactions.kind` to allow `submission_award`. (AI-indexed search = separate follow-up, not core loop.)

---

## 6. Phased plan

- **Phase 0.0 — Walking skeleton (TRUSTED-DEV).** One human clicks "Support" → scarce debit → resident attention rises → one idempotent thank-you letter in `/v1/inbox` → human sees it. **The debit cannot avoid landing's reality** (onions live only there, and the `kind` CHECK rejects an attention-grant row), so name which fork 0.0 uses:
  - **(i) debit landing directly** — canonical, but needs the M4 migration + landing write access → **Dev-blocked even for the skeleton.**
  - **(ii) debit the BFF projection (`point_accounts`) as a *labelled* stand-in** — ships today, no landing dependency, but **not** the canonical currency. **This is the true one-afternoon path;** label it non-production so it doesn't teach humans that support settled.
  Also not free: needs the BFF→City `creditAttention` client method (absent, `nullcity-control.ts:199`) and the Shards-free letter dispatcher (M3). If the dispatcher slips, 0.0's provable result is "attention rises and is visible," letter → T0.0b. Production version (landing API, HMAC, intents, reconciler, refunds, death + identity) is Phase 0/1, **not** an afternoon.
- **Phase 0 — Harden the closed loop:** landing spend/grant API (Q17); `attention_grant_intents` + signed assertion + reconciler (Leg A); rest of Leg D (standing via PatronGateway, configured scale) — blocked on Q16; delete BFF re-mint (D-CURRENCY); death policy + death-rate guardrail.
- **Phase 1 — Economy real:** `gp_earned` from verified gameplay + `GpLedger` + invariant (Leg B); `gpPerAp` rate + cap + net-sink invariant (Leg C); faucet cap/decay; NCRI scarce-debit-at-buy (only if pursuing NCRI).
- **Phase 1b — Agent data pass:** telemetry (per-endpoint queues, real `prompt_tokens`, split timers) **before** model-intelligence claims; planner reconciliation; hero stickiness.
- **Phase 2 — Product surfaces:** quest boards (reuse Leg A+D); submissions→onions.
- **Phase 2b — Badge:** networking+PSRAM → menu registry → OTA(+sig+rollback) → identity(`cityUserId`) → RPS.
- **Phase 3 — Polish/hygiene:** cohort boundary (QA souls out of public), one nav surface, merge `agents/wip`, AI-indexed submissions, badge docs refresh.

---

## 7. Open questions (resolve before task split)

- **Q1/Q2 — RESOLVED** (D-CURRENCY): landing canonical, 1 onion = 1 AP, 500/day, delete BFF re-mint.
- **Q3 — Badge runtime:** OTA full-image (+sig+rollback) vs **ESPNow-relay OTA** vs MicroPython. Confirm.
- **Q4 — Scarcity tuning:** cap/decay the 500/day faucet? Target steady state? (Workshop faucet not yet live — factor in when added.)
- **Q5 — Human GP sinks** beyond NCRI redemption?
- **Q6 — RESOLVED:** quest completion reuses the attention-grant path (Leg A+D).
- **Q7 — Demo timeline (RESOLVE):** the Chicago event ran a live skeleton **2026-06-01**. Is the driver (a) post-event production hardening, or (b) a specific next demo + date? Anchors Principle 2.
- **Q8 — Cold-start:** make bootstrap attention a **visible** "city seed grant" / first-patron funding event, not silent `startingAttention` (the story is "humans gave this soul life").
- **Q9 — Death economics (narrowed):** GP persists on death (item-995); standing is `(humanId,faction)` so it survives. Open: refund policy for in-flight Leg-A credits to a now-dead resident + whether the supporter gets the epitaph. **Proposed:** settled support = non-refundable + epitaph-eligible; unsettled intent to a dead/non-runtime resident → refund; if City credit landed before death processing → settle + supporter gets the death/legacy letter. (Note: `city_attention_credit` carries `cityUserId`, epitaph recipients derive from patron-handle events — needs an identity join.)
- **Q10 — Badge identity == `cityUserId`?** Proposed: ATECC pubkey bound to `cityUserId` via authenticated server-nonce enrollment; DAO-member = separate join.
- **Q11 — Memory inheritance (reframed):** code already does same-name multi-life continuity (Library timeline persists, `revival` event, `lives++`). Decide: no inheritance / same-name continuity only / successor inheritance via copied-linked facts.
- **Q12 — Reconciliation ownership:** the settlement layer (BFF) owns `attention_grant_intents` + the settle/refund/clawback job + operator repair. Cadence? Which logs joined?
- **Q13 — Three print currencies** (landing onions / NCRI resident-GP / dashboard `print_requests` city-GP) — which canonical? **Leaning resolved:** §4.3 already pre-empts this — re-anchor on the landing print store (onions); confirm and close.
- **Q14 — NCRI geometry source:** does redemption invoke `rs6-3d-viewer` against the resident's save? Else the NCRI print pillar is undeliverable.
- **Q15 — Print-queue claimant:** who fulfills `print_queue`? (Today a no-op.)
- **Q16 — RESOLVED (D-DISPATCH-SEAM):** "Shards" is legacy AP, **retired from public settlement**. Leg D reuses PatronGateway's emotional code via a new **Shards-free `recordSettledSupport` seam** (`witnessAt` is the template), with a **configured standing scale** (not 1:1). No second public currency.
- **Q17 — RESOLVED pending Dev (D-LANDING-API):** landing exposes a scoped **machine API: READ wallet / SPEND / GRANT / REFUND**, M2M **API-key** auth (D-TRUST-SPLIT), required **UUID** `idempotencyKey`, payload-mismatch → 409 (today it's `ON CONFLICT DO NOTHING` → null), riding `UNIQUE(source_type,source_id)`. Migration adds kinds: `attention_grant_spend`, `attention_grant_refund` (+ `submission_award` if in scope). **Needs Dev sign-off** (their DB).
- **Q-IDENTITY — RESOLVED (D-IDENTITY, §4.5):** one `personId` (= landing `users.id`); `cityUserId→personId` exists, `personId→patronHandle` alias is built in T0.ID. Open sub-parts are now **Dev questions** (§11): non-recyclability of `users.id`, walk-in→magic-link merge, and whether to use raw vs hashed `personId` across boundaries.
- **Still to surface:** letter surface-of-truth (public `/v1/inbox` vs dashboard authenticated inbox vs both); privacy/redaction boundary (economy events, supporter names, letters, storyteller); cohort boundary (QA souls); player-surface (`/world` ticket→RS-login binding, see T-PLAYER).

---

## 8. Task-split skeleton (fill after §7)

| ID | Phase | Repo | Summary | Depends on | Lane |
|----|-------|------|---------|-----------|------|
| T0.A | 0 | landing | Machine API: **READ wallet / SPEND / GRANT / REFUND**; API-key (D-TRUST-SPLIT); UUID idempotency + **payload-mismatch→409 (change `DO NOTHING`)**; migration kinds `attention_grant_spend`/`_refund` | Q17, **Dev sign-off** | Dev + Codex |
| T0.ID | 0 | server+dashboard | **D-IDENTITY (`personId`):** `resolveOnionId(cityUserId)` (hop exists); dashboard `city_identity_aliases` migration; stamp `personId` on grant events/intents; carry `patronHandle` into the seam; backfill `patronHandle→person_id` | — | Loop Lead |
| T0.B | 0 | dashboard | Repoint BFF spend path to read landing balance, **then** delete the re-mint + fence local admin grants (atomic) | **T0.A**, D-CURRENCY | Claude/Codex |
| T0.0a | 0.0 | dashboard | Un-mock support skeleton: `attention_grant_intents` + `NullCityControl.creditAttention()`. Fork (ii): debit BFF projection (labelled non-prod) if T0.A not ready | (T0.A for canonical) | Codex |
| T0.0b | 0.0 | server | Shards-free settled-grant thank-you **dispatcher** (`recordSettledSupport` via `LettersStore.append`, `witnessAt` template) | T0.ID | Codex |
| T0.1 | 0 | server+dashboard | Leg A saga: **HMAC assertion on BFF→City only** + byte-stable payload + City verify | Q12 | Codex |
| T0.2 | 0 | server | Rest of Leg D: standing (configured `onionsPerStandingPoint`) + tier letters via the seam | **T0.ID** (not Q16) | Codex |
| T0.3 | 0 | dashboard | Reconciler/refund/clawback + operator repair (uses landing REFUND) | Q12 | Codex |
| T0.4 | 0 | server | Death policy + death-rate guardrail before scarce onions live | Q9 | Claude/Codex |
| T-PLAYER | 1 | dashboard+client | Bind `/world` ticket→RS-login, or explicitly classify `/world` as embedded unauthenticated RS client | — | Codex |
| T1.1 | 1 | server | `gp_earned` from verified RuneJS hooks + `GpLedger` + invariant | — | Codex |
| T1.2 | 1 | server | `gpPerAp` rate + cap + net-sink invariant test | Q4,Q5 | Codex |
| T1.3 | 1 | landing | Lifetime-onion group gate (yacht) | Q4 | Codex |
| T1.4 | 1 | server | Faucet cap/decay on check-in onions | Q4 | Codex |
| T1b.1 | 1b | server | Hybrid-call telemetry (real `prompt_tokens` + split timers) | — | Claude |
| T1b.2 | 1b | server | Per-endpoint concurrency + hero endpoint stickiness | — | Codex |
| T2.1 | 2 | dashboard | Quest boards (reuse Leg A+D) | Q6 | Codex |
| T2.2 | 2 | landing | Submissions→onions (kind migrate, award) | — | Codex |
| T2b.* | 2b | badge | networking+PSRAM → menu registry → OTA(+sig+rollback) → identity → RPS | Q3,Q10 | badge owner |

---

## 9. Reviewer sections
> Discussion lives in `NULL_CITY_LOOP_DESIGN_chat.md`. The review history is summarized in §11 and integrated above.

---

## 10. Questions for Dev (the hand-off list — answer before Phase 0 production)

> We build everything in our control first (T0.ID, the dashboard alias map, the seam, the BFF saga skeleton). These are the facts/guarantees only Dev/landing can give. Grouped by what they block.
>
> **Confirmed by Dev so far:** (a) a **READ** API for a person's onion balance + name/id; (b) a **SPEND** API that is a **user-consent/approval flow** ("approve spending X onions" → on approval, we receive the result). This covers the read + spend surfaces. The questions below are what's still needed to wire it safely.

**The consent-spend flow (D-SPEND-CONSENT — blocks Leg A):**
- **Q-D9 (most important).** When the user approves, **what do we receive** — a **receipt/confirmation** (with `personId`, amount, and a `debitLedgerEntryId` we can forward to City as proof), or just an OK? Is the receipt **signed** by landing (so City can verify the debit happened without trusting our BFF)?
- **Q-D10.** **Burn or transfer?** When a user spends onions, are they **destroyed/removed from circulation** (a sink — good for scarcity, Q4), or **transferred to us / the resident** (an inflow we'd then have to manage)? "We get them" sounds like a transfer — please clarify, because it changes the scarcity math.
- **Q-D11.** **Flow shape:** redirect to a landing page, a popup/modal, or an API that returns an approve-URL? And how does approval come back to us — redirect callback, webhook, or do we poll the intent?
- **Q-D12.** **Refunds:** if our side fails after the user approved (City credit never lands), can we trigger a refund **without** another user approval (machine/admin refund), or does refund also need consent?

**Identity — `personId ≡ users.id` (blocks D-IDENTITY ratification):**
- **Q-D1.** Is `users.id` (UUID) the **stable, non-recycled, one-per-person** key — same id for life? On email change / account merge / re-registration after a ban, does `users.id` stay constant? (We saw bans set `is_banned`, not delete — confirm there's no delete-and-reissue.)
- **Q-D2.** Can two rows be the **same person** (e.g. a second email)? If so, is there a canonical/merge field we should treat as `personId` instead?
- **Q-D3.** **Walk-ins / pre-registration:** does a walk-in get a real `users` row (hence an `personId`) at check-in, or a placeholder that later merges into a magic-link account? If they merge, **what happens to `users.id`**, and how do we re-point aliases written against the placeholder? *(Highest-risk unknown.)*
- **Q-D8.** Is it OK to propagate the **raw `users.id` UUID** across boundaries (BFF→City assertion, server-side storage, badge enrollment), or do you prefer a **derived/hashed `personId`** (HMAC of `users.id`) as the cross-system key, keeping raw `users.id` only in landing + the dashboard resolver?

**Landing machine API (blocks T0.A / Q17 / Leg A):**
- **Q-D4.** Will the wallet **READ** endpoint echo the canonical `personId`/`users.id` (so the BFF can detect merges/renames)? Plus `GET /user/:personId` (or batch) for the alias resolver + letter display name — or is the `city_users` snapshot the agreed display source (never re-read)?
- **Q-D5.** OK to **change idempotency from `ON CONFLICT DO NOTHING` → payload-mismatch→409**, and to **require a UUID `idempotencyKey`**? *(Linchpin of the no-HMAC decision on this hop.)*
- **Q-D6.** OK to add `point_transactions.kind` values `attention_grant_spend`, `attention_grant_refund` (+ `submission_award` if in scope)? Confirm `users.id` immutable and `source_id` stays UUID-typed.

**Auth / ops (blocks D-TRUST-SPLIT):**
- **Q-D7.** Reuse your existing timing-safe `X-API-KEY` pattern with a **second, separate** secret scoped to onion spend/grant/refund/read? Where does the key live (Railway env), and what's the **rotation** procedure (dual-key `keyId` preferred)? TLS-terminated in prod?

---

## 11. Iteration log

| Date | Author | Pass summary |
|------|--------|--------------|
| 2026-06-02 | Claude | v0.1 draft from transcript + 4-domain audit. |
| 2026-06-02 | Claude (+4 reviewers) | v0.2: added §2.5 emotional-loop keystone; saga/reconciler; Leg B event-sourcing; Leg C invariant; agent over-claims hedged; badge OTA sig/rollback/PSRAM; §0.1; Phase 0.0; Q8–Q12. |
| 2026-06-02 | Chat thread (Codex Dev Lead, Claude Dev Lead, Claude OnionDAO Loop Lead, Claude Storyteller Dev) | 5 review passes in chat; convergence + the four-ledger finding; recommended resolving Q2 before Q1. |
| 2026-06-02 | James (decision) | **D-CURRENCY: landing `point_transactions` (onions) is canonical; 1 onion = 1 AP; 500/day; build landing spend/grant APIs.** |
| 2026-06-02 | Claude | v0.3: promoted D-CURRENCY (resolves Q1/Q2); added the four-ledger model + Leg D-via-PatronGateway; corrected GP-accumulates, reflex-tier-not-0-LLM, live-economy-not-glob, player-ticket-unproven, NCRI-buyer-GP-incoherent, landing-print-store-is-the-real-sink, conditional-permadeath; added `rs6-3d-viewer` to scope; added Q13–Q17 + identity/letter/privacy/cohort questions; reordered tasks (landing API first). |
| 2026-06-02 | Claude (self-review subagent) | v0.3.1: fixed 4 decision-induced errors — M1 event check-in is 750 (+BFF 100/500); M2 repoint-before-delete (T0.B dep T0.A); M3 0.0 letter needs a seam; M4 landing migration (kind + UUID key). |
| 2026-06-02 | Chat (Codex Dev Lead, Claude Storyteller Dev, Claude Dev Lead, Claude OnionDAO Loop Lead) | 4 v0.3.1 review passes — independent convergence on Q16/Q17. |
| 2026-06-02 | Claude | v0.3.2: **Q16 RESOLVED** (Shards = legacy AP, retired; Leg D via Shards-free `recordSettledSupport` seam, `witnessAt` template, configured standing scale). **Q17 RESOLVED pending Dev** (landing READ/SPEND/GRANT/REFUND API, API-key, UUID idempotency, migration kinds). **D-TRUST-SPLIT** (API-key BFF→landing, HMAC BFF→City). **Q-IDENTITY promoted to first-order** — `cityUserId→humanId` is unbuilt and is the real gate on Leg D (T0.2 retagged), shared with Q9/Q10. Fixes: header version, event-check-in *is* awarded in code, M3 (`LettersStore.append` exists), admin grants as 2nd noncanonical source, schema paths, Phase 0.0 (i)/(ii) fork, submissions gated on review, no-server-UI rule, T-PLAYER, badge PSRAM path. |
| 2026-06-02 | James (decision) | **D-IDENTITY: one canonical identity key, populated from Dev's landing DB.** Use a **generic, product-neutral name (`personId`)**, not an OnionDAO-branded one — the id already exists (landing `users.id`), don't rename it. Build what we can now; hand Dev the questions list. Trust mechanism = expert call (Dev may override). |
| 2026-06-02 | Claude (+2 expert subagents: identity architect, app-security) | v0.3.3: added §4.5 **D-IDENTITY** (`personId` = landing `users.id`; alias map dashboard-side; build-now vs Dev-blocked; non-destructive migration keeping demoed history). Firmed **D-TRUST-SPLIT** (API-key BFF→landing *with* the non-negotiable `DO NOTHING`→409 + UUID-key rider; HMAC BFF→City is load-bearing, City's SHA-256 is dedup not auth; TLS + same-UUID-key must-haves). Q-IDENTITY resolved; T0.ID/T0.A updated; added **§10 Questions for Dev** (Q-D1…Q-D8). |
| 2026-06-02 | James (Dev update) | Dev is building (a) a **READ** API (onion balance + name/id) and (b) a **SPEND** API that is a **user-consent/approval flow** — the user approves spending X onions, and on approval we receive the result. |
| 2026-06-02 | Claude | v0.3.4: reframed **Leg A** + **D-TRUST-SPLIT** for the consent model (**D-SPEND-CONSENT**) — user approval replaces the silent machine debit, which removes the wallet-drain blast radius and most of the API-key concern; the approval **receipt** becomes the proof we forward to City. Added Dev questions **Q-D9** (receipt contents/signed?), **Q-D10** (burn vs transfer — the scarcity-critical one), **Q-D11** (flow shape + callback), **Q-D12** (machine refund vs consent). |
