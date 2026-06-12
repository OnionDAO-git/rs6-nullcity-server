# Null City — Holistic Design Review (2026-06-10)

> **Status:** v1.0 — synthesis of four expert review passes run 2026-06-10
> **Authored by:** Claude (holistic design reviewer), from four parallel expert subagent audits:
> resident-intelligence deep dive, human↔AI loop trace, complexity audit, attachment/experiment-design critique.
> **Audience:** any agent or human picking up Null City work. Read alongside `NULL_CITY_LOOP_DESIGN.md` (v0.3.4) and `mvp-tracker.md`.
> **Method note:** every claim cites `path:line` from its source audit. Claims marked **[SPOT-CHECKED]** were independently re-verified against code on 2026-06-10. Claims marked `[UNVERIFIED]` could not be confirmed.
> **How to reference:** stable IDs — `HR-#` headline recommendations, `IB-#` intelligence bottlenecks, `HX-#` human-experience gaps, `SL-#` simplification items, `RK-#` risks. Cite as `holistic-review HR-1` etc.

---

## 0. Executive summary

**The loop works. The thesis of the loop design doc has inverted.** `NULL_CITY_LOOP_DESIGN.md` (2026-06-02) said: *the emotional loop is built, the economic loop is the gap.* As of mvp-tracker 2026-06-05, all 5 core loops are verified live — support → landing onion burn → attention → standing → letter runs end-to-end (`mvp-tracker.md:10-16`, MVP-9). The gap is no longer wiring. It is that:

1. **The emotional loop as wired is institutional, not personal.** Letters say "You are now Acquaintance **of embassy**" — a loyalty card from a faction, not a friendship with a named resident. Standing is keyed `(humanId, faction)` and explicitly survives resident replacement — economically tidy, emotionally backwards.
2. **Grief — the entire third act of pride → attachment → grief → legacy — is currently switched off.** Hero attention floors + universal rebirth mean death effectively never happens to anyone a human could miss. The epitaph machinery (the best-built part of the system, 67 epitaph letters live) has no real deaths to process.
3. **Residents are not yet interesting enough to carry attachment.** 112k stuck-loop moments; two residents looped `acquire_axe_shopkeeper_missing` 900+ times; heroes mostly reflex-only on the local q4 model; goal completion is auto-detected for exactly one goal type (firemaking) **[SPOT-CHECKED]**.
4. **The system around the loop is ~5× bigger than the loop.** The emotional-loop code is ~20k LOC and is the product. The controller is 152k LOC. Five (not four) currency ledgers, three print pipelines, two planner stacks, 595 test-resident JSONs sharing the public namespace, 265 docs files, 6 overlapping trackers.

**The one-breath model the project should converge on:**

> **earn → choose → support → be known → return → lose → be remembered.**

Every box already exists in code. Only **return** (a daily ritual, HR-2) and **lose** (curated mortality, HR-3) need building; everything else needs *connecting, surfacing, or deleting*.

**The 30-second pitch a first-time attendee should hear:**
> "These villagers are AIs living their own lives in RuneScape. They stay alive on human attention. Check in daily for onions, spend them on one you like — they'll learn your name, write you letters, and when they die, you're named in their story forever."

---

## 1. Headline recommendations (HR)

Ordered by leverage. Each lists what it reuses — almost all are wiring, not construction.

| ID | Recommendation | Cost | Reuses |
|----|----------------|------|--------|
| **HR-1** | **Re-key the emotional frame from faction to resident.** Letters/UI copy: "Hans counts you a friend," never "Acquaintance of embassy." Derive a "your residents" list from existing support events. Copy + one query; no schema change. | Days | standing ledger events, letter templates |
| **HR-2** | **Ship the daily "while you were gone" digest letter** — one letter per patron per day: what *your* residents did, said, gained, and their attention runway, ending with the single most endangered one + a support button. Then email it (landing has every patron's email via magic-link identity). This is the retention engine. | ~1 week | Library timeline, `/v1/letters/all` bridge, standing ledger, Storyteller relevance scoring (P0-S3), landing email |
| **HR-3** | **Turn real death back on for a curated mortal cohort.** Heroes keep floors (they're cast); QA souls are fenced out (SL-4); in between, a named mortal cohort that can genuinely be lost — with a death-rate cap and a mandatory multi-day "fading" arc (plea letters → public FADING banner → rescue window) so every death is a telegraphed narrative event. This *is* T0.4, reframed from safety task to product. | ~1 week | epitaph dispatcher, graveyard, tombstones plugin, attention-plea letters (82 already fired live) |
| **HR-4** | **Close the human→resident channel: Reply-to-letter.** A Reply button on any inbox letter → existing city message delivery → resident memory (`social/<sender>.md` + `facts/humans.md`, LB-H2R-6c20) → `resident_reply` letter back (LB-H2R-8m13, wired but **0 live letters — needs its smoke**). Converts the inbox from a receipt drawer into a correspondence. Guardrails: treat letters as untrusted prompt input; per-patron reply rate limit. | Days | the entire LB-H2R chain, MVP-10 inbox fold |
| **HR-5** | **Flip `ONION_SPEND_MODE=real` and delete the BFF re-mint (T0.B).** The real-burn adapter exists and was smoke-verified (MVP-9), but the default is still `standin` (`dashboard packages/server/src/city/config.ts:58` **[SPOT-CHECKED]**) — in the default config, support does not actually burn the human's onions. Single highest-leverage config+delete left in the economy. | Days | landing-onions adapter, attention_grant_intents |
| **HR-6** | **HD-052: paid model for the ~6 heroes + endpoint stickiness.** Heroes are the attachment surface; a vivid character on Tuesday that's a stuck loop on Wednesday is parasocial betrayal. Highest interestingness-per-dollar decision available. Pair with per-endpoint concurrency (IB-9). | Decision + config | endpointFor routing (`spark.ts:234`) |
| **HR-7** | **Fence the cohorts.** ~595 of 607 `data/residents/` JSONs are test artifacts one unguarded `readdir` away from a `bmk_*` soul getting a public epitaph. A `cohort: public\|qa\|bench` field (or prefix denylist) enforced at Library/letters/storyteller/dashboard read paths; archive dead JSONs. ~50 LOC + one `mv`. | Hours | — |
| **HR-8** | **Second-encounter recognition.** Include `facts/humans.md` history in the greeting/acknowledge context so a returning patron is greeted differently than a stranger: "alice — you came back. The fire you watched me light still burns." One prompt-context addition; memory write+recall already proven (S-MEM-4). | Days | FactsStore, acknowledge reflex (HD-031) |

---

## 2. The loop as it actually runs today (verified trace)

Source: human-loop trace audit, 2026-06-10. Two paths exist, selected by `ONION_SPEND_MODE` (default `standin`).

**Real path (`onion-attention-grants`, MODE=real):**
1. Dashboard "Give Attention" → `App.svelte:2136` → `POST /api/city/residents/<id>/onion-attention-grants`.
2. BFF (`routes.ts:762-832`): requires landing session; creates landing burn request via `POST oniondao.dev/api/public/onions/requests` (`landing-2026 .../onion-approvals.ts:41-105`).
3. **BFF auto-approves the burn using the user's own session cookie (`routes.ts:800-804`) [SPOT-CHECKED]** — the landing consent UI is bypassed; the user never sees the approval screen the consent-spend design (D-SPEND-CONSENT) assumed. See HX-6.
4. Landing debits atomically (`FOR UPDATE`, `kind='external_burn'`) — **real scarce burn**.
5. BFF → City `creditAttention` (`service.ts:1040-1106`) carrying `personId` (T0.ID identity join: **wired**, `attention-grant.ts:72-73`, `postgres-store.ts:562-580`). Bearer token only — no HMAC; City idempotency is SHA-256 dedup, not auth.
6. City bumps attention → `onPatronSupport` (`controller-host.ts:250-270`) → `recordSettledSupport` (`settled-support.ts:44-75`): standing at `onionsPerStandingPoint=10`, tier letters via `lettersStore.append()` — **real**.
7. Letter served at `GET :43596/v1/inbox?human=<handle>`; BFF bridges into `/api/inbox` querying up to 5 identity aliases.

**Stand-in path (default):** debits the non-canonical BFF `point_accounts` projection, labelled `nonProduction: true`, still fires the full emotional chain. Humans' real onion balances are untouched (HX-5).

**Missing at every hop:** no reconciler job (lost callbacks strand intents in `sent_to_city`); no letter-arrival notification (poll only); no UI form for `POST /residents/<id>/inbox` (the ask-a-resident path is MCP/CLI-only); `/world` ticket→RS-login binding still unproven (T-PLAYER).

**Loop health flags (as of 2026-06-05, re-check before relying):** BFF :8787 was down (took crowd screen + auth + inbox with it); 4 heroes absent from `controller.yml` (MVP-2); woodcutters stuck on missing shopkeeper NPC (MVP-8); `onPlanCompleted → markGoalAchieved` wired but never observed firing live (MVP tracker note).

---

## 3. Resident intelligence — bottlenecks (IB)

Source: resident-intelligence audit. The live cognition stack: SPARK orchestration layer → `HybridAgentThinkingModule` (production thinking module, `standard-modules.ts:14`) → reflex tier (deterministic) + Brain (goal, every ~180 ticks, thinking-on) + Body (action, every ~8 ticks or forced at attention ≤ 10). Memory read-back into prompts **is now wired** (the 2026-05-23 "not wired" finding is resolved): 6 memories × 360 chars, patron events prioritized (`memory-store.ts:75-111`, `hybrid-agent-helpers.ts:1454-1455`).

| ID | Bottleneck | Evidence | Fix direction |
|----|-----------|----------|---------------|
| **IB-1** | **Goal completion auto-detected for exactly one goal type** (standalone firemaking + `fire_lit` event). Everything else waits up to 180 ticks (~3 min) for the next Brain pass — residents visibly keep doing finished tasks. **[SPOT-CHECKED]** | `hybrid-agent-helpers.ts:3307-3320` | Generalize `observeCompletedLocalGoal` per goal-factory success predicate (logs in inventory, fish caught, XP delta). The single largest legibility win — residents that *finish things* read as intelligent. |
| **IB-2** | **Brain cadence 180 ticks** makes residents slow to adapt; between passes only deterministic reflexes run. | `hybrid-agent-thinking-module.ts:80` | Event-driven Brain triggers: goal-completed (IB-1), plan-stage-blocked, patron-interaction, attention-threshold-crossed. |
| **IB-3** | **Residents don't know their own attention number.** The Brain prompt never includes it; `survive` tier triggers only at attention ≤ 5 (apFloor defaults 0). A dying resident feels no urgency. | `needs-hierarchy.ts:80-82` | Inject attention + runway into the Brain prompt ("you have ~2 days of life left"). Cheap, and it powers stakes-bearing pleas (HR-3). |
| **IB-4** | **Memory retrieval is chronological/keyword, not relevance-ranked**; ~92% of library timeline is stuck/say noise, so the 6-slot window evicts promises to specific humans. | `memory-store.ts:75-111`; intelligence-verification-log E7 | Filter noise event kinds out of retrieval; reserve slots: 2 patron + 2 goal-relevant + 2 recent. |
| **IB-5** | **Conversations are stateless beyond ~20 ticks.** Social-reply has a 1-turn follow-up window; a 5-minute human conversation is forgotten unless the Brain happens to write a memo. | `hybrid-agent-thinking-module.ts:428-451`, `social-reply.ts` | Auto-append a conversation summary to `social/<player>.md` after each reply burst (the write path exists — LB-H2R-6c20 does this for inbox messages; extend to in-game chat). |
| **IB-6** | **Human recognition is registry-only.** Only humans in the static `controller.yml patrons:` list get durable patron memory; an unconfigured human who interacts heavily is never "known." | `patron-registry.ts` | Auto-promote: N interactions or any settled support → patron registry entry (the settled-support seam already has the identity). |
| **IB-7** | **Personality is static prompt text** (voice/quirks/fears); no cumulative emotional state from history. | `hybrid-agent-prompts.ts:187-201` | Cheap version: a one-line "disposition" fact updated by the Brain (e.g. "wary of the wilderness since dying there") — persisted via FactsStore, injected next to soul identity. |
| **IB-8** | **Deliberative planning (PlannerPass) is opt-in and budget-capped at 10/day**; most residents never get multi-step plans. | `hybrid-agent-helpers.ts:3409-3415`, `budgets.ts` | Enable for the mortal named cohort (HR-3) and heroes; leave QA souls reflexive. |
| **IB-9** | **One global inference semaphore (8)**; per-resident endpoint routing exists but per-endpoint capacity doesn't — a 2nd GPU adds zero throughput; endpoint sharding can flicker hero personality. | `llm-client.ts:115,169` | T1b.2 as specced: per-endpoint queues + hero stickiness. Do with HR-6. |

**Telemetry first** still stands (design doc Principle 4 / T1b.1): `envelope_tokens` is `chars/4`, not real `usage.prompt_tokens` — measure before trimming prompts.

---

## 4. Human experience — loop-breaking gaps (HX)

Source: human-loop trace, first-five-minutes walkthrough of the simple-mode dashboard.

| ID | Gap | Evidence |
|----|-----|----------|
| **HX-1** | **No reason to care about a specific resident.** Resident list/detail shows attention numbers, status, goal line — no portrait, history, or personality. Library portraits (the richest narrative artifact) are `expertOnly` (`end-user-dashboard.ts:90`). A first-timer has no basis to choose. Fix: surface the Library portrait excerpt + "why did they do that" goal-reason on every resident card (cheap; data exists). |
| **HX-2** | **Support produces a text string, not a moment.** No attention-rising animation, no live resident reaction, no immediate "Hans noticed." (`end-user-dashboard.ts:295-303`) |
| **HX-3** | **No letter-arrival notification** — no push, no unread badge in nav; user must re-load `/profile`. The single cheapest retention fix is an unread count + (HR-2) email. |
| **HX-4** | **Nothing pulls the human back tomorrow.** Check-in (the faucet) lives at landing; the dashboard never says "come back / check in." HR-2 is the answer. |
| **HX-5** | **Default config doesn't burn real onions** (`ONION_SPEND_MODE=standin`) — see HR-5. Humans' canonical balances unchanged by "support." |
| **HX-6** | **Consent flow is silently bypassed**: BFF auto-approves the burn with the user's session cookie (`routes.ts:800-804` **[SPOT-CHECKED]**). Either restore the landing approval UI (D-SPEND-CONSENT as designed) or explicitly decide one-click-spend-with-in-dashboard-confirm is the product and document it. Right now it's the worst of both: the consent architecture's complexity with none of its consent. |
| **HX-7** | **No human→resident channel in the UI** (HR-4). `patron_ask` is MCP/CLI-only; no Reply button exists. |
| **HX-8** | **Letter identity can fragment**: settled-support letters key on `patronHandle ?? personId ?? cityUserId`; legacy CLI letters on free-text `humanId`; the alias table needs manual seeding (`setIdentityAlias`). Auto-seed the alias on first authenticated support. |
| **HX-9** | **Attention-plea letters may only reach prior patrons** — a new human never learns anyone is dying. `[UNVERIFIED — check buildPleaRecipients]`. The FADING banner on `/overview` (HR-3) is the public version. |
| **HX-10** | **`/world` player entry unproven** (T-PLAYER); the "View in RuneScape" button likely dead-ends for real login. Either prove the ticket binding or relabel as spectator. |

---

## 5. Simplification ledger (SL)

Source: complexity audit. Full version in that audit; condensed here with verdicts. Baseline: emotional-loop code ≈ 20k LOC (the product); controller total 152.5k; 78 npm scripts; 265 docs files; 2.7 GB runtime logs.

| ID | Item | Verdict | Notes |
|----|------|---------|-------|
| **SL-1** | **FIVE currency ledgers, not four.** The design doc missed #5: **landing mints onions as Solana SPL tokens for badge-linked users**, and `creditOnions` **throws on daily check-in if a badge is linked and Solana isn't configured** (`landing-2026/src/lib/server/points.ts:129-143` **[SPOT-CHECKED]**) — a conditional outage of the canonical faucet, and it makes Q-D10 (burn vs transfer) ambiguous for badge users. | **Defuse now** (~5 lines: fall through to Postgres instead of throwing), then decide ledger #5's fate with Dev. | Landing is Dev's repo — coordinate, don't unilaterally delete. |
| **SL-2** | BFF `point_accounts` re-mint (wrong values, 100/500 vs 500/750) | **DELETE** after HR-5 flip (T0.B, already decided) | |
| **SL-3** | Controller "Shards" `CurrencyLedger` + ~13 `patron:*` scripts | **FREEZE** (Q16 already retired it; operator CLI only) | |
| **SL-4** | 595 test-resident JSONs in the public namespace | **Fence + archive** (HR-7) | Kills the most embarrassing failure mode: a load-test soul in the public graveyard. |
| **SL-5** | **Three print pipelines** (landing store ✅ works E2E; NCRI — fulfillment stub, no geometry; dashboard print-bridge — 2.7k LOC polling a queue nothing feeds) | **KEEP landing; FREEZE NCRI + print-bridge**; close Q13 as "landing wins" | Best reuse of the frozen pieces: HR-12 memorial prints via the *landing* pipeline. |
| **SL-6** | AP↔GP exchange endpoint accepts arbitrary `{apAmount,gpAmount}` — an uncapped mint/burn pair | **Disable in prod config now** — it becomes an exploit surface the moment onions are scarce | `ap-gp-exchange.ts:109`, `http-server.ts:314` |
| **SL-7** | Legs B/C (GpLedger — never emitted anywhere — rates, invariants) + quest boards (don't exist) | **Strike from active plan** (design-doc Principle 2 applied to its own task table: T1.1–T1.4, T2.1) | GP stays as Storyteller *flavor* ("Hans found coin"), never a human-facing rate. |
| **SL-8** | Service topology ~10 processes; **port 43610 "patron-loop" does not exist in code** — the ops runbook describes a phantom service | **Collapse toward 6 units**; fix the runbook | Storyteller → `setInterval` in controller host; serve built SPA from BFF (the 06-05 "BFF down, SPA up" half-state confused ops). |
| **SL-9** | Docs: 265 files, 6 live trackers, same fact in 5 places (already disagreeing) | **Collapse to 3 living files**: `mvp-tracker.md` (status), `human-decisions.md` (decisions), `NULL_CITY_LOOP_DESIGN.md` (design); archive dated docs to `docs/archive/2026-05/`; one announced commit; update `START-HERE-AGENTS.md` | The multi-agent protocol worked — keep the discipline, cut the write-tax. |
| **SL-10** | Two planner stacks (`spark/` 16.9k + `thinking/` 21.5k LOC) | **SIMPLIFY slowly**: delete `spark/legacy.ts` (435 LOC, self-labeled) now; extract `runescape-brain-planner.ts` ranking into hybrid Brain post-telemetry; **no big-bang unification** — this is the residents' brain. | |
| **SL-11** | Misc: `simulation/` (2.1k, superseded), `feat/` (6.8k design-md in code dirs), Railway deploy artifacts (vestigial?), 78 npm scripts, 7,707-line `App.svelte` hosting ~4 UIs | Archive / verify-then-delete / split App.svelte **after** the next event along its existing `isDebugPath` seam | |

**Pattern:** the economy and its scaffolding keep growing faster than the emotional loop they exist to feed. The loop needs **one wallet, one sink, one brain, one patron UI, and the letters**. Everything else argues its way back in.

---

## 6. Risks (RK)

| ID | Risk | Mitigation |
|----|------|------------|
| **RK-1** | **Death-rate spiral when scarcity goes live — and its current mirror, no deaths at all.** The 6-residents-in-10s overnight mass-death already happened once. | HR-3's curated mortality: deaths/day cap, mandatory fading arc, rescue window; resolve Q-D10 (burn vs transfer) before tuning scarcity. |
| **RK-2** | **Letters become spam.** ~47 letters/recipient already; at >1/day they're notifications, not vellum. | Per-patron daily letter budget; overflow folds into the HR-2 digest; global plea rate-limit. Scarcity of letters *is* their value. |
| **RK-3** | **Boring residents.** The best-evidenced risk (112k stuck events). A repetitive resident retroactively cheapens letters already received — parasocial betrayal. | HR-6 (paid heroes), IB-1/IB-2 (visible completion), MVP-8 fixes, cohort curation (HR-7). |
| **RK-4** | **Authenticity collapse.** If patrons discover "personal" letters are faction templates, the relationship inverts into feeling conned. | HR-1 now; medium-term: LLM-personalize tier/epitaph letters quoting verbatim shared history (Library's quote-never-paraphrase rule is the asset), under the Storyteller's grounding/verifier pattern; never claim a feeling the evidence can't support. |
| **RK-5** | **Economy gaming.** Lowest of the five (rewards are sentimental). Whale standing domination → port v2's "first N onions count full" cap; multi-account farming → magic-link + the Q-D3 walk-in-merge hole; pump → mooted if SL-7 cuts the exchange. |
| **RK-6** | **Operational fragility at the moment of truth.** BFF down during the 06-05 review = dead crowd screen = "the city was never alive." | Supervised BFF restart; static "the city sleeps" fallback frame; SL-8 topology collapse reduces failure modes. |

---

## 7. The experiment, not just the demo

Mostly publishing what is already logged:

1. **Attention economics as a natural experiment.** EconomyEventLog + standing ledger + death events → survival curves (supported vs unsupported), attention-Gini, patron concentration vs lifespan. **Pre-register the question before scarcity goes live** so death data is a finding, not an incident report. A notebook over existing JSONL.
2. **Twins-as-content.** Twin model runs are already QA practice (identical souls, different models). Make it public and unlabeled: which one do humans *fund* — competence or charm? Frame as patronage of rival scholars, never betting (vision doc's "not horses" anti-goal).
3. **Public legibility of cognition.** Goal + one-line reason on every resident card. Every "AI town" runs on the illusion of inner life; Null City can run on the genuine, inspectable article.
4. **Resident-authored history.** `prepare_epitaph` (dying resident writes its own epitaph) + a weekly Storyteller chronicle = a civilization writing its own primary sources.
5. **Honest capability copy as exhibit text.** "This resident can complete Cook's Assistant; it has never chosen to" is funnier and more credible than overclaiming.

---

## 8. Recommended order of operations

**Now (days, before anything else):**
1. SL-1 defuse the Solana check-in throw (5 lines, coordinate with Dev).
2. HR-7 cohort fence + archive test residents + log retention.
3. HR-5 flip `ONION_SPEND_MODE=real` (after re-running the MVP-9 smoke) → SL-2 delete re-mint.
4. HR-1 re-key letters/UI copy to the resident, not the faction.
5. SL-6 disable the AP/GP exchange endpoint in prod; SL-7 strike Legs B/C + quests from the active plan; SL-9 docs collapse (one announced commit).
6. HR-4 smoke + ship Reply-to-letter; resolve HX-6 (consent: restore or explicitly decide one-click).

**Next (1–2 weeks — the retention and grief engines):**
7. HR-2 daily digest letter, then email delivery.
8. HR-3 curated mortality + fading arc + death-rate guardrail (T0.4 reframed).
9. HR-6 paid heroes + IB-9 endpoint stickiness; bring the 4 offline heroes online (MVP-2).
10. IB-1 generalized goal-completion detection + IB-3 attention-in-prompt; HR-8 second-encounter recognition.
11. HX-1 portraits on resident cards; HX-3 unread badge.

**Later (post-proof of the daily ritual):**
12. Reciprocity gifts at Ally tier (resident sends a named item / note quoting shared history).
13. LLM-personalized tier/epitaph letters (RK-4 mitigation).
14. Memorial prints: rs6-3d-viewer → **landing** print pipeline, offered in the epitaph letter — grief converted into a physical legacy artifact (skips NCRI entirely).
15. LoreBus/rumor wiring (Smallville emergence layer); twin benchmarks as content; hero arcs; resident-authored epitaphs.
16. SL-10/SL-11 structural simplifications (App.svelte split, SPARK ranking extraction) — after the next event.

---

## 9. Source audits

The four underlying expert reports were produced 2026-06-10 by parallel subagents (resident-intelligence deep dive; human↔AI loop end-to-end trace; complexity/simplification audit; attachment & experiment-design critique). Their full texts live in the session transcript; the load-bearing claims are reproduced above with citations, and the four highest-stakes claims (SL-1 Solana throw, HR-5 standin default, IB-1 single-case goal detection, HX-6 silent auto-approve) were independently re-verified against code the same day.

Disagreements between audits: none material. All four converged on the same center of gravity: **the loop is built; make it personal, make it mortal, make it daily — and stop building economy ahead of emotion.**
