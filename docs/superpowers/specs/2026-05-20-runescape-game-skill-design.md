# RuneScape Game Skill And Self-Improving Knowledge Design

## Purpose

The resident does not yet "know RuneScape" in the strong sense. It has starter facts and a few working routines, but weak models still need a compact, explicit game skill: exact actions, exact items, exact success signals, exact blockers, and a safe way to learn from failures.

This design turns the current RuneBench-inspired playbook into a self-improving controller subsystem that works locally and in production-style deployments such as Railgun.

## Goals

- Give Brain and Body relevant, current RuneScape knowledge without asking a dumb model to search a whole wiki.
- Keep local engine config authoritative over external wiki facts.
- Make workflow cards executable enough to answer: "can do now", "missing item", "missing target", "unsafe", "blocked", or "not relevant".
- Let agents propose knowledge updates from successful or failed attempts without letting them directly mutate curated game knowledge.
- Make runtime feedback portable: it must survive Railgun/container deployments when a persistent volume is configured, and still be visible through stdout log drains when disk is ephemeral.
- Give the OnionDAO team a repeatable review/promotion process with clear evidence, rejection, benchmark, and deployment instructions.

## Non-Goals

- No full wiki scrape at runtime.
- No agent-authored commits or autonomous edits to curated knowledge.
- No broad questing system in this slice.
- No arbitrary `execute_code` tool for residents.
- No reliance on `/Users/james/...` paths or laptop-only state.
- No multi-instance external queue in the MVP. Multi-instance support is file-per-instance plus stdout; a real external store can be added later.

## Architecture

### 1. Small Services, Not One Large Registry

Do not create one large `RuneScapeGameSkill` object that owns all knowledge, workflow, rendering, and suggestion behavior. Use a thin facade over focused services:

- `GameKnowledgeCatalog`: loads and merges curated, generated, and optional reference entries.
- `KnowledgeRetriever`: scores and returns bounded entries for a goal/perception query.
- `WorkflowCardCatalog`: stores structured workflow cards as data.
- `WorkflowEvaluator`: pure evaluator functions that turn cards + perception into availability results.
- `GameSkillContextBuilder`: builds the per-tick `GameSkillContext`.
- `GameSkillPromptRenderer`: renders Brain and Body sections from a context.
- `KnowledgeSuggestionStore`: writes suggestions to stdout and optional file storage.
- `KnowledgeSuggestionGenerator`: observes action attempts/outcomes and proposes reviewed updates.
- `KnowledgeSuggestionReview`: groups, dedupes, and reports suggestions for humans/Codex.

Acceptance rule: new files should stay small and focused. No new controller file should exceed roughly 300-400 lines without a specific reason. No workflow evaluator file should mix unrelated skill families.

### 2. Curated Knowledge Pack

The controller keeps a small source-labeled knowledge pack under `src/controller/knowledge/`.

Sources, in precedence order:

1. Engine-local facts from source/config.
2. Curated human-reviewed entries.
3. Generated skill-guide entries from `src/plugins/skills/skill-guides/*.json`.
4. Optional bounded RuneBench wiki snippets from a configured local checkout.
5. Runtime suggestions, which are never used as source-of-truth until promoted.

Rules:

- Engine-local facts win over wiki facts when they disagree.
- Prompt injection is retrieval-based, not "dump everything".
- Prompt snippets must stay bounded and cite source paths.
- Curated knowledge changes require tests.
- Prompt rendering should truncate whole entries by priority rather than cutting facts mid-sentence.

### 3. Game Skill Context

Prompt builders should not perform retrieval or workflow evaluation. They receive a precomputed context.

```ts
interface GameSkillContextInput {
    resident: string;
    tick: number;
    activeGoal?: ActiveGoalState;
    perception: Perception;
    recentAttempts?: ActionAttemptSummary[];
}

interface GameSkillContext {
    knowledgeResults: KnowledgeResult[];
    workflowAvailability: WorkflowAvailability[];
    brainSection: string;
    bodySection: string;
}
```

Data flow per tick:

1. Perception arrives.
2. Nervous system handles urgent survival/dialogue rules.
3. `GameSkillContextBuilder` evaluates workflow availability from perception and active goal.
4. Retriever pulls knowledge using goal + availability + perception summary.
5. Prompt renderer creates `brainSection` or `bodySection`.
6. Brain/Body prompt uses those sections.
7. Action executes through `ActionCoordinator`.
8. Suggestion generator observes action attempt, final outcome, and compact before/after evidence.

This order keeps prompt assembly dumb and keeps game knowledge reusable by benchmarks and dashboard surfaces.

### 4. Workflow Cards And Availability

Workflow cards are data. Evaluators are code.

```ts
interface WorkflowCard {
    id: string;
    version: number;
    title: string;
    source: string;
    evaluator: string;
    supersedes?: string[];
    knowledgeIds: string[];
    requiredItems: string[];
    visibleTargets: string[];
    actionKinds: string[];
    successSignals: string[];
    riskRules: string[];
    recoveryActions: string[];
}

type WorkflowAvailabilityStatus =
    | 'can_do_now'
    | 'missing_item'
    | 'missing_target'
    | 'unsafe'
    | 'blocked'
    | 'not_relevant';

interface WorkflowAvailability {
    workflowId: string;
    workflowVersion: number;
    evaluator: string;
    status: WorkflowAvailabilityStatus;
    reason: string;
    nextActionHint?: string;
    evidence: string[];
}
```

Body prompt priority:

1. `unsafe` vetoes risky action.
2. `can_do_now` supplies exact next action guidance.
3. `missing_item` and `missing_target` become preparation/report goals.
4. `blocked` triggers recovery or a suggestion.
5. `not_relevant` is omitted from prompt output.

The availability section is the concrete "what can be done now" voice. Knowledge remains factual. Playbook text should shrink over time to avoid duplicated/conflicting guidance.

### 5. Agent Feedback Loop

Agents may suggest knowledge updates, but suggestions are append-only review items, not source-of-truth edits.

Suggestion triggers:

- Repeated action failure with the same cause.
- Stuck detector fires for a workflow.
- Action succeeds and produces new evidence not covered by current knowledge.
- Body sees a visible item/NPC/object that retrieval has no good entry for.
- Agent says it learned a useful local fact, but this is low trust until confirmed by engine evidence.
- Human chat asks the agent to remember or try a new game fact, but this is low trust until confirmed by engine evidence.
- Benchmark run finds a repeatable improvement or failure mode.

Agents should be told: "I can propose a game-knowledge update for review; I cannot change the knowledge base directly."

### 6. Suggestion Schema

Suggestions must be reconstructable enough for a reviewer to audit without replaying the whole session.

```ts
type SuggestionStatus = 'proposed' | 'promoted' | 'rejected' | 'superseded';
type SuggestionOutcome = 'success' | 'partial' | 'blocked' | 'unsafe' | 'invalid_action' | 'repeated_no_progress' | 'hallucinated_target';

interface SuggestionEvidenceBundle {
    outcome: SuggestionOutcome;
    attemptId?: string;
    action?: unknown;
    actionStatus?: string;
    actionReason?: string;
    perceptionId?: string;
    before?: {
        position?: string;
        inventory?: string[];
        skills?: string[];
        visibleTargets?: string[];
    };
    after?: {
        position?: string;
        inventory?: string[];
        skills?: string[];
        visibleTargets?: string[];
    };
    deltas?: {
        inventory?: string[];
        skills?: string[];
        position?: string;
    };
    retrievedKnowledgeIds: string[];
    availability?: Array<{ workflowId: string; status: WorkflowAvailabilityStatus; reason: string }>;
    model?: string;
    promptVersion?: string;
    worldVersion?: string;
    summaries: string[];
}

interface KnowledgeSuggestion {
    id: string;
    dedupKey: string;
    createdAt: string;
    resident: string;
    controllerId: string;
    instanceId: string;
    tick: number;
    status: SuggestionStatus;
    source: 'brain' | 'body' | 'nervous_system' | 'routine' | 'human_chat' | 'benchmark';
    trust: 'engine_confirmed' | 'runtime_observed' | 'human_claim' | 'agent_claim';
    goalId?: string;
    workflowId?: string;
    workflowVersion?: number;
    observation: string;
    proposedChange: {
        kind: 'new_entry' | 'update_entry' | 'workflow_hint' | 'risk_rule' | 'availability_rule';
        targetId?: string;
        title?: string;
        summary: string;
        keywords?: string[];
        requiredItems?: string[];
        actions?: string[];
        successSignals?: string[];
        scope?: string;
    };
    evidence: SuggestionEvidenceBundle;
    confidence: number;
    duplicateOf?: string;
    supersedes?: string[];
    reviewedBy?: string;
    reviewedAt?: string;
    decisionReason?: string;
    promotionCommit?: string;
    benchmarkRunIds?: string[];
}
```

Evidence is sanitized and bounded:

- No env vars or secrets.
- No full LLM envelopes unless a debug flag is explicitly enabled.
- Chat/perception summaries have length caps.
- Absolute local paths are replaced with source labels when possible.
- Runtime-observed suggestions require `attemptId` and `perceptionId`. Human/agent claims may omit them, but then `trust` must be `human_claim` or `agent_claim`.
- Suggestion and workflow-card data must be validated at runtime with Zod schemas before being accepted from generated/reference/runtime sources.

### 7. Deduplication And Rejection Memory

Dedup key:

```text
kind + workflowId + targetId + normalized(proposedChange.summary) + normalized(actionReason/outcome) + trust
```

The review command groups by `dedupKey` and reports:

- count
- first/last seen
- residents
- controller/instance ids
- example evidence bundles
- conflicts
- whether this key has been rejected before

Rejected suggestions are stored as review artifacts and suppress repeated pollution. A future duplicate should attach to the rejected key instead of resurfacing as a fresh high-priority item unless it has stronger evidence or a changed scope.

### 8. Promotion Rubric

A suggestion may be promoted only if all applicable checks pass:

1. Evidence includes at least one engine-confirmed or runtime-observed signal.
2. It is not a duplicate of an existing curated entry or rejected suggestion.
3. It does not conflict with engine-local config. If it conflicts with wiki, engine wins.
4. It has a narrow scope when based on local position/spawn behavior.
5. It is compact enough for dumb models.
6. It includes exact action names/items/targets where possible.
7. It does not make combat/survival less safe.
8. Focused retrieval/prompt tests pass.
9. Relevant benchmark gates pass or the reviewer records why a benchmark is not applicable.
10. Reviewer identity, decision reason, and promotion commit are recorded.

Benchmark gates for promoted knowledge:

- pass rate does not regress on existing starter tasks
- median action count does not worsen by more than 20% for the relevant benchmark
- invalid action count does not increase
- unsafe action count does not increase
- bad suggestion rate does not increase; denominator is proposed suggestions per completed benchmark run
- prompt section stays under 2200 characters for Body and 2600 characters for Brain until a token-aware renderer replaces character caps

### 9. Storage And Railgun Portability

The repo has no explicit Railgun deployment files. This design assumes Railgun behaves like a production container runner with env vars, stdout/stderr log drains, and optional persistent volumes.

Config:

```yaml
knowledge:
  dir: ${CONTROLLER_KNOWLEDGE_DIR}
  runebenchWikiDir: ${RUNEBENCH_WIKI_DIR}
  enableSuggestions: true
  emitStdout: true
  storageMode: persistent-volume
```

Recommended production env:

```bash
CONTROLLER_CONFIG=/app/controller.yml
CONTROLLER_MEMORY_DIR=/data/controller/memory
CONTROLLER_LOG_DIR=/data/controller/logs
CONTROLLER_KNOWLEDGE_DIR=/data/controller/knowledge
CONTROLLER_INSTANCE_ID=${RAILGUN_INSTANCE_ID}
RUNEBENCH_WIKI_DIR=/app/reference/RuneBench/wiki
```

Storage modes:

| Mode | Behavior |
| --- | --- |
| `ephemeral` | Suggestions emit to stdout only; file writes are best-effort and non-blocking. |
| `persistent-volume` | Suggestions emit to stdout and append to per-instance JSONL files under `knowledge.dir`. |
| `external-store` | Future adapter writes to a queue/object store/database; stdout remains enabled for observability. |

`storageMode` controls file mirroring:

- `ephemeral`: stdout only, no file append required.
- `persistent-volume`: stdout plus per-instance JSONL file append under `knowledge.dir`.
- `external-store`: stdout plus the configured external sink when that adapter exists.

MVP multi-instance contract:

- Default supported production mode is one controller writer per resident set.
- File storage uses per-instance files: `suggestions.<controllerId>.<instanceId>.jsonl`.
- A shared single `suggestions.jsonl` is not used in multi-instance deployments.
- If a deployment wants multiple active writers against one shared knowledge store, use an external durable store/queue in a later slice.

Failure behavior:

- Emit each suggestion to stdout first as one JSON object with `event: "knowledge_suggestion"`.
- Then attempt file append if enabled.
- On `ENOENT`, `EROFS`, `EACCES`, `ENOSPC`, or other write errors: emit `event: "knowledge_suggestion_write_failed"` to stdout once per error class/path window and continue running.
- Suggestion write failures must never block movement, chat, combat safety, or controller reconciliation.

Startup validation:

- Required for production: `CONTROLLER_CONFIG`, `gateway.controllerId`, controller gateway URL, LLM endpoint config, memory dir, knowledge dir when `storageMode` is `persistent-volume`, unique `CONTROLLER_INSTANCE_ID`.
- Optional: `RUNEBENCH_WIKI_DIR`; missing path disables wiki snippets with one sanitized warning.
- Print a sanitized startup summary: residents count, controllerId, instanceId, knowledge mode, wiki enabled/disabled, suggestion file path pattern. Do not print API keys or auth tokens.

Image/reproducibility:

- Runtime image must include source/build files needed by controller knowledge and skill guides, or mount them read-only.
- Generated curated pack is deterministic.
- Runtime-generated suggestions/cache files never live under `src/`.
- Production Docker image should use `npm ci` and a pinned Node image/minor version or digest.

### 10. OnionDAO Team Workflow

Daily or per-PR:

1. Run the controller with suggestions enabled.
2. Let residents attempt benchmark workflows.
3. Collect suggestions from stdout log drain and/or `knowledge.dir`.
4. Run the review command or dashboard panel to group by dedup key.
5. Promote only suggestions that pass the rubric.
6. Add or edit curated entries/workflow cards in source.
7. Run:

```bash
npm test -- --runInBand src/controller/knowledge src/controller/thinking
npm run typecheck
npm run lint
npm run build
```

8. Push curated knowledge and tests. Do not push runtime suggestions.

Automation options:

- Local Codex heartbeat: summarize suggestions and draft patches.
- Railgun scheduled job: export stdout-drained `knowledge_suggestion` events into durable review artifacts.
- Dashboard panel: list pending suggestions with evidence and accept/reject commands.
- CI benchmark job: run starter tasks and report pass rate/action count/safety regressions.

Concrete operator instructions live in `docs/controller-knowledge-runbook.md`. Keep that runbook updated whenever storage, review, benchmark, or Railgun deployment behavior changes.

### 11. MVP Build Slice

Implement the smallest useful self-improving loop:

1. Config support for `knowledge.dir`, `knowledge.runebenchWikiDir`, `knowledge.enableSuggestions`, `knowledge.emitStdout`, `knowledge.storageMode`, and `controller.instanceId`.
2. `KnowledgeSuggestionStore` with stdout-first emission, per-instance JSONL mirroring, redaction, and non-blocking file-write fallback.
3. `GameSkillContextBuilder` that composes curated entries, generated skill-guide entries, optional wiki snippets, and workflow availability.
4. Structured workflow cards and evaluators for:
   - make fire
   - woodcutting
   - safe combat/prayer
   - fishing starter
   - follow/report
5. Prompt integration: Brain and Body receive `GameSkillContext` sections instead of doing retrieval inside prompt builders.
6. `ActionAttemptObserver` or `SuggestionEventSink` after `ActionCoordinator.submit()` so suggestions can use final action outcomes.
7. Suggestion generation for repeated failed Body actions and selected successful workflow evidence.
8. Review CLI/script that groups pending suggestions by dedup key and prints promotion rubric fields.

Post-review hardening requirements for this MVP:

- Production/Railgun startup must reject laptop-style memory, log, and knowledge defaults when durable feedback is expected.
- Suggestion stdout emission is mandatory whenever suggestions are enabled; `emitStdout: false` cannot create a feedback black hole.
- Item, interact, combat, and eating actions should wait for perception evidence before they are treated as successful.
- Workflow availability should prefer structured perception facts over regex-only compressed prose whenever inventory, HP, visible actors, available options, or slots are present.
- Nervous-system actions must use the same effect-wait evidence path as Body actions.
- Direct chat commands and retaliation rules must not bypass survival gates.
- Shutdown should flush pending persistent-volume feedback writes; stdout remains the first-line durable log drain.
- Review tooling should parse raw JSONL suggestion files and prefixed stdout export lines.

### 12. Lifecycle Integration Contract

Attach the game-skill subsystem at existing controller seams, not by making prompt builders or the thinking module reach into files.

Host construction:

- `ControllerHost` creates one `GameSkillService` singleton from `ControllerConfig`.
- `ControllerHost` passes the service into each `ResidentRuntime`.
- Tests can inject a fake service through `ControllerHostOptions` or `ResidentRuntimeOptions`.

Runtime options:

```ts
interface ResidentRuntimeGameSkill {
    buildContext(input: GameSkillContextInput): GameSkillContext;
    observeAttempt(event: {
        resident: string;
        producer: 'nervous-system' | 'body';
        perception: Perception;
        context?: GameSkillContext;
        attempt: ActionAttempt;
    }): void;
}

interface ResidentRuntimeOptions {
    gameSkill?: ResidentRuntimeGameSkill;
}
```

Tick integration:

1. `ResidentRuntime.onPerception()` stores the perception and lets the nervous system react first.
2. If the nervous system submits an action, await `ActionCoordinator.submit()` and pass the returned `ActionAttempt` to `gameSkill.observeAttempt()`.
3. If thinking is not suppressed, compute `GameSkillContext` from resident, tick, active goal, and compressed perception before calling `thinking.think()`.
4. Pass game-skill prompt sections through a defined thinking input extension:

```ts
interface ThinkingInput {
    perception: Perception;
    gameSkill?: GameSkillContext;
}
```

For the first implementation, avoid broad interface churn by allowing `createThinkingModule` and `HybridAgentThinkingModule` to accept an optional `gameSkillContextProvider` callback. The prompt builders still receive plain `gameSkill?: { brainSection?: string; bodySection?: string }`, so prompt assembly remains pure.

5. For each Body action, await `ActionCoordinator.submit()`, then call `gameSkill.observeAttempt()` with the context used for that decision.
6. Suggestion generation is best-effort; exceptions are caught and logged without interrupting the resident.

### 13. Testing

Unit tests:

- Config defaults and env interpolation.
- Production-like env path resolution.
- Optional wiki dir missing does not fail.
- Suggestion store emits stdout before file append.
- Suggestion store creates per-instance filenames.
- Suggestion store swallows file write failures after stdout warning.
- Suggestion redaction removes env-looking secrets and caps text fields.
- Zod validators reject malformed suggestion/workflow-card data.
- Dedup key generation groups equivalent suggestions.
- Rejected/superseded suggestion records suppress duplicate priority.
- Retrieval includes generated skill guide entries.
- Availability evaluator returns correct statuses for crafted perceptions.
- Prompt renderer truncates whole entries by priority.

Integration tests:

- Brain prompt includes relevant knowledge and availability from `GameSkillContext`.
- Body prompt prefers `can_do_now` over generic workflow text.
- `unsafe` availability suppresses risky action guidance.
- Repeated failure writes one deduplicated suggestion, not a flood.
- Action coordinator result can be observed by suggestion generator.
- Railgun-like config with `/data/controller/knowledge` resolves correctly.
- Runtime passes game-skill sections into prompt construction without prompt builders reading files.
- Nervous-system and Body action attempts are observed after coordinator completion.

Manual/live tests:

- Make fire produces no bad suggestions when successful.
- Missing logs produces a "need logs/chop tree" availability hint.
- Unsafe combat produces an `unsafe` availability status and no attack action.
- A stuck path produces a bounded suggestion with action-result evidence.
- File storage disabled/readonly still emits suggestions to stdout and keeps the resident running.

## Open Question

If Railgun has a specific durable storage or event API, use a small `KnowledgeSuggestionSink` adapter. Do not change the game skill, workflow, retrieval, or suggestion schema to fit one platform.
