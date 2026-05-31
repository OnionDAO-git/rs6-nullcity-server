# S-HEALTH-PROBE-QWOPUS-1 — qwopus health probe compatibility

## Why

The live controller had a confusing split-brain signal:

- `npm run controller:inference-audit` over `2026-05-31T22:18:02Z..22:48:02Z` reported `226/226` usable brain decisions and `86.3%` goal follow-through.
- `GET /v1/health` reported inference red with `LLM health probe failed: 400 Bad Request`.

That meant residents were thinking, but the operator health probe looked broken.

## Root Cause

The resident brain path sends an explicit completion ceiling (`max_tokens` and `max_completion_tokens`) for qwopus calls. The direct health probe hand-built its own tiny request without that ceiling. Both owned qwopus endpoints can reject the uncapped probe with `{"error":"Context size has been exceeded."}` even though normal bounded resident inference is healthy.

Boundary check on `2026-05-31`:

| Endpoint | Variant | Result |
| --- | --- | --- |
| `http://inf.nullcity.ai:1234` | JSON schema, no token ceiling | `400 Context size has been exceeded` |
| `http://inf.nullcity.ai:1234` | JSON schema, `max_tokens=128`, `max_completion_tokens=128` | `200 OK` |
| `http://spacetower.nullcity.ai:8100` | JSON schema, `max_tokens=128`, `max_completion_tokens=128` | `200 OK` |

## Fix

`src/controller/llm/inference-health.ts` now sends the direct probe with:

- `reasoning: { enabled: false }`
- `chat_template_kwargs: { enable_thinking: false }`
- `max_tokens: 128`
- `max_completion_tokens: 128`
- the existing JSON-schema response format

This keeps the probe small and provider-compatible without changing resident brain/body runtime behavior.

## Evidence

- Red test: `inference-health.test.ts` failed before the probe body included the 128-token ceilings.
- Green tests: `npm test -- --runInBand src/controller/llm/inference-health.test.ts src/controller/admin/inference-canary-smoke.test.ts` passed `16/16`.
- Source canary:
  - `npm run inference:canary -- --endpoints=default,spacetower_qwopus_q4 --timeout-ms=90000 --json`
  - `default`: `ok`, model `qwopus3.5-27b-v3@q4_k_s`, `899ms`, `52` prompt tokens, `25` completion tokens.
  - `spacetower_qwopus_q4`: `ok`, model `qwopus3.5-27b-v3@q4_k_s`, `507ms`, `52` prompt tokens, `25` completion tokens.
- Gates:
  - `npm run check:no-ui`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format -- src/controller/llm/inference-health.ts src/controller/llm/inference-health.test.ts`
  - `npm run build`

## Runtime Note

The already-running controller process still reports the old false-red `/v1/health` until it is rebuilt/restarted. Do the next controller restart once the active S-INFER-8 runtime lease is complete so this health-probe fix and the longer brain timeout deploy together.
