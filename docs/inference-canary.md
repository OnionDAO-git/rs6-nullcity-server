# Inference Canary

Null City keeps the proven inference route as `default` and adds named canary endpoints for last-minute model experiments. The tracked canary config lives at `config/controller.inference-canary.yml`.

## Endpoints

- `default`: `http://inf.nullcity.ai:1234`, model `qwopus3.5-27b-v3@q4_k_s`, timeout `75000`.
- `spacetower_qwopus_q4`: `http://spacetower.nullcity.ai:8100`, model `qwopus3.5-27b-v3@q4_k_s`.

Do not assume cross-loaded model combinations exist on both machines. As of 2026-05-31, Qwen is non-serving on both owned boxes; do not repoint `default` or a soul endpoint to Qwen until Dev confirms it serves again.

## Safe Default

Do not move the demo heroes away from the `default` qwopus route right before a team demo. The baseline `default` stays stable for `res:agent` and named public heroes. Synthetic QA residents `res:qa-scout` and `res:qa-forager` can still be pinned to named canary endpoints, so operators can compare behavior without putting noisy test residents on public wall/library surfaces.

## Quick Probe

Run a health probe against the default and qwopus canary endpoints:

```bash
npm run inference:canary -- --config config/controller.inference-canary.yml
```

Probe all configured combinations:

```bash
npm run inference:canary -- --config config/controller.inference-canary.yml --all
```

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
