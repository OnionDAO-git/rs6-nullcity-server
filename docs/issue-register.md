# Null City Issue Register

This is the central ledger for bugs, weak evidence, process gaps, and QA findings discovered by humans or autonomous agents.

Use this file when:

- A capability is claimed but evidence is missing or weak.
- A benchmark or live run fails and the root cause is not fixed in the same cycle.
- A doc contradiction could mislead a new human or AI agent.
- A process rule is unclear enough to cause file collisions, unsafe model spend, bad merges, or UI-boundary violations.
- A code bug is found but cannot be fixed immediately.

Do not use this file for ordinary task planning. Planned work belongs in the roadmap and packet backlog. This file is for discovered problems and risks.

## Severity

| Severity | Meaning |
|---|---|
| `P0` | Blocks weekend loop, demo credibility, data safety, or can cause bad autonomous work. |
| `P1` | Important product/agent behavior issue; should be fixed soon. |
| `P2` | Useful polish, cleanup, or weaker evidence that does not block current sprint. |

## Status

| Status | Meaning |
|---|---|
| `Open` | Valid issue, no active owner. |
| `Claimed` | Someone has posted a `STARTING` line for the linked packet/fix. |
| `In Review` | Fix or doc update is pushed and awaits QA Marshal review. |
| `Verified` | QA Marshal confirmed evidence, tests, docs, and capability rows are coherent. |
| `Closed` | Verified and no follow-up remains. |
| `Blocked` | Needs a human decision, external service, or unavailable infra. |
| `Deferred` | Real issue intentionally left for after the weekend with a reason. |
| `Duplicate` | Same root cause as another issue; link the canonical issue. |
| `Invalid` | Evidence did not support the issue after review. |
| `Won't Fix` | Explicitly accepted or out of scope. |

## How Agents Should Use This

1. Check this file after `docs/agent-status.md` and before claiming a packet.
2. Prefer fixing a `P0`/`P1` issue over starting adjacent new work.
3. If you find an issue and can fix it in the same cycle, fix it and add one `Fixed` row with the commit/evidence.
4. If you cannot fix it immediately, add an `Open` row with exact evidence and the packet that should own it.
5. When fixing an issue, keep the row and update its status/evidence rather than deleting it.
6. If the issue affects a capability, update `docs/resident-capabilities.md` too.

## QA Marshal Review Checklist

- [ ] Issue id appears in HANDOFF or packet closeout.
- [ ] Changed files match the claimed packet/lane.
- [ ] No unrelated edits were reverted or swept in.
- [ ] Focused tests and `npm run check:no-ui` are reported.
- [ ] Code changes ran `npm run fin` unless a human explicitly waived it.
- [ ] Behavior claims cite benchmark artifacts, action logs, Library timelines, or model reports.
- [ ] Capability rows keep `Can do it?` distinct from `Does do it live?`.
- [ ] Partial/failed evidence became a fix, a caveat, or an issue row.

## Evidence Tags

Use compact tags in the evidence column and in `docs/resident-capabilities.md`:

| Tag | Meaning |
|---|---|
| `benchmark:<runId>` | Focused disposable-resident benchmark artifact. |
| `live-log:<resident>:<date>` | Ordinary controller/action log proof. |
| `timeline:<resident>:<event>` | Library timeline proof. |
| `model-report:<doc-or-run>` | Twin/triplet model comparison. |
| `issue:<id>` | Known gap or blocker. |
| `commit:<sha>` | Fix or behavior substrate landed in code. |

## Open Issues

| ID | Severity | Area | Status | Packet | Capability row | Evidence refs | Owner | Opened | Next action |
|---|---|---|---|---|---|---|---|---|---|
| QA-20260529-001 | P2 | Questing | Deferred | CQA1 | Questing / natural ingredient sourcing | issue:QA-20260529-001; `docs/resident-capabilities.md` says Cook's Assistant completion is proven with carried or visible ingredients, but natural egg/flour/milk sourcing from empty inventory is unproven. CIC meeting scope cut says not to expand broad questing for weekend MVP. | unclaimed | 2026-05-29 | Defer until AP/GP loop is proven; use only as bounded proof of missing game primitives if a human reopens it. |
| QA-20260529-004 | P1 | Combat/survival | Open | CQA5 | Combat survival | model-report:docs/model-intelligence-benchmark-results-2026-05-27.md; Qwen 0/6, Qwopus/Haiku 3/6 each in prior hard runs. | unclaimed | 2026-05-29 | Run combat survival benchmark by model; fix flee/eat/target selection loops. |
| QA-20260529-005 | P1 | Equipment | Open | CQA3 | Equipment / normal gear soak | issue:QA-20260529-005; gear equip is autonomous-benchmark-proven, but normal named-resident logs still show thin evidence outside harnesses. | unclaimed | 2026-05-29 | Run normal gear soak and update can-do vs does-do evidence. |
| QA-20260529-006 | P1 | Live behavior QA | Open | CQA10 | Long-run normal-life audit | issue:QA-20260529-006; capability doc lacks fresh one-hour multi-resident normal-life audit with cause histogram and capability deltas. | unclaimed | 2026-05-29 | Run one-hour audit; update capability matrix and issue rows for failures. |
| QA-20260529-007 | P1 | Release process | Open | release-qa | Release QA | issue:QA-20260529-007; `agents/wip` is 689 commits ahead of `nullcity` and 3 behind, making broad external dispatch risky without curation. | unclaimed | 2026-05-29 | Assign QA Marshal and curate/squash range before treating `nullcity` as current. |
| QA-20260529-008 | P0 | Resident intelligence | Blocked | S8c/CQA9/CQA11 | Goal planning / Library strategy | issue:QA-20260529-008; doc:docs/capability-evidence/2026-05-29-s8c-ap-gp-hierarchy-benchmark-attempt.md; code/tests: AP/GP hierarchy knowledge + prompt guardrails + `ap-gp-library-strategy-5m` benchmark substrate landed, but live artifact capture failed with `connect EPERM 127.0.0.1:43595`. | codex | 2026-05-29 | Re-run `ap-gp-library-strategy-5m` autonomous benchmark on loopback-permitted infra and fold artifact evidence into capability matrix. |
| QA-20260529-009 | P0 | AP life-force | Blocked | S1a/S1b | AP decay / top-up / fade-resume | issue:QA-20260529-009; commit:pending-s1b; doc:docs/capability-evidence/2026-05-29-s1b-ap-life-force-benchmark-attempt.md; `controller:bench --task ap-decay-ask-5m --mode autonomous` failed with `connect EPERM 127.0.0.1:43595`. | codex | 2026-05-29 | S1a replay substrate is landed and S1b benchmark task exists; re-run S1b in an environment that permits loopback gateway connects, then update capabilities with real artifact id. |

## Fixed Issues

| ID | Severity | Area | Status | Packet | Capability row | Evidence refs | Owner | Closed | Fix |
|---|---|---|---|---|---|---|---|---|---|
| QA-20260529-002 | P0 | AP/GP economy | Closed | S2b/CQA6 | GP earning | benchmark:bench_20260529065910_starter_gp_pickup_3m; benchmark:bench_20260529070519_starter_gp_pickup_3m; doc:docs/capability-evidence/2026-05-29-cqa6-gp-coin-995-verification.md | codex | 2026-05-29 | Verified real coin `995` GP observation/pickup in scripted + autonomous artifacts. Kept broader GP/hour route expansion out of scope and tracked separately via capability confidence + S8/CQA packets. |
| QA-20260529-003 | P1 | Pathing/stuck recovery | Closed | CQA2 | Movement / door-path recovery | benchmark:bench_20260528181711_equipment_prep_3m; benchmark:bench_20260528021111_explore_report_5m; doc:docs/capability-evidence/2026-05-29-cqa2-door-path-recovery.md | codex | 2026-05-29 | Verified blocked-route recovery through both successful `stuck_open_obstacle` (door/gate interact success) and successful `stuck_move_recovery` fallback movement in autonomous benchmark artifacts. |
| QA-20260529-010 | P1 | AP/GP economy | Closed | S2a | GP burn audit evidence | test:src/controller/city-integration/service.test.ts; test:src/controller/city-integration/http-server.test.ts; cmd:npm test -- --runInBand src/controller/city-integration; cmd:check:no-ui | codex | 2026-05-29 | Fixed `city_gold_burn` Library timeline amount to use real `burnedAmount` from inventory authority and added HTTP contract tests for `/wealth` and `/gold-burns` 409 insufficient-gold behavior. |
