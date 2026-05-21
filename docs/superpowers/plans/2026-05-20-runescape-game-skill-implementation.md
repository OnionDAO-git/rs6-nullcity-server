# RuneScape Game Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP RuneScape game-skill subsystem so residents receive explicit workflow/knowledge context and can emit reviewed knowledge suggestions that work locally and on Railgun-style deployments.

**Architecture:** Add small controller services for game-skill context, workflow availability, and suggestions. `ControllerHost` owns the singleton service, `ResidentRuntime` builds context per decision and observes completed action attempts, and prompt builders receive rendered sections instead of reading files themselves.

**Tech Stack:** TypeScript, Jest, Zod, append-only JSONL, stdout JSON events, existing controller config/runtime/thinking modules.

---

## File Map

- Modify `src/controller/config.ts`: add `controller.instanceId` and `knowledge` config.
- Create `src/controller/knowledge/suggestions.ts`: schemas, redaction, dedup, stdout/file suggestion store.
- Create `src/controller/knowledge/game-skill-context.ts`: context types, workflow availability, renderer, service facade.
- Modify `src/controller/thinking/thinking-module.ts`: optional game-skill context argument.
- Modify `src/controller/thinking/hybrid-agent-prompts.ts`: accept pre-rendered game-skill sections.
- Modify `src/controller/thinking/hybrid-agent-thinking-module.ts`: pass game-skill context to Brain/Body prompts.
- Modify `src/controller/resident-runtime.ts`: build context before thinking and observe completed action attempts.
- Modify `src/controller/controller-host.ts`: instantiate and pass the game-skill service.
- Create `src/controller/knowledge/review-suggestions.ts`: CLI helper to group pending suggestions by dedup key.
- Modify `package.json`: add `controller:knowledge:review`.

## Task 1: Config

- [x] Add failing tests in `src/controller/config.test.ts` for defaults, env interpolation, and Railgun-like knowledge paths.
- [x] Implement `controller.instanceId` and `knowledge.{dir,runebenchWikiDir,enableSuggestions,emitStdout,storageMode}`.
- [x] Run `npm test -- --runInBand src/controller/config.test.ts`.

## Task 2: Suggestion Store

- [x] Add failing tests in `src/controller/knowledge/suggestions.test.ts` for stdout-first append, per-instance filenames, write failure fallback, redaction, schema validation, and dedup keys.
- [x] Implement `KnowledgeSuggestionStore`, Zod schemas, `knowledgeSuggestionDedupKey()`, and `redactSuggestion()`.
- [x] Run `npm test -- --runInBand src/controller/knowledge/suggestions.test.ts`.

## Task 3: Game Skill Context

- [x] Add failing tests in `src/controller/knowledge/game-skill-context.test.ts` for firemaking, woodcutting, fishing, safe-combat/prayer, and follow/report availability.
- [x] Implement `GameSkillService.buildContext()` with bounded Brain/Body sections.
- [x] Run `npm test -- --runInBand src/controller/knowledge/game-skill-context.test.ts src/controller/knowledge/knowledge-retriever.test.ts`.

## Task 4: Prompt Integration

- [x] Update `src/controller/thinking/hybrid-agent-prompts.test.ts` to require injected game-skill sections.
- [x] Remove prompt-builder-owned retrieval and render only provided sections.
- [x] Update `HybridAgentThinkingModule` to pass `GameSkillContext` to Brain/Body prompts.
- [x] Run `npm test -- --runInBand src/controller/thinking/hybrid-agent-prompts.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts`.

## Task 5: Runtime Integration

- [x] Add tests in `src/controller/resident-runtime.test.ts` proving Body and nervous-system `ActionAttempt`s are observed after coordinator completion.
- [x] Build context after nervous-system handling and before `thinking.think()`.
- [x] Pass `gameSkill` through `ControllerHost` into `ResidentRuntime`.
- [x] Run `npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/controller-host.test.ts`.

## Task 6: Review CLI

- [x] Add tests for grouping suggestions by dedup key.
- [x] Implement `review-suggestions.ts` and `controller:knowledge:review`.
- [x] Run the CLI against an empty temp directory and a fixture file.

## Task 7: Verification

- [x] Run focused tests:

```bash
npm test -- --runInBand src/controller/config.test.ts src/controller/knowledge src/controller/thinking/hybrid-agent-prompts.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/resident-runtime.test.ts src/controller/controller-host.test.ts
```

- [x] Run static checks:

```bash
npm run typecheck
npm run lint
npm run build
```

- [x] Dispatch a code-review subagent for final review before claiming ready.

## Post-Review Hardening Added

- [x] Production/Railgun config now fails closed on local memory/log/knowledge defaults.
- [x] Suggestion events always emit to stdout, even in ephemeral mode or write-failure paths.
- [x] Runtime waits for perception evidence before marking important item/combat/interact actions successful.
- [x] Workflow availability uses structured perception for inventory slots, axe checks, HP safety, safe combat targets, and follow visibility.
- [x] OnionDAO runbook added at `docs/controller-knowledge-runbook.md`.
- [x] Nervous-system actions now use the same effect-wait path as Body actions.
- [x] Controller shutdown flushes pending game-skill feedback writes.
- [x] Review CLI handles prefixed Railgun/stdout log lines.
- [x] Prayer has a carried-bones availability evaluator.
- [x] Direct and reactive combat obey survival gates before attack actions.
- [x] Deterministic woodcutting/firemaking routines require an axe before chopping.
