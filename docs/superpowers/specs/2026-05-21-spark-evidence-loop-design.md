# SPARK Evidence Loop And Library Of Souls — Design

**Status:** Draft v2.1, two rounds of expert subagent review applied; pending maintainer approval.
**Author:** Claude (with the maintainer in brainstorming).
**Date:** 2026-05-21.
**Supersedes:** floating recommendations in `feat/runebench-agent-design.md` and `feat/runebench-systems-design.md` for ProgressTracker, TrajectoryBuilder, dashboard detail data sources, and Library of Souls export.
**Coordinates with:** `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` (a separate roadmap delta proposes a new Workstream I to track this work; see `2026-05-21-roadmap-delta-evidence-loop.md`).

**Revision history:**
- v1 (2026-05-21, morning): initial draft from brainstorming.
- v2 (2026-05-21, afternoon): incorporated expert subagent feedback on (a) early-exit paths in `spark.tick`, (b) cross-repo `portrait.json` field schema, (c) emotional resonance of the artifact (voice, patrons, per-life chapters, last words), (d) integration realities for ActionCoordinator, LegacyTracker, plan advance, and EvidenceStore ownership. Sections affected: Architecture, Components, Data Flow, Library of Souls, Testing, Decomposition, Open Questions.
- v2.1 (2026-05-21, evening): final-review pass resolved four follow-up issues: `endTick(reason)` signature locked, all 8 spark.tick exit reasons enumerated by table, `ActionCoordinator` callbacks split into `onAckReady` + `onEffectResolved` (no semantic ambiguity), `LegacyProgress` interface locked. Roadmap delta now enumerates benchmark names instead of using `[C3]–[C4]` task identifiers.

## Relationship To Null City v1 And v2

This repo (`rs6-nullcity-server`) is a **deliberate divergence** from Null City v2 — it is the Runescape-flavored implementation, not the toned-down event-MVP that ships from `nullv2`. The divergence is intentional and recorded here so future agents and Dev know which canon governs which repo.

- **v1** (the original `NullCity` repo) was the aspirational Kubernetes-native worldbox with full autonomous residents, hero arcs, Spark-style needs, Honcho-style memory, and a Library of Souls. It set the emotional bar.
- **v2** (the `nullv2` repo) is the shippable event app: simpler economy (Shards, factions, resources, achievements), four canonical factions, four canonical needs, a post-mortem Library of Souls row in `packages/db/src/schema/residents.ts`, and the June 1 wall-map experience. It does not currently support resurrection, multi-life chapters, or living portraits.
- **rs6-nullcity-server** picks Runescape (RS build #435) as its substrate, so v2's embassy rooms, named factions, and lanyard mechanics don't map. We port concepts (patrons, factions, civic recognition, libraries) with **open minds** for Runescape-native adaptations. Where this spec and v2 disagree (multi-life accumulation; living vs. post-mortem library; invented vs. canonical patron taxonomy) the rs6 implementation governs *this repo only* and is not implicitly proposed as a v2 change.

The naming collision around "SPARK" is real: v2 uses SPARK for the four-needs framework (`packages/types/src/spark.ts` — hunger/safety/social/purpose), while this repo uses SPARK for the agent kernel (`src/controller/spark/spark.ts`). Both are correct in their repo. Future cross-repo work should disambiguate explicitly (e.g., "SPARK-needs" vs. "SPARK-kernel").

Ideas worth porting from v1/v2 that are not yet in this spec are catalogued in `docs/null-city-ideation-backlog.md` so they don't decay into markdown bit-rot.

## Why This Spec Exists

Two problems compound right now:

1. SPARK residents struggle to act effectively because the kernel cannot tell whether an agent is making progress, repeating itself, or stuck. The `[F3]` stuck recovery task and the floating "ProgressTracker" idea in `feat/runebench-agent-design.md` both point at the same missing capability: an objective record of what happened, sampled often enough to detect progress and stalls.
2. Null City's emotional loop (pride, attachment, grief, legacy) depends on humans being able to read a resident's story. Today there is no artifact that tells that story; trajectories are scattered across inference logs and memory files.

This spec adds an **Evidence Layer** under the SPARK kernel that captures a resident's life as append-only structured events, and a **Library of Souls** that maintains a per-resident living narrative on top of those events. Death is one notable event among many, not the trigger that creates the artifact.

## Goals

- Residents leave a per-tick objective record (perception, decision, action, outcome) that the kernel, dashboard, and humans can read.
- A `ProgressTracker` surfaces "last meaningful progress" so SPARK and modules can detect stalls without bespoke heuristics.
- SPARK benchmarks adopt a standard 3-tier reward emission and a failure taxonomy so results are comparable and recoverable from logs alone.
- Each resident has one Library entry that grows over their existence. Deaths and rebirths are events in the entry, not the end of it.
- The Library export is best-effort, asynchronous, and never blocks the agent's decision loop.
- The Evidence Layer offers a side-benefit mock-perception adapter so SPARK modules can be unit-tested without a running RuneJS server.

## Non-Goals

- Replacing SPARK's existing inference logs or memory store; this layer is additive.
- Live streaming evidence to the dashboard in real time (the dashboard reads files on demand; the streaming concern is `[D2]/[D3]` work owned elsewhere).
- Cross-resident shared memory or faction rumor (a separate future spec).
- Server-side autonomy benchmarks beyond what `[C4]` already plans.
- Editing or replacing existing trajectory/log conventions in places where current code already writes structured artifacts (e.g., benchmark artifacts in `src/controller/benchmarks/benchmark-artifact.ts`). The Evidence Layer wraps and complements those; it does not supersede them.

## Constraints

- TypeScript, Node 24+, existing repo conventions (Zod for schemas, Jest for tests, Biome for lint/format).
- Must not break `[A1]`–`[A7]` SPARK facade contracts. Modules see only what their facade exposes; Evidence Layer is kernel-owned.
- Must not touch files currently in flight on the `nullcity` branch (Codex's `combat-prayer-10m`, `cli.ts`, `hybrid-agent-thinking-module.ts`) or the residents-dashboard repo (Dev's branch).
- Same-process TypeScript is not a sandbox; treat all evidence as potentially observable by reviewed modules through the telemetry facade, not as a private kernel channel.
- Evidence writes are best-effort and bounded; a slow disk or out-of-space condition must degrade gracefully (drop oldest, never crash the tick).
- **Single-process constraint:** one `ControllerHost` (one Node process) owns one `CONTROLLER_MEMORY_DIR` at a time. Multi-process sharing of a memory dir is out of scope; `EvidenceStore` does not implement OS-level file locking. If parallel controllers become a requirement, that is a future spec.
- **`RuntimeState` additions required:** P1 must add two optional fields to `RuntimeState`:
  - `lastMeaningfulProgressAt?: number` — tick number of last meaningful progress, or undefined if never measured.
  - `stuckSince?: number` — tick number when stuck was first detected (cleared on next meaningful progress), or undefined.
  These are kernel-set, module-readable via the existing read-only state facade (no new facade required, but the facade snapshot must propagate the new fields).
- **`LegacyUpdate` extension required:** P2 (or earlier if convenient) extends `LegacyUpdate` to optionally include a `legacyProgress` payload. The interface, minimal but contract-locked here so P2 plans don't diverge:

  ```ts
  interface LegacyProgress {
    schemaVersion: 1;
    ticksLived: number;                 // total ticks across all lives or current life, see lifeIndex
    lifeIndex: number;                  // 1-based; which life completed
    completedMilestones: string[];      // tag list, soul-defined
    deathCause: 'attention_exhausted' | 'legacy_complete' | 'endured' | 'died_in_combat' | 'died_other' | string;
    deathContext?: Record<string, unknown>;  // free-form; e.g. { hpAtDeath: 0, attackerKey: 'goblin' }
  }

  interface LegacyUpdate {
    complete: boolean;
    cause?: string;
    legacyProgress?: LegacyProgress;    // present iff complete === true (P2+)
  }
  ```

  Until P2 lands, the legacy event row in `timeline.jsonl` carries only the `cause` string and `lifeIndex` derived from `index.json`. The `legacyProgress` block is field-additive — older legacy events without it still parse.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                          SPARK kernel                              │
│   spark.tick()  ┌────────────► EvidenceWriter ── trajectory.jsonl  │
│                 │                                                  │
│                 ├────────────► ProgressTracker ── progress.jsonl   │
│                 │                                                  │
│                 ├──[legacy: dead/rebirth/etc.]──► Library updater  │
│                 │                                  ├ portrait.md   │
│                 │                                  ├ timeline.jsonl│
│                 │                                  └ portrait.json │
│                 │                                                  │
│   BenchmarkRunner ──► VerifierConventions ── reward.{json,txt}     │
│                                              + failure_reason       │
└────────────────────────────────────────────────────────────────────┘
                                  │
                  CONTROLLER_MEMORY_DIR/<resident>/evidence/
                  CONTROLLER_MEMORY_DIR/<resident>/library/
                  CONTROLLER_BENCHMARK_DIR/<runId>/...
```

The Evidence Layer never participates in the decision; it only observes. The kernel calls Evidence Layer methods after the tick's decision is made and actions are emitted. If Evidence Layer throws, the kernel logs the error and continues — evidence loss is preferred over agent loss.

### Integration with `spark.tick`

Reference: `src/controller/spark/spark.ts:48-199` (line numbers as of 2026-05-21; treat as **guidance only** — when implementing, re-locate insertion points by symbol and surrounding context, not by line number).

**Early-exit discipline (added in v2 per architecture review M1/M3).** `spark.tick` has multiple early-return paths in addition to the normal end of the function. Every Evidence Layer integration MUST wrap the tick body so that `endTick(reason)` runs on every return path. The implementation uses a scope-guard pattern (e.g., `try { ... } finally { evidence.endTick(this.endTickReason) }` where each return point sets `this.endTickReason` before returning) so that no exit leaves a tick without a terminator line.

**Named exit reasons** (the complete enumeration; the reason string is the `endTick.reason` field on the `end_tick` trajectory line):

| spark.ts location | Condition | `reason` |
|---|---|---|
| 57-63 | `legacyUpdate.complete` | `'legacy_complete'` |
| 67-74 | `attention_exhausted` | `'attention_exhausted'` |
| 76-79 | `advancePlan` returned non-null | `'plan_continuation'` |
| 81-83 | `!winner \|\| winner.priority <= 0` | `'hook_noop'` |
| 85-100 | budget rejected | `'budget_exhausted:<window>'` |
| 147-149 | `parseCompletion` failed | `'parse_failed'` |
| 188-191 | post-action legacy complete (fall-through logout appended) | `'legacy_complete_post_action'` |
| 193-198 | normal end | `'tick_complete'` |

Implementers MUST add a unit test that drives `spark.tick` down every row in this table and asserts the matching `end_tick` line appears in the trajectory.

Insertion points (numbered as in the tick sequence; final emit ordering is enforced by the scope guard, not by hand):

1. **Tick start** (after `this.state.tick += 1` at `spark.ts:49`): `evidence.beginTick(state.tick, perception)`. The writer captures perception fingerprint (small hash + size, not full payload — full payload is captured by step 7's `decision` line via the LLM prompt envelope).
2. **Legacy update** (after `legacy.update` at `spark.ts:56`): if `legacyUpdate.complete`, emit `evidence.recordLegacy(event)` THEN set the scope-guard reason to `'legacy_complete'` THEN return. The `endTick('legacy_complete')` line is written by the guard before control leaves the function. This is the death log entry.
3. **Hook winner** (after `hooks.evaluate` at `spark.ts:66`): `evidence.recordHook(winner)` line — `{ kind: 'hook', cause, priority, source }`.
4. **Budget exhausted** (at `spark.ts:85-100`): `evidence.recordBudget(budget)` line — already-synthetic event, just persisted. The scope guard then terminates the tick with reason `'budget_exhausted:<window>'`.
5. **LLM decision** (after `parseCompletion` at `spark.ts:107-150`): `evidence.recordDecision({ moduleId, moduleVersion, promptTokens, completionTokens, actionKinds, memoUpdates, planChange, promptHash })`. Full LLM prompt/completion is NOT stored in trajectory — it stays in the existing inference log. The trajectory line carries `promptHash` (SHA-256 of the prompt envelope text); the inference log MUST also record `promptHash` so a reader can join them. The promptHash field addition to inference log is a P1 deliverable (see Constraints).
6. **Plan recording** (revised in v2; original "spark.ts:76-79 advancePlan" insertion is inaccessible). Plan changes are recorded from inside the LLM-decision block at `spark.ts:176-182` when `parsed.plan` is non-null. The scope guard reason on this branch is `'plan_advanced'`. Plan-advance early-return at `spark.ts:76-79` records nothing of its own (the plan was already recorded on the tick that *set* the plan); the scope guard terminates with reason `'plan_continuation'`.
7. **Action emission** (at the action collection point near `spark.ts:184-194`): one `evidence.recordAction(action, requestId)` line per emitted action. `requestId` is generated by the kernel (UUID) before the action leaves `spark.tick`, allowing ActionCoordinator to correlate without inventing its own id.

**ActionCoordinator integration (clarified in v2, signature locked).** ActionCoordinator does not currently expose a result-resolved hook. P1 adds two optional callbacks to `ActionCoordinator.submit()` — one for the immediate ack, one for the post-effect resolution. They fire at distinct points, are independent, and carry distinct payloads:

```ts
interface ActionCoordinatorSubmitInput {
  // ... existing fields
  // Fires synchronously when the gateway acks the submitted action.
  // Use: write 'action' line into trajectory (already done by spark.recordAction; this is for non-kernel submitters).
  onAckReady?: (requestId: string, ack: ActionResult) => void;
  // Fires after the effect wait resolves (success, failure, or timeout).
  // This is what triggers trajectory's 'action_result' line.
  onEffectResolved?: (requestId: string, effect: ActionEffectOutcome) => void;
}

interface ActionEffectOutcome {
  status: 'success' | 'failure' | 'timeout' | 'aborted';
  ackResult: ActionResult;             // pass-through of the original ack
  evidence?: Record<string, unknown>;  // perception delta evidence the coordinator collected
  resolvedAtTick: number;
}
```

`ResidentRuntime` supplies `onEffectResolved`, routing into `trajectoryBuilder.recordActionResult(requestId, outcome)`. `onAckReady` is unused by the kernel today (the ack write is already done at action-emission time) but is exposed for future module-side submitters. Trajectory line `kind: 'action_result'` is written only on `onEffectResolved`.

This distinction matters because the kernel records an `action` line at submission (insertion point #7) — recording an `action_result` on ack would duplicate that information. The valuable evidence is the *effect outcome*, which is only known later.

**Inference log content-hash (clarified in v2).** Today `InferenceLog.append()` writes `{ t, ...entry }`. P1 extends it to include a `promptHash: string` (SHA-256 of prompt envelope) and a `completionHash: string` (SHA-256 of completion JSON). The hash is computed once by the kernel and passed into both the trajectory `decision` line and the inference log line. No index file is added — joining is O(n) scan when needed, which is acceptable for the read patterns (dashboard detail page reads one resident's recent logs, not a global query).

### Progress Tracker integration

The Progress Tracker subscribes to perception events through the same `beginTick` hook. It maintains a small in-memory rolling state per resident:

- last sampled skill XPs, inventory counts, position, HP
- `lastMeaningfulProgressAt` (tick number)
- `stuckSince` (tick number, or null)

A delta exceeding any per-metric threshold updates `lastMeaningfulProgressAt`. After `STUCK_THRESHOLD_TICKS` (default 20) without meaningful progress, `stuckSince` is set; this surfaces to SPARK kernel as a synthetic event (`stuck_detected`) and to the Library timeline as a notable event. Modules can read the `stuckSince` value through the existing read-only state facade (no new facade required — surfaced in `RuntimeState` already).

### Library of Souls — per resident

(Substantially revised in v2 per product/emotional review.) The Library is not a log; it is a memorial. The schema below is engineered for emotional resonance — verbatim voice, named relationships, unfulfilled wants, per-life chapter structure, and patron acknowledgment — not just record fidelity. Kernel telemetry (hooks, budgets, benchmark boundaries) stays in `trajectory.jsonl`; only story events land in `timeline.jsonl`.

`library/<resident>/` directory layout:

- `portrait.md` — the canonical human-readable narrative. Regenerated periodically (every N ticks, default 200) and on notable events (death, rebirth, faction milestone, peer first-meet, low-HP-survived, patron event).
- `portrait.json` — same data, machine-readable. Read by dashboard / wall map. **Field schema defined below; cross-repo contract.**
- `timeline.jsonl` — append-only event log of *story* events (see split below). Bounded distillation; trajectory holds the firehose.
- `index.json` — per-resident metadata (created, last-updated, lives count, current state, faction).

#### Two-lane significance (revised in v2)

Trajectory events split into two lanes when distilled. Both lanes are defined as predicates in `evidence/significance.ts`:

**Story lane** — promoted to `timeline.jsonl` and feeds `portrait.md`:

- `legacy_event` — death, rebirth, attention exhausted, planned legacy reached.
- Near-death survival — HP dropped below threshold, then recovered before the tick window closed.
- "Firsts" — first time encountering a named peer, first interaction with an object kind, first XP in a skill, first time entering a place.
- Every `say` action — verbatim text, never paraphrased.
- `stuck_detected` and `stuck_recovered`.
- Faction-state changes (faction field present, even if state-change wiring is deferred).
- Patron events — `patron_gift`, `patron_witness`, `patron_sponsor` (schema present from day one; ingestion source is event-bus or REST hook from the OnionDAO event flow — wiring is out of scope for this spec, but the timeline accepts the events).
- Relationship milestones — first meeting a named peer, ≥3 interactions with same peer (mark as `relationship_repeated`), last interaction with a peer before death (mark as `relationship_parting`).
- Unfulfilled wants — at death, any active `pursue_goal` or `request_attention` that never resolved is promoted as a `wants_unfulfilled` event listing the wants.

**Diagnostic lane** — stays in `trajectory.jsonl`; never enters portrait:

- `hook` lines, `budget` lines, `plan` lines, `error` lines.
- Benchmark task start/end (these are dev-facing run boundaries, not life moments).
- `action_result` lines that succeeded without notable side effects.

#### Voice capture

Every `say` action is recorded verbatim in `trajectory.jsonl` (kind `say`, text field unchanged) AND promoted to `timeline.jsonl` immediately. The portrait template always quotes — never paraphrases — the resident's speech.

- The final `say` action before each `legacy_event` is tagged `last_words: true` in the timeline.
- The portrait's "In their own words" section selects 5–12 quotes chronologically across the resident's lives (weighted toward firsts, last words, and quotes that mention named peers or wants).

#### Per-life chapter structure

The `index.json` `lives` counter is incremented on every `legacy_event` that includes `rebirth: true`. Each life is a chapter in the portrait. The portrait template:

- Generates an epithet/title for each life from notable events of that life (e.g., a life with high firemaking activity and a death by drowning might produce "The one who could not light the rain"). Epithet generation is template-driven: a small set of patterns seeded by (life events × death cause × dominant skill) with the resident's name as random seed for stability. No LLM.
- Renders each life as 2-4 sentence prose chapters drawn from significance events of that life.
- Renders the death of each life as its own `### How it ended` subsection, quoting the last words if any.

Death is one event in the resident's story, but it is rendered with visual weight (chapter break, "How it ended" subheader, quoted last words) so it carries the appropriate gravity without dominating the artifact.

#### Patron loop (added in v2)

Null City's emotional design centers humans as patrons/witnesses/sponsors. The Evidence Layer accepts patron events from external sources (event-driven OnionDAO Shards flow, manual admin event, dashboard human attestation — wiring is out of scope here but the timeline schema is open for ingestion):

```ts
interface PatronEvent {
  kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor';
  ts: string;
  tick: number;
  patronHandle: string;        // OnionDAO handle / Shards account / 'anonymous'
  artifact?: string;           // e.g. 'tinderbox', 'shards:50', 'attendance:workshop-001'
  note?: string;               // free-text, e.g. "Alice gave at the workshop"
}
```

The portrait has a `## Patrons` section listing each patron with one sentence (e.g., "Alice gave him a tinderbox at the founding workshop; he used it twice before the grove fire."). The narrative is template-generated from `(patronHandle, artifact, usageEvents)` joined on artifact identity. Even with no wired patron source on day one, the section appears as "No recorded patrons" in the portrait — but the schema is present, dashboard can read it, and a future PR can begin emitting `patron_gift` lines without a schema migration.

#### Significance predicates

All criteria (story and diagnostic) are encoded in `evidence/significance.ts` as small predicates with unit tests. Easy to add new patterns; never refactor in the writer.

#### `portrait.json` schema (locked in v2 — cross-repo contract)

```ts
interface Portrait {
  schemaVersion: 1;
  residentName: string;
  epithet?: string;                                  // current life's epithet
  faction?: string;                                  // from soul if present
  born: { ts: string; tick: number };
  lastUpdated: { ts: string; tick: number };
  currentState: 'living' | 'deceased' | 'reborn';
  livesCount: number;
  lives: PortraitLife[];
  voice: { quotes: PortraitQuote[] };                // 5-12 entries
  relationships: PortraitRelationship[];
  patrons: PortraitPatron[];                         // empty array OK
  wants: PortraitWants;                              // current + unfulfilled
  artifacts: string[];                               // free-form notable artifacts/achievements
  cost?: { totalUsd: number; perLife: number[] };    // present iff pricing config wired
}

interface PortraitLife {
  index: number;                                     // 1-based
  epithet?: string;
  bornTick: number;
  diedTick?: number;
  deathCause?: string;
  durationTicks: number;
  notableEvents: Array<{ tick: number; kind: string; summary: string }>;
  lastWords?: string;                                // verbatim final say
}

interface PortraitQuote {
  tick: number;
  text: string;
  lifeIndex: number;
  tag?: 'first' | 'last_words' | 'mentions_peer' | 'mentions_want';
}

interface PortraitRelationship {
  peer: string;                                      // peer resident or player handle
  firstMet: { tick: number };
  interactions: number;
  lastInteraction?: { tick: number; partingBeforeDeath: boolean };
}

interface PortraitPatron {
  handle: string;
  events: Array<{ kind: 'patron_gift' | 'patron_witness' | 'patron_sponsor'; ts: string; artifact?: string }>;
  sentence: string;                                  // template-rendered acknowledgment
}

interface PortraitWants {
  current: string[];                                 // active goals at last update
  unfulfilledAtDeath: Array<{ lifeIndex: number; want: string }>;
}
```

The schema is field-additive only. Field removals or renames require a `schemaVersion` bump and a coordinated migration with Dev (see `docs/agent-coordination.md`).

### Verifier conventions

A new `src/controller/benchmarks/verifier-conventions.ts` helper wraps existing benchmark verifier output. It accepts the existing `BenchmarkArtifact` shape and emits, in addition to the current artifact:

- `reward.json` (structured: `{ value, unit, taskId, runId, moduleId, moduleVersion, samples?: any[], failure_reason: FailureReason }`)
- `reward.txt` (numeric value, single line, for Harbor-style ingestion)
- stdout markers `__REWARD_JSON_START__\n{...}\n__REWARD_JSON_END__` for log-only recovery

`FailureReason` enum (Zod-validated):

```
'none' | 'timeout' | 'exception' | 'goal_not_met' | 'died' |
'budget_exhausted' | 'kernel_aborted' | 'unknown'
```

Existing benchmark CLI continues to work; new conventions are *additive*. A separate plan slice (P2) wires the wrapper into the runner.

---

## Components

### 1. `EvidenceStore` (`src/controller/evidence/evidence-store.ts`)

**Ownership (clarified in v2):** one `EvidenceStore` per resident. Instantiated by `ResidentRuntime` in its constructor, alongside the existing per-resident memory and log handles. Shared resources (the `CONTROLLER_MEMORY_DIR` root, the controller-level `MemoryStore`/`ActionLog`/`InferenceLog` singletons) are unchanged. EvidenceStore writes are namespaced by resident path, so concurrent residents in the same process never share a file.

Filesystem layout under `CONTROLLER_MEMORY_DIR/<resident>/evidence/`:

```
evidence/
  trajectory/
    YYYY-MM-DD-HHMMSS-<session>.jsonl     # one per session
    current -> symlink to active file
  progress/
    YYYY-MM-DD-HHMMSS-<session>.jsonl
    current -> symlink to active file
  index.json                              # session index + rotation policy
```

Public API:

```ts
class EvidenceStore {
  constructor(residentName: string, root: string);
  beginSession(sessionId: string, soulVersion: string): SessionHandle;
  endSession(sessionId: string, reason: 'shutdown' | 'crash' | 'logout'): void;
  appendTrajectory(line: TrajectoryLine): void;       // sync, append-only
  appendProgress(line: ProgressLine): void;           // sync, append-only
  appendLegacyEvent(event: LegacyEvent): void;        // promoted to timeline immediately
  rotate(): void;                                     // triggered when size > 32 MB
}
```

Writes use `appendFileSync` (cheap, blocking but bounded — each line ≤ 4 KB). Crash-loss is acceptable to the depth of OS buffer. No fsync per line.

**Retention policy (clarified in v2):** by default, keep the last 8 trajectory and progress session files per resident (configurable via `controller.yml`). Older files are deleted at session start. This is a finite-disk policy; if a more sophisticated retention is needed later (e.g., keep all sessions that produced legacy events), it can be added without changing on-disk format.

**Trajectory line schema (enumerated in v2 per architecture review S2).** All trajectory lines share a common header:

```ts
interface TrajectoryHeader {
  schemaVersion: 1;
  ts: string;          // ISO timestamp
  tick: number;
  sessionId: string;
  kind: TrajectoryLineKind;
}

type TrajectoryLineKind =
  | 'begin_tick'
  | 'end_tick'
  | 'hook'
  | 'budget'
  | 'plan'
  | 'decision'
  | 'action'
  | 'action_result'
  | 'legacy_event'
  | 'say'           // verbatim resident speech (a specialization of action for emotional capture)
  | 'patron'        // patron/witness/sponsor event (see Library of Souls section)
  | 'error';        // evidence-internal errors, NOT agent errors
```

Per-kind fields are defined in `src/controller/evidence/schemas.ts` as Zod schemas; the writer always validates before append (cheap; line size ≤ 4 KB). Schema evolution is field-additive only; bumps to `schemaVersion` are reserved for breaking changes and must update `docs/runebench-conventions-adopted.md`.

### 2. `ProgressTracker` (`src/controller/evidence/progress-tracker.ts`)

Stateless function wrapped in a class that holds last-known sample. Public API:

```ts
interface ProgressSnapshot {
  tick: number;
  xpBySkill: Record<string, number>;
  inventoryCount: number;
  positionHash: string;
  hp: number;
}

interface ProgressDelta {
  meaningful: boolean;
  reasons: string[];       // e.g. ['xp_gain:woodcutting:50', 'inventory:+1', 'hp:-30']
  newStuck: boolean;
  stuckSince: number | null;
}

class ProgressTracker {
  constructor(thresholds?: Partial<ProgressThresholds>);
  observe(snapshot: ProgressSnapshot): ProgressDelta;
  reset(): void;                            // called on resident death/rebirth
  current(): ProgressSnapshot | null;
}
```

`ProgressDelta.reasons` lines are short and human-readable for the Library; `meaningful: true` triggers a Library timeline entry.

### 3. `TrajectoryBuilder` (`src/controller/evidence/trajectory-builder.ts`)

Bridges the kernel and `EvidenceStore`. Public API mirrors the seven tick insertion points listed above:

```ts
type EndTickReason =
  | 'legacy_complete'
  | 'attention_exhausted'
  | 'plan_continuation'
  | 'hook_noop'
  | `budget_exhausted:${string}`
  | 'parse_failed'
  | 'legacy_complete_post_action'
  | 'tick_complete';

class TrajectoryBuilder {
  constructor(store: EvidenceStore);
  beginTick(tick: number, perception: Perception): void;
  recordHook(winner: HookWinner | null): void;
  recordBudget(budget: BudgetDecision): void;
  recordPlan(plan: PlanState | null): void;
  recordDecision(decision: DecisionRecord): void;
  recordAction(action: AgentAction, requestId: string): void;
  recordActionResult(requestId: string, outcome: ActionEffectOutcome): void;
  recordLegacy(event: LegacyEvent): void;            // also routes to library
  endTick(reason: EndTickReason): void;              // every return path supplies a reason
}
```

All lines share a common header: `{ schemaVersion, ts, tick, kind }` then kind-specific fields. Schema defined and Zod-validated in `evidence/schemas.ts`.

### 4. `LibraryUpdater` (`src/controller/evidence/library-updater.ts`)

Subscribes to trajectory + progress events; applies significance predicates; updates timeline; periodically regenerates portrait. Patron events are accepted via a separate method since they originate outside the kernel.

```ts
class LibraryUpdater {
  constructor(residentName: string, root: string, soul: Soul);
  observeTrajectory(line: TrajectoryLine): void;
  observeProgress(delta: ProgressDelta): void;
  observeLegacy(event: LegacyEvent): void;
  observePatron(event: PatronEvent): void;         // accepts external patron events
  regeneratePortrait(): Promise<void>;             // async; safe to drop if previous one running
  shutdown(): Promise<void>;
}
```

Portrait regeneration is the only async/expensive operation; everything else is synchronous appends. Regeneration is debounced (one outstanding at a time per resident) and uses a templated narrative (no LLM dependence — deterministic string assembly from timeline + progress + soul). LLM-augmented portrait generation is an explicit future enhancement, not part of this spec.

**Portrait.md structure** (template defined in `evidence/portrait-template.ts`):

```markdown
# <Name>, <epithet>
<Faction line, if soul.faction present>
Born tick <N>, <ISO date>. <livesCount> <life|lives>. <currentState>.

## What they wanted
<2-3 sentences distilled from active goals + unfulfilled wants — present tense for living, past tense for deceased>

## Who they knew
<For each named relationship: peer name + first-meet + interaction count + (parting line if applicable)>

## In their own words
> <verbatim quote 1>
> <verbatim quote 2>
> ... (5-12 quotes, chronological, with tick or life marker)

## Life I — <life epithet>
<2-4 sentence prose chapter assembled from notable events of life I>

### How it ended
<death cause + circumstances; if last_words present, quote it>

> <last_words verbatim if present>

## Life II — <life epithet>
<continues for each life>

## Patrons
<For each patron: template sentence. If none: "No recorded patrons.">

## What remains
<Artifacts, achievements, faction effects, cost-of-life if pricing wired>
```

Sentence templates inside each section have 3–5 phrasings per beat, seeded by `residentName` so the same resident always reads consistently across regenerations. The template is intentionally pedestrian; the strength comes from quoting verbatim speech, naming relationships, and surfacing unfulfilled wants — not from prose generation.

### 5. `VerifierConventions` (`src/controller/benchmarks/verifier-conventions.ts`)

Pure function that takes an existing benchmark artifact + failure-reason classification and emits the three reward formats to disk + stdout. No state.

### 6. `MockPerceptionAdapter` (`src/controller/evidence/mock-perception.ts`)

A test-only helper that scripts perception events into a SPARK runtime without a RuneJS server. Originally a side-effect of TrajectoryBuilder testing; promote to a kernel-level test helper.

```ts
class MockPerceptionAdapter {
  constructor();
  push(perception: Perception): void;
  drain(): Perception[];
  // adapter used by runtime tests in place of gateway perception input
}
```

This unblocks fast iteration on SPARK module logic and is the highest-leverage side benefit of the spec.

---

## Data Flow

### Per tick

```
spark.tick(perception)
  ├─ evidence.beginTick(tick, perception)   ← step 1
  │   └─ trajectoryBuilder.beginTick → trajectory.jsonl append
  │   └─ progressTracker.observe → progress.jsonl append (if delta.meaningful)
  │      └─ libraryUpdater.observeProgress (if meaningful)
  │
  ├─ legacy.update(perception)
  │   └─ if complete: trajectoryBuilder.recordLegacy → libraryUpdater.observeLegacy
  │      → portrait regeneration scheduled
  │
  ├─ hooks.evaluate → trajectoryBuilder.recordHook
  ├─ admitInference → if !ok: trajectoryBuilder.recordBudget
  ├─ advancePlan → trajectoryBuilder.recordPlan (only on change)
  ├─ llm.complete + parseCompletion → trajectoryBuilder.recordDecision
  ├─ actions emitted → trajectoryBuilder.recordAction (one per action)
  │   ActionCoordinator later → trajectoryBuilder.recordActionResult
  │
  └─ evidence.endTick()
      └─ trajectoryBuilder.endTick → final newline / batch fsync (every K ticks)
```

### Per benchmark

```
benchmarkRunner.run(task, module)
  ├─ create disposable resident
  ├─ run task with autonomous mode (existing behavior)
  ├─ verifier classifies pass/fail and failure_reason
  └─ VerifierConventions.emit(artifact, failureReason)
       ├─ writes reward.json
       ├─ writes reward.txt
       ├─ prints __REWARD_JSON_START__ ... __REWARD_JSON_END__ to stdout
       └─ existing benchmark-artifact.ts still writes the full artifact
```

### Per resident — Library update cadence

- Significant event arrives → `timeline.jsonl` appended immediately (within the tick).
- Every 200 ticks (configurable) OR on any `legacy_event` → portrait regeneration debounced + queued.
- Portrait regeneration reads timeline + progress + soul + memory summary → writes `portrait.md` + `portrait.json`.
- Death is just one significance entry on the timeline; lives counter in `index.json` is incremented, but the file persists.

---

## Error Handling

| Failure | Behavior | Visibility |
|---|---|---|
| `appendFileSync` throws (disk full, permission) | Catch, log to existing controller log, drop the line, set `evidence.degraded = true` | Surfaces as a telemetry warning through existing facade; resident continues |
| ProgressTracker delta computation throws | Catch, return `{ meaningful: false, reasons: ['tracker_error: ...'] }`, continue | Logged once per session |
| Library portrait regeneration throws | Catch, leave previous `portrait.md`, write `portrait.failed.txt` with error | Surfaces in dashboard as a "library stale" indicator (future D-task) |
| Trajectory file > 32 MB | Rotate to new file, update `current` symlink; index.json records rotation | None to user |
| Multiple controller processes sharing the same `CONTROLLER_MEMORY_DIR` | Not supported. EvidenceStore detects via a sentinel lockfile written at session start; if another sentinel is fresh, EvidenceStore throws on construction. See Constraints (single-process). | Loud failure on startup |
| Two `ResidentRuntime` instances in the *same* process writing for the same resident | Architecturally impossible (`ControllerHost.runtimes` is keyed by resident name); reuse of EvidenceStore handle if encountered | Internal invariant violation logged as error |
| ActionCoordinator emits `recordActionResult` for unknown requestId | Log warning line into trajectory; do not fail | Self-documenting |
| `legacyComplete` arrives but library updater is mid-regeneration | Queue the legacy event; portrait next-regen includes it | Best-effort |

### Crash safety

Evidence is OS-flush best-effort. The Library's `portrait.md` is written via temp-file + atomic rename so a crash mid-write does not leave a half-portrait. `timeline.jsonl` is append-only so partial last lines are recoverable (parser drops invalid trailing lines).

---

## Testing

### Unit

- `progress-tracker.test.ts` — delta math, threshold edges, stuck detection, reset semantics.
- `evidence-store.test.ts` — append, rotate, session lifecycle, symlink behavior on platforms.
- `significance.test.ts` — each predicate has at least one positive and one negative fixture.
- `library-updater.test.ts` — timeline appended on observe, portrait regen output stable across runs.
- `verifier-conventions.test.ts` — 3-tier output, failure-reason enum validation, stdout marker format.

### Integration

- `evidence-integration.test.ts` — mock perception adapter drives SPARK tick; trajectory and progress files end up with expected content; library timeline correctly distilled.
- `existing benchmarks regress` — make-fire-5m, woodcutting-firemaking-10m, starter-fishing-5m, explore-report-5m, follow-and-chat-5m run with Evidence Layer enabled and still pass with no behavior change.

### Snapshot

- One Library `portrait.json` snapshot for a scripted "born → woodcut → meet peer → quote → die → reborn → woodcut more → quote → die again" scenario, asserted by *structural markers* (revised in v2 per product review N1):
  - `epithet` is non-empty.
  - `voice.quotes.length` ≥ 3, including at least one tagged `last_words`.
  - `relationships.length` ≥ 1 with a named peer.
  - `lives.length` === 2 with non-empty `notableEvents` for each.
  - `wants.unfulfilledAtDeath.length` ≥ 1.
  - Each life has either `lastWords` or a recorded `deathCause`.
- The asserted markers are stable across template-text changes; the *prose* itself is allowed to vary as the template improves. A second snapshot of `portrait.md` checks that the section headers exist in the expected order, not character-for-character content.

### Live smoke

- One `res:agent` local smoke run that ends with a manufactured `legacyComplete`. The smoke is graded against a checklist (revised in v2):
  - [ ] `portrait.md` exists and is non-empty.
  - [ ] Name and epithet present.
  - [ ] ≥ 3 verbatim quotes in "In their own words."
  - [ ] ≥ 1 named peer in "Who they knew."
  - [ ] ≥ 1 want in "What they wanted."
  - [ ] At least one `### How it ended` subsection with either a death cause or last words.
  - [ ] `## Patrons` section present (even if "No recorded patrons.").
  - Any missing item is a smoke failure, not a pass-with-notes.

---

## Decomposition Into Plans

The spec is too large for one implementation plan. Implementation order matches dependency order:

### Plan P1 — Evidence foundation + mock perception
- `EvidenceStore`, `TrajectoryBuilder`, `ProgressTracker`, `MockPerceptionAdapter`
- Wire into `spark.tick` insertion points 1–7 (above)
- Tests: unit + integration with mock perception
- Acceptance: existing make-fire-5m smoke still passes; `trajectory.jsonl` and `progress.jsonl` files exist after run; mock-perception unit tests demonstrate kernel testability without RuneJS server.

### Plan P2 — Library of Souls updater
- `significance.ts`, `LibraryUpdater`, `portrait` template
- Subscribe to P1's events
- Tests: significance unit tests + snapshot test
- Acceptance: live smoke produces a readable `portrait.md` after a death event.

### Plan P3 — Verifier conventions
- `VerifierConventions`, wire into benchmark runner
- Tests: unit + regression on all existing benchmark tasks
- Acceptance: all existing benchmarks emit `reward.json`, `reward.txt`, stdout markers, and a `failure_reason`. CLI dry-run unchanged.

P1 and P3 are independently shippable. P2 depends on P1. P3 has the smallest blast radius and lowest collision risk with Codex's in-flight `[C4]` work — we can ship P3 first if scheduling pressures matter, but P1 unlocks the mock-perception adapter which the rest of SPARK iteration benefits from.

**Recommended order: P1 → P3 → P2.** P1 first to unblock fast iteration; P3 next as an independent ship; P2 once P1 has live data.

**Build-order caveat (added in v2 per architecture review S4).** P3's acceptance criteria (regression run of `make-fire-5m`, `woodcutting-firemaking-10m`, `starter-fishing-5m`, `explore-report-5m`, `follow-and-chat-5m`, and `combat-prayer-10m` shows unchanged pass/fail) runs against an already-P1-enabled codepath. If P1 has a latency or write-bug regression, P3's regression suite will register phantom failures unrelated to verifier conventions. Mitigation: P3 acceptance treats P1 as the baseline; an explicit P1 stability check (one clean run of `make-fire-5m` and `woodcutting-firemaking-10m` with no Evidence Layer errors) is a prerequisite gate before P3 regression runs. This is documented in P3's plan, not the spec.

**Cross-plan dependencies summarized:**

- P1 deliverables that P2 and P3 consume:
  - `RuntimeState.lastMeaningfulProgressAt` and `RuntimeState.stuckSince` fields (with facade exposure).
  - `EvidenceStore` and `TrajectoryBuilder` instantiated by `ResidentRuntime`.
  - `ActionCoordinator.submit({ onAckReady, onEffectResolved })` callbacks wired through `ResidentRuntime`.
  - `InferenceLog` extended with `promptHash` and `completionHash` fields.
  - Scope-guard `endTick` discipline applied to every `spark.tick` return path.
- P2 extends `LegacyUpdate` with `legacyProgress` payload (cheap; can also ship in P1 if convenient).
- P3 wires `VerifierConventions` into the benchmark runner exit path; no kernel changes.

---

## Open Questions

(Several v1 questions are resolved in v2 — kept here with their resolution for traceability.)

1. ~~Does the controller currently expose `CONTROLLER_MEMORY_DIR` to non-module code, or only to the memory facade?~~ — **Resolved v2:** ResidentRuntime already has access; EvidenceStore takes a `root` path in its constructor, same pattern as ActionLog/InferenceLog.
2. Should benchmark runs also emit per-tick trajectory/progress files into the benchmark output dir (in addition to the resident's memory dir)? — *yes; mirror the files into `CONTROLLER_BENCHMARK_DIR/<runId>/evidence/`. Wiring belongs in P3.*
3. Should we add an "interesting" classifier (LLM-scored) to portrait regeneration later? — *out of scope; this spec uses deterministic templates only. LLM augmentation is the planned next iteration after the Library lands.*
4. ~~Does anyone read `portrait.md` over the gateway today?~~ — **Resolved v2:** No, but dashboard `[D2]` will. The `portrait.json` field schema is now locked in this spec; Dev's agent can implement a consumer in parallel.
5. Should the Library include cost data from `pricing.ts`? — *yes; `portrait.json.cost` is in the schema as optional. Library reads cost-per-life if pricing config is wired; absence is fine. Pricing wiring is a separate roadmap item (`[I5]`).*
6. Where do patron events originate from in practice? — **Open.** OnionDAO Shards flow / dashboard human attestation / admin tooling are all plausible. The schema is open; ingestion is a separate spec.
7. Who picks the "epithet" generator phrases? — *templates live in `evidence/portrait-template.ts`; first set is whatever P2 ships, refined post-June-1 from real reads.* This is a designed extension point, not a future scope risk.
8. Does the spec need to address Resident-as-Player base-class coupling (the Resident is a Player subclass in RuneJS)? — *No. EvidenceStore is keyed by resident name string; the kernel does not need to know about the actor class hierarchy.*

## Risks

- **Performance**: append-per-tick is cheap on modern disks. Worst case ~10–15 appendFileSync calls per tick (verified in v2 expert review); per-tick disk cost is dwarfed by LLM latency. Profile during P1 implementation anyway.
- **Schema churn**: trajectory line and portrait.json schemas will evolve. Mitigation: `schemaVersion` field on every line / artifact; field additions only; readers tolerate unknown future fields. Portrait.json baseline schema is locked in v2.
- **Coupling to current `spark.tick` shape**: the 7 insertion points pin Evidence Layer to current kernel internals. If `spark.tick` is refactored, the scope-guard `finally`-clause discipline must be preserved. Mitigation: Evidence Layer methods are event-based, not control-flow-based; a refactor changes where methods are called from, not what they do.
- **Inference log forward-compat**: `promptHash` and `completionHash` fields are added in v2 to enable trajectory↔inference joins. Older log lines (without hashes) are still parseable; joining just returns "no match." This is fine.
- **Emotional landing**: deterministic templates risk flatness. Mitigation (added in v2 per product review): verbatim voice capture, named relationships, unfulfilled wants, per-life chapters with template-generated epithets, patron section. The portrait will only ever be as good as the resident's actual life — if the resident doesn't `say` anything memorable, the portrait will have no quotes. This is a feature: the artifact is honest.
- **Patron ingestion is unwired**: portrait.json has a `patrons[]` field and timeline accepts `patron_*` events on day one, but no source emits them yet. Mitigation: dashboard renders empty patron section gracefully; future spec for OnionDAO/Shards integration adds the producer.
- **Cross-agent collision**: Codex is editing `hybrid-agent-thinking-module.ts` and `combat-prayer-10m`. Evidence Layer doesn't touch those, but Codex's roadmap edits are dirty — apply roadmap delta only after their merge. *See `agent-coordination.md`.*

## Multi-Agent Coordination Notes

- Claude (this branch) owns `src/controller/evidence/*`, `src/controller/benchmarks/verifier-conventions.ts`, and the four new doc files.
- Codex (branch `nullcity`) owns `combat-prayer-10m`, `hybrid-agent-thinking-module`, `benchmarks/cli`.
- Dev (separate repo) owns the dashboard. The `portrait.json` schema is the seam; treat it as a versioned contract.
- All roadmap edits go through the delta file `2026-05-21-roadmap-delta-evidence-loop.md` until Codex's in-flight work merges. See `docs/agent-coordination.md` for the protocol.

## RuneBench Convention Adoption

This spec adopts five of the eight conventions cataloged in `docs/runebench-conventions-adopted.md`:

- 3-tier reward emission (component 5)
- Failure taxonomy (component 5)
- Trajectory normalization (component 3; raw JSONL, normalize at extraction)
- Knowledge-as-file-per-entity is already adopted (Workstream E); we reinforce its conventions in `runebench-conventions-adopted.md`
- Probe-then-loop discipline is a prompt-level concern owned by `hybrid-agent-thinking-module.ts` (Codex territory); this spec does not touch it but the doc references it

TOML task manifests, unified pricing, and Docker layering are tracked separately in the conventions doc and the roadmap delta — not in this spec.
