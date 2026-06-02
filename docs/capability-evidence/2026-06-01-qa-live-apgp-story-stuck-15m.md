# QA Live AP/GP Story/Stuck 15m

Date: 2026-06-01 CDT / 2026-06-02 UTC

Packet: `QA-LIVE-APGP-STORY-STUCK-15M`

## TL;DR

- Live residents were active in this window: `10` residents submitted `637/637` actions successfully over 15 minutes.
- The same window had no organic AP/GP exchange, trade closure, combat, XP, level-up, death, or logout events.
- The Storyteller dry-run over the same window reported `17/17` active residents and included stale/test residents, so its current health summary can overstate who is really alive.

## Commands Run

```bash
npm run controller:smoke -- --observe-seconds 90 --allow-recent-visible

npm run controller:normal-life-audit -- \
  --start 2026-06-02T02:56:26Z \
  --end 2026-06-02T03:11:26Z \
  --output-dir data/benchmarks/capability-qa-2026-06-02/qa-live-apgp-story-stuck-15m-20260602T031126Z \
  --top 10

npm run storyteller:dry-run -- \
  --memory-root data/controller/memory \
  --since 2026-06-02T02:56:26Z \
  --until 2026-06-02T03:11:26Z \
  --digest-id qa-live-apgp-story-stuck-15m-20260602T031126Z \
  --output-dir data/controller/storyteller

env -u STORYTELLER_LLM_BASE_URL -u STORYTELLER_LLM_API_KEY -u STORYTELLER_LLM_MODEL \
  npm run storyteller:run -- \
  --digest-id qa-live-apgp-story-stuck-15m-20260602T031126Z \
  --output-dir data/controller/storyteller
```

## Evidence

| Check | Result | Notes |
|---|---:|---|
| `controller:smoke` 90s | `9 OK / 1 WARN` | `res:qa-social` warned for no recent/observed visible activity; other sampled residents moved/spoke/submitted successful actions. |
| Normal-life active residents | `10` | Artifact: `data/benchmarks/capability-qa-2026-06-02/qa-live-apgp-story-stuck-15m-20260602T031126Z/normal_life_audit_20260602T031126Z.json`. |
| Action submissions | `637/637` | `actionSuccessRate=100`; no failed submissions in the window. |
| Survival | Green | `deaths=0`, `logouts=0`, `lowHealthWaits=0`. |
| Starter survival loop | Active | `eat=23`, `interact=102`, `use_item_on=23`, `use_item_on_item=64`, `starter_fishing_net=24`, `starter_fishing_cook_catch=23`, `starter_fishing_eat_cooked_fish_for_space=23`. |
| AP/GP recurrence | Dormant | `economyEventsInWindow=0`, `apGpExchangeEvents=0`, `organicSelfInitiatedApGpExchangeEvents=0`; GP holders were far above the AP runway threshold, so no exchange was expected. |
| Trade recurrence | Dormant | `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`. |
| Combat / XP / levels | Dormant | `combatActions=0`, `xpEvents=0`, `levelUps=0`. |
| Stuck churn | Yellow | `stuckDetected=89`, `stuckRecovered=88`, `unresolved=1`; top churn: `res:qa-banker` 56, `res:qa-guardian` 42, `res:agent` 26, `res:qa-trader` 20, `res:hans` 18. |
| Storyteller dry-run | Truth gap | Digest artifact reports `systemHealth.totalResidents=17`, `activeResidents=17`, including stale/test residents not in the 10-resident controller cohort. |
| Storyteller model call | No paid call | `storyteller:run` was intentionally run with model env unset; `dispatch.json` has `needsReview=true` and `reviewReasons=["model call was nooped (unknown)"]`. |

## Storyteller Truth Gap

The dry-run digest listed these residents as active:

`res:agent`, `res:death-test`, `res:duke-horacio`, `res:father-aereck`, `res:hans`, `res:loop-check`, `res:mother-anvil`, `res:pip`, `res:restart-test`, `res:severn-vesta`, `res:smoke-born`, `res:the-hush`, `res:thrand`, `res:verify-born`, `res:wf-verify-born`, `res:wise-old-man`, `res:wren-calix`.

This conflicts with the live controller/normal-life evidence for the same window:

- Controller city heartbeat around the run reported `activeResidentCount=10`.
- Normal-life audit saw `activeResidents=10`.
- Several Storyteller-listed residents are known stale/test residents from event-day verification (`res:death-test`, `res:loop-check`, `res:smoke-born`, `res:verify-born`, `res:wf-verify-born`).

Issue registered: `QA-20260601-070`.

## Recommended Fix Packet

`S-STORY-ACTIVE-FILTER-1`:

- Teach the Storyteller digest builder to separate memory-known residents from live-active residents.
- Exclude residents with stale runtime/timeline activity from `systemHealth.activeResidents`.
- Filter obvious throwaway/test resident names from public active summaries unless they have current live evidence.
- Add regression coverage where stale born/test residents exist in memory but the digest active count follows current activity freshness.

Likely code paths from read-only sidecar review:

- `src/controller/storyteller/cli.ts` `buildResidentSnapshots(...)` seeds the digest with every `runtime-state.json` directory under `memoryRoot`.
- `src/controller/storyteller/cli.ts` `readRuntimeResidentSnapshots(...)` treats any persisted non-deceased runtime state as a resident snapshot.
- `src/controller/storyteller/digest-builder.ts` `buildDigest(...)` computes `systemHealth.activeResidents` as non-faded residents from those snapshots.
- `src/controller/storyteller/cli.ts` `isSyntheticResidentName(...)` only filters `res:qa-*` and `res:bmk_*`, so event-day test names such as `res:death-test` and `res:verify-born` remain eligible.
- `src/controller/city-integration/service.ts` `economyHeartbeat()` uses online runtime or recent economy-window activity, which is why the controller heartbeat can correctly report the smaller active cohort.

Recommended regression tests:

- CLI dry-run with stale `runtime-state.json` files and no in-window evidence should not count those residents as active.
- The stale/test names above should be absent from public active health summaries unless they have current evidence.
- A quiet but currently online resident should still be counted when the Storyteller is invoked from a context that supplies an explicit online set.

## Notes

This pass did not restart the controller and did not make paid model calls. It should be treated as a live QA observation, not a deploy verification of pending code fixes.
