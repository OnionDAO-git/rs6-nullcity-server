# Model intelligence benchmark - 2026-05-27

This pass asks the Thursday meeting question directly: **does a smarter or paid model make RuneScape residents behave more intelligently, and how many residents can we safely let humans spawn?**

Short answer: **model quality matters on harder resident tasks, but the evidence does not yet justify paid models for every resident.** The strongest local profile, `qwopus3.5-27b-v3@q4_k_s` on Spacetower, performed about as well as Haiku on the hardest live task and is much faster/cheaper. Qwen is functional for easy SPARK-assisted tasks but failed every repeated combat-prayer run.

No API keys are stored in this repo. Paid-provider keys were supplied through process environment for the benchmark process only.

## TL;DR

- **Plan around 20 active residents total** for Thursday/Chicago. That is the safe public capacity number from the current soak tests.
- **25 active residents is an ops-only stretch cap**, useful for controlled tests but not something to promise attendees yet.
- **30 active residents is not demo-safe** on either local profile tested; both machines stayed alive but produced too many timeouts.
- If Week 1 starts with **8 fixed residents**, allow roughly **10-12 human-spawned active residents** and put everyone else into the queue/voting flow.
- **Best current local resident profile:** `spacetower_qwopus_q4`. It matched Haiku on the hardest repeated live task and was much faster than Qwen.
- **Paid models help sometimes, but not enough to use for everyone.** Reserve paid/smarter models for Storyteller, important heroes, hard cognition tests, or high-touch patron moments until we have stronger evidence.
- **Qwen is usable for easy SPARK-assisted routines, but weak on harder live behavior.** It went `0/6` on repeated `combat-prayer-10m`; Qwopus and Haiku each went `3/6`.

## Profiles tested

| Label | Endpoint | Model | Notes |
|---|---|---|---|
| `inf_qwen` | `http://inf.nullcity.ai:1234` | `qwen/qwen3.6-27b` | Current local baseline. |
| `spacetower_qwopus_q4` | `http://spacetower.nullcity.ai:8100` | `qwopus3.5-27b-v3@q4_k_s` | Dev's smarter quantized local model. |
| `openrouter_haiku` | OpenRouter | `anthropic/claude-3.5-haiku` | First paid drop-in model that passed controller-shaped calls. |
| `openrouter_sonnet` | OpenRouter | `anthropic/claude-sonnet-4.5` | Worked in pure situational eval; current controller wrapper still needs provider adaptation for reliable resident use. |
| `openrouter_minimax` | OpenRouter | `minimax/minimax-m2.7` | Direct calls work, but it spends output budget on reasoning and did not produce controller-parseable actions in this pass. Needs adapter work before fair evaluation. |

## 1. Resident capacity result

Command shape:

```bash
npm run start:infra
npm run start:game
# generated isolated benchmark residents and controller configs, then:
npm run controller:smoke -- --config <temp-controller.yml> --observe-seconds 45 --allow-recent-visible
```

Artifacts:

- `data/benchmarks/resident-capacity-soak-2026-05-28T01-35-36-984Z.json`
- `data/benchmarks/resident-capacity-soak-midpoint-2026-05-28T01-45-18-204Z.json`

| Profile | Residents | Smoke OK | Actions | Success | Failures | Timeouts | Decisions | Read |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `inf_qwen` | 10 | 10/10 | 20 | 15 | 5 | 0 | 20 | Healthy. |
| `inf_qwen` | 20 | 20/20 | 40 | 20 | 20 | 0 | 40 | Alive, mixed action quality. |
| `inf_qwen` | 25 | 25/25 | 50 | 50 | 0 | 0 | 50 | Best Qwen midpoint run. |
| `inf_qwen` | 30 | 30/30 | 60 | 30 | 0 | 30 | 60 | Too many timeouts for live demo use. |
| `spacetower_qwopus_q4` | 10 | 10/10 | 37 | 26 | 5 | 1 | 122 | Healthy and much more active. |
| `spacetower_qwopus_q4` | 20 | 20/20 | 96 | 89 | 3 | 0 | 382 | Strongest capacity point. |
| `spacetower_qwopus_q4` | 25 | 25/25 | 60 | 44 | 13 | 4 | 158 | Alive, but degradation begins. |
| `spacetower_qwopus_q4` | 30 | 30/30 | 94 | 68 | 0 | 19 | 237 | Alive, but too many timeouts. |

### Capacity recommendation

- **Set the active human-spawn cap to 20 residents for Thursday/Chicago planning.**
- **Use 25 as a stretch/ops-only cap**, not a public promise.
- **Do not let humans freely spawn beyond 25 active residents** until a longer soak proves recovery under real crowd traffic.
- If Week 1 starts with 8 fixed residents, allow roughly **10-12 human-spawned active residents** and queue/vote the rest.

This lines up with the meeting reality: expected engaged users are more like 10-20, not 400.

## 2. Live resident intelligence result

Command shape:

```bash
npm run controller:bench -- --task all \
  --module onion.runescape.standard \
  --mode autonomous \
  --config <temp-model-profile.yml> \
  --output data/benchmarks/model-intelligence-paid-2026-05-27
```

Then the hardest discriminating task, `combat-prayer-10m`, was repeated five more times per profile.

Artifacts:

- `data/benchmarks/model-intelligence-paid-2026-05-27/bench_*.json`

### Full autonomous suite

| Profile | Full-suite pass rate | Average score | Failed task |
|---|---:|---:|---|
| `inf_qwen` | 8/9 | 0.906 | `combat-prayer-10m` |
| `spacetower_qwopus_q4` | 8/9 | 0.906 | `combat-prayer-10m` |
| `openrouter_haiku` | 9/9 | 1.000 | None |

Most existing tasks are now too easy or too SPARK-assisted to discriminate model intelligence. They are still useful regression tests, but not enough for a model-quality decision.

### Repeated hard task: `combat-prayer-10m`

Including the full-suite run plus five repeats:

| Profile | Passes | Average score | Interpretation |
|---|---:|---:|---|
| `inf_qwen` | 0/6 | 0.150 | Qwen consistently failed this harder workflow. |
| `spacetower_qwopus_q4` | 3/6 | 0.575 | Qwopus produced real successes, but is still unreliable. |
| `openrouter_haiku` | 3/6 | 0.575 | Haiku matched Qwopus here, not a decisive paid-model win. |

### Intelligence interpretation

- **Yes, model choice changes outcomes.** Qwen was 0/6 on the hardest repeated live task; Qwopus and Haiku were both 3/6.
- **No, paid Haiku did not clearly beat Dev's better local model.** In the live harness, Haiku and Qwopus tied on the hard repeated task.
- **The harness still hides differences.** SPARK modules, fallback routines, and deterministic recovery make easy tasks pass for every model.
- **The current best default strategy is hybrid:** local models for normal residents, paid models for important roles or special jobs once their adapters are reliable.

## 3. Pure situational judgment eval

Because live resident tests are partially SPARK-assisted, I also ran a small direct decision rubric with identical RuneScape situations: low HP combat, cooking, stuck door recovery, name-mentioned chat, patron ritual guidance, memory storage, and long-term ambition planning.

Command shape:

```bash
# OpenRouter key provided via environment only.
node <temporary situational-eval script>
```

Artifact:

- `data/benchmarks/model-intelligence-paid-2026-05-27/situational_20260528024018.json`

| Profile | Parseable | Average score | Avg latency | Read |
|---|---:|---:|---:|---|
| `openrouter_sonnet` | 8/8 | 0.856 | 3.7s | Best judgment score in this small rubric. |
| `inf_qwen` | 8/8 | 0.822 | 20.4s | Surprisingly competent when JSON-constrained, but slow. |
| `openrouter_haiku` | 8/8 | 0.806 | 2.7s | Good, but not obviously smarter than Qwen/Qwopus on this rubric. |
| `spacetower_qwopus_q4` | 8/8 | 0.772 | 1.7s | Fastest usable profile, modest judgment score. |
| `openrouter_minimax` | 0/8 | 0.000 | n/a | Not compatible with the simple wrapper in this pass. |

The direct rubric is not a replacement for game play, but it exposes two useful facts:

- Sonnet probably deserves a real adapter and a live-resident run.
- Qwen's biggest practical weakness may be latency and live-task reliability more than one-step reasoning.

## Current answer to Dev's question

**Did benchmarking go well?** Yes for a first scientific pass. We now have actionable resident-capacity numbers and a real live-task signal that Qwen is weaker on hard behavior.

**Do we have good results?** Good enough for policy, not yet good enough for final model selection.

**Is Qwopus better?** For our current system, yes: it is much faster than Qwen and matched Haiku on the hardest repeated live task. It should be the preferred local canary/high-value resident profile for now.

**Does paid inference make agents smarter?** Sometimes, but not enough evidence to pay for every resident. Haiku did not beat Qwopus in the live repeated task. Sonnet looked best in pure judgment but needs adapter work before a fair live-resident benchmark.

## Recommended next experiment

Follow-up plumbing landed after this report:

- Benchmark config now has `llm.endpoints` for machines/providers and `llm.profiles` for endpoint+model choices.
- Benchmark artifacts now include `inference.profileId`, `endpointId`, `provider`, `baseUrl`, `model`, and optional pricing fields.
- OpenRouter-style `message.reasoning` and provider `usage.cost` fields are parsed by the OpenAI-compatible client and health probe.
- Endpoints can opt into `responseFormat: text` when JSON-schema mode causes bad completions.

Remaining experiment work:

1. Add 3-5 harder model-sensitive live workflows:
   - `goal-orientation-cooked-shrimp`: high-level goal, no direct recipe.
   - `stuck-door-recovery`: unreachable target behind door.
   - `patron-conflict-resolution`: patron guidance vs distracting chat/NPC event.
   - `memory-route-recall`: learn new bank/location fact, use it later.
   - `danger-survival`: low HP, food, hostile NPC, recover before continuing.
2. Run 5-10 repetitions per profile:
   - Qwen local baseline.
   - Qwopus local.
   - Haiku.
   - Sonnet.
   - MiniMax after adapter.
3. Add Anthropic-native Messages API support for direct Anthropic keys.
4. Add a MiniMax adapter that limits or extracts reasoning-heavy outputs cleanly.
5. Score with pass rate, time to first valid action, meaningful progress, stuck ticks, useful speech, cost, and human-readability.

## Product recommendation

- Public active resident cap for planning: **20**.
- Operational stretch cap: **25**.
- Queue/vote everything above that.
- Default residents: local profiles.
- Important heroes, Storyteller, and high-touch patron interactions: use paid/smarter profiles only after adapter work and repeated evidence.
- Storyteller should be benchmarked separately; it is a narrative summarizer, not a body-loop resident.
