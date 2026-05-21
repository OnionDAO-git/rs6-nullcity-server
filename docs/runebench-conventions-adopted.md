# RuneBench Conventions Adopted In rs6-nullcity-server

**Date:** 2026-05-21.
**Status:** Documentation of intent. Items marked "in spec" link to active design work; items marked "in roadmap" are proposed as new tasks; items marked "adopted" are already in code.

## Background

[RuneBench](https://github.com/MaxBittker/RuneBench) is a benchmark harness for evaluating LLM agents on a RuneScape private server. Its substrate (LostCity engine + Docker harness + MCP `execute_code`) is incompatible with our persistent multi-resident world. **We are not adopting the substrate.** We are stealing design conventions.

Past work in `feat/runebench-agent-design.md` already stole the action-vocabulary and starter playbook ideas. This doc catalogs the rest, with explicit cross-references to where each lands.

## The Adopted Conventions

### 1. High-level action vocabulary (`bot.*` style)

**RuneBench:** Agents write TypeScript against `bot.chopTree()`, `bot.attackNpc("chicken")`, `bot.openBank()`, etc. One concrete verb per agent intent.

**Adopted:** `src/controller/actions/resident-actions.ts` defines typed `AgentAction` verbs. `runebench-playbook.ts` documents the surface in prompt form.

**Status:** Adopted. Reinforce by *generating* the playbook prompt section from the action registry rather than hand-maintained text. Tracked as a backlog item in Workstream B (extracting workflow cards).

---

### 2. Knowledge as file-per-entity with search index

**RuneBench:** `wiki/items/iron-ore.md`, `wiki/npcs/chicken.md`, etc. Agents grep first, bulk-load only for small windows.

**Adopted:** Workstream E shipped this. `docs/runescape-skill/` has agent-readable indices; `knowledge-retriever.ts` does the search-first pattern.

**Status:** Adopted. No new work.

---

### 3. Probe-then-loop discipline

**RuneBench:** `agents.md` explicitly teaches "first verify one action works (10s timeout), then scale up." This is a prompt-level convention enforced through agent instructions.

**Adopted partially:** `runebench-playbook.ts` says the same thing in Brain/Body prompts.

**Future:** Make it a measurable signal. Tag each trajectory with a binary `probedFirst: boolean` based on whether the first action ran and completed before the agent attempted a longer plan. Correlate with task success. *Tracked in Workstream I (Evidence Layer): the trajectory contains the data; classification is added later.*

---

### 4. 3-tier reward emission (`reward.json` + `reward.txt` + stdout markers)

**RuneBench:** `shared/check_skill_xp.ts` and `shared/check_gold.ts` emit three formats. Survives partial filesystem loss.

**Adopted in spec:** `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` component 5. New file `src/controller/benchmarks/verifier-conventions.ts` wraps existing benchmark artifacts.

**Status:** In spec; awaiting plan P3.

---

### 5. Failure taxonomy in verifier output

**RuneBench:** Failure modes are detected implicitly in verifiers; missing save files, connection errors, etc. are tagged.

**Adopted in spec:** `FailureReason` enum: `'none' | 'timeout' | 'exception' | 'goal_not_met' | 'died' | 'budget_exhausted' | 'kernel_aborted' | 'unknown'`. Wrapped into `reward.json` alongside the numeric value.

**Status:** In spec; awaiting plan P3.

---

### 6. Trajectory normalization (raw JSONL, normalize at extraction)

**RuneBench:** `trajectory.ts` adapts multiple raw agent log formats to a uniform `TrajectoryStep[]`. The raw format is whatever the agent produces; normalization happens during analysis.

**Adopted in spec:** `trajectory.jsonl` per resident per session. Schema documented and Zod-validated in `src/controller/evidence/schemas.ts`. We don't have multiple agent formats today (everything goes through the SPARK kernel), but the schema versioning prepares for future heterogeneity.

**Status:** In spec; awaiting plan P1.

---

### 7. TOML task manifests

**RuneBench:** `dataset.toml` registers benchmark tasks with name, digest, dependencies. Hash-versioned task definitions make runs reproducible.

**Adopted in roadmap (proposed):** Add a `benchmarks/manifest.toml` listing each SPARK benchmark task with version hash. Tracked in roadmap delta `2026-05-21-roadmap-delta-evidence-loop.md` as Workstream I.4 (low priority; nice-to-have once we have a leaderboard).

**Status:** Proposed in roadmap delta; not in any spec yet.

---

### 8. Unified pricing (`pricing.ts`)

**RuneBench:** Single map of per-model token costs (`shared/pricing.ts`). Costs backfilled at extraction time.

**Adopted in roadmap (proposed):** Add `src/controller/pricing/model-pricing.ts` with input/cache/output rates per profile. Wire into existing inference logs at extraction time, not at call time. Surface cost-per-resident-life in `portrait.json`.

**Status:** Proposed in roadmap delta as Workstream I.5; small slice; ship independently when convenient.

---

### 9. Docker layering — pre-cache heavy deps

**RuneBench:** Base image clones engine and pre-packs data. Task containers inherit and add only thin task-specific layers.

**Adopted in roadmap (proposed):** Our docker-compose already does this somewhat. Audit `Dockerfile` for any setup that runs per-container vs. once-at-build. Tracked under Workstream H (Operations) as a low-priority audit task.

**Status:** Roadmap audit item only; not blocking.

---

### 10. Result aggregation with full sample retention

**RuneBench:** `_combined.json` keeps full per-sample timeseries. Leaderboard view pivots lazily; new columns (failure-reason breakdown, cost-per-reward) can be added without re-running benchmarks.

**Adopted in spec partially:** Evidence Layer's `progress.jsonl` is the equivalent timeseries; benchmark artifacts already retain action/inference evidence. The "pivot lazily" view is owned by Dev's dashboard (Workstream D).

**Status:** Producer side in spec; consumer side owned by Dev.

---

## Cross-Reference Table

| # | Convention | Lands in | Tracked as |
|---|---|---|---|
| 1 | Action vocabulary | `resident-actions.ts`, `runebench-playbook.ts` | Workstream B (extract workflow cards) — adopted |
| 2 | Knowledge files | `docs/runescape-skill/` | Workstream E — adopted |
| 3 | Probe-then-loop | Prompt + trajectory classifier | Workstream I (data), Workstream B (analysis) |
| 4 | 3-tier reward | `verifier-conventions.ts` | Spec component 5, plan P3 |
| 5 | Failure taxonomy | `verifier-conventions.ts` | Spec component 5, plan P3 |
| 6 | Trajectory JSONL | `evidence/*` | Spec components 1–3, plan P1 |
| 7 | TOML manifests | `benchmarks/manifest.toml` (new) | Roadmap delta I.4 |
| 8 | Pricing map | `controller/pricing/model-pricing.ts` (new) | Roadmap delta I.5 |
| 9 | Docker layering | Dockerfile audit | Roadmap H (low) |
| 10 | Sample retention | `progress.jsonl`, dashboard | Spec + Workstream D |

## Additional Conventions (added 2026-05-21 after completeness re-sweep)

### 11. Layered Docker build with separate base image

**RuneBench:** `docker/Dockerfile.base` pre-caches engine + SDK + heavy deps; `docker/Dockerfile` layers thin per-test code. Avoids rebuilding 500MB+ for each test iteration.

**Adopted in roadmap (proposed):** Audit `rs6-nullcity-server/Dockerfile` for opportunities to split a base image from per-iteration layers. Tracked under Workstream H as a low-priority CI-speed audit; may be deferred until benchmark suite becomes daily.

**Status:** Proposed in `null-city-ideation-backlog.md` Theme 11.

---

### 12. GitHub Pages auto-deploy from result JSON

**RuneBench:** `.github/workflows/pages.yml` rebuilds and deploys a static site whenever results JSON changes. Results live alongside code.

**Adopted in roadmap (proposed):** Once rs6 has a leaderboard or Library snapshot view, publish via Pages with a results-trigger workflow. No separate hosting required.

**Status:** Proposed in `null-city-ideation-backlog.md` Theme 11. Defer until dashboard `[D3]`/`[D4]` lands and a publish-worthy view exists.

---

### 13. Agent adapter registry via import path

**RuneBench:** `--agent-import-path 'codex_adapter:CodexWithTimeout'` loads any adapter by name. Each adapter subclasses a base and overrides hooks. Composition over hardcoded enum.

**Adopted partially:** SPARK module registry (`src/controller/spark/modules.ts`) already does this for in-repo reviewed modules. The convention to steal is the **CLI-selectable-by-name pattern** — so an operator can choose modules at run time via flag without code changes. May already be present; verify.

**Status:** Already partially adopted. Audit needed.

---

### 14. Precomputed `MODEL_CONFIG` metadata dictionary

**RuneBench:** `views/shared-constants.js` defines one map per UI dimension (model slug → display name, color, icon, sort order). Single source of truth.

**Adopted in roadmap (proposed):** Build `src/controller/ui-constants.ts` (or `packages/types/src/ui-constants.ts`) mapping SPARK module IDs, NPC categories, faction colors, emotion presets to UI metadata.

**Status:** Proposed in `null-city-ideation-backlog.md` Theme 11. Tied to dashboard work (Workstream D).

---

### 15. Cost backfill via post-processing pass

**RuneBench:** Trials emit token counts; `scripts/postprocess-costs.ts` adds `cost_usd` later from a centralized pricing table. Trials never block on cost computation.

**Adopted in spec:** Part of the `pricing.ts` adoption (roadmap delta `[I5]`). Cost is backfilled at extraction time, not at LLM call time. Spec already includes the `Portrait.cost` optional field.

**Status:** Already in spec/roadmap delta.

---

### 16. Sample-preserving result aggregation

**RuneBench:** `extractors/extract-skill-results.ts` retains full `samples[]` arrays, including `elapsedMs` timestamps, across all trials. Enables offline trajectory replay and post-hoc charting without re-running.

**Adopted in spec:** `progress.jsonl` retains full timeseries; aggregation views pivot lazily. Already aligned.

**Status:** Already in spec.

---

### 17. env + CLI dual configuration pattern

**RuneBench:** Container sets defaults via `process.env`; scripts override via `process.argv` consistently. Allows ad-hoc runs without rebuilding the container.

**Adopted in roadmap (proposed):** Audit rs6 CLIs (benchmark CLI, controller CLI) for the env+argv pattern; document conventions.

**Status:** Proposed in `null-city-ideation-backlog.md` Theme 11.

---

## What We Are Explicitly Not Adopting

- **The RuneBench substrate** (LostCity engine, MCP `execute_code` Docker container, 8x clock as runtime, single-agent-per-container).
- **Peak-XP-per-window as a scoring primitive.** Null City benchmarks score gameplay correctness and survival, not pure throughput. Where peak-throughput is informative (e.g., woodcutting rate), it can be a *metric* but not the *reward*.
- **The ephemeral-container test model.** Residents are persistent; their evidence accumulates across sessions and lives.
- **Multiple inheritance chains for model adapters.** RuneBench has ~8 adapters with inheritance from Codex, OpenCode, etc. — works at small scale but creates fragility. Prefer composition (one parameterized adapter) for rs6 SPARK modules.
- **Global `window.COMBINED_DATA` pattern for result data.** Pollutes global scope and blocks SSR. Use proper JSON loading + hooks in dashboard work.
- **Scatter-shot `console.log` with ad-hoc prefixes.** Use structured logging (already in rs6 via inference/action logs).
