# S-INFER-8-DEPLOY-AUDIT-1 live deploy audit (2026-05-31)

## Scope

- Packet: `S-INFER-8-DEPLOY-AUDIT-1`
- Goal: deploy the S-INFER-8 generous brain-timeout/watchdog stack, verify the live owned-model route, and leave a restart-surviving config that does not melt resident inference.
- Runtime: rebuilt `dist`, restarted `screen:nullcity-controller-codex`, active controller PID `17392`, log `/tmp/nullcity-runtime/controller-20260531T232803Z.log`.

## Key finding

Initial deploy probes against the exact model id `qwopus3.5-27b-v3@q4_k_s` returned:

```text
{"error":"Context size has been exceeded."}
```

Follow-up bounded matrix probes showed the exact q4 id accepts both small and roughly 3K-token JSON prompts on both `spacetower.nullcity.ai:8100` and `inf.nullcity.ai:1234` when completions are capped, and it is much faster than the unsuffixed alias on Spacetower. A live-controller restart on the exact id then produced repeated `400 Bad Request` failures on full resident prompts, so the live q4 routes were reverted to the robust unsuffixed alias with `forceThinking: false` and `maxTokens: 512`. Exact q4 should not carry residents until a full-envelope resident canary proves it safe.

## Commands run

```bash
npm test -- --runInBand src/controller/llm/llm-client.test.ts src/controller/config.test.ts src/controller/admin/inference-canary-smoke.test.ts
npm run build
npm run inference:canary -- --config controller.yml --endpoint default --timeout-ms=90000 --json
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
npm run controller:inference-audit -- --duration-ms=120000 --output-dir data/benchmarks/capability-qa-2026-05-31/s-infer-8-deploy-audit-1
npm run check:no-ui
npm run typecheck
npm run fin
npm test -- --runInBand src/controller/letters/letters-http-server.test.ts src/controller/llm/inference-health.test.ts src/controller/llm/llm-client.test.ts src/controller/config.test.ts src/controller/admin/inference-canary-smoke.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/soul/soul-loader.test.ts
npm run controller:inference-audit -- --duration-ms=120000 --output-dir data/benchmarks/capability-qa-2026-05-31/s-infer-8-deploy-audit-1-post-final-restart
```

## Results

### Direct owned-server probes

- Initial `spacetower/qwopus3.5-27b-v3@q4_k_s` probe: `400 Context size has been exceeded`; follow-up 3K bounded probe: `200`, about `2.6s`; live full-prompt deploy then produced `44` controller LLM 400s within minutes.
- Initial `inf/qwopus3.5-27b-v3@q4_k_s` probe: `400 Context size has been exceeded`; follow-up 3K bounded probe: `200`, about `1.8s`.
- `spacetower/qwopus3.5-27b-v3` alias: `200` on resident-sized prompt, about `27.5s` in the later matrix.
- `inf/qwopus3.5-27b-v3` alias: `200` on small prompt, about `9.8s`.
- `inf/qwen/qwen3.6-27b`: `200` on resident-sized prompt, about `18.1s`.
- `inf/qwen/qwen3.6-35b-a3b`: `200` on resident-sized prompt, about `10.9s`.
- `inf/qwopus3.5-27b-v3@q8_0`: `200` on resident-sized prompt with thinking on, about `31.7s`.

### Canary

`npm run inference:canary -- --config controller.yml --endpoint default --timeout-ms=90000 --json`

- `ok=true`
- endpoint: `default`
- model: `qwopus3.5-27b-v3`
- latency: `20537ms`
- prompt tokens: `52`
- completion tokens: `25`

### Fresh controller log

`grep -c "LLM completion failed: 400" /tmp/nullcity-runtime/controller-20260531T232803Z.log`

- `0` LLM 400s after restart on the model alias.
- `2` `ECONTROL_REQUIRED` gateway errors appeared shortly after restart; this is separate from inference and should be watched under runtime/control ownership.

Final alias restart after the exact-id negative deploy: `/tmp/nullcity-runtime/controller-20260531T235110Z.log`

- `0` `LLM completion failed: 400`
- `0` `inference-alarm`
- `0` `ECONTROL_REQUIRED`
- `/v1/health`: `ok=true`, model `qwopus3.5-27b-v3`, latest observed latency `5223ms`

### Smoke (60s)

`npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible`

- `9/10` active residents were `OK`.
- `res:qa-social` was the only `WARN` in the 60s window (`no_recent_visible_activity/no_observed_visible_activity`).
- Successful visible work included woodcutting/firemaking, fishing/cooking, movement, trade-route movement, combat movement/loot pickup, and speech.

### Inference health (fresh 2m window)

Artifact: `data/benchmarks/capability-qa-2026-05-31/s-infer-8-deploy-audit-1/inference_health_audit_20260531T233026Z.json`

- Window: `2026-05-31T23:28:26.273Z` to `2026-05-31T23:30:26.273Z`
- Residents: `9`
- Brain-eligible decisions: `29`
- Usable brain rate: `100.0%`
- Breakdown: `clean=29`, `recovered=0`, `think_only_no_answer=0`, `thinking_cancelled=0`, `schema_mismatch=0`, `truly_empty=0`
- Planning: `goalsEmitted=10`, `goal-follow-through=98.3%` (`117/119` actions)

### Inference health after final alias restart

Artifact: `data/benchmarks/capability-qa-2026-05-31/s-infer-8-deploy-audit-1-post-final-restart/inference_health_audit_20260531T235501Z.json`

- Window: `2026-05-31T23:53:01.948Z` to `2026-05-31T23:55:01.948Z`
- Residents: `10`
- Brain-eligible decisions: `29`
- Usable brain rate: `96.5%`
- Breakdown: `clean=28`, `recovered=0`, `think_only_no_answer=0`, `thinking_cancelled=1`, `schema_mismatch=0`, `truly_empty=0`
- Planning: `goalsEmitted=11`, `goal-follow-through=97.1%` (`99/102` actions)
- 60s smoke after final alias restart still exited non-zero, but the failures were behavioral: `res:qa-banker` had one `move_to` effect timeout and `res:qa-social` sat in `follow_listen_hold`; the same window showed `res:agent` completed `city_exchange_ap_gp` successfully.

## Code/config changes

- `LlmEndpointConfig.forceThinking?: boolean` lets a hardware endpoint override a resident's requested thinking mode when the model server cannot serve thinking prompts.
- Endpoint `maxTokens` now acts as a hard compatibility ceiling when a request asks for more.
- `/v1/health` timeout was raised from `4s` to `30s`; the robust alias can take 20s+ for a tiny health probe, so the old route produced false-red dashboard health while the canary and residents were working.
- `config/controller.inference-canary.yml` uses the robust alias `qwopus3.5-27b-v3` and records `forceThinking: false`, `maxTokens: 512`.
- Live `controller.yml` was updated the same way for the q4 default/body routes; `brain_q8` remains `qwopus3.5-27b-v3@q8_0`.

## Verification gates

- Focused tests: `42/42` passed.
- Focused post-health tests: `438/438` passed.
- `npm run build`: passed, `847` files compiled.
- `npm run check:no-ui`: passed.
- `npm run typecheck`: passed.
- `npm run fin`: passed, `244/244` suites and `3497/3497` tests.

## Interpretation

The inference path is no longer the active blocker. The fresh post-restart window shows clean brain output and no LLM 400s. The important follow-ups are behavioral/runtime, not parser-timeout triage:

- Fix or re-audit `res:qa-social` quiet windows.
- Watch the `ECONTROL_REQUIRED` gateway control errors.
- Run a longer 20-30m audit after this config has been stable for a quiet window.
