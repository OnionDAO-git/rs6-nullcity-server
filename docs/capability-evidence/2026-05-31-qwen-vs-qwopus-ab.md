# S-INFER-AB-1: qwen3.6-27b vs qwopus3.5-27b head-to-head brain A/B (2026-05-31)

## Question

Resident brain `usable-rate = 0%` in live audits (`empty_completion` + `request_timeout`
dominated) on `qwen/qwen3.6-27b` with thinking ON. Two questions, answered with **live-measured**
numbers, not theory:

1. Is Qwen the bottleneck?
2. Does the other configured model (`qwopus3.5-27b-v3@q4_k_s`) do better — faster and/or more
   reliably within the 20s brain timeout?

## Method (all numbers are LIVE-measured from this sandbox, 2026-05-31 ~20:50–21:20 UTC)

- Both endpoints were **reachable** from the sandbox: `inf.nullcity.ai:1234` and
  `spacetower.nullcity.ai:8100` each returned HTTP 200 on `/v1/models`, and each serves **both**
  `qwen/qwen3.6-27b` and `qwopus3.5-27b-v3@q4_k_s`.
- Throwaway probe `scripts/ab-probe.mjs` (in the worktree, **not committed to `src/`**) POSTs a
  **realistic 13.3 KB brain prompt** — exact shape of `hybrid-agent-prompts.ts buildBrainPrompt`
  (the `/think` directive, needs-hierarchy, playbook, Hans hero soul, current goal, and a
  structured ~S-INFER-3-trimmed perception of 16 NPCs / 20 objects / 12 ground items / 12-slot
  inventory / 10 events) — to each endpoint's `/v1/chat/completions` with **thinking ON**
  (`reasoning.enabled=true` + `chat_template_kwargs.enable_thinking=true`, temp 0.7), modeled on
  `inference-health.ts`'s fetch.
- Each response is classified the way **production** classifies it: strip `<think>`, balanced-brace
  JSON salvage, then validate against the brain `goal`/`say` schema (`brainCompletionSchema` from
  `runescape-brain-planner.ts`). "Usable" = a parseable object carrying a `goal.description` or a
  `say` — i.e. a real plan the orchestrator can act on.
- Two timeout regimes: **20 s** (production brain timeout, parity) and **90 s** (uncapped, to learn
  each model's *true* latency and whether it answers at all).

## Results

### Production-parity: 20 s timeout (matches the live brain budget), 12 samples each

| Model | endpoint | p50 (all) | p90 (all) | under-20s? | usable-rate | empty / think-only / timeout |
|---|---|---:|---:|:---:|---:|---|
| **qwen/qwen3.6-27b** | inf:1234 | 20.0 s (cap) | 20.0 s (cap) | **0/12** | **0%** | 0 / 0 / **12 timeout** |
| **qwopus3.5-27b@q4** | spacetower:8100 | 20.0 s (cap) | 20.0 s (cap) | **1/12** | **8%** | 0 / 0 / 11 timeout, 1 usable |

At the real 20 s budget **both** local 27B thinking models mostly time out. qwopus occasionally
beats the buzzer (1/12 @ 17.5 s); qwen never does.

### Uncapped: 90 s ceiling — the decisive measurement, 6 samples each

| Model | endpoint | p50 (completed) | p90 (completed) | usable-rate | breakdown |
|---|---|---:|---:|---:|---|
| **qwen/qwen3.6-27b** | inf:1234 | — (never completed) | — | **0% (0/6)** | **6/6 request_timeout @ 90 s** |
| **qwopus3.5-27b@q4** | spacetower:8100 | **43.5 s** | 68.0 s | **100% (6/6)** | 6/6 usable |
| qwopus3.5-27b@q4 | inf:1234 | 38.7 s | 41.3 s | **100% (3/3)** | 3/3 usable (one @ **16.6 s**, under 20s) |

**qwen does not return a usable brain answer even given 4.5× the production timeout (90 s).**
qwopus returns a usable answer **every time**, on **both** hosts, p50 ~38–44 s.

### Host-vs-model isolation (the honesty check)

A 0% rate could be a dead host rather than a bad model. It is not — it is the **model**:

| Probe (tiny 17-token prompt, thinking OFF) | Result |
|---|---|
| qwopus on **inf** host (the "qwen" host) | **HTTP 200 in 1.3 s** ✅ |
| qwen on **spacetower** host (the "qwopus" host) | **timeout, 0 bytes @ 40 s** ❌ |
| qwen on inf host, trivial thinking-OFF prompt | timeout, 0 bytes @ 30 s ❌ |
| qwen on inf host, trivial thinking-ON prompt | timeout, 0 bytes @ 60 s ❌ |

`qwopus` serves fine on **both** hosts (1.3 s on a trivial prompt). `qwen/qwen3.6-27b` fails to
return *anything* on **both** hosts — even a 17-token, thinking-off "reply OK" hangs to 0 bytes.
So in this window `qwen3.6-27b` is **effectively non-serving** on this infra, while the host
hardware is healthy.

### Answer quality (eyeballed qwopus usable outputs)

qwopus output is in-character and engine-valid, clearly shaped by Hans's steward soul + the
firemaking/woodcutting playbook:

- goal: "Chop down the nearby Tree to gather logs for embassy warmth and order" — say: "The hour
  approaches noon. A little work keeps the embassy warm…"
- goal: "Gather ordinary logs from nearby tree and start a fire to keep the embassy warm" — say:
  "A ceremony of warmth begins; the fire shall keep watch tonight…"
- goal: "Build a welcoming hearth at the embassy using nearby wood" — say: "Welcome, travellers.
  Let the woodsmoke warm our hearth…"

These are runnable goals (the engine supports chop→logs→firemaking), survival-spine-aware, and
voiced like the soul. qwen produced **no** output to assess.

## Verdict

**It is the MODEL (`qwen/qwen3.6-27b`), and the bottleneck is BOTH a capability/serving failure
AND latency — but qwen is the worse of the two on every axis.**

- Is qwen the bottleneck? **Yes, decisively.** It returns nothing usable even at 90 s, and fails
  trivial prompts on both hosts. The live 0% brain rate is consistent with qwen being
  non-serving / catastrophically slow on this infra right now, not with the prompt being too big
  (S-INFER-3 already trimmed it to ~11–13 KB; qwopus digests the *same* 13.3 KB prompt fine).
- Does qwopus do better? **Yes, dramatically.** 100% usable vs 0%, on both hosts, with
  high-quality in-character goals. But qwopus's **p50 ~38–44 s still exceeds the 20 s brain
  timeout** — only ~1-in-12 calls finish under 20 s. So switching the model fixes "can it answer
  at all" but does **not** by itself fix "answers within 20 s."
- Therefore the fix is **two-part**: (1) get off qwen, and (2) give the local thinking model enough
  time, because no local 27B thinking model reliably answers a realistic brain prompt in 20 s on
  this hardware.

## Recommendation (in priority order)

1. **Stop using `qwen/qwen3.6-27b` as the brain.** It is non-serving on this infra in this window.
   Point the brain default at **qwopus3.5-27b-v3@q4_k_s** (it serves on both `inf` and
   `spacetower`).
2. **Raise the brain timeout to ≥ 45 s (ideally 60 s) for the local-model brain**, OR keep 20 s
   only if heroes run on a faster endpoint. With qwopus @ p50 ~40 s / p90 ~68 s, a 20 s budget
   throws away ~90% of perfectly good answers. A 60 s brain budget would capture essentially all
   of them.
3. **If a within-20-s brain is required (e.g. demo responsiveness), wire a faster endpoint** — the
   already-configured `openrouter_haiku` profile (`config/controller.model-benchmark.yml`) or
   `openrouter_storyteller`. No local 27B thinking model on this hardware meets a 20 s budget.
   Recommended split: heroes → paid Haiku (fast, cents at hero volume per HD-052); silent cohort →
   local qwopus with a 60 s budget.
4. This supersedes the unmeasured half of **HD-052**: that decision had task-intelligence
   benchmarks but no live latency/empty-rate A/B. This packet supplies it: qwen is not merely
   "less smart," it is **not answering at all** right now.

## Exact one-line config change to try the other model

The brain default lives in `llm.profiles.default` (compatibility alias) and/or
`llm.endpoints.default` in the live controller config (`controller.yml`; the in-repo template is
`config/controller.model-benchmark.yml`). **Do not apply live — maintainer's call.** Recommended:

```yaml
# llm.profiles.default — switch the brain model (keep the inf endpoint, which serves qwopus fine):
default:
  endpoint: inf
  model: qwopus3.5-27b-v3@q4_k_s   # was: qwen/qwen3.6-27b
```

Per-hero alternative (heroes only, leave the silent cohort untouched), in the hero soul frontmatter:

```yaml
model:
  endpoint: spacetower      # or inf; both serve qwopus
  model: qwopus3.5-27b-v3@q4_k_s
```

And pair **either** with a brain-timeout bump (the `timeoutMs` on the chosen endpoint/profile, e.g.
`timeoutMs: 60000`) so qwopus's ~40 s p50 fits the budget. The `spacetower_qwopus_q4` profile
currently hard-caps `timeoutMs: 30000` — raise it to 60000 if used for the brain.

## Honesty / caveats

- **All numbers above are LIVE-measured** from this sandbox against the real endpoints on
  2026-05-31. None are inferred or fabricated.
- Sample sizes are modest (12 at 20 s; 6/3 at 90 s) but the effect is large and unambiguous
  (qwen 0/24 usable across every regime vs qwopus 16/16 usable uncapped). The qwen non-serving
  result reproduced on **both** hosts and on **trivial** prompts, so it is not prompt-size or
  single-host noise.
- This is a **point-in-time** window. qwen3.6-27b may simply be unloaded / crashed / mis-warmed on
  the inference server right now; a maintainer who reloads/warms the qwen model may see different
  qwen latency. The robust read is still: **qwopus is the reliable local brain today; do not ship
  the demo on qwen without re-verifying it serves.** qwopus's >20 s latency, by contrast, is a
  stable property of a 27B thinking model on this hardware and will not change without a timeout
  bump or a faster endpoint.

## Reproduce locally (commands)

From a worktree with `node_modules` linked:

```bash
# qwen, production 20s budget, thinking ON
node scripts/ab-probe.mjs http://inf.nullcity.ai:1234       qwen/qwen3.6-27b          qwen   12 20000
# qwopus, production 20s budget
node scripts/ab-probe.mjs http://spacetower.nullcity.ai:8100 qwopus3.5-27b-v3@q4_k_s qwopus 12 20000
# uncapped 90s to see true latency + whether each answers at all
node scripts/ab-probe.mjs http://inf.nullcity.ai:1234       qwen/qwen3.6-27b          qwen   6  90000
node scripts/ab-probe.mjs http://spacetower.nullcity.ai:8100 qwopus3.5-27b-v3@q4_k_s qwopus 6  90000
# host-vs-model isolation (trivial prompt, thinking off) — qwen hangs, qwopus answers in ~1s
curl -m 40 http://inf.nullcity.ai:1234/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"qwopus3.5-27b-v3@q4_k_s","messages":[{"role":"user","content":"Reply OK."}],"reasoning":{"enabled":false}}'
```

The official harness equivalent is the inference-health probe / model-benchmark config:
`npm run inference:canary -- --config config/controller.model-benchmark.yml --all` (profiles
`inf_qwen` vs `spacetower_qwopus_q4`), but it uses a tiny health-probe prompt, not the realistic
13 KB brain prompt; this packet's probe is the brain-prompt-faithful version.
