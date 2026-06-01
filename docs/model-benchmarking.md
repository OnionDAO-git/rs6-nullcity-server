# Model Benchmarking

Null City can already assign different inference profiles to different residents. This note captures the post-demo model benchmarking plan without storing secrets in source.

Latest first-pass results:

- `docs/model-benchmark-results-2026-05-27.md` - endpoint canary capacity plus first owned-hardware resident runs.
- `docs/model-intelligence-benchmark-results-2026-05-27.md` - paid/local intelligence comparison, active resident cap recommendation, and next experiment design.

## What Works Today

- Owned hardware profiles are configured in `controller.yml`: `default`/`inf_qwen` on `inf.nullcity.ai:1234` and `spacetower_qwopus_q4` on `spacetower.nullcity.ai:8100`.
- Benchmark config now separates hardware/provider endpoints from model profiles:
  - `llm.endpoints.<id>` = URL/provider/API key/response format.
  - `llm.profiles.<id>` = endpoint + model + timeout + optional price hints.
  - Profiles are also exposed through `llm.endpoints` for backward compatibility with existing SOUL `model.endpoint` references.
- `res:qa-scout` and `res:qa-forager` already opt into `spacetower_qwopus_q4` in their SOUL files.
- A resident chooses an inference endpoint with SOUL frontmatter:

```yaml
model:
  endpoint: spacetower_qwopus_q4
```

- The controller can call OpenAI-compatible APIs with `baseUrl`, `model`, and `apiKey`.
- `config/controller.model-benchmark.yml` adds a tracked benchmark config for owned hardware plus OpenRouter profiles.
- Benchmark artifacts include an `inference` object with profile id, endpoint id, provider, base URL, model, and optional pricing fields so later reports do not have to infer which machine/model was tested from run order.
- OpenAI-compatible health checks and resident calls can use either JSON-schema or text response formatting; OpenRouter-style `message.reasoning` responses and provider cost fields are now parsed when present.

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
  --endpoints inf_qwen,spacetower_qwopus_q4
```

Run OpenRouter profiles after setting `OPENROUTER_API_KEY`:

```bash
set -a; source .env.local; set +a
npm run inference:canary -- --config config/controller.model-benchmark.yml \
  --endpoints openrouter_haiku,openrouter_storyteller
```

## Report Raw Benchmark Artifacts

Generate a human-readable comparison table from any benchmark artifact directory:

```bash
npm run benchmark:report -- --input data/benchmarks/model-intelligence-paid-2026-05-27
```

The markdown report now groups rows by `profile + resident + endpoint + model + task + mode` and includes pass rate, average duration, token totals, estimated cost, and failure causes.

Use JSON output for spreadsheets or follow-up analysis:

```bash
npm run benchmark:report -- --input data/benchmarks/model-intelligence-paid-2026-05-27 --json
```

Older artifacts may only have `modelProfile`, so token and cost columns can be zero. New artifacts include `inference` metadata for profile, endpoint, provider, model, and optional pricing.

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

## Model Profile Config

Use `llm.profiles` for new benchmark configs:

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
      responseFormat: text
  profiles:
    spacetower_qwopus_q4:
      endpoint: spacetower
      model: qwopus3.5-27b-v3@q4_k_s
    openrouter_storyteller:
      endpoint: openrouter
      model: ${OPENROUTER_STORYTELLER_MODEL}
      timeoutMs: 90000
```

Existing residents still use:

```yaml
model:
  endpoint: spacetower_qwopus_q4
```

The profile id resolves to an endpoint-shaped entry at runtime, so old `model.endpoint` continues to work while benchmark reports get clean endpoint/model metadata.

## Still Needed To Finish Benchmarking

1. Add harder live benchmark tasks that are less SPARK-assisted:
   - high-level cooked-shrimp goal
   - low-health danger survival
   - stuck-door recovery
   - patron instruction conflict
   - memory route recall
2. Run 5-10 repetitions per profile per task.
3. Add Anthropic-native Messages API support for direct Anthropic keys.
4. Add a MiniMax adapter that limits or extracts reasoning-heavy outputs cleanly.
5. Run the report generator on every completed batch and attach the table to the benchmark results note.

## Storyteller

The storyteller should not be a normal resident body loop. It should periodically read recent Library timelines, wall letters, deaths/revivals, patron events, and current resident goals, then produce a human-facing city status update. It should use a smarter/slower profile like `openrouter_storyteller`, not the default resident action model.
