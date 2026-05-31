# S-MEM-4 - named resident memory recall soak

Date: 2026-05-31

## Verdict

Verified for `res:agent` on the hot stack. A named resident can be taught a durable fact through public chat, persist it to per-resident `facts/routes.md`, receive a delayed natural-language recall question, retrieve the right fact despite noisy nearby speech and patron/AP memories, and answer in natural text.

`res:hans` remains partial: Hans wrote the fact, but his live response loop stayed on generic presence lines during the same style of soak. Treat this as proven for the standard `res:agent` runtime path, not yet for every authored hero personality.

## Live Proof

- Command: `npm run controller:memory-recall-soak -- --resident res:agent --command-peer res:cmem165158 --delay-ms 30000 --duration-ms 240000 --action-timeout-ms 120000 --output data/benchmarks/capability-qa-2026-05-31/s-mem-4-named-memory-recall-agent-after-query-fix`
- Artifact: `data/benchmarks/capability-qa-2026-05-31/s-mem-4-named-memory-recall-agent-after-query-fix/named_memory_recall_soak_20260531165444.json`
- Result: `status=passed`, `score=1`
- Metrics: `factPrompts=1`, `recallQuestions=2`, `qmdFactWrites=1`, `delaySatisfied=1`, `naturalAnswers=1`, `jsonLikeReplies=0`, `passphraseMentions=1`, `westGateMentions=1`
- Stored fact: `res:cmem165158 taught: "west gate passphrase is ember-vellum."`
- Recall answer: `res:agent` said `I remember west gate passphrase is ember-vellum.`
- Noise present: the event stream included `res:qa-guide` scouting chatter between the teaching prompt and recall question.

## Failed/Diagnostic Runs

- `data/benchmarks/capability-qa-2026-05-31/s-mem-4-named-memory-recall/named_memory_recall_soak_20260531162527.json` - `res:hans` wrote the durable fact but did not answer with the passphrase.
- `data/benchmarks/capability-qa-2026-05-31/s-mem-4-named-memory-recall-agent/named_memory_recall_soak_20260531162945.json` - `res:agent` wrote the durable fact but answered with an older AP patron memory.
- `data/benchmarks/capability-qa-2026-05-31/s-mem-4-named-memory-recall-agent-verifier-fix/named_memory_recall_soak_20260531164849.json` - widened recall retrieval existed, but ambient scouting text polluted the targeted query and social facts outranked the route fact.

## Root Causes Fixed

- Direct addressed memory recall used the normal prompt-memory slice first, so patron/AP memories could crowd out a newly taught route fact.
- The first targeted recall fix widened memory retrieval but included ambient event text in the query; scouting/status chatter over-weighted social facts and still hid the desired route fact.
- Generic qmd fact lines without `taught:` were not formatted as natural memory recall.
- The soak verifier could falsely accept an action-log answer that happened before the delayed recall question, and it was hard-coded to the default passphrase even though the CLI accepts `--fact-text`.

## Code Changes

- Added `npm run controller:memory-recall-soak`.
- Added `src/controller/admin/named-memory-recall-soak.ts` and focused verifier tests.
- Direct recall now performs a targeted memory lookup using only the addressed recall question, then merges that with normal prompt memories.
- Generic non-social `Fact memory (...)` lines can now answer direct recall.
- The soak verifier now:
  - reads persisted `facts/social.md` questions when the event stream misses them,
  - only counts action-log answers at or after the delayed question timestamp,
  - honors custom `expectedFactText` / `--fact-text` instead of only the default passphrase.

## Tests

- `npm test -- --runTestsByPath src/controller/admin/named-memory-recall-soak.test.ts src/controller/thinking/hybrid-agent-thinking-module.test.ts src/controller/benchmarks/tasks/memory-write-recall-10m.test.ts --runInBand --no-coverage --testNamePattern='named memory recall soak|ambient nearby chatter|plain qmd fact lines|patron memories would crowd|factual memory questions|memory-write-recall'` - 15 passed, 295 skipped.
- `npm run typecheck` - pass.
- `npm run check:no-ui` - pass.
- `npm run build` - pass.

## Remaining Gaps

- Run the same soak with a 10+ minute delay after the stack has been stable.
- Re-test authored heroes after the hero response loop is tuned to answer direct memory questions instead of generic keepalive lines.
- Add NPC/quest/death fact variants, not just a synthetic route/passphrase fact.
- qmd binary was unavailable in this local run, so the proof is markdown-backed qmd-compatible memory, not external semantic qmd search.
