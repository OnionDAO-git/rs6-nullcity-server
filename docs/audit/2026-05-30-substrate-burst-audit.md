# Substrate Burst Adversarial Audit — 2026-05-30

Packet: **D-AUDIT-SUBSTRATE**
Audit branch base: `origin/agents/wip` at `c2f6ec8c`
Scope: code that shipped in the 2026-05-29/30 substrate burst — P0 economy contracts (GoalContract, EconomyEvent, CityEventDigest, AP-for-GP exchange emission, AP ledger emission seam), NCRI registry + sale heuristic, needs hierarchy, RuneScape brain planner candidate-goal seam, `city:digest` CLI, and the dashboard EconomyPanel/economy BFF.

This is an adversarial audit; the goal was to find real holes before the June 1 CIC demo, not to praise what works. Reading was the bulk of the work; only doc rows + packet entries are added.

## Top-Line Confidence

Substrate is in noticeably good shape: typed contracts, atomic file writes, Zod schemas at the boundary, idempotency where it matters, and end-to-end coverage from emission → digest → CLI → dashboard BFF. AP/GP vocabulary is clean. The dashboard read path agrees with the server write path (verified slug equivalence — `res:agent` → `res-agent` on both sides).

The real risks fall into three buckets, in priority order:

1. **Wrong-attribution / mis-classified events.** The NCRI "sale" heuristic and the AP-for-GP `failed_gp` classifier both make assumptions that look correct in tests but mis-label real demo flows. These are not crashes — they are silent narrative bugs that will reach the Storyteller.
2. **Dead seam claimed as working substrate.** `selectCandidateGoals` is exported and tested but never called from any production code path. The needs-hierarchy "encoded into the resident loop" claim is therefore aspirational, not real.
3. **Operational footguns under the wrong cwd / multi-instance.** The `city:digest` CLI accepts any path (no normalization, no traversal guard), the per-process `refId = apledger:<index>` collides across instances, and the JSONL append is not safe under multi-writer because there is no file lock or O_APPEND atomicity guarantee documented (relies on platform-default).

P0 count is 2 — both are silent attribution issues likely to mislead the Storyteller substrate the moment a hot stack runs longer than a fixture window.

## Findings

Each finding is ranked, located, and paired with a suggested packet ID (`S-AUDIT-FIX-<n>`) added to the weekend sprint backlog.

---

### F1 — P0 — NCRI "sale" heuristic mislabels admin grants as sales

- Severity: **P0**
- Location: `src/controller/ncri/ncri-registry.ts:130-160` (`NcriRegistry.transfer`)
- Evidence: `ncri-registry.ts:145-158` emits `ncri_sale` on **any** approved owner change. There is no check that money/AP changed hands or that the new owner is a real city user. The "sourceResidentName" used as `residentName` on the emitted event is the *original creator* (typed onto the NCRI at create-time), so an admin who creates an NCRI as `admin`, approves it, then transfers it to `user-bob` produces an `ncri_sale` event whose `residentName` is `undefined` (because `residentOwner('admin')` returns undefined) and whose `cityUserId` is `user-bob`. The Storyteller digest will surface this as a sale that no resident made, with no AP/GP delta attached. The test at `ncri-registry.test.ts:409-420` confirms exactly this behavior, asserting only `kind/ncriId/cityUserId` — not that a real economic exchange occurred.
- Reproduction: admin issues a giveaway NCRI to a new attendee at the CIC event (`create` as `admin`, `approve`, `transfer` to user). The economy log records `ncri_sale` even though it's a gift, and the digest will sort it as a notable event.
- Recommended fix: rename `ncri_sale` semantically or add a `transferReason: 'sale' | 'gift' | 'admin_assign'` to the transfer API and emit `ncri_sale` only when `transferReason === 'sale'`. Alternatively, only emit when both old and new owners are real residents/users (not `admin`/system). The verifier already gates Storyteller text; the easier fix is making the substrate emit the right kind so the verifier doesn't have to second-guess it.
- Suggested packet: **S-AUDIT-FIX-1** (issue: `QA-20260530-011`)

---

### F2 — P0 — `failed_gp` classification swallows non-GP failures

- Severity: **P0**
- Location: `src/controller/city-integration/ap-gp-exchange.ts:112-130` (`deriveExchangeStatus`)
- Evidence: line 117 — `if (failureReason === 'insufficient_gold' || (gpEvidence === undefined && apEvidence === undefined && failureReason))` returns `failed_gp` **whenever** there's any `failureReason` and no AP+GP evidence yet. But the service call path (`service.ts:217-247`) only sets `failureReason` from the *GP burn* try/catch, so in practice this happens to be correct today — except that the helper is **exported and can be called by any consumer with a different failure source** (e.g. AP runtime resolution failure before GP is attempted). The test at `ap-gp-exchange.test.ts:27-29` only covers `insufficient_gold`. A future caller that passes `'resident_not_found'` with no evidence will get `failed_gp` even though the actual failure is on the AP side, mis-classifying the failure mode in stored records.
- Why it matters: `failed_gp` is one of two failure modes the Storyteller verifier accepts. Mis-classified records mean a future "no resident, exchange failed" log entry surfaces in the digest as if the resident were broke.
- Reproduction: call `deriveExchangeStatus(undefined, undefined, 'resident_not_found')` → returns `'failed_gp'` (not `'failed_ap'` or a new `'failed_setup'`).
- Recommended fix: tighten the helper to either require `failureReason === 'insufficient_gold'` for `failed_gp`, or introduce a fourth `failed_setup` status for non-GP-side failures. Add a test that passes a non-GP `failureReason` and asserts the failure mode.
- Suggested packet: **S-AUDIT-FIX-2** (issue: `QA-20260530-012`)

---

### F3 — P1 — `selectCandidateGoals` is dead code in production

- Severity: **P1**
- Location: `src/controller/spark/runescape-brain-planner.ts:518-563`; test in `runescape-brain-planner.test.ts:476+`
- Evidence: `grep -rn selectCandidateGoals src/` returns only the definition and its own test. No production call site in `hybrid-agent-helpers.ts`, the orchestrator, or any brain planner caller. The function's own doc-comment says wire-up is deferred to "the next orchestrator slim-down (Plan ε)" — but the public docs (sprint plan and capability rows for S8c) imply the needs hierarchy is engaged. It is not yet wired into goal selection at all; the only real consumer is the Brain prompt knowledge text.
- Why it matters: the Storyteller (and the closeout report) credit residents with picking practical AP-before-Soul-goal actions because of the needs hierarchy. If a Storyteller post or demo narration says "the resident chose this because survive AP came first," that claim is not yet substrate-backed for goal *selection* — it's only true at the prompt-influence layer.
- Recommended fix: either (a) flip the planner to actually call `selectCandidateGoals` at the next goal-selection point (small, additive, behind a feature flag) and add a live benchmark that proves order changes under a low-AP context; or (b) downgrade the capability claim and document the seam as "planned but not yet wired."
- Suggested packet: **S-AUDIT-FIX-3** (issue: `QA-20260530-013`) — related to S-GOAL-1..4 from D-WEEKEND-DESIGN

---

### F4 — P1 — `ApLedger.emitEconomyEvent` `refId` is not globally unique

- Severity: **P1**
- Location: `src/controller/patron/ap-ledger.ts:215-225`
- Evidence: `const refId = \`apledger:${this.events_.length - 1}\`;` This is the in-memory index of the just-pushed event. Two different residents' ledgers both produce `refId: 'apledger:0'` for their first event each, and after a controller restart loading from snapshot, the same resident's next event also restarts at index 0 if a fresh `ApLedger` is built per-process (which is what `attachEconomyEventLog` is designed for). The Storyteller verifier already accepts these refs as-is. Aggregated digests cannot use `refId` as a unique key.
- Why it matters: Storyteller dispatches that cite `refId` for "the AP grant that funded this Soul" can collide across residents or across restarts, undermining the verifier's claim that every Storyteller fact has a unique evidence anchor.
- Recommended fix: include the resident name and an ISO timestamp suffix: `apledger:${residentName}:${this.events_.length - 1}:${event.ts}`. Or, simpler, switch to `crypto.randomUUID()` per emission. Add a test that two residents' first events emit distinct `refId`s.
- Suggested packet: **S-AUDIT-FIX-4** (issue: `QA-20260530-014`) — risk amplified by S-HOST-WIRE sharing one EconomyEventLog across residents

---

### F5 — P1 — `city:digest` CLI does no path sanitization

- Severity: **P1**
- Location: `src/controller/city-integration/cli.ts:40-81` (`parseCityDigestArgs`), `cli.ts:92-108` (`runCityDigest`)
- Evidence: `--memory-root` is accepted verbatim and passed to `EconomyEventLog`/`GoalContractStore`, which then build paths under it without normalization or root checks. A path containing `../../` or pointing at an arbitrary directory is silently accepted; the CLI will read whatever JSONL/JSON it finds in the requested layout, including from outside the project tree. Compare with the dashboard's `packages/server/src/util.ts:55-62` which has an explicit "Path escapes configured root" guard.
- Why it matters: low *security* risk in single-operator demo context, but real *operator footgun* — running the CLI with a typo'd or relative path (e.g. from the wrong cwd) will produce a confusing empty/partial digest and the operator will not get a clear error.
- Reproduction: `npm run city:digest -- --memory-root /tmp/does-not-exist` returns a valid empty digest with `totalEvents: 0`. There is no warning, no exit code change, no mention that the path did not exist.
- Recommended fix: in `runCityDigest`, `fs.statSync` the memory root and warn (or fail) if it does not exist or does not contain the expected `city-integration/` subdirectory. Optionally normalize/resolve the path and refuse `..` traversals if the operator passed `--strict`.
- Suggested packet: **S-AUDIT-FIX-5** (issue: `QA-20260530-015`)

---

### F6 — P1 — EconomyEventLog has no concurrent-writer protection

- Severity: **P1**
- Location: `src/controller/city-integration/economy-event.ts:99-119` (`append`)
- Evidence: `fs.appendFileSync(filePath, ...)` with no file lock. On macOS/Linux, `O_APPEND` is atomic for writes ≤ `PIPE_BUF` (typically 4096 bytes) — and one EconomyEvent JSON line is well under that, so individual lines won't interleave bytes. But there is no documentation pinning this guarantee or testing it under contention, and a future enlargement (e.g. adding a verbose `details` field that pushes a line past 4 KB) would silently break the invariant. Multi-controller parity in Docker Compose (called out in the CIC decisions doc) makes this a near-term concern: two controllers writing to a shared NFS-style `memoryRoot` would have undefined ordering and possible interleaving.
- Why it matters: the digest treats lines newest-first and assumes one valid event per line. A torn line becomes a "skipped malformed line" silently, hiding evidence the Storyteller may have already referenced via cached digest snapshots.
- Recommended fix: document the `O_APPEND`/`PIPE_BUF` assumption inline with an assert that any single JSON line stays under 4 KB; or introduce a tiny `lockfile`-based critical section if multi-controller becomes real. At minimum add a test that simulates two concurrent appenders and asserts no torn lines.
- Suggested packet: **S-AUDIT-FIX-6** (issue: `QA-20260530-016`)

---

### F7 — P1 — `economy-events.jsonl` reads the whole file every call

- Severity: **P1**
- Location: `economy-event.ts:121-140` (`readAll`); dashboard `packages/server/src/economy.ts:87-113` (`readRecentEconomyEvents`)
- Evidence: `readAll()` reads the entire JSONL into memory and re-parses on every digest/CLI/dashboard refresh. The dashboard panel polls every 5 s (`EconomyPanel.svelte:14`). At ~10-30 concurrent residents with daily decay + grant + occasional GP events, the log will grow to thousands of lines within hours. Reading and parsing all of it 12 times/min per active dashboard tab is wasteful — and the dashboard's "newest first" scan reads the whole file even though it only wants the last 10 lines.
- Why it matters: not a correctness bug, but a perf/operational tax that will hurt the longer the demo runs. Becomes a P0 if the operator leaves the dashboard open across an entire CIC event.
- Recommended fix: add a `tail(n)` method to `EconomyEventLog` that reads from the file end. The dashboard's `readRecentEconomyEvents` should call it instead of `fs.readFile + split` on the whole file. (Node's `fs.read` with a backwards-byte scan is a 30-LOC helper.)
- Suggested packet: **S-AUDIT-FIX-7** (issue: `QA-20260530-017`) — adjacent to S-ECON-VIEW from D-WEEKEND-DESIGN

---

### F8 — P2 — `buildCityEventDigest` window bounds are inclusive in code, off-by-one in tests

- Severity: **P2**
- Location: `src/controller/city-integration/city-event-digest.ts:72-80`
- Evidence: `windowStart` uses `event.ts < windowStart` (strictly less excludes; events AT the bound are included) and `windowEnd` uses `event.ts > windowEnd` (events AT the upper bound are included). The behavior is inclusive on both ends. The CLI flag doc-comment in `cli.ts:17-18` describes `--since`/`--until` as "Inclusive lower bound" / "Optional inclusive upper bound" — consistent — but `EconomyEventLog.filter` (`economy-event.ts:80-85`) describes `sinceTs` as "Inclusive lower bound on ts" and has only a lower-bound filter at all (no `untilTs`). So `digest` is inclusive-inclusive, `filter` is inclusive-only-lower. The substrate test for the digest covers a window where the boundary timestamps don't tie, so the inclusivity of the upper bound is not asserted.
- Why it matters: A scheduled "digest every 10 min" run will double-count events that sit exactly on a window boundary (e.g. midnight rollover). Low frequency but real attribution bug.
- Recommended fix: pick a convention (likely inclusive-lower, exclusive-upper which matches "half-open windows" everywhere else in the codebase) and add boundary tests for both bounds in the digest and a matching `untilTs` flag on `EconomyEventLog.filter`.
- Suggested packet: **S-AUDIT-FIX-8**

---

### F9 — P2 — `GoalContractStore.list()` re-reads every JSON on every call

- Severity: **P2**
- Location: `src/controller/city-integration/goal-contract.ts:153-171`
- Evidence: identical issue to F7 but worse on the dashboard side — `readActiveGoals` (`packages/server/src/economy.ts:128-164`) lists the goal dir and reads every file on every 5 s poll. With 100 goals across all residents this is still negligible, but combined with the recent-event scan it adds disk I/O proportional to total ecosystem size for what is per-resident data. The fix is the same as F7: add an index file or stream from disk into a small in-memory cache invalidated on mtime change.
- Recommended fix: keep file storage but add an in-memory mtime-aware cache to both `GoalContractStore` and the dashboard reader. Low priority; rev when load actually matters.
- Suggested packet: **S-AUDIT-FIX-9**

---

### F10 — P2 — `attachEconomyEventLog` silently replaces, no double-attach guard

- Severity: **P2**
- Location: `src/controller/patron/ap-ledger.ts:204-207`
- Evidence: the seam re-assigns `this.economyEventLog_` and `this.economyContext_` without any guard or warning. If a caller wires the ledger to log A, then later (e.g. after a config reload) wires it to log B, subsequent events flow only to B with no record of the switch in either log. There is no log-line, no `console.warn`, no `assert(this.economyEventLog_ === undefined)`. This makes the multi-agent host-wiring work currently underway (`S-HOST-WIRE`, claimed in parallel) easier to mis-implement.
- Recommended fix: add a parameter `replace: boolean = false`; throw or warn when re-attaching unless explicitly allowed.
- Suggested packet: **S-AUDIT-FIX-10**

---

### F11 — P2 — `EconomyEvent` `ap_fade` carries `apDelta: 0` (misleading)

- Severity: **P2**
- Location: `src/controller/patron/ap-ledger.ts:260-269`
- Evidence: when a resident fades (AP hits 0), the emitted EconomyEvent has `apDelta: 0`. The semantics are "AP is now 0" — but the digest treats `apDelta` as a delta and a 0 contributes nothing to AP totals. The `ap_fade` notable summary in the digest correctly says "<resident> faded (ran out of AP)" regardless, so user-facing narration is fine — but anyone querying the EconomyEventLog directly and summing `apDelta` for a window will under-count the AP that decayed in the final tick before fade. The actual "AP burned" right before fade is in the preceding `ap_decay` event.
- Recommended fix: either drop `apDelta` from `ap_fade` events entirely (it's not signed in any meaningful way) or set it to the AP balance immediately before fade as a negative number. Document the choice on the event-kind reference.
- Suggested packet: **S-AUDIT-FIX-11**

---

### F12 — P2 — `EconomyEventLog.filter` upper-bound asymmetry

- Severity: **P2**
- Location: `src/controller/city-integration/economy-event.ts:80-87, 142-158`
- Evidence: `EconomyEventFilter` has `sinceTs` but no `untilTs`. The digest filter (which takes `windowEnd`) provides upper-bound filtering, but anyone using `EconomyEventLog.filter` directly to query historical windows cannot bound the upper edge. Inconsistency with the digest invites bugs in future tooling.
- Recommended fix: add an `untilTs` field to `EconomyEventFilter` and matching test; pick the same inclusivity convention as F8.
- Suggested packet: **S-AUDIT-FIX-12**

---

### F13 — P2 — `recentEventLimit` clamped to 100 silently, no warning to caller

- Severity: **P2**
- Location: `packages/server/src/economy.ts:57`
- Evidence: `const limit = Math.max(1, Math.min(100, options.recentEventLimit ?? 10));`. A dashboard caller asking for 500 gets back 100 with no indication. Minor surprise factor.
- Recommended fix: document the cap in the JSDoc; not worth a runtime warning.
- Suggested packet: rolled into S-AUDIT-FIX-9 docs polish; no dedicated packet.

---

## What's Solid (worth saying)

- Atomic file writes (tmp + rename) across `GoalContractStore`, `ApGpExchangeStore`, `NcriRegistry` — consistent, correct, and tested.
- Zod-at-the-boundary discipline: every public input goes through a schema before persistence.
- `goal-contract` lifecycle is the cleanest piece of the burst — idempotent transitions, evidence required for achieve, abandon-vs-achieve mutual exclusion, all tested.
- `EconomyEventLog` malformed-line tolerance is well-tested and the right call (lets old logs survive schema bumps).
- The dashboard economy BFF correctly handles the "substrate not wired yet" case with empty-state payloads. The `economy-panel` HTTP route is regex-tested against drift (`economy.test.ts:131-139`) — nice paranoia.
- Path slug alignment between server (`runtime-state.ts:235`) and dashboard (`util.ts:64`) is byte-equivalent; the dashboard reads from where the server writes.

## Open Questions For The Maintainer

1. Is `S-HOST-WIRE` (claimed in parallel) the intended fix for F4 (`refId` uniqueness)? If yes, it should also add resident-name attribution to `refId`.
2. Should `ncri_sale` always mean "money changed hands," or is "ownership change" the canonical meaning? F1's fix depends on the answer.
3. Should the city:digest CLI gain a `--strict` mode that fails on missing paths, or is the current empty-state-on-missing behavior intentional for dashboard polling?

## Stop Conditions Hit

- Found 2 P0 issues. Continued one extra pass for the P1 set because the P0s were both attribution rather than crash; the P1s are largely operational and worth filing.
- Stopped at 13 findings — last 4 are perf/polish and don't warrant deeper digging this cycle.
- No micro-fix applied: every P0/P1 finding here needs more than 5 LOC of code + test (NCRI sale heuristic, `failed_gp` reclassification, `refId` overhaul, CLI path guard). Leaving them for owners of the matching `S-AUDIT-FIX-<n>` packets.

