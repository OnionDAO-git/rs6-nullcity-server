# S-INFER-4: Loosen the limits that abort the slow qwopus brain mid-think

**Date:** 2026-05-31
**Packet:** S-INFER-4
**Lane:** INFER
**Branch:** agents/wip

## The live finding (the whole reason for this packet)

Measured on the running controller (qwopus brain, 30-min window):

```
brainDecisions=764  usable-brain-rate=0.3%  (clean=2  recovered=0 | cancelled=728  empty=34  think_only=0  schema=0)
```

**728/764 (95%) brain decisions were `thinking_cancelled`** — the nervous
system interrupted the brain mid-think. qwopus takes ~40s to deliberate; during
that window NON-URGENT reflexes (thank-a-patron, addressed-by-chat, routine
AP/GP exchange) fired with `interruptThinking:true` and CANCELLED the in-flight
brain. There were no timeouts (brain timeout is now 75s, fits qwopus p50 ~40s),
no truncation (`think_only=0`). When the brain DOES finish, it is usable (the 2
`clean`). The brain works — it was just never allowed to finish.

## A. interruptThinking reclassification (the big one)

Consumption: in `resident-runtime.ts:489`, a nervous reaction's action is ALWAYS
submitted via `submitActionWithWatchdog`. `reaction.interruptThinking` only gates
the extra `this.thinking.stop(...)` call that aborts the in-flight brain. So
flipping a non-urgent reflex to `interruptThinking:false` DEFERS/parallelizes the
abort: the reflex STILL acts (the resident still says/exchanges), it just no
longer cancels the brain. No reflex action is dropped.

### Every `interruptThinking:true` site and its classification

| Site | Rule | Classification | Decision |
|------|------|----------------|----------|
| `nervous-system.ts:83` | `eat-when-low-health` (HP ≤ 40%) | **SURVIVAL-CRITICAL** — must eat NOW or deliberate to death | **KEEP TRUE** |
| `nervous-system.ts:~135` | `patron-acknowledge` (thank patron for live chat) | NON-URGENT social | **SET FALSE** |
| `nervous-system.ts:~255` | `patron-ask-acknowledge` (addressed_by_chat) | NON-URGENT — being addressed by chat | **SET FALSE** |
| `nervous-system.ts:~320` | `patron-memory-acknowledge` (thank remembered patron) | NON-URGENT social | **SET FALSE** |
| `nervous-system.ts:~370` | `self-initiated-ap-gp-exchange` / `hero-surplus-gp-exchange` | NON-URGENT economic — proactive runway top-up well above floor, NOT imminent death | **SET FALSE** |
| `prompt-envelope.ts:308` | `eat-when-hurt` (schema example, hpFraction ≤ 0.35) | **SURVIVAL-CRITICAL** — canonical low-HP eat example | **KEEP TRUE** |

### Sites that were already `interruptThinking:false` (unchanged, listed for completeness)

- `attention-topup-resume` (`nervous-system.ts:209`) — ack AP top-up, never interrupted.
- `prepare-epitaph` (`nervous-system.ts:411`) — final testament, never interrupted.
- `starter-gp-harvest` (`nervous-system.ts:452`) — goal seed, never interrupted.
- `request-attention-appeal` (`nervous-system.ts:542`) — **this is the actual
  imminent-death reflex** (AP appeal as attention fades). It already runs with
  `interruptThinking:false` (`suppressThinking:true`). It is allowed to fade the
  resident's appeal without aborting thinking; the survival-critical HARD stop is
  the low-health eat reflex above.

### Survival preservation

Survival reflexes that STILL interrupt: **`eat-when-low-health`** (and the
`eat-when-hurt` schema example shown to the Brain). A resident at/below 40% HP
still abandons any slow deliberation to eat immediately — "keep enough attention
to survive" is preserved. Combat-flee / under-attack handling is the same
low-health/eat path plus body routines; no survival interrupt was loosened.

## B. Token headroom

`DEFAULT_BRAIN_MAX_TOKENS`: **1536 → 4096** (`hybrid-agent-helpers.ts`). qwopus
spends most of its ~40s budget on the `<think>` trace before emitting the
compact goal/say JSON. 1536 risked truncating mid-think → the salvage path saw
reasoning-only text → a bogus `think_only_no_answer`. 4096 fits `<think>` + the
JSON answer while staying well under the local quantized model context budget.
Body keeps its own smaller ceiling. Endpoint/profile config still overrides.

## C. Rate / backoff loosening (`budgets.ts`, named constants)

| Constant | Before | After | Why |
|----------|--------|-------|-----|
| `maxRequestsPerMinute` | 20 | **60** | Don't rate-cap a resident that is trying to think. |
| `noInferenceMs` | 60_000 | **20_000** | A transient hiccup must not suppress thinking for a full minute. |
| `maxRequestsPerTick` | 1 | 1 (kept) | Sane per-tick cap. |
| `maxRequestsPerDay` | 10000 | 10000 (kept) | Day ceiling unchanged. |

Kept as named constants (`DEFAULT_MAX_REQUESTS_PER_MINUTE`, `DEFAULT_NO_INFERENCE_MS`,
etc.) so the maintainer can tighten them back later.

## TDD evidence

- NON-URGENT reaction (`patron-ask-acknowledge`, addressed_by_chat) → action
  still fires (`say`), `interruptThinking:false`. (new test)
- SURVIVAL reaction (low-health eat) → `interruptThinking:true`. (new test)
- The 4 reclassified reflexes assert `interruptThinking:false`. (updated tests)
- Budget defaults assert the new looser values (60 / 20_000). (updated test)
- Brain `maxTokens` default asserts 4096. (updated test)
- Stale brain-timeout assertions aligned to the shipped `75_000` default
  (maintainer commit c7bf5678, 20s→75s); these were already red at HEAD,
  unrelated to this packet. No survival guarantee weakened — the change widens
  the deliberation window, consistent with this packet.

## Honesty / live-verify recipe (PENDING controller restart)

Proven by unit test: non-urgent reflexes no longer abort the brain; survival
interrupts (low-health eat) preserved. The live usable-rate impact is **PENDING a
controller restart + re-audit** — this packet does NOT claim the cancel rate
dropped in production.

Live-verify after restart:

```bash
# restart controller, let it warm up, then re-run the inference audit
npm run controller:inference-audit  # (or the equivalent inference-health-audit)
# expect: cancelled% to crash from ~95%, usable-brain-rate to rise from 0.3%.
# Histogram the trajectory cause buckets:
grep -oE 'thinking_cancelled(:[a-z_:]+)?|brain_[a-z_]+|empty_completion(_[a-z_]+)?' <trajectory> | sort | uniq -c
# expect far fewer thinking_cancelled:nervous:patron-* / nervous:self-initiated-ap-gp-exchange.
```
