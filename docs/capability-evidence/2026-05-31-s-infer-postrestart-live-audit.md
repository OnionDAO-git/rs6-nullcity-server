# S-INFER-POSTRESTART-LIVE-AUDIT (2026-05-31)

## Scope

Packet: `S-INFER-POSTRESTART-LIVE-AUDIT`  
Lane: `INFER`  
Goal: make the live inference-health readout honest after restart so "usable brain" does not get inflated by non-LLM control ticks.

## Live finding from restart window

The first post-restart audit window surfaced two root causes:

1. `inference-health-audit` counted control-flow `decision` rows (`budget_exhausted:pause`, `hook_noop`, `body_wait`, `follow_listen_hold`, etc.) as brain decisions, which inflated the "clean" bucket.
2. The default per-resident daily inference budget (`2000`) was too low for the current weekend all-day loop and caused midday budget exhaustion for active residents.

After the audit was made honest and the daily cap was raised, the next live window was more useful and more worrying: heroes were no longer blocked by `budget_exhausted:pause`, but their model-bearing decisions were still all empty fallbacks.

Corrected artifact: `data/benchmarks/capability-qa-2026-05-31/inference-audit/inference_health_audit_20260531T190834Z.json`

Key numbers:

| Metric | Result |
|---|---:|
| Active residents | 23 |
| Brain-eligible decisions | 84 |
| Usable brain decision rate | 0.0% |
| Clean/recovered decisions | 0 |
| Empty fallback decisions | 84 |
| Dominant cause | `empty_completion_idle_initiative` |
| Goals emitted | 12 |
| Goal-attributed actions | 196 / 387 |
| Goal follow-through rate | 50.6% |

Top affected residents in that window were the authored heroes: `res:duke-horacio`, `res:hans`, `res:mother-anvil`, `res:thrand`, `res:wise-old-man`, `res:father-aereck`, `res:wren-calix`, `res:pip`, `res:the-hush`, and `res:severn-vesta`. That matches the visible demo symptom: heroes stay alive and speak via deterministic fallback/cadence, while the LLM channel is not producing usable plan text.

The same run also exposed runtime pressure after the smoke/audit sequence: the foreground controller session exited after repeated `Gateway socket closed`, `Gateway socket is not open`, `Gateway action queue timed out: submit_action`, and `Gateway request timed out: list_residents` errors. Game and infra were still running, but the controller itself was not a stable long-run owner in this exact window.

Goal-follow-through benchmark note: `data/benchmarks/bench_20260531185745_goal_follow_through_5m.json` timed out with score `0`. It did record early motion (`selectedModuleActions=2`, `selectedModuleInferences=1`, `meaningfulProgressTicks=6`, `stuckProgressTicks=0`), but cleanup also timed out on resident disconnect/delete. Treat this as live-stack instability plus weak goal proof, not a passing intelligence result.

## Fixes landed

- `src/controller/admin/inference-health-audit.ts`
  - Added `isInferenceDecision(...)` filter so only inference-bearing decisions are counted (`promptHash`/`completionHash`, `brain_*`, `completion_*`, `empty_completion*`, or known inference causes).
  - Reclassified `empty_completion_idle_initiative` as `truly_empty` (conservative telemetry) instead of `clean`.
  - Mapped `brain_timeout_fallback` into `thinking_cancelled`.
- `src/controller/admin/inference-health-audit.test.ts`
  - Added coverage proving control decisions are excluded from `brainEligibleDecisions`.
  - Added classification assertions for `brain_timeout_fallback` and `empty_completion_idle_initiative`.
- `src/controller/llm/budgets.ts`
  - Raised `defaultInferenceBudget().maxRequestsPerDay` from `2000` to `10000`.
- `src/controller/llm/budgets.test.ts`
  - Added guard test for the new default budget tuple.

## Verification

- `npm test -- --runInBand src/controller/admin/inference-health-audit.test.ts src/controller/llm/budgets.test.ts` (PASS)
- `npm run check:no-ui` (PASS)
- `npm run build` (PASS)
- `npm run fin` (FAIL once in the parallel Jest sweep: `src/controller/resident-runtime.test.ts` expected the gateway `action_result` failure to beat movement timeout)
- `npm test -- --runInBand src/controller/resident-runtime.test.ts -t "matches gateway action_result failures"` (PASS)
- `npm test -- --runInBand src/controller/resident-runtime.test.ts` (PASS, 78/78)
- `npm run test:fin -- --runInBand` (PASS, 3444/3444)

The `fin` failure is a concurrency-sensitive test flake or order/timing issue in `resident-runtime.test.ts`, not a deterministic failure in the inference-audit or budget changes. It remains relevant to runtime health because the live controller also showed gateway socket/action-queue pressure during this packet; follow-up should isolate action-result race behavior rather than hiding it.

## Interpretation

This packet improves audit correctness and budget headroom. It also proves the current local-Qwen hero channel is not healthy enough to call "smart" in live authored-resident windows: the budget cap was a real blocker, but after removing it the model still returned empty completions for every brain-eligible hero decision in the sampled window.

Next best packet: run a small capped hero-only A/B on a paid smarter model profile, or fix the prompt/schema path that causes empty local-Qwen completions. Do not spend more effort on AP/GP recurrence until the hero brain channel has a non-empty baseline, because deterministic SPARK routines already prove many body capabilities while the user-facing "soul intelligence" remains the demo risk.
