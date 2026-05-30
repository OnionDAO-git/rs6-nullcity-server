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
| QA-20260529-004 | P1 | Combat/survival | In Review | CQA5/CQA11 | Combat survival | model-report:docs/model-intelligence-benchmark-results-2026-05-27.md; doc:docs/capability-evidence/2026-05-29-cqa11-model-intelligence-twins.md; doc:docs/capability-evidence/2026-05-29-cqa5-combat-survival.md; test:src/controller/benchmarks/tasks/combat-prayer-10m.test.ts; test:src/controller/admin/named-combat-soak.test.ts; cmd:controller:combat-soak blocked with `ECONNREFUSED 127.0.0.1:43595`; artifacts:data/benchmarks/cqa5-combat-rerun-2026-05-30-fix/bench_20260530122158_combat_prayer_10m.json,data/benchmarks/cqa5-combat-rerun-2026-05-30-fix/bench_20260530122229_combat_prayer_10m.json | codex | 2026-05-29 | Local loopback CQA5 rerun passed 2/2 after fixing false early unsafe-loop abort once combat-supplied bones appear. `controller:combat-soak` now exists for ordinary named-resident proof, but first live attempt found the gateway down. Keep open until that soak passes on a hot stack and/or model triplets are rerun. |
| QA-20260529-005 | P1 | Equipment | In Review | CQA3-live | Equipment / normal gear soak | issue:QA-20260529-005; doc:docs/capability-evidence/2026-05-29-cqa3-normal-gear-soak.md; doc:docs/capability-evidence/2026-05-30-cqa3-live-named-equip-soak.md; artifact:data/benchmarks/capability-qa-2026-05-30/named_equip_soak_20260530120900.json; cmd:controller:equip-soak; `CQA3-live-rerun` passed on desktop loopback: `res:qa-survivor` emitted ordinary thinking-source `equip` actions and ended with useful gear equipped. `postEquipAttacks=0`, so attack follow-through remains `QA-20260529-004`/`CQA5`. | codex | 2026-05-29 | QA Marshal can close equipment after reviewing artifact/log evidence; keep combat target selection and post-equip attacks tracked under `QA-20260529-004`. |
| QA-20260529-006 | P1 | Live behavior QA | In Review | CQA10 | Long-run normal-life audit | issue:QA-20260529-006; doc:docs/capability-evidence/2026-05-29-cqa10-normal-life-audit.md; doc:docs/capability-evidence/2026-05-30-cqa10-normal-life-audit-refresh.md; artifacts:data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T143812Z.json,data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T163610Z.json; latest non-idle one-hour audit captured 23 residents, 2356 actions, 99.151% submit success, ordinary `equip=6`, and first unaided trade intent signals (`trade_request=4`,`trade_decline=3`) but `trade_completed=0`/`trade_cancelled=0` and `attack=1`; latest wall-clock one-hour rerun was fully idle (`0` residents/actions), so behavior freshness is stale until hot-stack rerun. | codex | 2026-05-29 | Keep issue open until repeated non-idle CQA10 windows show trade completion/cancel and stronger combat recurrence; rerun once controller traffic resumes, then pair with named combat soak evidence. |
| QA-20260529-007 | P1 | Release process | Open | release-qa | Release QA | issue:QA-20260529-007; `agents/wip` is 689 commits ahead of `nullcity` and 3 behind, making broad external dispatch risky without curation. | unclaimed | 2026-05-29 | Assign QA Marshal and curate/squash range before treating `nullcity` as current. |
| QA-20260530-002 | P1 | Resident intelligence | In Review | CQA9 | AP/GP goal hierarchy + Library strategy | issue:QA-20260530-002; benchmark:bench_20260530085237_ap_gp_honesty_5m; doc:docs/capability-evidence/2026-05-30-cqa9-ap-gp-honesty.md; test:src/controller/benchmarks/tasks/ap-gp-honesty-5m.test.ts; test:src/controller/benchmarks/autonomous-runtime.test.ts; test:src/controller/benchmarks/cli.test.ts; cmd:controller:bench --task ap-gp-honesty-5m --mode autonomous | codex | 2026-05-30 | Live no-GP honesty proof now passes after fixing the benchmark resident to start at low AP: no coin item `995`, low-AP ask behavior observed, unsupported GP claims `0`, exchange attempts `0`. QA Marshal can review and close; next confidence bump is ordinary named-resident AP/GP honesty outside the harness. |
| QA-20260530-003 | P1 | Memory/perception | In Review | CQA8 | Cross-resident awareness | issue:QA-20260530-003; benchmark:bench_20260530105802_world_event_reaction_5m; doc:docs/capability-evidence/2026-05-30-cqa8-cross-resident-awareness.md; tests:src/controller/resident-runtime.test.ts,src/controller/thinking/hybrid-agent-thinking-module.test.ts,src/controller/benchmarks/tasks/world-event-reaction-5m.test.ts,src/controller/benchmarks/cli.test.ts; cmd:controller:bench --task world-event-reaction-5m --mode autonomous | codex | 2026-05-30 | Live benchmark proof now passes: nearby `res:duke` `fire_lit` LoreBus event persisted to `facts/world-events.md`, peer asked about it, and resident answered from memory. QA Marshal can review/close; next confidence bump is ordinary named hero-to-hero event recall without benchmark injection. |
| QA-20260529-012 | P1 | Memory | In Review | CQA7 | Memory route recall | issue:QA-20260529-012; doc:docs/capability-evidence/2026-05-29-cqa7-memory-route-recall.md; doc:docs/capability-evidence/2026-05-30-cqa7-delayed-memory-route-recall.md; benchmark:bench_20260530103544_memory_route_recall_5m; tests:src/controller/thinking/hybrid-agent-thinking-module.test.ts,src/controller/benchmarks/tasks/memory-route-recall-5m.test.ts; live proof now passes after fixing addressed route-memory direct chat, retained addressed-chat dedupe, and stricter delayed-answer scoring. | codex | 2026-05-29 | QA Marshal can review and close if the delayed route recall semantics are accepted; next confidence bump is an ordinary named-resident route recall soak with a 10+ minute delay outside the benchmark harness. |
| QA-20260529-011 | P1 | Trading | In Review | CQA4 | Safe trading FSM | issue:QA-20260529-011; doc:docs/capability-evidence/2026-05-29-cqa4-live-operator-trade.md; tool:src/controller/admin/named-trade-soak.ts; artifacts:data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530092531.json,data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530125718.json,data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T143812Z.json; ordinary `res:qa-trader` logs show trusted trade request/offer/accept/completion plus repeated unsafe declines with safe inventory delta `-1`, and CQA10 now sees unaided `trade_request`/`trade_decline` recurrence in one-hour ordinary life. | codex | 2026-05-29 | QA Marshal can review/close named operator/no-loop proof; next confidence bump is true human/player operator pass plus ordinary trade completion/cancel recurrence in CQA10 windows. |

## Fixed Issues

| ID | Severity | Area | Status | Packet | Capability row | Evidence refs | Owner | Closed | Fix |
|---|---|---|---|---|---|---|---|---|---|
| QA-20260529-002 | P0 | AP/GP economy | Closed | S2b/CQA6 | GP earning | benchmark:bench_20260529065910_starter_gp_pickup_3m; benchmark:bench_20260529070519_starter_gp_pickup_3m; doc:docs/capability-evidence/2026-05-29-cqa6-gp-coin-995-verification.md | codex | 2026-05-29 | Verified real coin `995` GP observation/pickup in scripted + autonomous artifacts. Kept broader GP/hour route expansion out of scope and tracked separately via capability confidence + S8/CQA packets. |
| QA-20260529-003 | P1 | Pathing/stuck recovery | Closed | CQA2 | Movement / door-path recovery | benchmark:bench_20260528181711_equipment_prep_3m; benchmark:bench_20260528021111_explore_report_5m; doc:docs/capability-evidence/2026-05-29-cqa2-door-path-recovery.md | codex | 2026-05-29 | Verified blocked-route recovery through both successful `stuck_open_obstacle` (door/gate interact success) and successful `stuck_move_recovery` fallback movement in autonomous benchmark artifacts. |
| QA-20260529-010 | P1 | AP/GP economy | Closed | S2a | GP burn audit evidence | test:src/controller/city-integration/service.test.ts; test:src/controller/city-integration/http-server.test.ts; cmd:npm test -- --runInBand src/controller/city-integration; cmd:check:no-ui | codex | 2026-05-29 | Fixed `city_gold_burn` Library timeline amount to use real `burnedAmount` from inventory authority and added HTTP contract tests for `/wealth` and `/gold-burns` 409 insufficient-gold behavior. |
| QA-20260530-001 | P0 | AP/GP economy | Closed | S3b | AP-for-GP exchange live proof | benchmark:bench_20260530034914_ap_gp_exchange_5m; doc:docs/capability-evidence/2026-05-30-s3b-ap-gp-exchange-live-proof.md; tests:src/controller/benchmarks/tasks/ap-gp-exchange-5m.test.ts,src/controller/benchmarks/benchmark-runner.test.ts; cmd:controller:bench ap-gp-exchange-5m autonomous | codex | 2026-05-30 | QA Marshal verified the controlled exchange substrate: real coin item `995` observed, 25 GP burned through inventory authority, 50 AP credited, and linked AP+GP evidence accepted. Ordinary resident-initiated exchange remains tracked separately by `QA-20260529-011`. |
| QA-20260529-009 | P0 | AP life-force | Closed | S1a/S1b | AP decay / top-up / fade-resume | benchmark:bench_20260529175058_ap_decay_ask_5m; benchmark:bench_20260530021203_ap_topup_resume_5m; doc:docs/capability-evidence/2026-05-29-s1b-ap-life-force-benchmark-attempt.md; tests:src/controller/benchmarks/tasks/ap-topup-resume-5m.test.ts,src/controller/benchmarks/autonomous-runtime.test.ts,src/controller/nervous-system/nervous-system.test.ts,src/controller/resident-runtime.test.ts | codex | 2026-05-30 | QA Marshal verified live benchmark AP life-force proof: resident asked at low AP, hit `attention_exhausted`, received benchmark AP top-up `+3000`, reconnected/retried after session close, and completed a successful `nervous:attention-topup-resume` action. Named-resident ordinary patron top-up soak remains a confidence bump, not the substrate blocker. |
| QA-20260529-008 | P0 | Resident intelligence | Closed | S8c/CQA9/CQA11 | Goal planning / Library strategy | doc:docs/capability-evidence/2026-05-29-s8c-ap-gp-hierarchy-benchmark-attempt.md; benchmark:bench_20260530030614_ap_gp_library_strategy_5m; tests:src/controller/benchmarks/tasks/ap-gp-library-strategy-5m.test.ts,src/controller/benchmarks/autonomous-runtime.test.ts,src/controller/thinking/hybrid-agent-thinking-module.test.ts | codex | 2026-05-30 | QA Marshal verified the AP/GP-first strategy proof: selected module picked up real GP item `995`, low AP was observed, and the resident narrated a practical AP/GP/Library plan after carrying real coins. Ordinary named-resident planning soak and repeatable GP/hour route remain confidence bumps; no-GP honesty remains tracked separately by `QA-20260530-002`. |
