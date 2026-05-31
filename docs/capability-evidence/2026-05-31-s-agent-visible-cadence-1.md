# S-AGENT-VISIBLE-CADENCE-1

Date: 2026-05-31

Issue: `QA-20260529-006`

## Problem

`S-STUCK-ATTRIB-1` made the remaining stuck churn attributable by resident, and `res:agent` was one of the top offenders in the fresh normal-life window (`119` detected stuck moments). The social and trader slices then gained explicit visible keepalives and progress accounting, but the operator-facing Agent resident could still drift into generic stuck/no-visible recovery loops without saying the most useful human-facing status line.

## Change

- Added a `res:agent`-only `agent_keepalive` action for stuck windows with no visible tester/player nearby.
- The cadence respects return-to-anchor work, active moves, and visible players so it does not interrupt actual navigation or a live operator.
- The first stuck observation primes `lastAgentKeepaliveTick` instead of immediately speaking, which preserves ordinary stuck recovery and direct status behavior at the stuck boundary.
- Successful `agent_keepalive` speech now counts as explicit visible progress through `visible_say:agent_keepalive`, updating runtime progress and clearing lingering stuck state.
- `normal-life-audit` now tracks `agent_keepalive` alongside the other high-signal causes.

## Tests

Focused and expanded regression coverage:

```bash
npm test -- --runTestsByPath src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/resident-runtime.test.ts --runInBand --testNamePattern "agent_keepalive|res:agent announce|res:agent keepalive|visible runtime progress" --coverage=false
npm test -- --runTestsByPath src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/resident-runtime.test.ts src/controller/admin/normal-life-audit.test.ts --runInBand --coverage=false
npm run check:no-ui
npm run typecheck
npm run build
```

Results before handoff:

- Focused keepalive/progress tests passed.
- Expanded thinking/runtime/audit suites passed: `3` suites, `361/361` tests.
- `check:no-ui`: passed.
- `typecheck`: passed.
- `build`: passed (`825` files compiled with swc).

## Live Proof

Targeted `res:agent` smoke on the running controller observed the new visible status line within 90 seconds:

```bash
npm run controller:smoke -- --resident res:agent --observe-seconds 90 --allow-recent-visible
```

Result:

- Exit `0`.
- `observed=90000ms/+54t`.
- `success=1`, `says=1`.
- Last say: `Agent online. No tester visible. Say "agent status" or "agent help" to check my goal, location, and next step.`

Trajectory/progress evidence in `data/controller/memory/res-agent/evidence` shows successful visible speech becoming progress:

- `progress/20260531T124817Z-local-43087-res-agent-1780231697028.jsonl`: `visible_say:agent_keepalive` at `2026-05-31T12:49:08.829Z`, `12:53:39.097Z`, `12:54:30.845Z`, `12:55:22.625Z`, `12:56:13.781Z`, and `12:57:06.154Z`.
- `trajectory/20260531T124817Z-local-43087-res-agent-1780231697028.jsonl`: matching `agent_keepalive` decisions and `say` actions with the operator status line.

Normal-life audit proof:

- Artifact: `data/benchmarks/capability-qa-2026-05-31/s-agent-visible-cadence-1/normal_life_audit_20260531T125336Z.json`.
- Window: `2026-05-31T12:48:16.000Z..2026-05-31T12:53:36.000Z`.
- Activity: `23` residents, `332/332` successful action submissions, `100%` action success.
- `trackedCauseCounts.agent_keepalive=1`.
- `stuckSummary`: `21` detected, `10` recovered, `11` unresolved.
- `res:agent`: `3` detected, `2` recovered, `1` unresolved, `churn=5`.

A follow-up 10-minute audit over the same live session captured more cadence:

- Artifact: `data/benchmarks/capability-qa-2026-05-31/s-agent-visible-cadence-1/normal_life_audit_20260531T130330Z.json`.
- Activity: `23` residents, `1170/1170` successful action submissions.
- `trackedCauseCounts.agent_keepalive=7`.
- `res:agent`: `11` detected, `9` recovered, `2` unresolved, `churn=20`.

Latest rerun on the same stack (this handoff cycle):

- `npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible` observed the new `res:agent` status line twice (`says=2`, `success=2`) and reported `OK res:agent`.
- The all-resident smoke command still exited `1` for two unrelated warnings: `res:qa-forager` timeout-heavy movement and `res:the-hush` inert `budget_exhausted:pause`.
- `npm run controller:normal-life-audit -- --duration-ms=600000 --top=12 --output-dir data/benchmarks/capability-qa-2026-05-31/s-agent-visible-cadence-1` produced `normal_life_audit_20260531T130535Z.json` with `23` residents, `1183/1183` successful actions, and `trackedCauseCounts.agent_keepalive=7` (`res:agent` slice `9` action attempts, `agent_keepalive=7`).

After the cadence boundary fix, the stack was rebuilt and restarted onto the configured controller command. `scripts/post-restart-smoke.sh --no-color` returned `READY WITH WARNINGS (1 yellow)` with infra, Library, wall redaction, resident registry, and patron checks green; the only warning was fresh-window action activity for `res:agent`. A final targeted smoke attempt was aborted by a game-gateway wedge, not by an Agent assertion failure. Runtime state after the rebuilt controller had already recorded `lastBodyActionKey=agent_keepalive`.

## Caveat

This packet improves visibility and progress accounting for the Agent resident; it does not eliminate all stuck churn. The 10-minute audit still shows `res:agent` as noisy, and the final gateway wedge points to a separate game-server tick/gateway saturation problem. The next confidence bump is a clean post-restart Agent cadence soak after server tick-budget work, plus continued reductions for hero/trader/social idle cadence without hiding true blocked routes.
