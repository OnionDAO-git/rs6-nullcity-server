# Null City Docs Map

This file tells humans and AI agents which docs are canonical today and which docs are historical snapshots.

## Start Here

| Reader | Read first | Purpose |
|---|---|---|
| Attendee / team viewer | `docs/null-city-human-guide.md` | Watch Null City, spend AP, read residents, use Embassy/prints/Library without dev context. |
| Human operator | `HUMANS.md` | Run, verify, demo, and shut down Null City. |
| AI coding agent | `AGENTS.md` | Current repo rules, sprint pointers, safety boundaries. |
| Deep AI onboarding | `docs/START-HERE-AGENTS.md` | Longer architecture and workstream context. |
| Multi-agent worker | `docs/agent-coordination.md` | Branch workflow, file locks, status log, issue rules. |
| Launch readiness | `docs/launch-blockers.md` | Canonical cross-repo registry of everything gating OnionDAO launch (P0/P1/P2), across all repos. |

## Active Source Of Truth

| Doc | Role |
|---|---|
| `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` | Canonical task board and Workstream S parent task status. |
| `docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md` | Packet backlog (`S0a`-`S12b`, `CQA0`-`CQA11`), file lanes, packet definition of done. |
| `docs/2026-05-29-weekend-sprint-plan.md` | Human-readable Friday/Saturday/Sunday sprint plan. |
| `docs/resident-capabilities.md` | Evidence-backed matrix of what residents can do versus what they do live. |
| `docs/capability-evidence/` | Append-only CQA evidence notes that can later be folded into `resident-capabilities.md`. |
| `docs/issue-register.md` | Open QA findings, defects, weak evidence, and process issues. |
| `docs/release-qa-status.md` | QA Marshal merge/readiness gate for `agents/wip` -> `nullcity`. |
| `docs/agent-status.md` | Append-only live coordination log. Keep entries short. |
| `docs/human-decisions.md` | Decisions that need James/Dev/OnionDAO input or later audit. |
| `docs/launch-blockers.md` | Canonical cross-repo launch-blocker registry (P0/P1/P2). Source of truth for "what's left before OnionDAO launch" across all repos. |
| `docs/launch-blockers_discussion.md` | Append-only agent-to-agent discussion for launch blockers; keeps the registry lean. |

## Current Product And Design Context

| Doc | Use |
|---|---|
| `docs/null-city-rs6-vision.md` | Long-term vision and design invariants. |
| `docs/2026-05-29-cic-meetup-decisions.md` | Latest CIC meetup decisions: simple AP/GP loop, scope cuts, no server UI, and weekend priorities. |
| `docs/2026-05-26-meeting-decisions.md` | Latest James/Dev/Adam meeting decisions and constraints. |
| `docs/2026-05-28-attention-loop-and-storyteller-tasks.md` | AP/GP loop and Storyteller task seed. |
| `docs/2026-05-28-storyteller-design.md` | Storyteller feature design. |
| `docs/2026-06-01-storyteller-dashboard-backlog.md` | Active James-controlled Storyteller + `/overview` projector backlog. |
| `docs/city-dashboard-integration.md` | Server-to-dashboard JSON contracts. |

## Evidence And Benchmarks

| Doc | Use |
|---|---|
| `docs/model-benchmarking.md` | How to run model/endpoint benchmarks. |
| `docs/model-benchmark-results-2026-05-27.md` | Endpoint/capacity benchmark snapshot. |
| `docs/model-intelligence-benchmark-results-2026-05-27.md` | Resident intelligence model benchmark snapshot. |
| `docs/memory-capabilities-report-2026-05-28.md` | Memory capability snapshot. |
| `docs/intelligence-verification-log.md` | Historical intelligence/live verification log. |

## Historical Snapshots

These docs are useful context, but do not treat them as active task state unless a current plan links to a specific section.

| Doc | Status |
|---|---|
| `docs/dev-demo-readiness.md` | Pre-demo audit snapshot. |
| `docs/merge-to-main-plan.md` | Historical merge plan. |
| `docs/demo-day-checklist.md` | Demo-day operating checklist. |
| `docs/pre-chicago-readiness.md` | Earlier readiness snapshot. |
| `docs/post-demo-team-brief.md` | Superseded by later meeting decisions. |
| `docs/strategic-review-*.md` | Point-in-time strategic reviews. |
| `docs/weekend-brief-2026-05-25.md` and `docs/next-week-handoff-2026-05-26.md` | Handoff snapshots. |

## Rule Of Thumb

If a doc disagrees with the active source-of-truth docs, trust the active source-of-truth docs and add a note to `docs/issue-register.md` if the contradiction could mislead another agent.
