# CQA11 - Model intelligence twins/triplets evidence (2026-05-29)

| Field | Value |
|---|---|
| Packet | CQA11 |
| Related issues | QA-20260529-004 (combat survival), QA-20260529-008 (AP/GP hierarchy still blocked live) |
| Capability rows | Safe combat and Prayer training; Model intelligence; AP/GP goal hierarchy + Library strategy |
| Date | 2026-05-29 |
| Scope | Re-score existing model-intelligence artifacts across local and paid profiles without changing runtime code |

## Commands run

```bash
npm run benchmark:report -- --input data/benchmarks/model-intelligence-2026-05-27
npm run benchmark:report -- --input data/benchmarks/model-intelligence-paid-2026-05-27
```

Ad-hoc aggregation script:

- Parsed benchmark JSON artifacts in both folders.
- Grouped by `task.id` and `modelProfile`.
- Calculated `runs`, `passRate`, `avgScore`, and `avgSec`.

## Dataset coverage

- Local intelligence set: `12 parsed`, `3 skipped` (`model-intelligence-2026-05-27`)
- Paid intelligence set: `42 parsed`, `4 skipped` (`model-intelligence-paid-2026-05-27`)

## Twin/triplet results by task

### Local twins (Qwen vs Qwopus)

| Task | Qwen pass/runs | Qwopus pass/runs | Notes |
|---|---:|---:|---|
| `follow-and-chat-5m` | 2/2 (100%) | 2/2 (100%) | Both stable on easy social loop. |
| `memory-recall-3m` | 2/2 (100%) | 2/2 (100%) | Both stable on short recall harness. |
| `explore-report-5m` | 2/2 (100%) | 2/2 (100%) | Both stable on movement/report loop. |

### Paid triplets (Qwen vs Qwopus vs Haiku)

| Task | Qwen pass/runs | Qwopus pass/runs | Haiku pass/runs | Notes |
|---|---:|---:|---:|---|
| `combat-prayer-10m` | 0/6 (0%) | 3/6 (50%) | 3/6 (50%) | Hard-task split remains severe; all Qwen failures show unsafe-loop guard trips. |
| `make-fire-5m` | 1/1 | 1/1 | 1/1 | No model separation on simple loop. |
| `starter-fishing-5m` | 1/1 | 1/1 | 1/1 | No model separation. |
| `fishing-cooking-10m` | 1/1 | 1/1 | 1/1 | No model separation. |
| `trading-giving-5m` | 1/1 | 1/1 | 1/1 | No model separation in harness. |
| `memory-recall-3m` | 1/1 | 1/1 | 1/1 | No model separation in short recall harness. |
| `follow-and-chat-5m` | 1/1 | 1/1 | 1/1 | No model separation. |
| `explore-report-5m` | 1/1 | 1/1 | 1/1 | No model separation. |
| `woodcutting-firemaking-10m` | 1/1 | 1/1 | 1/1 | No model separation. |

## Key findings

1. Model separation is currently concentrated in hard combat survival/planning (`combat-prayer-10m`), not in basic starter loops.
2. Qwen remains the clear outlier on hard combat in the paid set (`0/6`) while Qwopus and Haiku are tied (`3/6` each).
3. This packet does not clear `QA-20260529-008`: AP/GP goal hierarchy benchmark still lacks live artifact due loopback `EPERM` in this sandbox.

## Recommended next packet

- `CQA5`: run focused combat survival root-cause pass (flee/eat/target loops) using the same triplet model profiles and capture fresh artifacts.
