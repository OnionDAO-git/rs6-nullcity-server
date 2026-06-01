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

## Follow-up: top-up/resume substrate (2026-05-29 late run)

To close the remaining S1b/QA-20260529-009 gap, this run added a dedicated benchmark path for fade -> AP top-up -> resumed activity:

- New task: `ap-topup-resume-5m` in `src/controller/benchmarks/tasks/ap-topup-resume-5m.ts`.
- New verifier: requires low-AP ask + fade/logout + AP jump (`attentionAfter <= 0` then `> 0`) + resumed non-logout action after top-up.
- Runtime driver hook: `ResidentRuntimeBenchmarkDriver` now injects one benchmark-scoped AP top-up (`+3000`) after detecting `attention_exhausted` when task id is `ap-topup-resume-5m`.
- CLI registration: task is available in single-run and `--task all` suites.

Verification in this run:

- `npm test -- --runInBand src/controller/benchmarks/tasks/ap-topup-resume-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts src/controller/benchmarks/tasks/ap-decay-ask-5m.test.ts src/controller/benchmarks/cli.test.ts` ✅
- `npm run check:no-ui` ✅
- `npm run build` ✅
- `npm run fin` ❌ (sandbox loopback `EPERM` in unrelated HTTP/WebSocket suites)

Live attempt in this run:

```bash
npm run controller:bench -- --task ap-topup-resume-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29
```

Result:

- `[controller:bench] connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`

Dry-run proof of registration:

```bash
npm run controller:bench -- --task ap-topup-resume-5m --module onion.runescape.standard --mode autonomous --dry-run
```

Output:

```json
{"dryRun":true,"mode":"autonomous","task":{"id":"ap-topup-resume-5m","version":"0.1.0"},"module":{"id":"onion.runescape.standard","version":"0.1.0"}}
```

Current state from the late 2026-05-29 run: top-up/resume verifier and runtime substrate landed, but live artifact capture remained blocked in that sandbox.

## Live proof: top-up/resume closed (2026-05-30)

Follow-up run on loopback-permitted local infra:

```bash
npm run start:infra
npm run start:game
npm run controller:bench -- --task ap-topup-resume-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29
```

Final artifact:

- `data/benchmarks/capability-qa-2026-05-29/bench_20260530021203_ap_topup_resume_5m.json`
- Status: `passed`
- Score: `1`

Key metrics:

| Metric | Value |
|---|---:|
| `startingAp` | 10 |
| `finalAp` | 2994 |
| `minObservedAttention` | 0 |
| `lowApAskActions` | 6 |
| `attentionExhaustedLogouts` | 2 |
| `topUpJumps` | 1 |
| `resumeAfterTopUpActions` | 1 |
| `trajectoryActions` | 7 |
| `trajectorySays` | 6 |

Representative action sequence:

```json
{"kind":"say","cause":"nervous:request-attention","source":"nervous-system","finalStatus":"success"}
{"kind":"ap_topup","cause":"benchmark:ap-topup-resume-5m","source":"benchmark","finalStatus":"success","attentionAfter":3000}
{"kind":"logout","cause":"attention_exhausted","source":"nervous-system","finalStatus":"failure","finalReason":"session_closed"}
{"kind":"say","cause":"nervous:attention-topup-resume","source":"nervous-system","finalStatus":"failure","finalReason":"session_closed"}
{"kind":"say","cause":"nervous:attention-topup-resume","source":"nervous-system","finalStatus":"success"}
```

Root-cause fix from the proof run:

- `ResidentRuntime.incrementAttention()` now queues an `attention_topup` perception event when AP revives an attention-exhausted resident.
- Runtime schedules an immediate reconnect plus a short retry after top-up, so a late logout close cannot strand the resident.
- If the visible resume line fails or is body-blocked, the top-up event is requeued and the AP-resume cooldown is cleared, so the resident retries instead of silently losing the revival moment.
- The benchmark verifier now rejects body-blocked resume lines; a pass requires a successful/accepted non-logout action after the AP top-up.

Result: AP life-force is now live-proven through ask -> fade/logout -> top-up -> visible resume. Remaining caveat: this proves the runtime/benchmark revival path; named-resident patron top-up should get one ordinary-life soak next to prove the same behavior outside the benchmark harness.
