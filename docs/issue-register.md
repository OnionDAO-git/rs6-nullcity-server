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
| QA-20260529-002 | P0 | AP/GP economy | In Review | S2b/CQA6 | GP earning | benchmark:bench_20260529070519_starter_gp_pickup_3m; `starter-gp-pickup-3m` now proves autonomous visible coin item `995` pickup: 2 selected-module `opportunistic_pickup` actions, 25 GP carried, `gpGainedFromGround=1`; `city_gold_observed` Library event test covers GP inspection evidence. | codex | 2026-05-29 | QA Marshal review: confirm tests/gates and decide whether broader GP/hour route remains separate from this substrate issue. |
| QA-20260529-003 | P1 | Pathing/stuck recovery | Open | CQA2 | Movement / door-path recovery | issue:QA-20260529-003; door/path recovery is listed as unproven for blocked/indoor targets and required for normal survival, trading, GP routes, and bounded goal proofs. | unclaimed | 2026-05-29 | Add stuck-door/blocked-target benchmark; fix route clearing or door interaction as needed. |
| QA-20260529-004 | P1 | Combat/survival | Open | CQA5 | Combat survival | model-report:docs/model-intelligence-benchmark-results-2026-05-27.md; Qwen 0/6, Qwopus/Haiku 3/6 each in prior hard runs. | unclaimed | 2026-05-29 | Run combat survival benchmark by model; fix flee/eat/target selection loops. |
| QA-20260529-005 | P1 | Equipment | Open | CQA3 | Equipment / normal gear soak | issue:QA-20260529-005; gear equip is autonomous-benchmark-proven, but normal named-resident logs still show thin evidence outside harnesses. | unclaimed | 2026-05-29 | Run normal gear soak and update can-do vs does-do evidence. |
| QA-20260529-006 | P1 | Live behavior QA | Open | CQA10 | Long-run normal-life audit | issue:QA-20260529-006; capability doc lacks fresh one-hour multi-resident normal-life audit with cause histogram and capability deltas. | unclaimed | 2026-05-29 | Run one-hour audit; update capability matrix and issue rows for failures. |
| QA-20260529-007 | P1 | Release process | Open | release-qa | Release QA | issue:QA-20260529-007; `agents/wip` is 689 commits ahead of `nullcity` and 3 behind, making broad external dispatch risky without curation. | unclaimed | 2026-05-29 | Assign QA Marshal and curate/squash range before treating `nullcity` as current. |
| QA-20260529-008 | P0 | Resident intelligence | Open | S8c/CQA9/CQA11 | Goal planning / Library strategy | issue:QA-20260529-008; CIC meeting made the core intelligence test "turn a Soul goal into practical AP/GP survival and Library-learning behavior." Existing proof focuses on isolated capabilities and does not yet prove this hierarchy live. | unclaimed | 2026-05-29 | Add prompt/retrieval tests plus a twin/triplet benchmark for a practical Soul goal such as "make 100 GP/hour and write the strategy into the Library." |

## Fixed Issues

| ID | Severity | Area | Status | Packet | Capability row | Evidence refs | Owner | Closed | Fix |
|---|---|---|---|---|---|---|---|---|---|
