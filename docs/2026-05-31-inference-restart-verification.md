# Post-restart inference verification runbook (S-INFER-DIAG-1)

**When to run:** immediately after restarting the controller onto the new
binary that contains the S-INFER-1 parser salvage (`empty_completion_<class>` /
`brain_<class>` decisionCause) and the S-INFER-2 request hardening (configurable
`max_tokens` / brain timeout; `thinking_cancelled` separated from
`empty_completion`).

**Why:** the old "empty_completion 87.5%" was a single blurry number that mixed
three very different failures (parser bug, truncation, reflex pre-emption). This
runbook turns it into a precise per-resident breakdown and a planning check, then
routes you to the correct knob.

**Honesty note:** none of these numbers can be produced from the sandbox — there
are no current-binary live logs there. The `inference-health-audit` CLI is proven
against a synthetic fixture (`src/controller/admin/inference-health-audit.test.ts`).
Its real value lands only after you restart and run it over a live window.

---

## 1. Confirm the binary is actually new

The controller has no version endpoint, so use the S-OBS-DRAIN-1 admin AP-drain
route as a liveness + new-binary probe (it 200s only on a controller that has the
admin route, i.e. a recent build):

```bash
# Operator bearer token + base URL come from your controller.yml city config.
# Path prefix defaults to /api/nullcity.
curl -sS -X POST \
  -H "Authorization: Bearer $CONTROLLER_OP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount":0}' \
  "$CONTROLLER_BASE_URL/api/nullcity/admin/residents/res:agent/ap-drain"
# Expect HTTP 200 + a JSON body. A 404 means an OLD binary (no admin route) —
# the restart did not take. A 401 means the token is wrong, not a stale binary.
```

Also sanity-check the process start time / git SHA out of band:

```bash
# On the host running the controller:
git -C /path/to/rs6-nullcity-server rev-parse --short HEAD   # should match the deployed SHA
ps -o lstart= -p "$(pgrep -f 'controller/index')"            # start time after your restart
```

A `0`-amount drain is a no-op on the economy but still writes an audit row, so it
is safe to use as a probe.

---

## 2. Run a normal hero window, then the audit

Let residents live normally for **~20-30 minutes** (heroes awake, brain firing).
Then run the new audit over that window:

```bash
# Default: last 30 minutes, reads data/controller/memory/<slug>/evidence/trajectory/*.jsonl
npm run controller:inference-audit

# Explicit window (recommended — pin the exact 30 min you observed):
npm run controller:inference-audit -- \
  --start=2026-05-31T18:00:00.000Z \
  --end=2026-05-31T18:30:00.000Z
```

Artifact lands at
`data/benchmarks/capability-qa-<DATE>/inference-audit/inference_health_audit_<ts>.json`.

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--trajectory-root <dir>` | override the evidence root (default `data/controller/memory`; must match `memory.dir` in your controller.yml) |
| `--start` / `--end` | ISO window bounds (default: last `--duration-ms`, ending now) |
| `--duration-ms <ms>` | window length when only one bound is given (default 1800000 = 30 min) |
| `--exclude-prefix <p>` | drop residents by id prefix (default drops `res:bmk_` benchmark runners) |
| `--top <n>` | cap the per-resident `causeCounts` histogram rows |

If you prefer a raw histogram (no rollup), the S-INFER-1 grep recipe still works:

```bash
grep -hoE 'empty_completion(_[a-z_]+)?|brain_[a-z_]+|thinking_cancelled' \
  data/controller/memory/res-*/evidence/trajectory/*.jsonl | sort | uniq -c | sort -rn
```

---

## 3. Read the headline + breakdown

The audit's headline replaces "87.5% empty":

> **usable-brain-decision rate = (clean + recovered) / brain-eligible-decisions**

Per-resident and aggregate, the audit splits every brain-eligible decision into:

| Class | Meaning | What it tells you |
| --- | --- | --- |
| `clean` | brain emitted a usable plan / action / say / memo | working as intended |
| `recovered` | completion WAS broken, the parser salvaged it (think-strip / fence / trailing-comma / lenient field) | **the old 87.5% was a PARSER bug — now fixed** |
| `think_only_no_answer` | think text / truncated mid-think, no JSON answer | **bucket B** — out of token/time headroom |
| `thinking_cancelled` | a reflex pre-empted the brain mid-think | **bucket C** — reflex tuning, NOT inference |
| `schema_mismatch` | valid JSON, wrong shape | prompt / schema issue |
| `truly_empty` | whitespace / nothing usable | genuine empty completion |

What "good" looks like:

- **usable-brain-decision rate ≥ 0.80** — healthy. The brain is producing usable
  plans on most ticks; the old number was mostly a parser artifact.
- **usable rate 0.50-0.80** — partial. Read the broken classes to decide the knob.
- **usable rate < 0.50** — still poor. Go to the decision gate in §5.

Interpretation by dominant broken class:

- **High `recovered`** ⇒ the parser bug WAS the problem and is now fixed. The old
  87.5% was salvageable JSON the old parser threw away. No model change needed.
- **High `think_only_no_answer`** ⇒ bucket B (truncation). The model is thinking
  past the token/time budget. **Raise the headroom** — S-INFER-2 made these
  configurable; point at the `llm.brain` knobs in `controller.yml` (per S-INFER-2's
  HANDOFF, `max_tokens` + brain timeout). Bump `max_tokens` first, then the brain
  request timeout, and re-run §2.
- **High `thinking_cancelled`** ⇒ bucket C. Reflexes are interrupting the brain
  before it finishes. This is **separate tuning** (nervous-system reflex priority /
  cancellation thresholds), not an inference fix. Do NOT raise tokens for this.
- **High `schema_mismatch`** ⇒ the model emits JSON of the wrong shape; revisit the
  brain prompt / schema, not the timeout.
- **High `truly_empty`** ⇒ genuine empty completions; check the endpoint is up and
  returning content, then consider the model gate in §5.

---

## 4. Verify residents actually plan

A high usable rate is necessary but not sufficient — confirm the brain emits goals
AND residents follow them across ticks.

a) The audit already reports planning proxies per resident and aggregate:

- `goalsEmitted` — distinct goalIds the brain produced (plan ids + goal-attributed
  action tags).
- `goalFollowThroughRate` — `goalAttributedActions / totalAttributableActions`
  (S-GOAL-FOLLOW-1 causation tags on action/say lines).

> **Good:** `goalsEmitted > 0` AND `goalFollowThroughRate ≥ 0.60`.

b) Confirm with the dedicated benchmark (controlled, seeds a goal + healthy AP):

```bash
npx ts-node src/controller/benchmarks/cli.ts \
  --task goal-follow-through-5m \
  --module onion.runescape.standard \
  --mode autonomous \
  --config controller.yml
```

> **PASS** when `goalAttributedActions / totalActions ≥ 0.6`, `goalChangeCount ≤ 3`,
> and the final goal is the seeded follow-through goal (or a sensible successor).
> The artifact carries `goalAttributedActions`, `totalActions`, `goalChangeCount`,
> and a `goalTrace[]` summary.

If the usable-brain rate is healthy but follow-through is low, the problem is goal
selection / hysteresis, not inference — a separate lane.

---

## 5. Decision gate (Qwen local + thinking vs Haiku)

After §3-§4 over a real window:

- **Usable-brain rate is good on Qwen (≥ 0.80) and planning passes** ⇒ **keep local
  Qwen + thinking ON.** The 87.5% was a parser bug, now fixed. No model switch.
- **Usable rate still poor after raising headroom (bucket B addressed) and reflex
  tuning (bucket C addressed)** ⇒ **flip the brain to Haiku per HD-052.** Per
  S-INFER-MODEL-1: set `controller.yml#llm.endpoints.default.{baseUrl,provider,apiKey,model}`
  to `openrouter_haiku` (`anthropic/claude-3.5-haiku`), or scope paid to heroes-only
  via soul frontmatter `model.endpoint=openrouter_haiku`
  (`endpointFor()` resolves `behavior.brain.endpoint ?? soul.model.endpoint ?? default`).
  See `config/controller.paid-example.yml`.

Re-run §2 after any knob change and compare the artifacts — the audit's
`usableBrainDecisionRate` is the single before/after number to track.

---

## Cross-references

- S-INFER-1 parser salvage + classification enum:
  `docs/capability-evidence/2026-05-31-inference-parse-salvage.md`
- S-INFER-MODEL-1 paid-vs-local comparison + HD-052 switch recipe:
  `docs/capability-evidence/2026-05-31-inference-model-comparison.md`
- Audit source + fixture: `src/controller/admin/inference-health-audit.ts` (+ `.test.ts`)
- Goal-follow-through benchmark: `src/controller/benchmarks/tasks/goal-follow-through-5m.ts`
