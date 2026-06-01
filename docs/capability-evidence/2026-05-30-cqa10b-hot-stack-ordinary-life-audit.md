# CQA10b - hot-stack ordinary-life audit + AP top-up proof (2026-05-30)

Packet: `CQA10b`  
Issue: `QA-20260529-006`  
Owner: `codex`  
Date: 2026-05-30

## Why this pass ran

Earlier CQA10 had a good non-idle one-hour sample and then a stale idle rerun. After the weekend hot stack was restarted for D9, this pass rechecked ordinary resident behavior while the controller, game, city API, BFF, and dashboard were all live.

## Live stack checked

- Game gateway: `127.0.0.1:43595`
- Controller MCP/letters/city: `43610`, `43596`, `43611`
- Dashboard: Vite `5174`, BFF `8787`
- City API auth: `Authorization: Bearer operator-token`

## 30-minute ordinary-life audit

Command:

```bash
npm run controller:normal-life-audit -- --duration-ms=1800000 --top=20
```

Artifact:

- `data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T180241Z.json`

Window:

- UTC: `2026-05-30T17:32:41.897Z` -> `2026-05-30T18:02:41.897Z`
- America/Chicago: `2026-05-30 12:32:41` -> `2026-05-30 13:02:41`

Headline metrics:

| Metric | Value |
|---|---:|
| Active ordinary residents | 23 |
| Action attempts | 3,615 |
| Successful submissions | 3,594 |
| Failed submissions | 21 |
| Submit success rate | 99.419% |
| Residents with AP telemetry | 23 |
| Residents with net AP drop | 13 |
| Aggregate AP drop | 17,060 |

Action histogram:

| Action kind | Count |
|---|---:|
| `move_to` | 2,001 |
| `say` | 1,258 |
| `interact` | 149 |
| `use_item_on_item` | 111 |
| `attack` | 89 |
| `item_action` | 7 |

Cause histogram highlights:

| Cause | Count |
|---|---:|
| `idle_initiative` | 1,590 |
| `faction_landmark_recovery` | 314 |
| `explore_patrol` | 297 |
| `stuck_pre_inference_explore` | 222 |
| `woodcutting_level1_routine` | 165 |
| `firemaking_fallback` | 111 |
| `low_health_return_to_anchor` | 66 |
| `low_health_seek_safe_recovery` | 64 |
| `combat_retaliate` | 45 |
| `combat_attack_safe_target` | 43 |
| `nervous:request-attention` | 30 |
| `combat_retreat` | 14 |

Timeline histogram:

| Timeline kind | Count |
|---|---:|
| `say` | 1,240 |
| `stuck_detected` | 960 |
| `stuck_recovered` | 828 |
| `first_xp` | 46 |

Not observed in this 30-minute window:

- `logout`
- `death`
- `city_attention_credit` before the controlled top-up below
- `city_gold_observed`
- `city_gold_burn`
- `city_ap_gp_exchange`
- `trade_completed`
- `trade_cancelled`
- `level_up`
- `quest_complete`

## Controlled AP top-up on live stack

The ordinary loop showed repeated AP help requests from named heroes, including `res:thrand`:

```json
{"kind":"say","cause":"nervous:request-attention","text":"Thrand: I can feel my AP fading. An offering at the embassy would keep me here a while longer."}
```

After that live request, this pass credited a small controlled AP top-up through the city API:

```bash
curl -X POST \
  -H 'Authorization: Bearer operator-token' \
  -H 'Content-Type: application/json' \
  'http://127.0.0.1:43611/api/nullcity/residents/res%3Athrand/attention-grants' \
  --data '{"idempotencyKey":"cqa10b-thrand-topup-20260530T1803Z","amount":75,"cityUserId":"city-user:codex-cqa10b","sourceType":"qa_hot_stack_topup","note":"CQA10b controlled AP top-up after Thrand asked for support"}'
```

Result:

```json
{"ok":true,"resident":"res:thrand","attentionBefore":3000,"attentionAfter":3075,"creditedAmount":75}
```

Library timeline proof:

```json
{"kind":"city_attention_credit","amount":75,"attentionBefore":3000,"attentionAfter":3075,"cityUserId":"city-user:codex-cqa10b","sourceType":"qa_hot_stack_topup","note":"CQA10b controlled AP top-up after Thrand asked for support","significanceReasons":["city:attention_credit"]}
```

## Dashboard/BFF proof

Controller API:

- `GET http://127.0.0.1:43611/api/nullcity/economy/live?limit=5&residentLimit=5`
- `city.activeResidentCount=1`
- `city.attentionDelta=75`
- `countsByKind.ap_topup=1`
- latest `recentEvents[0].kind=ap_topup`
- latest `recentEvents[0].residentName=res:thrand`
- private `cityUserId` redacted to `<patron #1>`

Dashboard BFF:

- `GET http://127.0.0.1:8787/api/nullcity/economy/live?limit=5&residentLimit=5`
- `available=true`
- same `ap_topup` event and redaction.

Browser dashboard at `http://127.0.0.1:5174/` showed:

- `LIVE AP/GP ECONOMY`
- `25 residents carrying 430,004.5 AP`
- `1 ACTIVE IN ECONOMY WINDOW · AP Δ +75 · GP Δ 0`
- `1 AP/GP events`
- `AP TOPUP`
- `res:thrand AP +75 <PATRON #1>`

## Interpretation

What this proves:

1. The hot stack is alive and non-idle: 23 ordinary residents generated 3,615 actions in 30 minutes.
2. Residents are still doing real game actions, not only speech: 89 attacks, 111 firemaking item-use actions, 149 interactions, and 7 item actions appeared in the latest window.
3. AP decay pressure is visible in ordinary life: 13 residents dropped AP, and named heroes repeatedly asked humans for AP.
4. A live AP top-up through the city API immediately appears in the Library, controller `/economy/live`, dashboard BFF, and browser dashboard.

What remains weak:

1. Stuck churn is still high: 960 `stuck_detected` and 828 `stuck_recovered` moments in 30 minutes.
2. Combat recurrence is present but still shallow: 89 attacks in the window, but long survival/heal/re-engage proof remains tracked under `QA-20260529-004`.
3. No live GP burn or AP-for-GP exchange happened organically in this window; controlled exchange remains proven by S3b, ordinary emergence remains open.
4. Trade completion/cancel did not recur in this window even though earlier CQA4 named trade proof remains strong.

## Next best follow-up

Run a focused ordinary AP/GP exchange soak:

1. Pick a named resident with real coin item `995`.
2. Prompt or guide them into an AP-for-GP exchange.
3. Require linked evidence: `city_gold_observed` -> `city_gold_burn` -> `city_ap_gp_exchange` -> visible dashboard event.

If no resident naturally holds GP, seed the resident with GP for the soak, but label the proof as seeded rather than ordinary.
