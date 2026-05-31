# QA-LIVE-DRESS-3 clean post-S-NCRI smoke

Date: 2026-05-30 CDT

## Verdict

READY for the current hot stack smoke target.

This pass ran after:

- `4faff47a` NCRI redemption/print-queue contract
- `b89d1bea` fast queued `submit_action` ACK
- `ba324d1c` status SHA update

## Commands and Results

`bash scripts/post-restart-smoke.sh`

- Result: READY
- Controller alive.
- Letters fallback OK (`v1/inbox` responded while `v1/health` was slow/unavailable).
- Wall snapshot redaction green.
- 23/23 residents alive.
- Hero attention floors green.
- Library index green for all residents.
- Recent activity green for all 23 residents in the last 5 minutes.

`npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible`

- Result: PASS (exit 0).
- 23/23 residents OK.
- Heroes spoke and acted in-window.
- QA residents ticked after the post-restart reset (`+100t` for the QA cohort).
- Notable residual warnings are action-effect timeouts, not gateway request starvation:
  - `res:agent`: 1 timeout, still moved successfully.
  - `res:pip`: 2 timeouts, still moved/spoke.
  - `res:qa-survivor`: 3 timeouts around combat/survival movement.
  - `res:severn-vesta`: 2 timeouts, still moved/spoke.

Dashboard/API probes:

- `curl http://127.0.0.1:5174/api/overview`: 23 residents, 23 online, readiness `ok`.
- Readiness checks: gateway `ok`, controller data `25 resident runtimes visible`, resident cohort `23 online of 23 known residents`, souls `23`, patrons `20`, letters `12`.
- `curl http://127.0.0.1:43611/api/nullcity/economy/heartbeat`: responded; payload shape reports `residentCount: 25`.

Gateway log scan:

- After the rebuilt gateway listener came up, no new `AgentGateway slow message kind=submit_action`, `Gateway request timed out: submit_action`, or `Gateway action queue timed out` lines appeared in the sampled log window.
- The repeated listener timestamps before `00:23Z` were from nodemon restarts caused by active S-NCRI source edits and the final build. After the clean smoke window the stack had one listener on `127.0.0.1:43595`.

## Follow-Ups

1. Investigate action-effect timeouts separately from gateway ACK latency. The fast ACK fix appears to remove the controller request starvation layer; the remaining timeouts are game-effect waits.
2. Keep an eye on `v1/health` latency. The fallback path is demo-safe, but the health route still sometimes responds slowly.
3. Consider narrowing nodemon watches away from test files during live weekend work. Source/test edits restarted the game gateway several times during QA-LIVE-DRESS-3 setup.
