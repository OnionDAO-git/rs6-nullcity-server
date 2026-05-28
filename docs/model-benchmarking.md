# Model Benchmarking

Null City can already assign different inference profiles to different residents. This note captures the post-demo model benchmarking plan without storing secrets in source.

Latest first-pass results:

- `docs/model-benchmark-results-2026-05-27.md` - endpoint canary capacity plus first owned-hardware resident runs.
- `docs/model-intelligence-benchmark-results-2026-05-27.md` - paid/local intelligence comparison, active resident cap recommendation, and next experiment design.

## What Works Today

- Owned hardware profiles are configured in `controller.yml`: `default`, `spacetower_qwopus_q4`, `spacetower_qwen`, and `inf_qwopus_q4`.
- `res:qa-scout` and `res:qa-forager` already opt into `spacetower_qwopus_q4` in their SOUL files.
- A resident chooses an inference endpoint with SOUL frontmatter:

```yaml
model:
  endpoint: spacetower_qwopus_q4
```

- The controller can call OpenAI-compatible APIs with `baseUrl`, `model`, and `apiKey`.
- `config/controller.model-benchmark.yml` adds a tracked benchmark config for owned hardware plus OpenRouter profiles.

## Secrets

Do not commit real keys. Copy `.env.example` to `.env.local`, fill in local values, and source it before benchmark runs:

```bash
cp .env.example .env.local
# edit .env.local locally
set -a; source .env.local; set +a
```

The pasted Anthropic key should live only in `.env.local` as `ANTHROPIC_API_KEY`. The controller does not yet call Anthropic's native API directly; that needs a provider adapter because Anthropic uses a different HTTP shape from OpenAI-compatible `/v1/chat/completions`.

## Quick Health Checks

Run all configured benchmark profiles:

```bash
set -a; source .env.local; set +a
npm run inference:canary -- --config config/controller.model-benchmark.yml --all
```

Run only owned hardware:

```bash
npm run inference:canary -- --config config/controller.model-benchmark.yml \
  --endpoints inf_qwen,inf_qwopus_q4,spacetower_qwen,spacetower_qwopus_q4
```

Run OpenRouter profiles after setting `OPENROUTER_API_KEY`:

```bash
set -a; source .env.local; set +a
npm run inference:canary -- --config config/controller.model-benchmark.yml \
  --endpoints openrouter_haiku,openrouter_storyteller
```

## Benchmark Questions

For each URL/model combination, measure:

- latency and timeout rate
- empty/invalid completion rate
- successful action rate
- meaningful progress rate
- stuck recovery quality
- useful speech rate
- task completion score
- token use and cost when the provider returns usage

Use QA residents first. Keep hero/demo residents on the stable default until a model proves it improves live behavior.

## Recommended Next Implementation

Add a compatibility-safe `llm.models` layer so endpoints and models are separate concepts:

```yaml
llm:
  endpoints:
    spacetower:
      provider: openai-compatible
      baseUrl: http://spacetower.nullcity.ai:8100
    openrouter:
      provider: openai-compatible
      baseUrl: https://openrouter.ai/api
      apiKey: ${OPENROUTER_API_KEY}
  models:
    spacetower-qwopus:
      endpoint: spacetower
      model: qwopus3.5-27b-v3@q4_k_s
    storyteller:
      endpoint: openrouter
      model: ${OPENROUTER_STORYTELLER_MODEL}
```

Then allow residents to use:

```yaml
model:
  profile: spacetower-qwopus
```

Keep the old `model.endpoint` path working while the benchmark layer migrates.

## Storyteller

The storyteller should not be a normal resident body loop. It should periodically read recent Library timelines, wall letters, deaths/revivals, patron events, and current resident goals, then produce a human-facing city status update. It should use a smarter/slower profile like `openrouter_storyteller`, not the default resident action model.
