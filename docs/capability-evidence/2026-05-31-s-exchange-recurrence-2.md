# S-EXCHANGE-RECURRENCE-2 - self-initiated AP/GP recurrence verifier

## TL;DR

Status: **passed in autonomous hot-stack benchmark**.

- Ran `self-initiated-ap-gp-recurrence-10m` in autonomous mode against `onion.runescape.standard@0.1.0`.
- Artifact `data/benchmarks/capability-qa-2026-05-31/s-exchange-recurrence-2/bench_20260531081331_self_initiated_ap_gp_recurrence_10m.json` passed with score `1`.
- The verifier observed `2` self-initiated attempts, `2` completed attempts, and `2` fully proven AP/GP exchanges using real coin item `995`.
- This proves repeated benchmark-side recurrence under AP/GP seeding. It does not close ordinary unconditioned multi-resident recurrence, GP earning, trade closure, or human/player operator proof.

## Command

```bash
npm run controller:bench -- --task self-initiated-ap-gp-recurrence-10m --mode autonomous --output data/benchmarks/capability-qa-2026-05-31/s-exchange-recurrence-2
```

Dry run also succeeded:

```bash
npm run controller:bench -- --task self-initiated-ap-gp-recurrence-10m --mode autonomous --dry-run
```

## Artifact

- Run ID: `bench_20260531081331_self_initiated_ap_gp_recurrence_10m`
- Task: `self-initiated-ap-gp-recurrence-10m@0.1.0`
- Mode: `autonomous`
- Module: `onion.runescape.standard@0.1.0`
- Resident: `res:bmk_self_in_00xlfc16`
- Started: `2026-05-31T08:13:31.452Z`
- Ended: `2026-05-31T08:13:32.471Z`
- Duration: `1019ms`
- Reward: `1`
- Failure reason: `none`

Runtime note:

- The benchmark printed `qmd unavailable; memory retrieval is limited to markdown files.`
- It retained runtime artifacts under `/var/folders/xj/wwg7k2z54psbr2f_jb8xpytr0000gn/T/res-bmk_self_in_00xlfc16-bench-KPibPO`.
- Cleanup was skipped because disposable resident deletion was disabled.

## Verifier Metrics

| Metric | Value |
|---|---:|
| `coinItemId` | `995` |
| `requiredFullyProvenExchanges` | `2` |
| `selfInitiatedAttempts` | `2` |
| `selfInitiatedCompleted` | `2` |
| `fullyProvenExchanges` | `2` |
| `actionsAttempted` | `2` |
| `selectedModuleActions` | `1` |
| `selectedModuleInferences` | `0` |
| `meaningfulProgressTicks` | `1` |
| `stuckProgressTicks` | `0` |

## Action Evidence

The artifact's `evidence.actionAttempts` contains two successful `city_exchange_ap_gp` attempts:

1. `source=nervous-system`, `cause=nervous:self-initiated-ap-gp-exchange`, `ok=true`, `attentionAfter=5013`.
2. `source=nervous-system`, `cause=nervous:self-initiated-ap-gp-exchange`, `ok=true`, `finalStatus=success`, `evidenceCount=1`, `sparkModule=onion.runescape.standard@0.1.0`.

The verifier summary states that it observed repeated resident-initiated AP-for-GP exchanges with AP up and coin-995 GP down.

## Interpretation

`S-EXCHANGE-RECURRENCE-2` closes the narrow repeat-verifier question: with benchmark AP/GP seeding, the autonomous resident runtime can produce repeated self-funded AP buys through the nervous-system `city_exchange_ap_gp` route, and the verifier can prove both AP increase and coin-995 GP decrease twice.

Keep `QA-20260529-011` open. The remaining release-relevant gap is ordinary, unconditioned economy recurrence: residents should naturally acquire GP, naturally hit the AP danger band, self-exchange across more than one ordinary resident, and still show trade completion/cancel and human/player operator behavior.

## Follow-Ups

1. Run a 60-120 minute unconditioned normal-life audit after no manual drains.
2. Pair the next CQA10 window with GP earning recurrence so the exchange loop has natural fuel.
3. Complete true human/player operator proof and review the 500 AP / 250 GP cap balance.
