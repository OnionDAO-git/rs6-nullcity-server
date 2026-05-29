# S1b AP life-force benchmark attempt (blocked in sandbox)

Date: 2026-05-29  
Packet: `S1b`  
Owner: `codex`

## What landed

- New autonomous benchmark task: `ap-decay-ask-5m`.
- Task verifier requires both:
  - low-AP ask evidence (`nervous:request-attention` or `request_attention` action), and
  - fade evidence (`logout` with `cause=attention_exhausted` and observed `attention <= 0`).
- Benchmark runtime now applies a task-specific low attention seed for `ap-decay-ask-5m` (`startingAttention=12`, `decayCurve=steep`, `floor=0`) so fade can happen inside 5 minutes.

## Verification that ran

- `npm test -- --runInBand src/controller/benchmarks/tasks/ap-decay-ask-5m.test.ts src/controller/benchmarks/autonomous-runtime.test.ts` ✅
- `npm run check:no-ui` ✅
- `npm run build` ✅
- `npm run fin` ⚠️ failed in sandbox due unrelated loopback listen restrictions (`listen EPERM 127.0.0.1` in existing HTTP/MCP/gateway tests).

## Live evidence attempt and blocker

Command attempted:

```bash
npm run controller:bench -- --task ap-decay-ask-5m --module onion.runescape.standard --mode autonomous --output data/benchmarks/capability-qa-2026-05-29
```

Observed failure:

- `[controller:bench] connect EPERM 127.0.0.1:43595 - Local (0.0.0.0:0)`

Result: no benchmark artifact was produced in this sandbox run, so S1b live AP fade/resume proof remains blocked until loopback gateway connections are permitted.
