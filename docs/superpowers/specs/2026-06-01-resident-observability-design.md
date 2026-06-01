# Resident Observatory — Design (v3, demo-scoped)

Author: claude, 2026-06-01. Status: **approved by maintainer (James), building Phase 1.**
Supersedes the over-scoped "Approach C" after two expert review rounds.

## Goal

Two human-visible outcomes:
1. **Outage visible in <10s** on the view the audience watches. Tonight every LLM call
   returned 400 and residents looked "frozen/milling" — the failure was invisible for
   ~40 minutes of log-tailing. That must never happen on stage.
2. **Per-resident legibility**: a human can tell at a glance whether a resident is
   `ALIVE-ACTING`, `THINKING`, `STUCK`, or `ERRORING`, and what it's trying to do.

No database. Reuse existing JSONL-on-disk telemetry. Minimize edits to the hot tick path.

## What the review rounds corrected (load-bearing facts)

- **400s are swallowed inside `LlmClient`.** `completeNow` (`llm-client.ts:96-111`) catches a
  non-retryable 400 and retries once with `response_format:text`; only a *doubled* 400 escapes.
  A try/catch in `runBrain`/`runBody` would miss the common case and risk double-counting.
  → **Derive per-resident error state from the existing inference JSONL** (`parse_ok`,
  `cause`, `nooped`) + a **timed health probe**. No hot-path try/catch.
- **Brain fires every ~180 ticks; body every ~8** (`hybrid-agent-thinking-module.ts:65-66`).
  "Latest Thought" is stale-by-design. → **Lead with liveness** (`ticksSinceAction`), not thoughts.
- **The health probe already exists and is wired** lazily in `index.ts:69`
  (`runInferenceHealthProbe`, `inference-health.ts`). It resolves the SAME `default` endpoint +
  model the residents use, so it *would* have gone red tonight. → Run it **on a timer**.
- **Most consumer UI already exists** in the dashboard (liveness ledger, story lines, thinking
  panel, spectator map). This is mostly wiring.
- **Cut the gold-plating** for a few-hour single-box demo: 5MB rotation, in-memory ring buffer,
  2s TTL cache, a separate `thoughts.jsonl`, reasoning_content persistence, and the new
  `/v1/residents/status` HTTP endpoint (the dashboard reads disk directly). Reuse the existing
  date-partitioned inference log and direct disk reads.

## Architecture (Phase 1 — server, all net-new, zero frozen-file edits)

Frozen files (proposed code-freeze): `src/controller/spark/`, `resident-runtime.ts`,
`action-coordinator.ts`. **Phase 1 touches none of them.**

### 1. `StatusAggregator` — `src/controller/observability/status-aggregator.ts` (new)
Pure, disk-backed, never throws out (missing data → nulls). Inputs per resident:
- `runtime-state.json`: `attention`, `tick`, `cognition.activeGoal`, `cognition.lastBrainTick`,
  `cognition.lastBodyActionTick`, `stuckSince`, `deceased`, `lastMeaningfulProgressAt`.
- tail of `<logging.dir>/<slug>/inference/<date>.jsonl` (last N rows): `cause`, `parse_ok`,
  `nooped`, `error` — defensive parse (skip torn lines, copy `wall-snapshot.ts:455-466`).
- the latest health-probe result (see §2).

Produces:
```ts
type ResidentState = 'ALIVE_ACTING' | 'THINKING' | 'STUCK' | 'ERRORING' | 'OFFLINE';
interface ResidentStatusRow {
  resident: string; online: boolean; state: ResidentState;
  ticksSinceAction: number | null;       // primary heartbeat (body/nervous, not brain)
  currentGoal: string | null;            // activeGoal.description
  storyLine: string;                     // "Hans — chopping trees for an axe — acted 2s ago"
  attention: number | null;
  lastInferenceCause: string | null;     // brain_clean | parse_failed | ...
  inferenceErrorRate: number | null;     // share of recent rows that failed/errored
  lastError: string | null;
  thoughtAgeTicks: number | null;        // ticks since lastBrainTick (label thoughts honestly)
}
interface CityStatus {
  health: { state: 'ok'|'error'|'not_configured'|'timeout'|'unknown'; detail: string;
            model?: string; endpoint?: string; latencyMs?: number; at: string };
  residents: ResidentStatusRow[];
  generatedAt: string;
}
```
State derivation (priority order):
1. `deceased` set → `OFFLINE`.
2. runtime-state mtime stale (> window) → `OFFLINE`.
3. health red OR recent inference rows mostly error/parse-failed → `ERRORING`.
4. `stuckSince` set, or a run of non-meaningful progress → `STUCK`.
5. an in-flight brain call (`thinking.mode==='deciding'` / recent `thinking_started`) → `THINKING`.
6. otherwise → `ALIVE_ACTING`.

### 2. Timed health probe → `inference-health.json` — in `src/controller/index.ts` (not frozen)
`setInterval(~10_000ms)` calling the existing `runInferenceHealthProbe({endpoints, timeoutMs})`,
writing the result atomically to `<memory.dir>/inference-health.json`. Distinguish
`ok` / `error` / `not_configured` / `timeout` so "I forgot to set the endpoint" ≠ "Chicago outage".
Caveat documented: this is a name-resolution/liveness probe on the `default` endpoint, not a
resident-prompt-fidelity signal.

### 3. `controller:status` CLI — `src/controller/admin/status-cli.ts` (new) + npm script
Reads `inference-health.json` + runs `StatusAggregator`, prints a table. **Exit code:**
non-zero iff health is non-`ok` OR any resident is `ERRORING` — keyed to health/error state,
**never** to JSONL parse failures (a torn line must not page anyone). The operator fallback that
makes an outage visible even if the dashboard is down.

## Architecture (Phase 2 — dashboard)
- Red/green **health strip** bound to `inference-health.json`, placed **on/adjacent to the map**.
- **Red ring/badge** on the spectator-canvas markers for `ERRORING`/`STUCK`/stale residents —
  because tonight they looked fine standing still.
- Wire `ResidentStatusRow` into the existing liveness ledger + story rows in `App.svelte`.
- Dashboard reads disk directly (no new HTTP endpoint).

## Architecture (Phase 3 — post-Chicago, optional)
- Surface `inferenceError {httpStatus, endpoint, model}` + `reasoning_content` on `LlmResponse`
  (additive, blast radius known) for richer per-resident error attribution and a forensic
  "what was it thinking" capture. Persist counters to `RuntimeState` (plain interface, no schema
  validation — backward compatible) at the existing `inferenceLog.append` site.

## Error handling
Aggregator and CLI degrade gracefully: missing files → nulls, torn JSONL lines skipped, a thrown
aggregator only fails its own call. No new failure modes in the tick loop (Phase 1 doesn't touch it).

## Testing
- Unit: state derivation from fixtures (erroring/stuck/thinking/acting/offline), defensive JSONL
  parse (torn line skipped), health-file read (each state), CLI exit code (ok→0, outage→non-zero,
  parse-noise→0).
- Live smoke: `npm run controller:status` shows the woodcutter's `master-woodcutting` goal +
  `ALIVE_ACTING`; point the model name at a non-loaded id → strip/CLI go `ERRORING` in <10s.

## Sequence (guarantees something visible even if time runs out)
1. `StatusAggregator` + tests (no live deps).
2. Health-probe timer + `inference-health.json`.
3. `controller:status` CLI (operator outage-detector — demo safety net, dashboard-independent).
4. Live-verify against the running controller.
5. Phase 2 dashboard strip + map markers.
