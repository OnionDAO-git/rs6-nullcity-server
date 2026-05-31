# QA-20260530-024 — letters health timeout guard

## Why

`scripts/post-restart-smoke.sh` and dashboard checks should never block behind the full
LLM endpoint timeout. The letters `/v1/health` route was awaiting the real inference
canary inline, while the default endpoint timeout in `controller.yml` is 60s.

## Change

- Added `DEFAULT_HEALTH_TIMEOUT_MS = 4_000`.
- Added `healthTimeoutMs` to `startLettersHttpServer`.
- `/v1/health` now races the configured health probe against that deadline and returns
  `503` with `inference.status = "health_timeout"` if the probe never settles.
- Production wiring passes the same timeout to `runInferenceHealthProbe`, so the live
  fetch is aborted instead of continuing for the endpoint's normal long timeout.

## Red / Green

- RED: `npm test -- --runInBand src/controller/letters/letters-http-server.test.ts -t "returns quickly when the health probe never settles"`
  - Failed before implementation because `healthTimeoutMs` did not exist on `LettersHttpServerOptions`.
- GREEN: same command passed after implementation.
  - New regression returned in 27ms with a never-settling probe and status `503`.

## Verification

- `npm test -- --runInBand src/controller/letters/letters-http-server.test.ts src/controller/llm/inference-health.test.ts`
  - PASS: 64/64 tests.
- `npm run check:no-ui`
  - PASS: server UI boundary clean.
- `npm run typecheck`
  - PASS.
- `npm run build`
  - PASS: 803 files compiled.

## Live Stack

Controlled controller restart:

```bash
screen -dmS nullcity-controller bash -lc 'cd /Users/james/Code/OnionDAO/rs6-nullcity-server && node dist/controller/index.js --config=/Users/james/Code/OnionDAO/rs6-nullcity-server/controller.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact --city-http-port=43611 --city-http-token=operator-token 2>&1 | tee /tmp/nullcity-controller-demo.log'
```

Health route after restart:

```text
{"ok":false,"controller":"ok","inference":{"ok":false,"status":"error","endpoint":"default","model":"qwen/qwen3.6-27b","latencyMs":4010,"error":"The operation was aborted due to timeout"}}
HTTP_STATUS=503 TIME_TOTAL=4.072018
```

Post-restart smoke:

```text
READY
all 23 residents alive
all 23 residents had recent trajectory activity
```

Controller smoke:

```text
npm run controller:smoke -- --observe-seconds 30 --allow-recent-visible
23/23 residents OK
notable residual timeouts: res:agent 1, res:qa-trader 1, res:qa-survivor 2, res:qa-forager 1, res:severn-vesta 1
```

Dashboard BFF:

```text
GET http://127.0.0.1:5174/api/overview
residents=23 online=23
```

## Follow-up

The route no longer hangs. The inference canary itself is still timing out against the
current default endpoint, so a later packet should separate cheap HTTP liveness from
model-quality health if operators want a green `/v1/health` even when the model is slow.
