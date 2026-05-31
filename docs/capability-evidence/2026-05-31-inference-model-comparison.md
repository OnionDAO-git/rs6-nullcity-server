# Inference model comparison — paid vs. local Qwen (decision-grade)

**Packet:** S-INFER-MODEL-1 · **Date:** 2026-05-31 · **Author:** claude (docs+analysis lane)
**Question from maintainer:** *"Does the other model work better, and how do I switch it over?"*

## Recommendation (one sentence)

**Switch the brain `default` endpoint to the paid `openrouter_haiku` profile (`anthropic/claude-3.5-haiku`) for the demo** — it is the only model that passed the full autonomous suite 9/9, it parses cleanly, and it is the cheapest paid drop-in; keep local Qwopus as the local fallback and reserve Sonnet for the Storyteller.

**Honesty caveat up front (read this):** the existing benchmark artifacts measure **task pass / score only**. They do **NOT** measure the live `empty_completion` pathology that HD-033/HD-042 found in production (heroes' Qwen3 brain returns empty 84–100% of the time). The benchmark even shows Qwen parsing **8/8** on a JSON-constrained rubric. So the paid-model win documented here is a **task-intelligence** win, not yet a proven **empty-rate** fix. The definitive empty-rate A/B must be re-run on the paid model **after S-INFER-1's parser salvage lands** (see §5).

---

## D1 — Comparison analysis

All numbers below are extracted directly from the on-disk artifacts (the benchmark dirs are gitignored / local-only):

- Local set: `data/benchmarks/model-intelligence-2026-05-27/` (Qwen + Qwopus, easy tasks only)
- Paid set: `data/benchmarks/model-intelligence-paid-2026-05-27/` (Qwen + Qwopus + Haiku, full suite + combat repeats + situational rubric)

Prior synthesis: `docs/model-intelligence-benchmark-results-2026-05-27.md` (this doc re-derives its numbers from the raw JSON and adds the switch recipe + empty-rate honesty framing).

### 1. Full autonomous suite — pass rate & average score

Source: first run of each of the 9 distinct tasks per model, in `model-intelligence-paid-2026-05-27/bench_*.json`.

| Model (profile) | Pass rate | Avg score | Only failed task |
|---|---:|---:|---|
| `qwen/qwen3.6-27b` (local baseline) | **8/9** | 0.906 | `combat-prayer-10m` |
| `qwopus3.5-27b-v3@q4_k_s` (local, Dev's quantized) | **8/9** | 0.906 | `combat-prayer-10m` |
| `anthropic/claude-3.5-haiku` (paid, OpenRouter) | **9/9** | **1.000** | — none — |

Most tasks (`make-fire`, `woodcutting-firemaking`, `starter-fishing`, `fishing-cooking`, `trading-giving`, `memory-recall`, `follow-and-chat`, `explore-report`) are SPARK-assisted and pass for **every** model — they no longer discriminate model intelligence. The single discriminating task is `combat-prayer-10m`.

### 2. The discriminating task — `combat-prayer-10m` (full suite run + 5 repeats = 6 runs/model)

Source: all `bench_*combat_prayer*.json` in the paid set.

| Model | Passes | Scores | Avg |
|---|---:|---|---:|
| `qwen/qwen3.6-27b` | **0/6** | `[.15, .15, .15, .15, .15, .15]` | 0.150 |
| `qwopus3.5-27b-v3@q4_k_s` | **3/6** | `[1, .15, .15, 1, .15, 1]` | 0.575 |
| `anthropic/claude-3.5-haiku` | **3/6** | `[1, .15, 1, .15, 1, .15]` | 0.575 |

This is the underlying data behind the `docs/resident-capabilities.md` "Model-sensitive combat result" table (Qwen 0/6, Qwopus 3/6, Haiku 3/6).

**What the failure actually is (from the per-run `metrics`):** the task only scores 1.0 when the resident stops attacking and **buries bones to gain prayer XP** (`prayerXpIncreased: 1`). Passing runs share a signature: **fewer attack actions + more inferences** (the model reasons about switching task), e.g. Haiku-pass `attackActions: 6, inferences: 13, prayerXpIncreased: 1`. Failing Qwen runs keep attacking and never switch (`attackActions: 12, inferences: 8, prayerXpIncreased: 0`). **This is a reasoning / task-switching failure, not an empty-completion failure** — Qwen *does* emit actions, they're just the wrong ones (it never reaches the prayer phase). Score 0.15 is the floor for "did combat, never prayed."

### 3. Empty-completion / parse-failure signal — what the data can and cannot show

**The benchmark artifacts contain NO `empty_completion` / `noop` / `parse_failure` metric.** I grepped every `bench_*.json` for `empty|noop|parse|emptyCompletion` — zero hits. The score never drops to 0; the worst is the 0.15 floor, which means "ran but didn't achieve the goal," not "returned nothing."

The **only** parse-rate signal in the whole set is the situational rubric (`situational_20260528024018.json`, 8 one-step JSON-constrained decisions/model):

| Model | Parseable | Avg judgment | Avg latency | Completion tokens |
|---|---:|---:|---:|---:|
| `anthropic/claude-sonnet-4.5` (paid) | **8/8** | 0.856 | 3.71 s | 1171 |
| `qwen/qwen3.6-27b` (local) | **8/8** | 0.822 | **20.36 s** | 1205 |
| `anthropic/claude-3.5-haiku` (paid) | **8/8** | 0.806 | 2.68 s | 907 |
| `qwopus3.5-27b-v3@q4_k_s` (local) | **8/8** | 0.772 | **1.65 s** | 850 |
| `minimax/minimax-m2.7` (paid) | **0/8** | 0.000 | 0.04 s | 0 |

**Critical reading:** when given a clean, JSON-constrained single-step prompt, **Qwen parses 8/8 — it does NOT show the empty-completion pathology here.** The 84–100% empty rate that HD-033/F20a/HD-042 measured is a **live-runtime phenomenon** (Qwen3 thinking-mode emits `<think>…` and runs out the watchdog before producing `actions[]`; see `docs/intelligence-verification-log.md` §E20/E52/E53) that the benchmark harness does **not** reproduce. So:

> **emptyRateComparable = FALSE.** The two benchmark sets let us compare *task scores* and *one-step parse rate*, not the production *empty-completion rate*. Anyone claiming "the paid model fixes the empty-completion epidemic" is over-reaching from this data.

The strongest empty-rate evidence we have is *live* and points at Qwen3 thinking-mode specifically (HD-033): heroes on `qwen/qwen3.6-27b` hit 84–100% empty; `res:agent` (also Qwen, but lighter prompt) hit only ~5.4%. A paid model with no thinking-mode quirk is **plausibly** far better on empty-rate, but that is an inference from the failure mode, **not** a measured benchmark number.

### 4. Latency & cost

- **Latency** (situational avg): Qwopus 1.65 s, Haiku 2.68 s, Sonnet 3.71 s, **Qwen 20.36 s** (Qwen is ~8–12× slower than the alternatives — this latency is what drives the live watchdog timeouts in HD-033).
- **Cost** — only paid profiles carry pricing. From `config/controller.model-benchmark.yml` / `.env.example`, `openrouter_haiku` cost is `promptTokenUsd: 0.0000008`, `completionTokenUsd: 0.000004` (i.e. **$0.80 / 1M prompt tokens, $4.00 / 1M completion tokens**). The situational rows show ~125 prompt + ~113 completion tokens per Haiku decision (1001 prompt + 907 completion over 8). That is roughly **$0.0001 + $0.00045 ≈ $0.00055 per brain decision**, i.e. **~$0.55 per 1,000 brain completions**. Local Qwen/Qwopus = **$0** (owned hardware).

---

## D2 — Switch recipe (the "how to switch" half)

### How the brain model is actually selected (verified in code, read-only)

Resolution order for the brain endpoint, from `src/controller/thinking/hybrid-agent-thinking-module.ts:396-398` and `hybrid-agent-helpers.ts:3290`:

```
endpointFor(behavior.brain)  →  behavior.brain.endpoint            (per-behavior override)
                              ?? soul.frontmatter.model.endpoint   (per-resident override)
                              ?? 'default'                         (global llm.endpoints.default)
```

- `LlmClient.complete()` (`src/controller/llm/llm-client.ts:55`) picks `this.endpoints[request.endpoint]` and falls back to `this.endpoints['default']` if the named endpoint is missing.
- Config parsing (`src/controller/config.ts:413-469`): `llm.endpoints` are raw machine+model combos; `llm.profiles` are named `endpoint + model` overlays that get merged into the endpoint map (`{ ...endpoints, ...profiles }`, line 275). A profile or endpoint may carry `cost: { promptTokenUsd, completionTokenUsd }`.

**Net:** to switch the brain for **everyone**, change what `default` points at. To switch **only heroes**, set `model.endpoint` in each hero soul's frontmatter.

### A. Switch ALL residents to paid Haiku — edit `controller.yml`

The live `controller.yml#llm.endpoints.default` currently is:

```yaml
# BEFORE (controller.yml, lines 40-45) — local Qwen for everyone
llm:
  endpoints:
    default:
      baseUrl: http://inf.nullcity.ai:1234
      model: qwen/qwen3.6-27b
      timeoutMs: 60000
```

```yaml
# AFTER — default brain = paid Haiku via OpenRouter (OpenAI-compatible)
llm:
  endpoints:
    default:
      baseUrl: https://openrouter.ai/api
      provider: openrouter
      apiKey: ${OPENROUTER_API_KEY}
      model: anthropic/claude-3.5-haiku
      responseFormat: text          # OpenRouter returns message.reasoning; text mode parses cleanest
      timeoutMs: 45000
      cost:
        promptTokenUsd: 0.0000008
        completionTokenUsd: 0.000004
```

Then export the key (never commit it) and restart the controller:

```bash
set -a; source .env.local; set +a   # provides OPENROUTER_API_KEY
# restart controller
```

A ready-to-copy annotated example lives at **`config/controller.paid-example.yml`** (shipped with this packet) and the existing **`config/controller.model-benchmark.yml`** already defines the `openrouter`, `openrouter_haiku`, and `openrouter_storyteller` profiles if you prefer the profile style.

### B. Scope to HEROES ONLY (keep cohort/res:agent on free local) — **YES, supported**

Two equivalent ways:

1. **Per-resident, in the hero soul frontmatter** (`src/controller/soul/.../<hero>.md`):
   ```yaml
   model:
     endpoint: openrouter_haiku   # any endpoint/profile name in llm.endpoints / llm.profiles
   ```
   This is read by `endpointFor()` → `soul.frontmatter.model.endpoint`. Leave `default` = local Qwen, add the `openrouter_haiku` profile to `llm.profiles`, and only the heroes that carry `model.endpoint` use the paid model. **This is the recommended scoping for the demo** — heroes are the high-touch, on-camera residents (HD-033's empty-completion epidemic is specifically a *hero* problem); the silent cohort can stay free on local hardware.

2. **Per-behavior override** (if a soul/behavior sets `brain.endpoint`): `endpointFor(behavior.brain)` takes precedence over both, so a behavior definition can pin the brain (the smart loop) to paid while leaving the body (`endpointFor(behavior.body)`) on local. This is the finest-grained knob.

> `canScopeToHeroesOnly = TRUE`.

### C. Cost implications & existing guardrails

- ~**$0.55 / 1,000 brain completions** for Haiku (see §4). Heroes-only keeps the bill tiny: 6 heroes × tens of brain calls per soak is cents.
- Existing guardrails to respect (per `docs/model-benchmarking.md` and the cron/coord docs): keep OpenRouter for **brain / important-role / Storyteller** use, **not** tick-by-tick body control (`docs/model-benchmarking.md:148`); the `default` resident-action model should stay local for the silent cohort. `inference.maxConcurrent: 2` caps in-flight calls. The Storyteller already has its own slower/smarter profile (`openrouter_storyteller` = Sonnet) and is explicitly *not* a body loop.
- The `apiKey: ${OPENROUTER_API_KEY}` interpolation means no secret ever lands in source — keep it in `.env.local` only.

---

## 5. A/B verification plan (the definitive empty-rate test)

The benchmark proves a **task-score** win for paid models but cannot prove the **empty-rate** win. To close that honestly:

1. **Re-run the model-intelligence suite on the paid profile** with the same harness:
   ```bash
   set -a; source .env.local; set +a
   npm run controller:bench -- --task all \
     --module onion.runescape.standard --mode autonomous \
     --config config/controller.paid-example.yml \
     --output data/benchmarks/model-intelligence-paid-2026-05-31
   # then repeat the discriminating task 5×:
   for i in $(seq 1 5); do npm run controller:bench -- --task combat-prayer-10m \
     --config config/controller.paid-example.yml \
     --output data/benchmarks/model-intelligence-paid-2026-05-31; done
   ```
   Compare `combat-prayer-10m` pass rate vs. the Qwen 0/6 baseline.

2. **Measure empty-rate directly (the part the benchmark misses)** — this requires S-INFER-1's parser salvage to have landed, because empty-rate is a *live decision-cause* metric, not a benchmark field. After the parser fix is live, run a live soak and histogram the SPARK decision causes (`empty_completion` / `hook_noop` / `watchdog_fallback` / `completion_action`) per resident, exactly as `docs/intelligence-verification-log.md` §E52/E53 did for the Qwen baseline (Hans = 87.5% empty). Pass criterion: paid-model heroes' `empty_completion` share drops well below Qwen's 84–100%.

3. **Decision gate:** flip `default` (or hero `model.endpoint`) to Haiku **before the demo** if step 1 reproduces the 9/9 suite and step 2 shows a materially lower empty-rate; otherwise scope paid to heroes only and keep the local cohort as-is.

---

## Sources cited

- Raw artifacts: `data/benchmarks/model-intelligence-paid-2026-05-27/bench_*.json`, `…/situational_20260528024018.json`, `data/benchmarks/model-intelligence-2026-05-27/` (gitignored, local-only).
- Prior synthesis: `docs/model-intelligence-benchmark-results-2026-05-27.md`.
- Empty-completion epidemic: `docs/human-decisions.md` HD-033, HD-042, HD-050; `docs/intelligence-verification-log.md` §E20/F20a, §E52/F52c, §E53.
- Switch mechanism (read-only): `controller.yml#llm.endpoints`, `config/controller.model-benchmark.yml`, `src/controller/config.ts:413-469`, `src/controller/thinking/hybrid-agent-thinking-module.ts:396-398`, `src/controller/thinking/hybrid-agent-helpers.ts:3290,3386`, `src/controller/llm/llm-client.ts:55`, `.env.example`.
