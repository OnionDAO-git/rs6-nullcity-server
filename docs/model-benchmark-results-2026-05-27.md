# Model benchmark first pass - 2026-05-27

> Correction added 2026-05-28: Dev clarified that the owned machines did not have every cross-loaded model combination. Treat rows for `inf_qwopus_q4` and `spacetower_qwen` as invalid endpoint-specific evidence. The confirmed owned profiles are `inf_qwen` on `inf.nullcity.ai:1234` and `spacetower_qwopus_q4` on `spacetower.nullcity.ai:8100`. Later benchmark plumbing adds explicit endpoint/model metadata to prevent this ambiguity.

This pass separates two questions:

1. **Endpoint capacity:** how many simultaneous inference requests each URL/model can absorb before latency becomes demo-hostile.
2. **Resident intelligence:** whether identical live benchmark residents perform better when only the inference profile changes.

## Setup

- Branch: `agents/wip`
- Commit under test: working tree after the post-demo merge, before this report commit
- Config: `config/controller.model-benchmark.yml`
- Local services: `npm run start:infra` and `npm run start:game`
- Owned profiles tested:
  - `inf_qwen`: `http://inf.nullcity.ai:1234`, `qwen/qwen3.6-27b`
  - `inf_qwopus_q4`: invalid cross-load label; see correction above.
  - `spacetower_qwen`: invalid cross-load label; see correction above.
  - `spacetower_qwopus_q4`: `http://spacetower.nullcity.ai:8100`, `qwopus3.5-27b-v3@q4_k_s`

OpenRouter and Anthropic were not run in this pass because no `.env.local` was present. Keep keys outside source; source `.env.local` before paid-provider runs.

## Endpoint capacity result

Command family:

```bash
npm run inference:canary -- --config config/controller.model-benchmark.yml \
  --endpoints inf_qwen,spacetower_qwopus_q4 \
  --timeout-ms 90000
```

Then a bounded high-concurrency sweep used the same controller-shaped health request with thinking disabled and JSON-schema response formatting. Raw JSON artifacts are local-only under `data/benchmarks/`.

| Profile | URL | Model | C | OK | Median | P90 | Max |
|---|---|---|---:|---:|---:|---:|---:|
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 1 | 3/3 | 3.4s | 3.5s | 3.5s |
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 4 | 12/12 | 4.6s | 4.7s | 4.7s |
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 8 | 24/24 | 4.7s | 9.3s | 9.3s |
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 12 | 36/36 | 9.2s | 13.9s | 13.9s |
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 16 | 16/16 | 10.0s | 19.8s | 19.9s |
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 24 | 24/24 | 14.9s | 29.7s | 29.8s |
| inf_qwen | inf:1234 | qwen/qwen3.6-27b | 32 | 32/32 | 20.0s | 35.2s | 40.2s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 1 | 3/3 | 3.4s | 3.4s | 3.4s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 4 | 12/12 | 4.7s | 4.7s | 4.7s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 8 | 24/24 | 4.7s | 9.3s | 9.3s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 12 | 36/36 | 9.3s | 14.0s | 14.0s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 16 | 16/16 | 10.0s | 19.9s | 19.9s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 24 | 24/24 | 15.0s | 29.8s | 29.8s |
| spacetower_qwen | spacetower:8100 | qwen/qwen3.6-27b | 32 | 32/32 | 19.9s | 34.8s | 39.8s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 1 | 3/3 | 0.5s | 0.5s | 0.5s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 4 | 12/12 | 1.0s | 1.0s | 1.0s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 8 | 24/24 | 1.0s | 2.0s | 2.0s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 12 | 36/36 | 2.0s | 3.0s | 3.0s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 16 | 16/16 | 2.3s | 4.3s | 4.4s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 24 | 24/24 | 3.2s | 6.2s | 6.2s |
| inf_qwopus_q4 | inf:1234 | qwopus3.5-27b-v3@q4_k_s | 32 | 32/32 | 4.2s | 7.3s | 8.3s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 1 | 3/3 | 0.5s | 0.5s | 0.5s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 4 | 12/12 | 1.0s | 1.0s | 1.0s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 8 | 24/24 | 1.0s | 2.0s | 2.0s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 12 | 36/36 | 2.0s | 3.0s | 3.0s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 16 | 16/16 | 2.2s | 4.2s | 4.2s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 24 | 24/24 | 3.2s | 6.2s | 6.3s |
| spacetower_qwopus_q4 | spacetower:8100 | qwopus3.5-27b-v3@q4_k_s | 32 | 32/32 | 4.2s | 7.3s | 8.4s |

### Capacity interpretation

- Both URLs stayed healthy through 32 concurrent tiny controller-shaped requests.
- The **model** mattered much more than the URL in this pass. `inf` and `spacetower` behaved nearly identically for the same model.
- `qwen/qwen3.6-27b` starts to feel queued above 8-12 concurrent requests. It can survive 32 concurrent calls, but a 35-40s tail is too slow for visible live residents unless the controller deliberately staggers thinking.
- `qwopus3.5-27b-v3@q4_k_s` is dramatically faster under this prompt. At 32 concurrent requests it stayed around 4.2s median and 8.4s max.
- Practical first policy: use Qwen for stable/default residents at conservative concurrency, use qwopus for canaries and high-throughput QA residents, and keep `inference.maxConcurrent` low enough that important hero thoughts are not starved by QA residents.

## Live resident intelligence result

Command pattern:

```bash
npm run controller:bench -- --task <task> \
  --module onion.runescape.standard \
  --mode autonomous \
  --config /tmp/nullcity-model-bench-configs/<profile>.yml \
  --output data/benchmarks/model-intelligence-2026-05-27
```

Each temp config used the same world, task, SPARK module, resident scaffolding, and soul template; only the `llm.endpoints.default` profile changed. Tasks were run sequentially to isolate model quality rather than saturating the servers.

| Profile | Task | Status | Score | Duration | Selected actions | Selected inferences | Meaningful ticks | Stuck ticks |
|---|---|---|---:|---:|---:|---:|---:|---:|
| inf_qwen | memory-recall-3m | passed | 1 | 21.6s | 3 | 1 | 1 | 16 |
| inf_qwopus_q4 | memory-recall-3m | passed | 1 | 13.3s | 3 | 1 | 1 | 2 |
| spacetower_qwen | memory-recall-3m | passed | 1 | 21.5s | 3 | 1 | 1 | 16 |
| spacetower_qwopus_q4 | memory-recall-3m | passed | 1 | 21.3s | 3 | 1 | 1 | 16 |
| inf_qwen | follow-and-chat-5m | passed | 1 | 20.2s | 12 | 8 | 6 | 0 |
| inf_qwopus_q4 | follow-and-chat-5m | passed | 1 | 20.1s | 12 | 8 | 6 | 0 |
| spacetower_qwen | follow-and-chat-5m | passed | 1 | 20.1s | 12 | 8 | 6 | 0 |
| spacetower_qwopus_q4 | follow-and-chat-5m | passed | 1 | 20.1s | 12 | 8 | 6 | 0 |
| inf_qwen | explore-report-5m | passed | 1 | 47.2s | 8 | 11 | 44 | 0 |
| inf_qwopus_q4 | explore-report-5m | passed | 1 | 38.1s | 12 | 23 | 12 | 8 |
| spacetower_qwen | explore-report-5m | passed | 1 | 50.2s | 10 | 17 | 18 | 10 |
| spacetower_qwopus_q4 | explore-report-5m | passed | 1 | 38.7s | 12 | 19 | 16 | 9 |

### Intelligence interpretation

- All four owned profiles successfully drove autonomous benchmark residents through all three workflows.
- This confirms the swap plumbing works: identical resident/task scaffolds can run against either URL and either model.
- This does **not** yet prove that the smarter model makes residents smarter. The current tasks are too easy or too SPARK-assisted:
  - `memory-recall-3m` is a good memory/plumbing canary, but the nervous/template layer can satisfy it.
  - `follow-and-chat-5m` is a strong command-following regression, but all models produce the same pass.
  - `explore-report-5m` gives more movement/progress signal, but one run per profile is not enough to compare intelligence.
- The strongest signal today is capacity, not cognition: `qwopus3.5-27b-v3@q4_k_s` is much faster under concurrent load. Quality needs harder tasks and repetitions.

## Next scientific benchmark design

Run the next pass as a small factorial experiment:

- Profiles: `inf_qwen`, `spacetower_qwopus_q4`, then OpenRouter/Anthropic profiles once keys are present.
- Tasks: 2 deterministic controls plus 2 genuinely cognitive workflows.
- Repetitions: at least 5 runs per profile per task.
- Metrics: pass rate, time to first valid action, completion time, selected-module inference count, meaningful progress ticks, stuck ticks, useful speech, empty/JSON-like replies, and estimated cost.

Recommended new cognitive workflows:

1. **Unknown goal orientation:** give the resident a high-level goal like "bring me cooked shrimp" without direct command templates; score planning, tool acquisition, movement, and recovery.
2. **Social memory + instruction conflict:** a patron asks for one thing, a nearby NPC/player says something distracting, and the resident must answer/use memory without looping.
3. **Stuck recovery challenge:** spawn behind an openable door or unreachable coordinate and score whether the resident diagnoses the obstruction, opens/moves around it, and continues the original goal.
4. **Storyteller quality eval:** run the periodic storyteller over the same world snapshot, then score with a human rubric for specificity, drama, and factual grounding.

## Current recommendation

- Keep the default stable profile until repeated cognitive benchmarks prove a quality win.
- Use `qwopus3.5-27b-v3@q4_k_s` for canary residents and QA concurrency because it has far better latency headroom.
- Treat `inf` and `spacetower` as roughly equivalent for these two models until a heavier/longer run shows otherwise.
- Add an artifact-level endpoint/profile label before the next serious benchmark batch; today the run order had to be used to map identical model names back to URL profiles.
