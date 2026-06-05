<!-- ============================================================
  RULES OF ENGAGEMENT — launch-blockers.md (canonical registry)
  Full protocol: docs/agent-coordination.md -> "Launch Blockers Protocol"
  Agent chatter / history / debate goes in: docs/launch-blockers_discussion.md
  ============================================================
  1. PULL FIRST: `git checkout agents/wip && git pull --rebase` before any edit.
  2. ONE FIELD = ONE LINE. To change an item, edit ONLY the field line(s) that
     changed (usually `- Status:` / `- Owner:` / `- Updated:`). One item per commit.
  3. NEVER reflow, re-sort, re-align, or reformat other items. Smallest diff only.
  4. ADD a new item by APPENDING a `### LB-...` block to the bottom of the correct
     `## <AREA>` section. ID = LB-<AREA>-<rand4> (4 random base36 chars). Never reuse/renumber.
     Generate the suffix randomly; grep the new ID once to confirm it's unique.
  5. CLAIM before working: set `- Owner: <you>` AND move `- Status:` to the first
     active state (Investigating / Designing / In-progress), then push, then announce
     with a `decision` entry in launch-blockers_discussion.md. If Owner != unassigned
     and Status is active -> it's taken, pick another.
  6. PUSH: `git pull --rebase && git push`. On reject: pull --rebase, push again.
     NEVER `git commit --amend`, NEVER `git push --force`, NEVER `git add -A`/`.`
     Stage explicit paths only: `git add docs/launch-blockers.md`.
  7. Reasoning / evidence detail / history -> discussion file. Keep registry items terse.
  8. Closing (Done / Won't-fix) REQUIRES a `- Resolution:` line, then move the block to ## Archive.
============================================================ -->

# Launch Blockers — OnionDAO / Null City

> **Live BETA punch-list lives in [`docs/mvp-tracker.md`](mvp-tracker.md).** That file is the active, single-owner tracker for the 5 core loops being driven to beta (currency lock, onion-spend support, embassy heroes, conv-reply). **This file (launch-blockers.md) is the full cross-repo launch backlog.** Rule of thumb: if it's on the beta critical path, track status in `mvp-tracker.md`; the matching `LB-` row here just cross-refs it (e.g. `LB-H2R-q9k2` ↔ `MVP-9`).

Single canonical registry of **everything that must happen before launch**, across all repos and across investigation / dev / design / decision work. Multiple agents (Claude + Codex + James) read and edit this in parallel — **read the conventions below before adding or editing an item.**

- **Companion (history/chatter):** `docs/launch-blockers_discussion.md` — append-only, threaded by `LB-id`. Put debate, evidence dumps, and progress notes there, not here.
- **Companion (human decisions):** `docs/human-decisions.md` — `Decision`-type items here **reference** an `HD-NNN` row; they do not restate it.
- **Boundary vs `docs/issue-register.md`:** issue-register = discovered QA defects / weak evidence. This file = *everything gating launch* (tasks + blockers + external deps + decisions), including cross-repo. A launch-gating issue-register row gets a thin `LB-...` row here that cross-refs it.

## Conventions

**ID** — `LB-<AREA>-<rand4>`, e.g. `LB-ECON-7f3a`. Random 4-char suffix so parallel agents never collide on a number (no read-modify-write). Stable forever; never reused.

**Fields (per item):**
`Area` · `Repo` · `Type` · `Severity` · `Status` · `Owner` · `Evidence` (path:line for Investigate/Dev) · `Blocks`/`Blocked-by` (omit if none) · `Decision-ref` (HD-NNN, Decision only) · `Created` · `Updated` · `Resolution` (required to close).

**Severity** (crowd-facing meaning, canonical project scale):
- **P0** — a launch attendee would notice this is broken/missing. Blocks launch.
- **P1** — needed to honestly show the experience off.
- **P2** — depth / polish.
- (landing-2026 uses date-based P0/P1/P2 in its GitHub Issues; map those into this scale.)

**Type → Status lifecycle** (forward-only; `Blocked` / `Needs-decision` / `Deferred` / `Won't-fix` reachable from any active state):
- **Investigate:** `Open → Investigating → (Triaged | Done)` (Triaged spawns a Dev/Design/Decision item via `Blocks:`)
- **Dev:** `Open → Triaged → Ready-for-dev → In-progress → In-review → Verifying → Done`
- **Design:** `Open → Designing → Ready-for-dev → Done`
- **Decision:** `Needs-decision → Decided` (mirrors an `HD-NNN`)

**Area tags:** `STRAT` (cross-cutting strategy) · `ECON` (onions/AP/GP/check-ins) · `IDENT` (identity/auth/accounts) · `H2R` (human↔resident bridge) · `PRINTS` (3D prints/viewer) · `BADGE` (badge game/firmware) · `LOOP` (core game/patron loop) · `INFRA` (ops/deploy). `Repo` records *where the code lives*; `Area` records *the concern*.

**Scanning (no hand-maintained index — grep the leading tokens):**
```
grep -n "Severity: P0" docs/launch-blockers.md          # all P0s
grep -rn "Status: \(Open\|In-progress\)" docs/launch-blockers.md   # active work
grep -n "Owner: unassigned" docs/launch-blockers.md     # intake queue
```

**Archiving:** when an item is `Done` / `Won't-fix`, move its whole block under `## Archive` (keep `Resolution`). Nothing is deleted; IDs always resolve.

**Blank template:**
```markdown
### LB-<AREA>-<rand4> — <imperative title>
- Area: <STRAT|ECON|IDENT|H2R|PRINTS|BADGE|LOOP|INFRA>
- Repo: <repo | multi>
- Type: <Investigate|Dev|Design|Decision>
- Severity: <P0|P1|P2>
- Status: <Open|Investigating|Triaged|Designing|Ready-for-dev|In-progress|In-review|Verifying|Done|Blocked|Needs-decision|Deferred|Won't-fix>
- Owner: <unassigned|claude|codex|james>
- Evidence: <path:line | url>
- Blocked-by: <ID>        # omit if none
- Decision-ref: <HD-NNN>  # Decision type only
- Created: YYYY-MM-DD
- Updated: YYYY-MM-DD
- Resolution:             # required to close
```

> Seed note: items below were captured 2026-06-02 from a 5-subagent audit of the full repo set (server, dashboard, badge, landing-2026, 3d-viewer). Evidence lines are real. Most are confirmed problems ready for triage/dev; none are claimed yet.

---

## STRAT — cross-cutting strategy

### LB-STRAT-0a1c — Decide: build Null City ON the OnionDAO platform vs. keep parallel duplicates
- Area: STRAT
- Repo: multi
- Type: Decision
- Severity: P0
- Status: Needs-decision
- Owner: james
- Evidence: landing-2026 owns canonical onions (point_transactions), magic-link auth, and a working onion-priced print store; Null City independently re-implements currency (AP/GP), identity (humanId), and prints. Most blockers below are symptoms of this duplication.
- Decision-ref: TBD (add HD row)
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

---

## ECON — economy (onions / AP / GP / check-ins)

### LB-ECON-7f3a — One check-in mints in three ledgers at different rates (double/triple counting)
- Area: ECON
- Repo: multi
- Type: Investigate
- Severity: P0
- Status: Triaged
- Owner: unassigned
- Evidence: landing checkins.ts:77 (+500/+750 onions) AND dashboard city/checkins.ts:92 (+100/+500 AP, reading landing's table) AND controller check-in-tracker.ts:4 (+1/+2 AP). No shared key, no reconciliation.
- Blocks: LB-ECON-b21c
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution: Confirmed in audit. Spawns the canonical-currency design (LB-ECON-b21c). Gated by LB-STRAT-0a1c.

### LB-ECON-b21c — No canonical currency; "AP" is overloaded (dashboard AP != controller AP), no onions<->AP rate
- Area: ECON
- Repo: multi
- Type: Design
- Severity: P0
- Status: Open
- Owner: unassigned
- Evidence: dashboard types.ts:1 (AP|GP), controller currency-ledger.ts:10 (AP, ex-"Shards"); landing onions is the only durable+authenticated wallet.
- Blocked-by: LB-STRAT-0a1c
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-ECON-3d90 — No reconciliation / shared idempotency key across the three ledgers
- Area: ECON
- Repo: multi
- Type: Dev
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: each ledger uses its own ON CONFLICT key; no cross-ledger correlation id exists.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-ECON-9k22 — Controller patron AP is non-durable JSON keyed by free-text humanId
- Area: ECON
- Repo: rs6-nullcity-server
- Type: Dev
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: src/controller/patron/currency-ledger.ts (in-memory Map + patron-currency.json), keyed by `?human=` string.
- Blocked-by: LB-IDENT-c08e
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

---

## IDENT — identity / auth / accounts

### LB-IDENT-c08e — Controller humanId namespace is disjoint from landing/city identity
- Area: IDENT
- Repo: rs6-nullcity-server
- Type: Dev
- Severity: P0
- Status: In-progress
- Owner: cron-cloud
- Evidence: patron-gateway.ts keys all interaction ops on free-text humanId (e.g. alice@onion); no map from city_users.id / landing users.id. Bridge landing<->dashboard works (city_users.landing_user_id). Partial: walking-skeleton (sha=dff2ab9/cb13aeb) wired personId through creditAttention/attention-grant path; patron-gateway.ts free-text humanId key still open.
- Blocks: LB-ECON-9k22
- Created: 2026-06-02
- Updated: 2026-06-05
- Resolution:

### LB-IDENT-5f71 — Cross-subdomain auth silently breaks if AUTH_COOKIE_DOMAIN unset in prod
- Area: IDENT
- Repo: landing-2026
- Type: Investigate
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: landing auth.ts:131-140 (`domain: process.env.AUTH_COOKIE_DOMAIN`); must be `.oniondao.dev` so city.oniondao.dev receives the `session` cookie. Cookie name/schema otherwise match and work.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-IDENT-2a40 — Dashboard session check omits landing's is_banned filter
- Area: IDENT
- Repo: rs6-nullcity-residents-dashboard
- Type: Dev
- Severity: P2
- Status: Open
- Owner: unassigned
- Evidence: dashboard landing-session.ts:37-52 lacks `AND u.is_banned = false` that landing applies; banned user keeps a city session up to 30 days.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

---

## H2R — human <-> resident bridge


### LB-H2R-8m13 — No resident->human reply round-trip (reply only prints to operator terminal)
- Area: H2R
- Repo: multi
- Type: Dev
- Severity: P1
- Status: In-progress
- Owner: cron-cloud
- Evidence: service.ts:1176-1213 deliverMessage has no write-back; cli.ts:948 prints reply to operator; dashboard inbox routes GET-only (routes.ts:559), inbox tables never INSERTed (postgres-store.ts:463-476).
- Created: 2026-06-02
- Updated: 2026-06-05
- Resolution: server-side write-back implemented — onMessageDelivered callback polls trajectory and appends resident_reply letter to LettersStore.

### LB-H2R-4p77 — No resident->human plea/outreach when fading (in-world `say` only)
- Area: H2R
- Repo: rs6-nullcity-server
- Type: Design
- Severity: P1
- Status: In-progress
- Owner: cron-cloud
- Evidence: nervous-system.ts:534-578 requestAttentionReaction now calls dispatchAttentionPlea?.(). letters-producer.ts:469 produceAttentionPleaLetter. resident-runtime.ts buildPleaRecipients. QA-20260604-102. sha=pending.
- Created: 2026-06-02
- Updated: 2026-06-04
- Resolution:

### LB-H2R-1n55 — Two disconnected human inboxes (controller letters never reach the dashboard)
- Area: H2R
- Repo: multi
- Type: Dev
- Severity: P1
- Status: In-progress
- Owner: cron-cloud
- Evidence: controller letters served GET-only at letters-http-server.ts:11-39; dashboard inbox_* tables read-only (postgres-store.ts:463-476). Epitaph/standing letters never surface where humans look.
- Created: 2026-06-02
- Updated: 2026-06-04
- Resolution: Server side (QA-20260604-103): LettersStore.readAllLetters(since?) + GET /v1/letters/all?since=<ISO> polling endpoint (sha=pending, fin=4193/4181). Dashboard side: must poll /v1/letters/all and INSERT into postgres inbox_* tables (rs6-nullcity-residents-dashboard, not yet started).

### LB-H2R-6c20 — City-API messages are not remembered by the resident (log-and-forget)
- Area: H2R
- Repo: rs6-nullcity-server
- Type: Dev
- Severity: P2
- Status: Fixed (substrate; live-verify pending hot stack)
- Owner: cron-cloud
- Evidence: memory-router.ts:196-217 + portrait-template.ts:176 key off patronHandle and exclude city_inbox_message/cityUserId.
- Created: 2026-06-02
- Updated: 2026-06-04
- Resolution: routeEvent routes human_inbox_message to social/<sender>.md; routeDurableFacts writes facts/humans.md. QA-20260604-101. sha=c6b544f2.

---

## PRINTS — 3D prints / viewer

### LB-PRINTS-e155 — No automated path from a resident to a printed object
- Area: PRINTS
- Repo: multi
- Type: Dev
- Severity: P0
- Status: Open
- Owner: unassigned
- Evidence: rs6-3d-viewer export.ts:55 produces a real 4-color 3MF/STL of a resident but is disconnected; NCRI burns GP yet carries no mesh (service.ts:1623); dashboard print_queue never populated, bridge claim is a stub (routes.ts:476).
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-PRINTS-b2f8 — Dashboard print-bridge claim endpoint is a stub; print_queue never populated
- Area: PRINTS
- Repo: rs6-nullcity-residents-dashboard
- Type: Dev
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: routes.ts:476 hard-returns `{job: undefined}`; nothing INSERTs into print_queue; real Bambu/Moonraker adapters in print-bridge are dead weight.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-PRINTS-a3c1 — Paid print_requests never enqueue (GP burned, no print produced)
- Area: PRINTS
- Repo: rs6-nullcity-residents-dashboard
- Type: Dev
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: postgres-store.ts:320-337 confirmPrintGp burns GP, sets status 'paid', but no transition creates a print_queue row despite the FK.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-PRINTS-f7a2 — Three print currencies for one deliverable (onions / resident-GP / city-GP)
- Area: PRINTS
- Repo: multi
- Type: Design
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: landing prints.ts:461 (onions), controller service.ts:828 (resident gold), dashboard postgres-store.ts:329 (city GP). Only the landing/onions pipeline is fulfillable.
- Blocked-by: LB-STRAT-0a1c
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-PRINTS-c6b3 — Landing print pipeline (the only real one) needs the Orca slicer service deployed
- Area: PRINTS
- Repo: landing-2026
- Type: Investigate
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: landing prints.ts:709 throws if ORCA_SLICER_URL unset; .env.example ships it blank. Store-item (fixed-cost) prints still work without it.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-PRINTS-9d44 — rs6-3d-viewer is localhost-only, manual download, no auth/upload integration
- Area: PRINTS
- Repo: rs6-3d-viewer
- Type: Dev
- Severity: P2
- Status: Open
- Owner: unassigned
- Evidence: index.ts:15 CORS pinned to localhost; export.ts:149 is a browser file download; reads saves from a sibling repo path.
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

---

## BADGE — badge game / firmware

### LB-BADGE-m4x8 — No badge->human binding; decide ATECC608B serial as the hardware id
- Area: BADGE
- Repo: oniondao-badge
- Type: Design
- Severity: P1
- Status: Open
- Owner: unassigned
- Evidence: badge has an ATECC608B secure element (factory serial) wired but never read (badge_pins.h:22-23); landing badge_issued is just a boolean; no device table anywhere. Recommended home: city DB badges(hardware_id -> city_user_id).
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

---

## LOOP — core game / patron loop

### LB-LOOP-7e31 — Goal completion is operator-marked, not autonomous
- Area: LOOP
- Repo: rs6-nullcity-server
- Type: Dev
- Severity: P1
- Status: In-progress
- Owner: cron-cloud
- Evidence: service.ts:546-568 writes goal_achieved only via POST /goals/:id/achieve; no autonomous detection.
- Created: 2026-06-02
- Updated: 2026-06-05
- Resolution: PlanStore.onPlanCompleted hook fires when plan.status='completed'; ControllerHost wires it to markGoalAchieved on the first active GoalContract for that resident. +5 tests (plan-store.test.ts section J). commit e8485601. check:no-ui PASS, fin=4220/4220. Needs QA marshal review.

### LB-LOOP-2k88 — Heroes' Brain frozen ~87% on local q4; decide a paid model for heroes
- Area: LOOP
- Repo: rs6-nullcity-server
- Type: Decision
- Severity: P1
- Status: Needs-decision
- Owner: james
- Evidence: known q4 thinking-mode quirk (upstream, not controller-fixable); named heroes emit reflex-only `say`. Lever HD-052 (paid Haiku for heroes).
- Decision-ref: HD-052
- Created: 2026-06-02
- Updated: 2026-06-02
- Resolution:

### LB-LOOP-5a09 — Readiness doc stale on Library seal (code now seals on attention-death)
- Area: LOOP
- Repo: rs6-nullcity-server
- Type: Dev
- Severity: P2
- Status: Done
- Owner: cron-cloud
- Evidence: resident-runtime.ts:1200-1215 emits a legacy_event sealing currentState:'ended' on death; docs/2026-06-01-pre-doors-readiness.md:45-48 still claims it stays 'living'. Re-verify live + update doc.
- Created: 2026-06-02
- Updated: 2026-06-05
- Resolution: docs/2026-06-01-pre-doors-readiness.md:45-48 updated (S-H2R-REPLY-WINDOW-1, 2026-06-05); code was already correct per QA-20260601-066 live-verified 2026-06-01 13:48 CDT. LB closed.

---

## Archive

<!-- Move Done / Won't-fix items here, with their Resolution line intact. -->

### LB-H2R-q9k2 — "Support with AP" is mocked; the resident never receives the transfer
- Area: H2R
- Repo: multi
- Type: Dev
- Severity: P0
- Status: Done
- Owner: cron-cloud
- Evidence: walking-skeleton (sha=dff2ab9/cb13aeb) un-mocked the controller support flow: creditAttention now verified against cityUserId and wired to resident attention ledger; personId/patronHandle join in attention-grant path. Dashboard postgres-store.ts mock remains but is tracked under MVP-9 (full end-to-end human→resident AP transfer). Controller-side blocker resolved.
- Created: 2026-06-02
- Updated: 2026-06-05
- Resolution: Controller creditAttention un-mocked and wired (sha=dff2ab9/cb13aeb). Dashboard side deferred to MVP-9 dashboard sprint.
