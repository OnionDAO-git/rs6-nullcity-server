# Controller MCP Routine Facade — Design (RB-MCP)

**Status:** Draft v1, pending maintainer review of authorization model + first verb set.
**Author:** Claude.
**Date:** 2026-05-23.
**Roadmap:** RB-MCP. Surfaced as the largest Pillar 2 gap in `docs/strategic-review-2026-05-23.md`.
**Read first:** `feat/runebench-systems-design.md` §11 (Typed MCP Facade Upgrade) — this spec extends that idea with concrete shapes + the controller-side Routine Runner.

---

## Why This Spec Exists

Today humans can interact with residents in exactly one way: in-game chat (`say`). There is no out-of-band path. A maintainer who wants to ask `res:agent` to "make a fire near the embassy" or "follow me to the bank" has to type that into a player character, hope the LLM picks it up, and watch evidence to see if it worked.

This is the largest gap for the OnionDAO June 1 2026 event. The patron loop (J) handles **economic** human → resident interaction. The MCP routine facade is the **operational** seam: an MCP client (Claude Code, Anthropic API, dashboard backend) can ask the controller to execute a named routine on a named resident, get a typed result, and stream progress.

Done well, this also unblocks:
- Dashboard "interventions" (RuneBench `SuggestedIntervention`): suggest → operator approves → controller runs.
- Live demo at the IRL event: presenter can drive a hero resident from the lectern.
- Automated regression smoke: CI can run `make_fire` headless via MCP without spinning up a player.

---

## Goals

- A controller-side MCP server exposes a **whitelisted** set of routine tools (`run_routine`, `run_workflow_card`) and resources (`resident_api`, `workflow_cards`, `observe_resident_progress`, `observe_resident_trajectory`).
- Every routine call is **authorised**, **logged**, and produces a **typed result** the caller can act on.
- Routines run through the same `ActionCoordinator` + `ResidentBody` path as the autonomous loop — no parallel control plane, no kernel bypass.
- A routine call NEVER bypasses Nervous System safety reflexes (eat-when-hurt, flee-when-outmatched). The routine yields if the reflex preempts.
- The autonomous Brain/Body loop continues to run during a routine; the routine just owns the next action slot until it completes or its `maxTicks` budget elapses.

## Non-Goals

- **No `execute_code`** in the live resident loop. RuneBench's `execute_code` is deferred to local-only experimental contexts and explicitly excluded from this facade. Codified in `docs/runebench-conventions-adopted.md`.
- No MCP-driven SOUL editing or module loading. Routines change in-world state; they don't change identity or wiring.
- No multi-resident broadcast routines (one routine = one resident). Multi-resident orchestration is L (cross-resident lore) territory.
- No human direct-control mode ("I am the agent now"). The resident remains autonomous; the routine is a request, not a takeover.

## Constraints

- TypeScript, Node 24+, MCP SDK already in use elsewhere in this repo.
- Must coexist with Codex's benchmark / runtime work. New file paths (`src/controller/mcp/`, `src/controller/routines/`) so no monolith touches.
- Authorization must work both for **local maintainer** (file-based token list) and **shared dashboard** (per-operator API key, future).
- Routines are **whitelisted**, not LLM-generated. Adding a new routine is a code change with a test.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MCP Client (Claude Code / Anthropic API / dashboard backend / CI smoke)  │
│                                                                          │
│   tool.run_routine({ resident: 'res:agent', routine: 'make_fire',        │
│                       params: {}, maxTicks: 200 })                       │
│                                                                          │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ stdio / streamable HTTP
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ src/controller/mcp/server.ts   (NEW)                                     │
│                                                                          │
│ 1. Authenticate caller via token (env: CONTROLLER_MCP_TOKENS or          │
│    per-operator API key).                                                │
│ 2. Validate request shape via Zod (resident exists, routine in catalog,  │
│    maxTicks in 1..1200 range, params match routine schema).              │
│ 3. Lookup ResidentRuntime by name; return 404 if not registered.         │
│ 4. Delegate to RoutineRunner (below). Stream progress events back as     │
│    MCP notifications.                                                    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ src/controller/routines/routine-runner.ts   (NEW)                        │
│                                                                          │
│ - ROUTINE_CATALOG: { make_fire, chop_tree, bury_bones, safe_combat,      │
│   follow_player, run_workflow_card } each with paramSchema + impl.       │
│ - Each impl is a thin async wrapper that:                                │
│   * pushes a high-priority intent into ActionCoordinator                 │
│   * watches ProgressTracker for completion or stuck signals              │
│   * yields if Nervous System preempts (no override)                      │
│   * returns { status: 'completed' | 'stuck' | 'preempted' | 'timeout',   │
│              effectEvidenceCount, ticksUsed, lastError? }                │
│ - Cancels via AbortSignal on caller disconnect.                          │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Existing ResidentRuntime / ActionCoordinator / ResidentBody              │
│ — no changes required.                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Where this slots in

- `src/controller/mcp/` is a new directory; nothing in `src/controller/` currently exposes MCP.
- `src/controller/routines/` is also new. The existing `src/controller/spark/runescape-body-routines.ts` is body-internal — those routines are kernel-private helpers Body calls during autonomous decisions. The new RoutineRunner *also* invokes them but via a typed external surface.
- The dashboard repo (`rs6-nullcity-residents-dashboard`) can later use the MCP HTTP transport to drive interventions. That's a separate slice.

---

## Components

### 1. MCP Server (`src/controller/mcp/server.ts`)

Uses the official MCP TypeScript SDK. Exposes one tool group + four resources.

**Tools (caller-invoked):**

```ts
// run_routine
interface RunRoutineRequest {
    resident: string;                // e.g. 'res:agent'
    routine: 'make_fire' | 'chop_tree' | 'bury_bones' | 'safe_combat' | 'follow_player';
    params?: RoutineParams;          // routine-specific (typed below)
    maxTicks?: number;               // default 200, max 1200 (~10 min at 600ms ticks)
}

interface RunRoutineResponse {
    status: 'completed' | 'stuck' | 'preempted' | 'timeout' | 'rejected';
    ticksUsed: number;
    effectEvidenceCount: number;
    trajectoryHints?: string[];      // first/last meaningful progress moments
    lastError?: string;              // populated if rejected/stuck
}

// run_workflow_card (alias path for higher-level work)
interface RunWorkflowCardRequest {
    resident: string;
    cardId: string;                  // matches WorkflowCard.id in runebench-playbook.ts
    params?: Record<string, unknown>;
    maxTicks?: number;
}
```

**Resources (caller-read):**

- `resident_api` — list of registered residents + their current state summary (read-only mirror of `controller-host.listResidents()`).
- `workflow_cards` — the full WorkflowCard catalog so callers can discover what's runnable.
- `observe_resident_progress` — last N `ProgressTracker` samples for a resident.
- `observe_resident_trajectory` — last N trajectory lines for a resident.

### 2. RoutineRunner (`src/controller/routines/routine-runner.ts`)

The execution kernel. Maps each whitelisted routine name to an implementation that:

1. Validates `params` via the routine's Zod schema.
2. Pushes an **intent** (not a raw `AgentAction`) into `ActionCoordinator` with priority `routine` (higher than autonomous Brain, lower than Nervous System reflex).
3. Polls `ProgressTracker` and `ResidentBody.events` on every tick.
4. Returns when:
   - Completion evidence is observed (per routine-specific predicate).
   - Stuck condition (>= 3 consecutive ticks with no meaningful progress).
   - `maxTicks` budget exhausted.
   - Caller aborts (AbortSignal).
   - Nervous System preempts the routine slot (HP < 20%, food crisis, flee).

### 3. Authorization

- Local-mode: `CONTROLLER_MCP_TOKENS` env var holds comma-separated tokens; every MCP connection must present one in the `authorization: bearer <token>` header (stdio mode uses the same env via wrapping).
- Tokens carry an implicit operator name (env: `CONTROLLER_MCP_OPERATOR_FOR_<token>`) recorded on each call.
- All calls are logged to `data/mcp-call-log.jsonl` with `{ ts, operator, resident, routine, paramsHash, status, ticksUsed }`. Per-operator rate limit: 60 routine calls / hour (configurable).
- Shared-dashboard mode (later): replace env tokens with an HTTP cookie / OAuth flow. Out of scope for this spec; the env-token mode is what unblocks the local maintainer + CI smoke.

### 4. Routine Whitelist (first set)

Each routine has a Zod paramSchema, an impl, and a completion predicate.

| Routine          | Params shape                                   | Completion predicate                                |
|------------------|------------------------------------------------|-----------------------------------------------------|
| `make_fire`      | `{}` (uses nearest log + tinderbox)            | `fire_lit` event observed                           |
| `chop_tree`      | `{ targetCoord?: {x,y,z} }`                    | `inventory_log_added` evidence                      |
| `bury_bones`     | `{}` (all bones in inventory)                  | `inventory_bones_zero` evidence                     |
| `safe_combat`    | `{ target: { kind, name?, coord? }, killCount: number }` | N kills of safe targets, HP stays > 30%   |
| `follow_player`  | `{ player: string, distance: number }`         | Within `distance` tiles for >= 5 consecutive ticks  |

`run_workflow_card` accepts any `WorkflowCard` by id — broader, looser completion.

### 5. Error taxonomy

| `status: 'rejected'` `lastError` | Meaning                                                  |
|----------------------------------|----------------------------------------------------------|
| `'resident_not_found'`           | Resident name not in runtime registry                    |
| `'routine_not_whitelisted'`      | Routine name not in catalog                              |
| `'params_invalid'`               | Zod paramSchema rejected `params`                        |
| `'maxticks_out_of_range'`        | `maxTicks` < 1 or > 1200                                 |
| `'unauthorized'`                 | Missing / bad bearer token                               |
| `'rate_limited'`                 | Operator hit hourly cap                                  |

| `status: 'preempted'` `lastError` | Meaning                                                 |
|-----------------------------------|---------------------------------------------------------|
| `'nervous_eat_when_hurt'`         | Reflex took the action slot to eat                      |
| `'nervous_flee_when_outmatched'`  | Reflex routed resident to safe POI                      |
| `'nervous_death'`                 | Resident died mid-routine                               |
| `'nervous_help_request'`          | Stuck-help reflex took the slot to broadcast            |

`status: 'stuck'` means `ProgressTracker` saw `>= 3` no-progress ticks. `status: 'timeout'` means `maxTicks` elapsed without completion. `status: 'completed'` is the success path.

---

## Data Flow Example — `run_routine make_fire`

```
1. Caller sends: tool.run_routine({ resident: 'res:agent', routine: 'make_fire', maxTicks: 100 })
2. MCP server validates token, looks up runtime, validates params.
3. RoutineRunner.makeFire(runtime, {}, maxTicks=100):
   a. Push intent { kind: 'make_fire', priority: 'routine' } into ActionCoordinator.
   b. Body picks it up next tick, decomposes into use_item_on_item (tinderbox on logs).
   c. ProgressTracker observes inventory delta (logs--, fire object appears).
   d. RoutineRunner sees fire_lit event → completion predicate true → return.
4. MCP server returns:
   {
     status: 'completed',
     ticksUsed: 7,
     effectEvidenceCount: 2,
     trajectoryHints: ['tinderbox_used', 'fire_lit'],
   }
5. data/mcp-call-log.jsonl receives:
   { ts: '...', operator: 'maintainer-james', resident: 'res:agent',
     routine: 'make_fire', paramsHash: 'sha256:...', status: 'completed',
     ticksUsed: 7 }
```

If Nervous System preempts mid-routine (e.g. an aggressor appears), the response becomes:

```
{ status: 'preempted', lastError: 'nervous_flee_when_outmatched', ticksUsed: 4, ... }
```

The caller can retry once the resident is safe.

---

## Testing

### Unit

- `mcp-server.test.ts` — token auth, Zod request validation, request → RoutineRunner dispatch with mocked runner.
- `routine-runner.test.ts` — each whitelisted routine in isolation with mocked ActionCoordinator + ProgressTracker:
  - happy path (`completed`)
  - stuck path (no progress → `stuck`)
  - timeout path (`maxTicks` exhausted → `timeout`)
  - Nervous System preempt path (`preempted` with right `lastError`)
  - cancellation via AbortSignal
- Per-routine integration test: real ActionCoordinator + MockPerception verifies the routine submits the expected `AgentAction` sequence.

### Integration

- MCP client connects via stdio → calls `run_routine make_fire` against a test runtime → asserts completion + trajectory has expected line kinds.
- `mcp-call-log.jsonl` integration test asserts the append shape.

### Live smoke

- `npm run controller:dev` + start MCP server → `mcp-client-cli run_routine --resident res:agent --routine make_fire` → assert fire_lit appears in dashboard within 30 seconds.

---

## Decomposition Into Plans

Build order — each is a single-day slice:

### Plan RB-MCP-α — RoutineRunner skeleton (NO MCP yet)

- `src/controller/routines/routine-runner.ts` with the catalog skeleton + one routine impl (`make_fire`).
- Unit tests for the impl + completion predicate + stuck + timeout paths.
- No MCP integration. Direct method calls only. Validates the kernel-side seam.

### Plan RB-MCP-β — MCP server boilerplate + token auth

- `src/controller/mcp/server.ts` boots the MCP SDK server, exposes `resident_api` resource only (read-only listing).
- Token validation via env. Per-call log append.
- No tools yet. Validates the transport + auth path independently.

### Plan RB-MCP-γ — Wire run_routine tool to RoutineRunner

- Add the `run_routine` tool to the MCP server.
- Connect through to the Plan-α RoutineRunner.
- Integration test via in-process MCP client.

### Plan RB-MCP-δ — Routine catalog expansion

- Add `chop_tree`, `bury_bones`, `safe_combat`, `follow_player` routine impls.
- Each gets full test coverage per the Testing section above.

### Plan RB-MCP-ε — `run_workflow_card` + resources

- Add the workflow-card path so callers can run anything in the WorkflowCard catalog.
- Add `workflow_cards`, `observe_resident_progress`, `observe_resident_trajectory` resources.
- Live smoke at the end.

**Recommended order: α → β → γ → δ → ε.** Skeleton + auth land independently, then the wiring connects them, then catalog grows.

Total estimate: ~5 days of focused work. Could land core path (`α + β + γ + make_fire`) in 2 days for an event demo.

---

## Open Questions

1. **Streaming progress events.** MCP supports notifications mid-call. Should `run_routine` stream `progress` events to the caller in real time (e.g. "chopped log 1/5"), or batch into the final response? — *Recommendation: batch v1, streaming v2.*

2. **Concurrent routines per resident.** Should a second `run_routine` against the same resident reject ("busy") or queue? — *Recommendation: reject with `lastError: 'busy'` in v1; queue is L (cross-resident) territory.*

3. **Routine vs autonomous Brain priority.** Routine intent priority sits above autonomous Brain (so it preempts) but below Nervous System. Confirm this ordering with one explicit test in `action-coordinator.test.ts`. — *Maintainer confirmation needed.*

4. **Authorization scope per token.** Should some tokens only get read resources, not `run_routine`? — *Recommendation: yes, add a `scopes: ['read'|'run']` env. v1 can be all-or-nothing.*

5. **Dashboard integration shape.** When the dashboard wires this (post-event), does it speak MCP directly or via a thin HTTP wrapper? Maintainer decision needed before D-MCP slice.

6. **Routine catalog discovery.** Should `workflow_cards` resource be the canonical "what can I ask for?" source, or should `run_routine` callers consult a separate `routines` resource? — *Recommendation: separate `routines` resource for typed routines, `workflow_cards` for looser cards.*

---

## Cross-references

- `feat/runebench-systems-design.md` §11 — original RuneBench idea.
- `docs/runebench-conventions-adopted.md` — `execute_code` exclusion + low-level server-MCP keep.
- `docs/strategic-review-2026-05-23.md` — Pillar 2 gap analysis.
- `src/controller/spark/runescape-body-routines.ts` — kernel-internal routines the runner wraps.
- `src/controller/thinking/runebench-playbook.ts` — WorkflowCard catalog.
- `src/controller/actions/action-coordinator.ts` — priority-based intent acceptance + cancellation.
- `src/controller/evidence/progress-tracker.ts` — completion + stuck signals.
- `src/controller/evidence/trajectory-builder.ts` — trajectory hint source.
- Future: `rs6-nullcity-residents-dashboard` — D-MCP slice will consume via HTTP.
