# S1b AP life-force benchmark evidence

Date: 2026-05-29  
Packet: `S1b`  
Owner: `codex`

## What landed

- New autonomous benchmark task: `ap-decay-ask-5m`.
- Task verifier requires both:
  - low-AP ask evidence (`nervous:request-attention` or `request_attention` action), and
  - fade evidence (`logout` with `cause=attention_exhausted` and observed `attention <= 0`).
- Benchmark runtime now applies a task-specific low attention seed for `ap-decay-ask-5m` (`startingAttention=12`, `decayCurve=steep`, `floor=0`) so fade can happen inside 5 minutes.
- Follow-up live fix: residents without an attention floor now make a critical low-AP appeal at `attention <= 10` instead of silently fading. The appeal copy uses AP / Attention Points, not historical Shards wording.
- Benchmark artifacts now include `attentionAfter` on action-attempt evidence so AP fade artifacts can show the `10 -> 0` decline without reading side logs.

## Verification that ran

- `npm test -- --runInBand src/controller/benchmarks/tasks/ap-decay-ask-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts` ✅
- `npm test -- --runInBand src/controller/nervous-system/nervous-system.test.ts src/controller/benchmarks/tasks/ap-decay-ask-5m.test.ts src/controller/benchmarks/benchmark-runner.test.ts src/controller/benchmarks/autonomous-runtime.test.ts` ✅
- `npm run check:no-ui` ✅
- `npm run build` ✅
- `npm run fin` ✅ (`2605/2605` tests after rebasing over the P0 contract substrate commits)

## Live evidence

Initial command attempted before loopback was available:

```bash
npm run controller:bench -- --task ap-decay-ask-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29
```

Historical failure:

- `[controller:bench] connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`

Live retry after starting the local game gateway:

- First live artifact: `bench_20260529174010_ap_decay_ask_5m.json` timed out. It showed a direct `attention_exhausted` logout but no low-AP ask. Root cause: `requestAttentionReaction` only fired for souls with an attention floor; benchmark residents use `floor=0`.
- Final live artifact: `data/benchmarks/capability-qa-2026-05-29/bench_20260529175058_ap_decay_ask_5m.json` passed with score `1`.

Key final metrics:

| Metric | Value |
|---|---:|
| `startingAp` | 10 |
| `finalAp` | 0 |
| `apDecayObserved` | 1 |
| `lowApAskActions` | 2 |
| `attentionExhaustedLogouts` | 2 |
| `sawAttentionDropToZero` | 1 |
| `selectedModuleActions` | 2 |
| `trajectorySays` | 2 |

Representative action evidence:

```json
{"actionKind":"say","source":"nervous-system","cause":"nervous:request-attention","ok":true,"attentionAfter":10}
{"actionKind":"logout","source":"nervous-system","cause":"attention_exhausted","ok":false,"attentionAfter":0}
```

Result: low-AP ask + attention-exhausted fade is now live-proven. Top-up/resume after a patron AP grant is still a separate follow-up proof.
