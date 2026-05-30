# Live Verify Substrate — 2026-05-30 QA-LIVE-1

Packet: **QA-LIVE-1**
Observer: claude (autonomous subagent), branch `agents/wip`
Stack tip at run: `e74064c1` (server) — see `git log` for context. The running controller was built from binaries dated `dist/controller/index.js 2026-05-30 14:44` which include the S-AUDIT-FIX-3 needs-hierarchy wire-up.

Hot stack confirmed before runs:
- Controller: pid 16763, MCP `:43596`, city-integration HTTP `:43611` (bearer token = `operator-token`), letters HTTP `:43610`.
- Game server: pid 39208, ports `:43594` + `127.0.0.1:43595`.
- Dashboard web `:5174` (Vite); BFF `:8787` (bun).
- Memory root: `./data/controller/memory` per `controller.yml` (CWD = `/Users/james/Code/OnionDAO/rs6-nullcity-server`).
- Economy JSONL: `data/controller/memory/city-integration/economy-events.jsonl` (29 lines at baseline; grew to 33 by end of run).

This run was observation-only. No code touched. Three new economy events were appended (1 × `ap_topup`, 1 × `ncri_gift`, 1 × `ncri_sale`) plus two `ap_gp_exchange` attempts that failed at the GP gateway and therefore did NOT emit (by design).

---

## V1 — Needs-hierarchy ranker firing live

**Status: UNBLOCKED — recipe now substrate-supported; awaits controller restart for end-to-end live observation**
**Confidence: MEDIUM that the wire-up is deployed; HIGH that the recipe is now executable on-demand (only blocker is restarting the controller to pick up the new dist binary).**

### Update 2026-05-30 (S-OBS-DRAIN-1 closes the verification-tooling gap)

The "no on-demand AP-drain HTTP endpoint" gap noted in the original attempt log below was closed by packet **S-OBS-DRAIN-1** (commit `fe8e8984` on `agents/wip`):

- New service method `CityIntegrationService.adminDrainAttention(residentName, {amount, reason})`
- New HTTP route `POST /api/nullcity/admin/residents/:id/ap-drain {amount, reason}` (operator-token gated, same bearer as `/attention-grants`)
- `ResidentRuntime.decrementAttention(amount)` clamps balance at 0, persists, returns actualDrain
- Emits an `ap_decay` economy event (`apDelta = -actualDrain`, `note = reason`) so the JSONL/digest/dashboard surface the operator drain in the same channel as per-tick decay, **plus** a `city_attention_drain` library timeline event with `requestedDrain`/`actualDrain`/`attentionBefore`/`attentionAfter`/`tick`/`reason`/`lifeIndex` for per-resident audit
- Kept on a separate `/admin/` URL segment so the user-facing `attention-grants` schema stays positive-only — no back-compat risk
- Tests: 7 new service tests + 3 new HTTP tests; `fin` 2981/2981 PASS

### Snapshot of relevant residents at the time of the unblock (controller pid 16763, **OLD binary**, dist 2026-05-30 14:44)

| resident | online | AP | tick | activeGoal.id |
|---|---|---|---|---|
| `res:agent` | yes | 52355 | 29 | `null` (no benchmarkTask configured) |
| `res:qa-woodcutter` | yes | 22486 | 33 | `master-woodcutting` (S-GOAL-1 orientation working live!) |
| `res:qa-trader` | yes | 23027.5 | 33 | `scout-nearby-area` (benchmark) |
| `res:qa-scout` | yes | 22917.5 | 37 | `scout-nearby-area` (benchmark) |
| `res:qa-survivor` | yes | 22947.5 | 54 | `train-combat-safely` (benchmark) |
| `res:qa-cook` | yes | 22948.5 | 36 | `catch-and-cook-starter-fish` (benchmark) |
| `res:qa-angler` | yes | 22573 | 31 | `catch-and-cook-starter-fish` (benchmark) |

**Bonus live finding** (no extra packet needed): `res:qa-woodcutter` shows `activeGoal: master-woodcutting` live — its S-GOAL-1 `orientationGoal {id: master-woodcutting, tier: pursue}` is firing through `ensureBenchmarkGoal`. That's S-GOAL-1's first organic live evidence for the healthy-AP arm of the recipe. Survival-flip arm still pending controller restart so the new admin-drain code can execute.

### Endpoint probe against the OLD running binary (expected to 404)

```bash
$ curl -sS -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
    -d '{"amount":22480,"reason":"S-OBS-DRAIN-1 live-verify F3 (probe before restart)"}' \
    "http://127.0.0.1:43611/api/nullcity/admin/residents/res%3Aqa-woodcutter/ap-drain"
{"error":"Not Found"}
```

Confirms the new endpoint is NOT in the running binary — the source tree was rebuilt against `fe8e8984` but the controller process (pid 16763) was launched manually (`node dist/controller/index.js ...`, no nodemon watching dist for the controller). A maintainer-initiated controller restart is required to pick up the new binary.

### Recipe to run AFTER controller restart (end-to-end live verify)

```bash
# (1) Snapshot a benchmark resident at healthy AP (qa-trader has benchmarkTask=scout-explore-5m by default)
curl -sS -H "Authorization: Bearer operator-token" \
  http://127.0.0.1:43611/api/nullcity/residents/res%3Aqa-trader/public-snapshot \
  | jq '{ap:.state.attention, tick:.state.tick, goal:.state.cognition.activeGoal.id, online}'
# expected (per snapshot above): { ap: ~23000, tick: ~33, goal: "scout-nearby-area", online: true }

# (2) Drain AP into the SURVIVE band. With no soul.attentionProfile.floor configured
# on qa-trader, apFloor defaults to 0 and SURVIVE buffer is 5, so AP must end <= 5.
DRAIN=$(echo "23028 - 5" | bc)
curl -sS -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
  -d "{\"amount\":$DRAIN,\"reason\":\"live-verify F3 needs-hierarchy SURVIVE flip\"}" \
  "http://127.0.0.1:43611/api/nullcity/admin/residents/res%3Aqa-trader/ap-drain"
# expected: { ok: true, attentionBefore: ~23028, attentionAfter: <=5, actualDrain: $DRAIN, reason: "..." }

# (3) Wait one Brain cycle (qa-trader inherits brainEveryTicks; typical ~30-60s on live tick rate)
sleep 60

# (4) Re-snapshot — activeGoal should now be 'collect-visible-gp' (the survival winner from
# goalPoolForBenchmark when currentTier === 'survive').
curl -sS -H "Authorization: Bearer operator-token" \
  http://127.0.0.1:43611/api/nullcity/residents/res%3Aqa-trader/public-snapshot \
  | jq '{ap:.state.attention, tick:.state.tick, goal:.state.cognition.activeGoal.id}'
# expected: { ap: <=5, tick: bigger, goal: "collect-visible-gp" }    <-- THE F3 LIVE PROOF

# (5) Top up AP via the positive grant endpoint to push back to healthy
curl -sS -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"f3-verify-topup-1","amount":20000,"sourceType":"qa_live_verify","note":"F3 live-verify back to healthy"}' \
  "http://127.0.0.1:43611/api/nullcity/residents/res%3Aqa-trader/attention-grants"

sleep 60

# (6) Re-snapshot — activeGoal should flip BACK to the benchmark (round-trip proof)
curl -sS -H "Authorization: Bearer operator-token" \
  http://127.0.0.1:43611/api/nullcity/residents/res%3Aqa-trader/public-snapshot \
  | jq '{ap:.state.attention, tick:.state.tick, goal:.state.cognition.activeGoal.id}'
# expected: { ap: ~20005, tick: even bigger, goal: "scout-nearby-area" }
```

### JSONL evidence the recipe should produce

```bash
wc -l data/controller/memory/city-integration/economy-events.jsonl
# expected: +2 lines (one ap_decay + one ap_topup)
tail -3 data/controller/memory/city-integration/economy-events.jsonl
# expected an ap_decay row: {"kind":"ap_decay","residentName":"res:qa-trader","apDelta":-23023,"note":"live-verify F3 needs-hierarchy SURVIVE flip",...}
tail -2 data/controller/memory/library/res-qa-trader/timeline.jsonl
# expected a city_attention_drain row + a city_attention_credit row
```

If the SURVIVE flip is observed → F3 is LIVE-VERIFIED — the substrate claim graduates from MEDIUM to HIGH. Update `docs/resident-capabilities.md` accordingly.

If the flip is NOT observed → file a new P0. That's a HUGE finding: substrate code claims it works, integration tests pass, but live planner does not call through. Document full state.cognition before/after, the wait period, and the drain/topup HTTP responses.

### Original (pre-S-OBS-DRAIN-1) attempt log — kept for posterity

### What was attempted

- Identified candidate residents (qa-* souls have `legacy.parameters.benchmarkTask`; res:agent does NOT).
- Snapshotted `res:qa-woodcutter` via `GET /api/nullcity/residents/res:qa-woodcutter/public-snapshot` — online=True, attention=22664, tick=63, `activeGoal.id = make-fire` (benchmark goal seeded). Other qa-* show similar benchmark goals: `catch-and-cook-starter-fish` (angler/cook), `scout-nearby-area` (trader/scout/forager/banker), `train-combat-safely` (survivor).
- Tried to drain AP via the documented "AP-grant with negative amount" recipe — **does not exist**. `attentionGrantRequestSchema` enforces `z.number().int().positive()` (service.ts:151). There is no HTTP endpoint that decreases AP. AP only decreases via the in-process per-tick decay in `resident-runtime.ts:367-376`.
- The packet's V1 recipe ("POST /api/nullcity/residents/:id/attention-grants {amount: -N}") is not implementable against the current API. Documented but not fixed (out of QA scope).

### What WAS verifiable

The deployed binary contains the S-AUDIT-FIX-3 wire-up. `dist/controller/thinking/hybrid-agent-helpers.js` has 5 references to `buildResidentNeedsContext` / `goalPoolForBenchmark`; `dist/controller/spark/runescape-brain-planner.js` has 9 references to the same exports plus `selectCandidateGoals`. Source at `src/controller/thinking/hybrid-agent-helpers.ts:2419-2461` confirms `ensureBenchmarkGoal()` builds the candidate pool and calls `selectCandidateGoals` IFF `currentTier(needsContext) === 'survive'` (AP ≤ floor+5).

### Why "MEDIUM that the wire-up is deployed":

I have not observed an actual goal-flip event in the wild. The wire-up is conservative (only overrides on SURVIVE tier) and SURVIVE requires AP ≤ 5. The qa residents are all in the 22000–25000 AP range with a `gentle` decay curve; they will never reach SURVIVE in a demo window without either (a) hours of tick-decay accumulation, (b) an explicit drain endpoint, or (c) a benchmark task that drains AP. None of those exist in the live demo today.

### Live-found gap (not a code bug, but a verification-tooling gap)

Without an `ap-decay`/`ap-spend` HTTP endpoint, the needs-hierarchy SURVIVE override cannot be reproduced on-demand by an operator or QA agent. The capability claim in `resident-capabilities.md` for S-AUDIT-FIX-3 currently rests on unit tests + code-deployment, NOT live demo evidence. This is the same risk F3 originally called out — the substrate-side fix landed, but the operational verification path is missing.

---

## V2 — Economy event flow live

**Status: VERIFIED (partial)**
**Confidence: HIGH for the AP-topup path; HIGH for the digest tally; the AP-GP exchange leg is BLOCKED by a separate live-found bug (see V2-bug below).**

### Steps

```bash
# baseline
wc -l data/controller/memory/city-integration/economy-events.jsonl
#  29

# AP grant
IDK="qa-live-1-grant-1780172352"
curl -sS -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
  -d "{\"idempotencyKey\":\"$IDK\",\"amount\":50,\"cityUserId\":\"city-user:qa-live-1\",\"sourceType\":\"qa_live_verify\",\"sourceId\":\"qa-live-1\",\"note\":\"V2 attention grant test\"}" \
  "http://127.0.0.1:43611/api/nullcity/residents/res:qa-trader/attention-grants"
```

### Response excerpt

```json
{"ok":true,"resident":"res:qa-trader","attentionBefore":23152.5,"attentionAfter":23202.5,"creditedAmount":50}
```

### JSONL excerpt (line appended after the grant)

```json
{"schemaVersion":1,"id":"ea87eab5-5e8e-4c40-9a28-77c89183636e","ts":"2026-05-30T20:19:12.470Z","kind":"ap_topup","residentName":"res:qa-trader","cityUserId":"city-user:qa-live-1","apDelta":50,"refId":"qa-live-1","note":"V2 attention grant test"}
```

### Digest verification

`npm run city:digest -- --memory-root /Users/james/Code/OnionDAO/rs6-nullcity-server/data/controller/memory` reported:

```
totalEvents: 31
countsByKind: {'ap_decay': 0, 'ap_grant': 0, 'ap_topup': 2, 'ap_fade': 0,
               'gp_observed': 28, 'gp_earned': 0, 'gp_traded': 0,
               'ap_gp_exchange': 1, 'ncri_sale': 0, 'ncri_redemption': 0,
               'ncri_gift': 0, 'ncri_admin_transfer': 0}
apGrantedTotal: 175
qa-trader: {'residentName': 'res:qa-trader', 'apGranted': 50, 'apDecayed': 0,
            'apNet': 50, 'gpEarned': 0, 'gpTraded': 0, 'eventCount': 3}
```

`apGranted=50` for qa-trader matches my grant exactly; net rolls up into `apGrantedTotal=175`. **Substrate roundtrip from HTTP → JSONL → digest is VERIFIED.**

### V2-bug — AP-GP exchange leg fails at GP burn gateway (P0)

Issued two AP-GP exchange POSTs after the grant: one against `res:qa-trader`, one against `res:agent`. Both returned `status: "failed_gp"` with `failureReason: "Gateway request timed out: burn_resident_gold"`. Reproducible — and `GET /residents/res:qa-trader/wealth` returned `{"error":"Gateway request timed out: inspect_resident_gold"}` while `GET /residents/res:agent/wealth` returned `{"ok":true,"amount":24150}`. So the gateway-to-game-server bridge is partially degraded:

| resident | inspect_resident_gold | burn_resident_gold |
|---|---|---|
| res:agent | OK (24150 GP observed) | TIMEOUT |
| res:qa-trader | TIMEOUT | TIMEOUT |

`failed_gp` correctly does NOT emit an `ap_gp_exchange` JSONL event (by design — no actual exchange occurred). The exchange record is stored under `data/controller/memory/city-integration/exchanges/` and the audit log captures it. The Storyteller verifier would correctly not see a phantom exchange.

This is filed below as **QA-20260530-018**.

### Response excerpt (failed exchange #2)

```json
{"schemaVersion":1,
 "exchangeId":"apgp:res:agent:qa-live-1-exchange2-1780172428",
 "resident":"res:agent","apAmount":20,"gpAmount":10,
 "status":"failed_gp",
 "failureReason":"Gateway request timed out: burn_resident_gold",
 "createdAt":"2026-05-30T20:20:28.362Z"}
```

---

## V3 — NCRI gift vs sale distinction

**Status: VERIFIED**
**Confidence: HIGH**

### Steps (gift)

```bash
# Create NCRI owned by res:qa-trader
curl -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
  -d '{"itemId":995,"displayName":"QA Live Gift NCRI","lore":"For V3 gift test","owner":"res:qa-trader"}' \
  http://127.0.0.1:43611/api/nullcity/ncri
# -> id ncri-1780172496166-sa9aia

# Approve
curl -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
  -d '{"adminNotes":"qa live gift"}' \
  http://127.0.0.1:43611/api/nullcity/ncri/ncri-1780172496166-sa9aia/approve

# Transfer with reason=gift
curl -X POST -H "Authorization: Bearer operator-token" -H "Content-Type: application/json" \
  -d '{"newOwner":"res:qa-cook","reason":"gift"}' \
  http://127.0.0.1:43611/api/nullcity/ncri/ncri-1780172496166-sa9aia/transfer
```

### Steps (sale)

Same flow, owner=`res:qa-cook` → `res:qa-trader`, `reason: "sale"`.

### JSONL excerpts (both events landed)

```json
{"schemaVersion":1,"id":"1dfa659d-87ec-429d-82d5-f0613f3da8d2","ts":"2026-05-30T20:21:36.241Z","kind":"ncri_gift","residentName":"res:qa-trader","cityUserId":"res:qa-cook","ncriId":"ncri-1780172496166-sa9aia","refId":"ncri-1780172496166-sa9aia","note":"NCRI QA Live Gift NCRI (ncri-1780172496166-sa9aia) gifted to res:qa-cook"}
{"schemaVersion":1,"id":"c5ab554a-5f2e-4ff0-bd7a-a51ed6034703","ts":"2026-05-30T20:21:45.857Z","kind":"ncri_sale","residentName":"res:qa-cook","cityUserId":"res:qa-trader","ncriId":"ncri-1780172505807-zczl31","refId":"ncri-1780172505807-zczl31","note":"NCRI QA Live Sale NCRI (ncri-1780172505807-zczl31) transferred to res:qa-trader"}
```

The F1 fix is **live-verified**: `reason: "gift"` produces `kind: "ncri_gift"` and `reason: "sale"` produces `kind: "ncri_sale"`. The Storyteller substrate will no longer see admin/CIC giveaways labeled as sales.

### Cosmetic finding (NOT a P0/P1)

The free-text `note` on the `ncri_sale` event reads "transferred to" rather than "sold to". The `kind` is correct, but a human-reading the JSONL might find the note inconsistent with the kind. Not filing — this is below the bar.

---

## V4 — Dashboard panel reflects fresh data

**Status: VERIFIED**
**Confidence: HIGH (via BFF read); MEDIUM (full client-rendered UI not validated — Vite SPA shell does not server-render the panel).**

### Heartbeat (post-V3)

```
GET http://127.0.0.1:8787/api/nullcity/economy/heartbeat
{"available":true,
 "heartbeat":{"asOf":"2026-05-30T20:22:24.032Z",
              "controllerUptimeSec":5570,
              "residentCount":25,"activeResidentCount":23,
              "economyEventCount":33,
              "lastEconomyEventTs":"2026-05-30T20:21:45.857Z",
              "lastEconomyEventKind":"ncri_sale",
              "lastDigestBuiltAt":"2026-05-30T14:20:00.000Z",
              "degradedFlags":[]}}
```

`lastEconomyEventKind: ncri_sale` matches the freshest event I appended in V3. `economyEventCount: 33` matches JSONL line count.

### Resident-economy panel feed

```
GET http://127.0.0.1:8787/api/resident/res:qa-trader/economy
```

returned `ap: 23188` (= 23138.5 baseline + 50 from V2 grant — note minor tick-decay between snapshot and read accounts for the 0.5 unit; ap is rounded to int in the BFF). `recentEvents[0]` is the `ncri_gift` from V3 with `apDelta` absent (gift is non-economic) and `ncriId` populated. `recentEvents[1]` is the `ap_topup` with `apDelta: 50`. **Dashboard BFF reads the live substrate end-to-end.**

The Vite SPA shell at `http://127.0.0.1:5174/` is served but client-rendered, so curl cannot screenshot panel rendering. Confidence on the BFF feed is HIGH; confidence on the UI render is MEDIUM (would require Chrome MCP / browser to fully verify pixel-level display).

---

## Live-found issues to file

Only one. See `docs/issue-register.md` row appended in this packet.

| ID | Severity | Area | Why |
|---|---|---|---|
| QA-20260530-018 | P0 | Gateway / AP-GP exchange | GP burn + GP inspect operations time out for most residents on the live stack. Reproducible: `GET /residents/res:qa-trader/wealth` and `POST /residents/res:agent/ap-gp-exchanges` both return Gateway timeout. `res:agent` inspect works, but its burn does not. This blocks every demo flow that includes an AP-GP exchange or wealth readout. |

---

## Stack health: GREEN (with one degraded subsystem)

- Controller responsive (heartbeat, public-snapshot, attention-grants, NCRI flow all under 100ms).
- Economy JSONL writing correctly; atomic-append guard (S-AUDIT-FIX-6) appears to be working — no malformed lines observed.
- Game-server gateway bridge: DEGRADED for GP inspect/burn (see QA-20260530-018).
- Dashboard BFF + web both up.
- No emoji/PII leaks observed in surveyed event lines.

## Bottom line

The economy substrate (AP grants, NCRI gift/sale event kinds, JSONL append, digest CLI, dashboard BFF read) is **demonstrably working live**. The needs-hierarchy ranker (V1) is code-deployed but **not on-demand observable** — there is no HTTP path to drain AP into the SURVIVE band, so the live flip cannot be reproduced without either tick-decay over hours or new tooling. The AP-GP exchange leg is **blocked by a real live bug** in the game-server gateway. F1 (NCRI gift/sale split) is the clearest "shipped + verified" item from this morning's burst.
