# Inference Canary

Null City keeps the currently serving owned inference route as `default` and adds named canary endpoints for last-minute model experiments. The tracked canary config lives at `config/controller.inference-canary.yml`.

## Endpoints

- `default`: `http://spacetower.nullcity.ai:8100`, model `qwopus3.5-27b-v3`, timeout `240000`, `forceThinking: false`, `maxTokens: 512`.
- `spacetower_qwopus_q4`: `http://spacetower.nullcity.ai:8100`, model `qwopus3.5-27b-v3`, `forceThinking: false`, `maxTokens: 512`.
- `inf_qwopus_q4`: `http://inf.nullcity.ai:1234`, model `qwopus3.5-27b-v3`, timeout `240000`, `forceThinking: false`, `maxTokens: 512`; kept for explicit diagnostics and load comparison.

Do not assume cross-loaded model combinations exist on both machines. Probe the exact model id you plan to use, and make the probe representative. On 2026-05-31, `qwopus3.5-27b-v3@q4_k_s` accepted small and roughly 3K-token bounded JSON probes on both owned boxes, but deploying that exact id to the live controller produced repeated `400 Bad Request` failures on full resident prompts. The unsuffixed `qwopus3.5-27b-v3` alias is slower on Spacetower, but it is the robust live route until a full-envelope resident canary proves the exact id safe. Qwen is serving on `inf.nullcity.ai:1234` but remains a benchmark route, not the live default.

The `forceThinking: false` and `maxTokens: 512` values are endpoint compatibility guards, not SOUL design changes. Direct probes on 2026-05-31 showed q4 serves resident-sized prompts quickly with those guards; the client caps oversized resident requests at the endpoint ceiling.

## Safe Default

Do not move the demo heroes away from the `default` qwopus route right before a team demo. The baseline `default` stays stable for `res:agent` and named public heroes. Synthetic QA residents `res:qa-scout` and `res:qa-forager` can still be pinned to named canary endpoints, so operators can compare behavior without putting noisy test residents on public wall/library surfaces.

## Quick Probe

Run a health probe against the default serving endpoint:

```bash
npm run inference:canary -- --config config/controller.inference-canary.yml --endpoint default
```

Probe all configured combinations:

```bash
npm run inference:canary -- --config config/controller.inference-canary.yml --all
```

`--all` is useful diagnostic evidence. A failure usually means a model id, host, or serving alias drifted; do not move live residents between machines without a fresh bounded probe.

JSON output for notes or comparison scripts:

```bash
npm run inference:canary -- --config config/controller.inference-canary.yml --all --json
```

## Live Resident Experiment

Use the tracked canary config when starting a comparison controller:

```bash
npm run build
node dist/controller/index.js --config=config/controller.inference-canary.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact
```

Then watch:

- `res:qa-scout` and `res:qa-forager` for `spacetower_qwopus_q4`.
- Nearby baseline QA residents such as `res:qa-guide`, `res:qa-banker`, or `res:qa-trader` for `default`.

Compare timeout/noop rate, action diversity, useful speech, stuck recovery, and whether the resident appears more human to a viewer.
