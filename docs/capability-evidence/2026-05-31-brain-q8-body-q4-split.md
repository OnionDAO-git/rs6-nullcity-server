# S-INFER-9 — Brain → q8 (spark) / Body → q4 (tower) split

**Date:** 2026-05-31
**Packet:** S-INFER-9
**Result:** shipped (routing proven by unit test; live quality/latency PENDING deploy + watch)

> **REVERTED by S-INFER-10 (2026-05-31).** The q8 brain split was reverted to **q4-everywhere** after q8 proved unusable (~1.4 tok/s, ~12 min/plan; full-envelope prompts timed out — S-INFER-9-PREDEPLOY-GUARD-1 `ff47b826`). The committed config never reached production; the live controller stayed on q4 (95.5% usable-brain) the whole time. Cohort souls + `controller.yml` now route **both** Brain and Body to q4. See `docs/runtime-stewardship.md` § Model policy and HD-053.

## What

The maintainer's intended architecture is a **deliberate-planner + fast-executor** split:

- **Brain** = the rare, cadenced deliberate planning layer. Smarter > faster. It is
  fine for it to take ~60–150s because it emits a PLAN the Body executes for a while.
  Runs thinking ON. → routed to the **smarter/slower q8** (`qwopus3.5-27b-v3@q8_0`) on
  the **spark host** (`inf.nullcity.ai:1234`).
- **Body** = the fast every-few-seconds executor. Speed matters. Runs thinking OFF. →
  routed to the **fast q4** (`qwopus3.5-27b-v3@q4_k_s`) on the **tower host**
  (`spacetower.nullcity.ai:8100`).

The S-INFER-8 brain request timeout is already 240s (generous), so a slow q8 brain
(~60–150s) is NOT cut.

## Mechanism — per-soul frontmatter

`endpointFor(profile) = profile?.endpoint || soul.frontmatter.model?.endpoint || 'default'`
(`hybrid-agent-thinking-module.ts:400`). The Brain request is built with
`ctx.endpointFor(behavior.brain)` (`hybrid-agent-helpers.ts:~3319`) and the Body with
`ctx.endpointFor(behavior.body)` (`~3446`) — the two tiers resolve their endpoints
**separately**, so they can target different endpoints/hosts.

`InferenceProfileDefinition` already supports an `endpoint` field
(`soul-schema.ts:267`, schema `inferenceProfileSchema:312`), so the route is **additive
and already-typed** — no parser/schema change. There is no controller-level global
brain/body-endpoint default mechanism in `config.ts` (it would be net-new plumbing);
the per-soul edit is the smallest correct change and the packet permits it.

The 9 hybrid-agent cohort souls now carry:

```yaml
behavior:
  brain:
    endpoint: brain_q8   # smarter/slower q8 (spark)
    thinking: true
  body:
    endpoint: body_q4    # fast q4 (tower)
    thinking: false
```

`res:hans` is a **hook-driven hero exception** — single thinking-off model tier, no
deliberative q8 brain/body loop. It routes to the fast `body_q4` via soul-level
`model.endpoint`.

## Endpoints added to the LIVE (untracked) controller.yml

```yaml
llm:
  endpoints:
    brain_q8:
      baseUrl: http://inf.nullcity.ai:1234
      model: qwopus3.5-27b-v3@q8_0
      timeoutMs: 240000
    body_q4:
      baseUrl: http://spacetower.nullcity.ai:8100
      model: qwopus3.5-27b-v3@q4_k_s
      timeoutMs: 30000
```

`default` unchanged (fallback). controller.yml is gitignored (NOT committed) — noted
for the steward.

## Proof (unit test — `hybrid-agent-thinking-module.test.ts`, describe "S-INFER-9")

- For each of the 9 hybrid cohort residents (`res:agent` + 8 `res:qa-*`):
  `endpointFor(behavior.brain) === 'brain_q8'` and `endpointFor(behavior.body) === 'body_q4'`.
- Brain keeps thinking ON + the 240s ceiling; Body keeps thinking OFF + a short
  (≤30s) timeout.
- `res:hans` hero routes its single thinking-off tier to `body_q4`.
- **Body independent of Brain:** mutating `behavior.brain.endpoint` does NOT move the
  Body endpoint — the Body call (`runBody`) builds its endpoint from `behavior.body`
  alone, fires every tick on its own timeout, and never references the brain. A slow
  q8 brain cannot freeze or reroute the q4 body.

20 new test cases. Full suite: 3515/3515 pass, 244 suites (was 3495 passing + 1
pre-existing red `config.test.ts` canary, now fixed: qwen/60000 → qwopus/75000 to match
`config/controller.inference-canary.yml` after Codex's S-QWOPUS-CONFIG-1 migration).

## Honesty

- Brain routes to q8 (spark), Body to q4 (tower), **proven by endpoint-resolution
  test**; Body independent of Brain; the 240s timeout accommodates a slow q8 brain.
- The live "are plans smarter + residents lively" verdict is **PENDING deploy +
  observation**. NOT claiming residents are smarter yet.

## 2026-05-31 pre-deploy guard — do not restart onto q8 yet

Codex ran a runtime guard before deploying this split to the live controller. Result:
**do not restart Monday/demo runtime onto `brain_q8` yet.** The routing code is valid,
but the q8 host did not complete resident-sized Brain envelopes within the current
runtime tolerance.

Direct probes, all using a synthetic resident-sized Brain prompt:

- `inf.nullcity.ai:1234` / `qwopus3.5-27b-v3@q8_0` / thinking ON / 4096 tokens:
  **timeout at 180s**.
- `inf.nullcity.ai:1234` / `qwopus3.5-27b-v3@q8_0` / thinking OFF / 1024 tokens:
  **timeout at 90s**.
- `inf.nullcity.ai:1234` / `qwopus3.5-27b-v3@q8_0` / thinking OFF / 512 tokens:
  **timeout at 90s**.
- `spacetower.nullcity.ai:8100` / `qwopus3.5-27b-v3` / thinking ON / 4096 tokens:
  **timeout at 180s**.
- `spacetower.nullcity.ai:8100` / `qwopus3.5-27b-v3` / thinking OFF / 512 tokens:
  **timeout at 90s**.
- After a 30s cool-down, tiny non-thinking probes recovered on both hosts:
  `inf-q8-small` returned `200` in `14275ms`; `spacetower-small` returned `200` in
  `12487ms`.

Current deployed controller was therefore left untouched. It is still good enough to
keep residents moving:

- `npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible`:
  **10/10 OK**, no action timeouts/failures in the observation window.
- `npm run controller:inference-audit -- --duration-ms 900000 --output-dir data/benchmarks/capability-qa-2026-05-31/s-infer-host-degraded-check`:
  artifact `inference_health_audit_20260601T002420Z.json`, `206` brain decisions,
  `95.2%` usable brain rate, `96.6%` goal follow-through.
- `npm run controller:normal-life-audit -- --duration-ms 600000 --output-dir data/benchmarks/capability-qa-2026-05-31/s-runtime-health-check`:
  artifact `normal_life_audit_20260601T002420Z.json`, `10` active residents,
  `505/505` action attempts succeeded, `low_health_heal_wait=0`,
  `organicSelfInitiatedApGpExchangeEvents=1`.

Next safe path: keep the current robust q4/alias live stack for Monday unless a new
full-envelope canary proves q8 resident Brain prompts complete reliably. Small `/v1`
model and tiny chat probes are not enough.

## Steward / Dev notes

- **Keep q8 hot on spark.** Ask Dev to keep `qwopus3.5-27b-v3@q8_0` resident/warm on
  `inf.nullcity.ai:1234` so the q8 brain stays nearer ~60s than ~150s.
- **Verify inf serves @q8_0 first.** As of 2026-05-31 the inf host was rejecting
  qwopus probes ("Context size has been exceeded") and the LIVE `default` was failed
  over to spacetower. Re-check `/v1/models` before assuming a fallback host: Codex's
  pre-deploy guard saw `inf` list `@q8_0`, while `spacetower` listed the q4 id and
  the unsuffixed alias, not `@q8_0`.

## Watch plan (after deploy)

1. Brain trajectories show **smarter/varied** goals + speech (vs the q4 baseline).
2. Residents stay **lively** — body actions every few seconds while the brain thinks.
3. Brain calls complete **under 240s** (no `[inference-alarm]` request_timeout lines).
4. Note whether q8 is steady ~150s or **faster when kept hot** on spark.
