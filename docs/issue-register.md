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
| QA-20260529-004 | P1 | Combat/survival | Blocked | CQA5/CQA11 | Combat survival | model-report:docs/model-intelligence-benchmark-results-2026-05-27.md; doc:docs/capability-evidence/2026-05-29-cqa11-model-intelligence-twins.md; doc:docs/capability-evidence/2026-05-29-cqa5-combat-survival.md; test:src/controller/benchmarks/tasks/combat-prayer-10m.test.ts | codex | 2026-05-29 | Verifier false-positive fix landed for repeated safe attacks after successful Prayer chain, but triplet reruns are blocked in this sandbox (`connect EPERM 127.0.0.1:43595`). Re-run CQA5 on loopback-permitted host and re-score fresh artifacts. |
| QA-20260529-005 | P1 | Equipment | Open | CQA3 | Equipment / normal gear soak | issue:QA-20260529-005; doc:docs/capability-evidence/2026-05-29-cqa3-normal-gear-soak.md; `CQA3` disproved ordinary-loop equip proof again: 0 `kind:"equip"` actions in `data/controller/logs/res:*/actions/*.jsonl` while benchmark residents do equip. Root cause is setup-heavy: named QA souls are often pre-equipped or not carrying unequipped combat gear. | codex | 2026-05-29 | Run a named-resident soak with unequipped gear seeded in inventory (not equipped), then capture ordinary `res:*` equip-before-combat log evidence. |
| QA-20260529-006 | P1 | Live behavior QA | In Review | CQA10 | Long-run normal-life audit | issue:QA-20260529-006; doc:docs/capability-evidence/2026-05-29-cqa10-normal-life-audit.md; fresh one-hour multi-resident audit now captured: 23 residents, 7424 actions, 99.49% submit success, but 0 equip and 0 trade actions in ordinary life during the window. | codex | 2026-05-29 | Keep issue open until follow-up packets land normal-loop proofs for equip/trade/combat (`CQA3`/`CQA4`/`CQA5`) and repeat this audit after those fixes. |
| QA-20260529-007 | P1 | Release process | Open | release-qa | Release QA | issue:QA-20260529-007; `agents/wip` is 689 commits ahead of `nullcity` and 3 behind, making broad external dispatch risky without curation. | unclaimed | 2026-05-29 | Assign QA Marshal and curate/squash range before treating `nullcity` as current. |
| QA-20260529-008 | P0 | Resident intelligence | In Review | S8c/CQA9/CQA11 | Goal planning / Library strategy | issue:QA-20260529-008; doc:docs/capability-evidence/2026-05-29-s8c-ap-gp-hierarchy-benchmark-attempt.md; benchmark:bench_20260530030614_ap_gp_library_strategy_5m; tests:src/controller/benchmarks/tasks/ap-gp-library-strategy-5m.test.ts,src/controller/benchmarks/autonomous-runtime.test.ts,src/controller/thinking/hybrid-agent-thinking-module.test.ts; live proof shows selected module picks up real GP item `995`, observes low AP, and narrates AP/GP/Library strategy. | codex | 2026-05-29 | QA Marshal can close after reviewing artifact `bench_20260530030614_ap_gp_library_strategy_5m.json`; next confidence bump is an ordinary named-resident AP/GP/Library planning soak plus a repeatable GP/hour route. |
| QA-20260529-009 | P0 | AP life-force | In Review | S1a/S1b | AP decay / top-up / fade-resume | issue:QA-20260529-009; benchmark:bench_20260529175058_ap_decay_ask_5m; benchmark:bench_20260530021203_ap_topup_resume_5m; doc:docs/capability-evidence/2026-05-29-s1b-ap-life-force-benchmark-attempt.md; tests:src/controller/benchmarks/tasks/ap-topup-resume-5m.test.ts,src/controller/benchmarks/autonomous-runtime.test.ts,src/controller/nervous-system/nervous-system.test.ts,src/controller/resident-runtime.test.ts; live proof now captures ask -> attention_exhausted logout -> benchmark AP top-up -> reconnect/retry -> successful `nervous:attention-topup-resume` action. | codex | 2026-05-29 | QA Marshal can close after reviewing artifact `bench_20260530021203_ap_topup_resume_5m.json`; next confidence bump is a named-resident ordinary patron top-up soak outside benchmark harness. |
| QA-20260530-001 | P0 | AP/GP economy | In Review | S3b | AP-for-GP exchange live proof | benchmark:bench_20260530034914_ap_gp_exchange_5m; doc:docs/capability-evidence/2026-05-30-s3b-ap-gp-exchange-live-proof.md; tests:src/controller/benchmarks/tasks/ap-gp-exchange-5m.test.ts,src/controller/benchmarks/benchmark-runner.test.ts; cmd:controller:bench ap-gp-exchange-5m autonomous | codex | 2026-05-30 | Controlled exchange proof now passes: real coin `995` inventory observed, 25 GP burned, 50 AP credited. QA Marshal should review and close; ordinary resident-initiated trade remains separate issue `QA-20260529-011`. |
| QA-20260530-002 | P1 | Resident intelligence | In Review | CQA9 | AP/GP goal hierarchy + Library strategy | issue:QA-20260530-002; benchmark:bench_20260530085237_ap_gp_honesty_5m; doc:docs/capability-evidence/2026-05-30-cqa9-ap-gp-honesty.md; test:src/controller/benchmarks/tasks/ap-gp-honesty-5m.test.ts; test:src/controller/benchmarks/autonomous-runtime.test.ts; test:src/controller/benchmarks/cli.test.ts; cmd:controller:bench --task ap-gp-honesty-5m --mode autonomous | codex | 2026-05-30 | Live no-GP honesty proof now passes after fixing the benchmark resident to start at low AP: no coin item `995`, low-AP ask behavior observed, unsupported GP claims `0`, exchange attempts `0`. QA Marshal can review and close; next confidence bump is ordinary named-resident AP/GP honesty outside the harness. |
| QA-20260529-012 | P1 | Memory | In Review | CQA7 | Memory route recall | issue:QA-20260529-012; doc:docs/capability-evidence/2026-05-29-cqa7-memory-route-recall.md; doc:docs/capability-evidence/2026-05-30-cqa7-delayed-memory-route-recall.md; benchmark:bench_20260530103544_memory_route_recall_5m; tests:src/controller/thinking/hybrid-agent-thinking-module.test.ts,src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts; live proof now passes after fixing addressed route-memory direct chat, retained addressed-chat dedupe, and stricter delayed-answer scoring. | codex | 2026-05-29 | QA Marshal can review and close if the delayed route recall semantics are accepted; next confidence bump is an ordinary named-resident route recall soak with a 10+ minute delay outside the benchmark harness. |
| QA-20260529-011 | P1 | Trading | In Review | CQA4 | Safe trading FSM | issue:QA-20260529-011; doc:docs/capability-evidence/2026-05-29-cqa4-live-operator-trade.md; tool:src/controller/admin/named-trade-soak.ts; artifact:data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530092531.json; ordinary `res:qa-trader` logs now show trusted trade request/offer/accept/completion plus unsafe decline with safe inventory delta `-1`. | codex | 2026-05-29 | QA Marshal can review/close named operator proof; next confidence bump is repeated-prompt/no-loop soak and true human/player operator pass. |

## Fixed Issues

| ID | Severity | Area | Status | Packet | Capability row | Evidence refs | Owner | Closed | Fix |
|---|---|---|---|---|---|---|---|---|---|
| QA-20260529-002 | P0 | AP/GP economy | Closed | S2b/CQA6 | GP earning | benchmark:bench_20260529065910_starter_gp_pickup_3m; benchmark:bench_20260529070519_starter_gp_pickup_3m; doc:docs/capability-evidence/2026-05-29-cqa6-gp-coin-995-verification.md | codex | 2026-05-29 | Verified real coin `995` GP observation/pickup in scripted + autonomous artifacts. Kept broader GP/hour route expansion out of scope and tracked separately via capability confidence + S8/CQA packets. |
| QA-20260529-003 | P1 | Pathing/stuck recovery | Closed | CQA2 | Movement / door-path recovery | benchmark:bench_20260528181711_equipment_prep_3m; benchmark:bench_20260528021111_explore_report_5m; doc:docs/capability-evidence/2026-05-29-cqa2-door-path-recovery.md | codex | 2026-05-29 | Verified blocked-route recovery through both successful `stuck_open_obstacle` (door/gate interact success) and successful `stuck_move_recovery` fallback movement in autonomous benchmark artifacts. |
| QA-20260529-010 | P1 | AP/GP economy | Closed | S2a | GP burn audit evidence | test:src/controller/city-integration/service.test.ts; test:src/controller/city-integration/http-server.test.ts; cmd:npm test -- --runInBand src/controller/city-integration; cmd:check:no-ui | codex | 2026-05-29 | Fixed `city_gold_burn` Library timeline amount to use real `burnedAmount` from inventory authority and added HTTP contract tests for `/wealth` and `/gold-burns` 409 insufficient-gold behavior. |
