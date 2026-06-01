# S-APGP-STORY-LIVE-DIGEST-QA-1 - live AP/GP event into Storyteller digest

Date: 2026-05-31  
Lane: QA / AP-GP / Storyteller  
Result: Strong positive proof for ordinary AP-for-GP recurrence and grounded no-paid Storyteller dispatch; follow-ups remain for trade closure and action-watchdog noise.

## Why This Packet Ran

After the weekend AP/GP loop work, the important question was whether a normal running city window produces narratable AP/GP evidence without a directed admin drain or benchmark harness. This packet sampled the live 10-resident controller cohort, then built a Storyteller digest from the exact same time window.

## Commands

```bash
npm run controller:normal-life-audit -- \
  --duration-ms=900000 \
  --top=20 \
  --output-dir data/benchmarks/capability-qa-2026-05-31/s-apgp-story-live-digest-qa-1
```

Artifact:

```text
data/benchmarks/capability-qa-2026-05-31/s-apgp-story-live-digest-qa-1/normal_life_audit_20260531T230036Z.json
```

```bash
npm run storyteller:dry-run -- \
  --memory-root data/controller/memory \
  --since 2026-05-31T22:45:36.121Z \
  --until 2026-05-31T23:00:36.121Z \
  --digest-id s-apgp-story-live-digest-qa-1 \
  --output-dir data/controller/storyteller
```

```bash
npm run storyteller:run -- \
  --digest-id s-apgp-story-live-digest-qa-1 \
  --output-dir data/controller/storyteller
```

```bash
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
npm run check:no-ui
```

## Live Audit Findings

Window: `2026-05-31T22:45:36.121Z` to `2026-05-31T23:00:36.121Z`

| Measure | Result |
|---|---:|
| Active residents | 10 |
| Action attempts | 712 |
| Successful submissions | 712 |
| Action success rate | 100% |
| AP/GP exchange actions | 1 |
| AP/GP exchange events | 1 |
| Self-initiated AP/GP exchanges | 1 |
| Controlled AP/GP exchanges | 0 |
| Organic self-initiated AP/GP exchanges | 1 |
| Combat safe attacks | 14 |
| Combat resupply actions | 32 |
| Cooking actions | 69 |
| Eating actions | 11 |
| Loot pickups | 7 |
| Bone burials | 7 |
| Deaths / logouts / low-health waits | 0 / 0 / 0 |
| XP / level-up events in this 15m window | 0 / 0 |
| Trade requests / completions | 0 / 0 |
| Stuck detected / recovered / unresolved | 113 / 114 / 0 |

The core AP/GP event was:

```text
res:agent exchanged 250 GP for 500 AP
refId=apgp:res:agent:self-ap-gp:res:agent:9076
cityUserId=resident:self
```

That is real GP item `995` evidence flowing through the AP-for-GP exchange path, not a separate city-only GP ledger.

## Storyteller Digest Findings

Artifacts:

```text
data/controller/storyteller/s-apgp-story-live-digest-qa-1/digest.json
data/controller/storyteller/s-apgp-story-live-digest-qa-1/summary.txt
data/controller/storyteller/s-apgp-story-live-digest-qa-1/dispatch.json
```

The dry-run operator summary extracted the AP/GP exchange as the top high-importance event and also included recent stuck recoveries and visible resident speech.

The no-paid `storyteller:run` fallback generated:

```text
Null City Dispatch: AP and GP changed hands
11/11 residents active, 0 low on attention. res:agent: exchanged 250 GP for 500 AP ...
```

This proves the Storyteller path can ground a human-facing update in live AP/GP evidence. It does not prove final voice quality, because no `STORYTELLER_LLM_BASE_URL` was configured. The dispatch correctly has `needsReview: true` and the review reason `model call was nooped (unknown)`.

## Smoke / Risk Notes

The 15-minute normal-life audit was healthy at the submission level, but the follow-up 60-second controller smoke exited nonzero with warnings around `cancelled_before_submit:action_watchdog_timeout`, `body_wait`, and one stale `effect_timeout` on `res:qa-banker`.

Interpretation: the residents are alive and making progress, but smoke still catches cadence/action-watchdog noise. Do not treat this as fully green long-run readiness until the S-INFER-8 timeout/watchdog bundle is deployed and re-audited.

## Capability Update

This packet raises AP/GP confidence because it proves an ordinary running window can produce an organic resident-initiated AP-for-GP exchange, and that the same event can feed Storyteller. It does not close:

- ordinary trade closure recurrence;
- true human/player trade proof;
- XP/level-up proof in this specific 15-minute window;
- stuck churn and action-watchdog noise;
- configured smarter-model Storyteller narration.

## Recommended Next

1. Deploy the S-INFER-8 runtime bundle once, then hold the controller quiet for a clean 25-60 minute inference and normal-life audit.
2. Run a true human/player or controlled visible-target trade proof after the restart.
3. Enable a capped Storyteller model profile for one reviewed run, then compare fallback digest vs model narration for operator trust.
