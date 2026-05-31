# Capability Evidence — Inference Parse Salvage (S-INFER-1)

**Date:** 2026-05-31
**Owner:** claude (agents/wip)
**Packet:** S-INFER-1 — fix the brain completion parser so Qwen (and any model)
responses are actually used instead of silently discarded.
**Related:** HD-033 (F20a INFERENCE: Qwen3 thinking-mode emits `<think>`),
intelligence-verification-log § E52 (heroes' Brain returns empty 87.5%),
HD-050 (SPARK decision-cause taxonomy).

## The failure shape

Both completion parsers used the same naive extractor — a greedy
"first `{` to last `}`" slice plus a strict `JSON.parse`:

- `src/controller/spark/runescape-brain-planner.ts` → `parseBrainCompletion`
  (brain goal/say path, called from `hybrid-agent-helpers.ts:3308`)
- `src/controller/llm/completion-parser.ts` → `parseCompletion`
  (SPARK action path, called from `spark.ts:243`)

Neither stripped `<think>` blocks. Qwen3 in thinking-mode wraps its reasoning
in `<think>...</think>` (HD-033 / F20a) — reasoning that routinely contains
braces. The greedy slice then:

1. starts at the first `{` (often inside the think trace),
2. ends at the last `}` (often after the real answer),
3. produces a malformed span → `JSON.parse` throws or the Zod `safeParse`
   fails → the completion is silently dropped and logged as
   `empty_completion`.

The same naive logic also discarded: markdown-fenced answers
(` ```json ... ``` `), prose-prefixed JSON (`Sure! {...}`), JSON with a
trailing comma, and truncated mid-`<think>` completions. The codebase already
had the correct `stripThinkBlocks` + reasoning-content read in
`inference-health.ts`, but the brain/SPARK paths never used it.

**Note on grounding:** no raw logged brain completions were found on disk in
this sandbox (`data/controller/logs/` holds storyteller fixtures only, not raw
LLM text; `completionHash` in trajectories is a sha256, not the text). Fixtures
are therefore modelled on the documented Qwen3 thinking-mode shape from HD-033
/ F20a (the `<think>`-then-truncate pattern) rather than copied verbatim. This
is called out honestly: the salvage is proven against the *documented* failure
shape; a live run is still needed to confirm the exact on-the-wire bytes.

## The fix

New shared util `src/controller/llm/json-salvage.ts` (`parseJsonWithSalvage`,
`salvageJsonCandidates`, `stripThinkBlocks`) — one robust path, schema-gated,
never fabricates fields:

1. **Think-strip** — removes closed `<think>...</think>` blocks AND an unclosed
   trailing `<think>` (model truncated mid-thought), so JSON *before* a
   truncated think is still recoverable.
2. **Fenced JSON** — extracts ` ```json ``` ` / ` ``` ``` ` inner content first.
3. **Balanced-brace scan** — quote/escape aware; walks each top-level `{...}`
   span instead of greedy-slicing, so a stray brace in trailing prose can't
   corrupt the candidate.
4. **Trailing-comma tolerance** — lenient re-parse strips `,}` / `,]` when
   strict `JSON.parse` fails.
5. **Each candidate tried** until one schema-validates.
6. **Lenient field recovery (brain only, conservative)** — a bare quoted
   speech line (`"On my way."`) → `{ say }`. Never recovers a goal.

## Classification (the observability win)

`parseJsonWithSalvage` returns a `SalvageClassification` so we stop guessing
why a completion was empty:

| class | meaning |
|---|---|
| `clean` | pure JSON, parsed identically to the old path |
| `recovered_after_think_strip` | JSON found after stripping think/prose |
| `recovered_from_fence` | JSON found inside a code fence |
| `recovered_trailing_comma` | parsed only after trailing-comma cleanup |
| `salvaged_lenient` | bare quoted speech recovered into `{say}` (brain only) |
| `think_only_no_answer` | think text / truncated-think, no JSON answer (the F20a case) |
| `schema_mismatch` | valid JSON object(s) but none matched the schema |
| `truly_empty` | whitespace / nothing usable |

Wired into SPARK `decisionCause` via `emptyCompletionCause()` in `spark.ts`:
empty completions that are `clean`/`truly_empty` keep the bare
`empty_completion` (telemetry/test stability); every other class is suffixed,
e.g. `empty_completion_think_only_no_answer`, `empty_completion_schema_mismatch`.
The brain call site passes the class through as `brain_<class>`.

This is **additive** — it extends HD-050's cause taxonomy without renaming
`empty_completion` out from under existing consumers.

## Strict superset guarantee

- `parseBrainCompletion` is preserved **byte-identical** (its greedy extractor
  + throw-on-no-JSON behaviour is still contract-tested). The robust logic
  lives in a new sibling `parseBrainCompletionDetailed` used by the call site.
- Anything that parsed into a schema-valid object before parses identically now
  (classification `clean`).
- One intentional behaviour change: non-JSON *prose* (e.g. `"this is not JSON
  at all"`) previously **threw** inside `extractJson` → surfaced as
  `parse_failed`. It is now classified `truly_empty` → ordinary
  `empty_completion` with `tick_complete`. `parse_failed` is now reserved for
  the genuine failure: valid JSON of the wrong shape (`schema_mismatch`, e.g. an
  unsafe memo path). The spark-evidence test was updated to assert this clearer
  contract.

## Verification

- `npm run fin`: **237 suites / 3410 tests PASS** (baseline ~3356; +54 from
  new salvage/classification fixtures). `npm run check:no-ui` clean. Typecheck
  + lint + format green.
- New fixtures: `json-salvage.test.ts` (26), brain-planner detailed-parse
  fixtures, `spark-evidence.test.ts` live-wiring fixtures (think-only →
  `empty_completion_think_only_no_answer`; think-wrapped action recovered;
  prose → `empty_completion`; wrong-shape → `parse_failed`).

## HONEST scope

This proves **parser robustness by fixture**. It does **not** prove the live
87.5%-empty drop — there is no live inference in the sandbox. The real impact
is **PENDING a controller restart**.

### Live-verify recipe (post-restart)

1. Restart the controller so the new parser + classification ship.
2. Let heroes run a normal window (~1000+ ticks each).
3. Grep the action/trajectory logs for the new decisionCause classes:
   `grep -oE 'empty_completion(_[a-z_]+)?|brain_[a-z_]+' <trajectory> | sort | uniq -c`
4. The histogram now reveals the REAL breakdown behind the old blanket
   `empty_completion`: how many were `think_only_no_answer` (true F20a),
   `schema_mismatch`, `truly_empty`, vs how many are now *recovered* (no longer
   empty at all). That tells us whether the residual empties are an inference
   problem (model never answers) or were a parse problem all along.

## Follow-ups (deliberately deferred)

- `inference-health.ts` still has its own `stripThinkBlocks` + `extractJsonObject`.
  Could now delegate to `json-salvage.ts` to remove the last duplicate
  extractor. Left untouched to keep this change tightly scoped pre-demo.
- Optional llm-client `content`-over-`reasoning_content` ordering tweak was NOT
  taken — `llm-client.ts:271` already reads `firstNonEmptyString(content,
  reasoning_content, reasoning)`, so the answer reaches the parser; the failure
  was purely at the parse layer. Reordering risks subtle behaviour change for
  no proven gain here.

---

# Request Hardening (S-INFER-2)

**Date:** 2026-05-31
**Owner:** claude (agents/wip)
**Packet:** S-INFER-2 — harden the brain inference *request* + parse path so a
THINKING model reliably produces usable plans. Thinking stays ON — it is the
feature. Builds on S-INFER-1 (json-salvage + classification enum).

**Honesty:** Everything below is proven by **fixtures / unit tests only**. No
live inference ran in the sandbox. We do NOT claim the live empty-rate dropped —
that A/B is PENDING a controller restart. We claim: the request now gives the
thinking model explicit room, both response layouts parse, cancelled ≠ empty,
and there is one unified parser — each backed by a named test.

## D1 — Token / time headroom for the thinking model

A reasoning model spends tokens on its `<think>` trace BEFORE the final JSON. If
the (unknown) server default generation length is small, the answer is truncated
mid-think and the salvage path sees reasoning-only text → a bogus
`think_only_no_answer`. The request now sends an explicit ceiling.

- **`max_tokens` (a.k.a. `max_completion_tokens`)**: added to `LlmRequest`
  (`maxTokens?`). When set, `llm-client.ts` sends **both** `max_tokens`
  (OpenAI-classic) and `max_completion_tokens` (newer reasoning-model field) so
  either provider style honours it. The brain call passes
  **`DEFAULT_BRAIN_MAX_TOKENS = 1536`** — sized to fit a few hundred tokens of
  reasoning plus the compact goal/say JSON, while staying well under a local
  quantized model's context so the prompt envelope is never crowded out.
- **Endpoint-configurable**: new optional `llm.endpoints.*.maxTokens` /
  `llm.profiles.*.maxTokens` config field. Resolution order inside the client:
  per-request `maxTokens` → endpoint `maxTokens` → (omit field, server default).
  A behavior profile (`behavior.brain.maxTokens`) wins via `maxTokensFor(...)`.
  When nothing is set the field is dropped entirely, preserving prior behaviour.
- **Brain timeout**: `DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS` was already a generous
  **20_000ms** (configurable via `timeoutFor(behavior.brain, …)`). NOT stingy
  for a reasoning model, so left **unchanged**; documented rather than altered.
- **Thinking stays ON** everywhere: `thinking: behavior.brain?.thinking ?? true`
  is untouched; a test asserts `brainRequest.thinking === true` alongside
  `brainRequest.maxTokens === 1536`.

Tests: `llm-client.test.ts` (sends 1536 ceiling on both fields; endpoint-default
fallback; omits when unset; per-request overrides endpoint).
`hybrid-agent-thinking-module.test.ts` (brain call carries thinking=true +
timeout=20_000 + maxTokens=1536).

## D2 — `thinking_cancelled` (bucket C) classified distinctly

A brain think CANCELLED mid-flight (a reflex with `interruptThinking` →
`resident-runtime.ts` calls `stop('nervous:<ruleId>')`, the watchdog, attention
exhaustion, or a request timeout) is empty ONLY because it was aborted — NOT
because the model produced no decision. It must never fold into the
`empty_completion` buckets and inflate the "no decision" rate.

- **Hybrid brain path** (`hybrid-agent-helpers.ts:runBrain`): already returns the
  cancellation result (`cancellation.cause`, e.g. `nervous:flee_combat`) BEFORE
  `parseBrainCompletionDetailed`, with `'thinking_cancelled'` as the fallback
  label. A regression test now locks that a reflex-cancelled think surfaces the
  reflex cause and is NOT any `empty_completion*` / `brain_*` class.
- **SPARK path** (`spark.ts`): NEW branch — when the empty completion has
  `response.cancelledBy`, the decisionCause becomes
  `cancelledDecisionCause(reason)` = `thinking_cancelled:<reason>` (e.g.
  `thinking_cancelled:nervous:flee_combat`). A bare `request_timeout` keeps its
  own historical label (genuine timeout, not a reflex). This is checked BEFORE
  the S-INFER-1 `emptyCompletionCause(...)` salvage classification, so bucket C
  never reaches the empty buckets.

Tests: `spark-evidence.test.ts` (reflex-cancelled → `thinking_cancelled:...`,
not empty_completion, with the decision recorded in the trajectory;
`request_timeout` keeps its own cause). `hybrid-agent-thinking-module.test.ts`
(reflex-cancelled brain cause distinct).

## D3 — Robust to BOTH reasoning-model response layouts

`llm-client.ts` flattens `content || reasoning_content || reasoning` into
`response.text`, so by parse time both layouts arrive as one string:

- (a) `content` carries `<think>…</think>{json}` inline → recovered,
  `recovered_after_think_strip`.
- (b) `content` empty, `reasoning_content` carries the trace with the answer at
  its TAIL (no wrapping tags) → recovered via balanced-brace scan.
- (b) reasoning-only, no JSON answer → `think_only_no_answer` (no silent `{}`).
- pure prose, no tags, no object → `truly_empty` (kept distinct from think
  truncation so the breakdown stays honest).

Tests: `json-salvage.test.ts` D3 block (both layouts + reasoning-only +
prose-only). `llm-client.test.ts` (reasoning_content-tail surfaces verbatim as
`response.text`).

## D4 — One unified `<think>`-strip + JSON-extract path

`completion-parser.ts` already used `json-salvage.ts` (S-INFER-1).
`inference-health.ts` had its OWN `stripThinkBlocks` + greedy `extractJsonObject`
(first-`{`-to-last-`}`). It now **delegates both to `json-salvage.ts`**
(`stripThinkBlocks` + `salvageJsonCandidates`, balanced-brace) while keeping its
strict health-probe contract: the recovered object must equal the whole trimmed
(think-stripped) text — no surrounding prose — AND be exactly the two probe keys.
Net: ONE robust strip+extract path across brain parser, SPARK parser, and probe.

Tests: all existing `inference-health.test.ts` stay green (prose-wrapped →
`unexpected_completion`; extra keys → `unexpected_completion`; think-stripped
exact JSON → `ok`), plus a NEW test proving two adjacent objects go through the
shared balanced-brace scan (not a greedy slice) and are still rejected by the
strict equality gate.

## Live verification (PENDING controller restart)

Same protocol as S-INFER-1, with one addition: after restart, the histogram
should also surface `thinking_cancelled(:*)` as its own bucket, separate from
`empty_completion(_*)`. A drop in raw `empty_completion*` count attributable to
cancellations moving into `thinking_cancelled` is the D2 win; recoveries vs
`think_only_no_answer` remain the S-INFER-1 / model-quality signal.

```
grep -oE 'empty_completion(_[a-z_]+)?|brain_[a-z_]+|thinking_cancelled(:[a-z_:]+)?' <trajectory> | sort | uniq -c
```
