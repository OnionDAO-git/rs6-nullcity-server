# S-SOCIAL-KEEPALIVE-1 QA Social Idle Keepalive (2026-05-31)

Packet: `S-SOCIAL-KEEPALIVE-1`
Issue: `QA-20260531-049`
Run date: 2026-05-31

## Goal

Reduce `res:qa-social` stuck churn when no tester is visible. The latest stuck attribution audit put qa-social in the top offender set, and its action log showed repeated tiny `stuck_pre_inference_explore` probes while the social resident should have stayed findable and periodically announced how to interact with it.

## Evidence

- `data/benchmarks/capability-qa-2026-05-31/s-stuck-attrib-1/normal_life_audit_20260531T112003Z.json` reported `res:qa-social` at `63` stuck detections, `55` recoveries, `8` unresolved, and `118` churn.
- `data/controller/logs/res:qa-social/actions/2026-05-31.jsonl` showed repeated queued `move_to` actions with cause `stuck_pre_inference_explore` around the same Lumbridge tiles from `2026-05-31T10:13Z` through `2026-05-31T11:36Z`.
- `data/controller/memory/library/res-qa-social/timeline.jsonl` showed the matching `stuck_detected` / `stuck_recovered` cadence for the hot-stack sessions.

## Change

- `HybridAgentThinkingModule` now lets a due presence beacon beat stuck pre-inference recovery even when Brain is due.
- `socialKeepaliveAction` gives the `social` command-prefix resident a deterministic no-tester-visible `say` before generic stuck recovery, rate-limited by `lastSocialKeepaliveTick`.
- Ordinary stuck recovery remains active when the social keepalive is not due, so true blocked movement still probes locally.
- `RuntimeState.cognition` now persists `lastSocialKeepaliveTick`.
- Collateral gate fix: `orientation-scorer.test.ts` now casts two negative shape assertions to `Record<string, unknown>` so the committed S-GOAL-2 tests typecheck cleanly.

## Verification

- `npm test -- --runInBand src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "beacons a due active goal before stuck recovery|social QA resident announce capabilities|ordinary stuck recovery active when social keepalive is not due"` passed: `3/3`.
- `npm test -- --runInBand src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "social QA keepalive"` passed: `1/1`.
- `npm test -- --runInBand src/controller/thinking/hybrid-agent-thinking-module.test.ts` passed: `272/272`.
- `npm test -- --runInBand src/controller/spark/orientation-scorer.test.ts` passed: `22/22`.
- `npm run check:no-ui` passed.
- `npm run typecheck` passed.
- `npm run build` passed: `821` files compiled.

## Live Status

No controller restart was performed for this packet. The hot controller process stayed running, so live stuck-churn reduction remains pending a restart/load of the rebuilt code and a fresh 30-60 minute `normal-life-audit` comparison.
