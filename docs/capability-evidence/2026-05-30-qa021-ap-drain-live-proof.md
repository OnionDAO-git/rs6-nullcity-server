# QA-20260530-021 - AP drain and needs-hierarchy live proof

Date: 2026-05-30
Operator: Codex
Stack: hot local stack, controller HTTP on `127.0.0.1:43611`, bearer `operator-token`
Resident: `res:qa-trader`

## TL;DR

The admin AP-drain endpoint is live on the running controller, writes economy and Library audit rows, and successfully pushed `res:qa-trader` from its normal benchmark goal into the survival goal.

Observed goal sequence:

1. Healthy AP: `scout-nearby-area`
2. Drain to `5` AP: `collect-visible-gp`
3. Restore/top-up: `scout-nearby-area`

Important caveat: after the low-AP survival tick, the existing `restart_respawn_policy` revived the resident and reset AP to `60000` before the manual top-up ran. That means this is strong proof that the live planner observes the low-AP survival band and flips goals, but not a clean proof of long-lived behavior at exactly `5` AP.

## Commands and Results

Endpoint existence probe:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer operator-token" \
  -H "Content-Type: application/json" \
  -d '{"amount":1,"reason":"QA-20260530-021 endpoint existence tiny probe"}' \
  "http://127.0.0.1:43611/api/nullcity/admin/residents/res%3Aqa-trader/ap-drain"
```

Result:

```json
{
  "ok": true,
  "resident": "res:qa-trader",
  "attentionBefore": 21860.5,
  "attentionAfter": 21859.5,
  "requestedDrain": 1,
  "actualDrain": 1,
  "reason": "QA-20260530-021 endpoint existence tiny probe"
}
```

Pre-drain public snapshot:

```json
{
  "ts": "2026-05-30T22:04:46.365Z",
  "online": true,
  "ap": 21847,
  "tick": 538,
  "goal": "scout-nearby-area",
  "plan": null
}
```

Drain request:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer operator-token" \
  -H "Content-Type: application/json" \
  -d '{"amount":21842,"reason":"QA-20260530-021 survival flip live proof"}' \
  "http://127.0.0.1:43611/api/nullcity/admin/residents/res%3Aqa-trader/ap-drain"
```

Drain result:

```json
{
  "ok": true,
  "resident": "res:qa-trader",
  "attentionBefore": 21847,
  "attentionAfter": 5,
  "requestedDrain": 21842,
  "actualDrain": 21842,
  "reason": "QA-20260530-021 survival flip live proof"
}
```

First snapshot after drain:

```json
{
  "ts": "2026-05-30T22:05:06.619Z",
  "online": true,
  "ap": 60000,
  "tick": 549,
  "goal": "collect-visible-gp",
  "plan": null
}
```

Restore top-up:

```json
{
  "ok": true,
  "resident": "res:qa-trader",
  "attentionBefore": 60000,
  "attentionAfter": 82000,
  "creditedAmount": 22000
}
```

Snapshots after restore:

```json
{"ts":"2026-05-30T22:05:26.817Z","online":true,"ap":81992,"tick":568,"goal":"scout-nearby-area","plan":null}
{"ts":"2026-05-30T22:05:46.890Z","online":true,"ap":81979.5,"tick":593,"goal":"scout-nearby-area","plan":null}
{"ts":"2026-05-30T22:06:06.965Z","online":true,"ap":81976,"tick":600,"goal":"scout-nearby-area","plan":null}
```

## JSONL Evidence

Economy event log:

```text
data/controller/memory/city-integration/economy-events.jsonl:46
{"schemaVersion":1,"id":"61adb15a-30d5-4968-9470-1bfb49f318a3","ts":"2026-05-30T22:04:19.983Z","kind":"ap_decay","residentName":"res:qa-trader","apDelta":-1,"refId":"admin_drain:res:qa-trader:2026-05-30T22:04:19.983Z","note":"QA-20260530-021 endpoint existence tiny probe"}

data/controller/memory/city-integration/economy-events.jsonl:47
{"schemaVersion":1,"id":"4d300715-eee6-4805-a468-33441725683f","ts":"2026-05-30T22:04:46.473Z","kind":"ap_decay","residentName":"res:qa-trader","apDelta":-21842,"refId":"admin_drain:res:qa-trader:2026-05-30T22:04:46.473Z","note":"QA-20260530-021 survival flip live proof"}

data/controller/memory/city-integration/economy-events.jsonl:48
{"schemaVersion":1,"id":"57dd8da6-4eab-4786-9acf-8929d1f14cac","ts":"2026-05-30T22:05:06.696Z","kind":"ap_topup","residentName":"res:qa-trader","apDelta":22000,"refId":"qa021-topup-1780178706","note":"QA-20260530-021 restore after AP drain live proof"}
```

Library timeline:

```text
data/controller/memory/library/res-qa-trader/timeline.jsonl:23666
{"schemaVersion":1,"ts":"2026-05-30T22:04:46.473Z","tick":538,"sessionId":"external","kind":"city_attention_drain","requestedDrain":21842,"actualDrain":21842,"attentionBefore":21847,"attentionAfter":5,"reason":"QA-20260530-021 survival flip live proof","lifeIndex":4,"significanceReasons":["city:admin_attention_drain"]}

data/controller/memory/library/res-qa-trader/timeline.jsonl:23668
{"schemaVersion":1,"ts":"2026-05-30T22:04:47.469Z","tick":540,"sessionId":"local-28531-res-qa-trader-1780178081618","kind":"say","text":"I won't last at this pace. If anyone has earned AP today, I'd welcome the support.","lastWords":false,"lifeIndex":4,"significanceReasons":["voice:say"]}

data/controller/memory/library/res-qa-trader/timeline.jsonl:23670
{"schemaVersion":1,"ts":"2026-05-30T22:05:04.464Z","tick":549,"sessionId":"external","kind":"revival","cause":"restart_respawn_policy","lifeIndex":5,"significanceReasons":["life:revival"]}

data/controller/memory/library/res-qa-trader/timeline.jsonl:23671
{"schemaVersion":1,"ts":"2026-05-30T22:05:06.696Z","tick":549,"sessionId":"external","kind":"city_attention_credit","amount":22000,"attentionBefore":60000,"attentionAfter":82000,"sourceType":"qa_live_verify","note":"QA-20260530-021 restore after AP drain live proof","lifeIndex":5,"significanceReasons":["city:attention_credit"]}
```

## Assessment

Passed:

- Admin AP drain route is live on the running controller.
- Drain emits auditable `ap_decay` economy events.
- Drain emits per-resident `city_attention_drain` Library timeline events.
- Low AP produced an in-character AP support line.
- Live active goal changed from the benchmark/scouting goal to the survival goal `collect-visible-gp`.
- Restore/top-up returned the resident to `scout-nearby-area`.

Open follow-up:

- The death/revival policy immediately restored the resident to high AP after the low-AP tick. That is probably fine for liveness, but it means a future QA packet should test a less terminal low-AP scenario or explicitly account for revival when verifying prolonged AP-survival behavior.
- `docs/resident-capabilities.md` and `docs/issue-register.md` were not updated in this packet because active Claude packets currently own those docs. A follow-up doc-only pass should promote the needs-hierarchy row from "pending hot-stack verify" to "live verified with revival caveat" after those locks clear.
