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
