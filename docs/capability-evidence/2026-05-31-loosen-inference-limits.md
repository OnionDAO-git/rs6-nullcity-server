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

---

# S-INFER-5 — Brain fully uninterruptible (the architectural endpoint)

After S-INFER-4 the live audit showed usable-brain-rate **82.9%** (was 0.3%),
with a residual `cancelled=74` still attributed to reflexes aborting the brain
(live cause labels `thinking_cancelled:interrupted_by:trade_request` and
`:addressed_by_chat`). S-INFER-5 finishes the three-layer model:

> **Brain = deliberative / uninterruptible · Body = reactive · Nervous = reflexive-safety**

## What shipped (in the allowed scope)

Every remaining `interruptThinking: true` in **production** nervous-system code
is now `false`. The Brain can no longer be aborted by ANY nervous reflex:

| Site | Reflex | Before | After |
|------|--------|--------|-------|
| `nervous-system.ts:86` | `eat-when-low-health` (SURVIVAL) | `true` | **`false`** |
| `llm/prompt-envelope.ts:311` | `eat-when-hurt` schema example shown to the Brain | `true` | **`false`** |

(S-INFER-4 had already flipped the non-survival reflexes: `patron-acknowledge`,
`patron-ask-acknowledge` [addressed_by_chat], `patron-memory-acknowledge`,
self-initiated / hero-surplus AP-GP exchange. `requestAttentionReaction` was
always `false`.)

`grep -rn "interruptThinking: true" src/ | grep -v '\.test\.ts'` now returns
**nothing** — production has zero brain-aborting reflexes.

## Why dropping the SURVIVAL interrupt is safe (execution-priority invariant)

The reflex action is **always** submitted at `resident-runtime.ts:489`;
`interruptThinking` ONLY gates the *redundant* extra `thinking.stop()`. So an
`eat-when-low-health` reflex set to `interruptThinking:false` **still eats** in
real time via the Body — it just no longer kills the in-flight deliberation.

The Nervous/Body layer retains **EXECUTION priority** over a stale brain plan, so
a low-health resident cannot deliberate itself to death:

- `lowHealthRecoveryAction` (hybrid-agent-helpers.ts:444) pre-empts the brain
  plan with eat/recovery whenever `isLowHealth(perception)`.
- `classifyCombatDecision` (hybrid-agent-helpers.ts:1353) returns `retreat_low_hp`
  at HP < 15% (or ≤ 30% with no food), filtering a stale "attack" plan at
  execution time. Existing test `F5-T3 (Low HP Retreat)` already proves
  HP 20% + no food → `move_to` flee, NOT attack.

**Invariant verification result: HOLDS** — proven by the new
`resident-runtime.test.ts` test "S-INFER-5: a survival reflex during an in-flight
brain decision STILL acts via the Body but does NOT abort deliberation": with the
brain mid-flight (`think()` pending, `deciding=true`), a low-health survival
reflex (`interruptThinking:false`) is submitted to the Body (`body.submit` called
with the `eat`) while `thinking.stop` is **never** called.

## TDD evidence (S-INFER-5)

- SURVIVAL reaction (low-health eat) now asserts `interruptThinking:false` and
  STILL returns the `eat` action. (updated test — was `true`)
- NON-URGENT `addressed_by_chat` (patron:ask) still acts + `interruptThinking:false`. (S-INFER-4 test, unchanged, still green)
- Execution-priority invariant: Body acts mid-deliberation, brain not aborted. (new resident-runtime test)
- Routing fixtures at `resident-runtime.test.ts` that set `interruptThinking:true`
  are mock reactions exercising action ROUTING (city_exchange / wave-on-hit), not
  production interrupt contracts — intentionally left.

## Residual / FOLLOW-UP (out of S-INFER-5 allowed scope) — `src/controller/spark/hooks.ts`

The live cancel labels `interrupted_by:trade_request` / `interrupted_by:addressed_by_chat`
do **not** originate from nervous-system `interruptThinking`. They come from the
SPARK hook interrupt path:

- `spark/hooks.ts` defines `HookDefinition.interrupt: true` on the system hooks
  `addressed_by_chat` (id, priority 85) and `trade_request` (id, priority 80).
- `spark.ts:486-490` (`considerInterrupt`) calls
  `abortInflight(\`interrupted_by:${winner.id}\`)` when such a hook wins, which
  becomes the `thinking_cancelled:interrupted_by:<id>` cancel cause in the audit.

**Live mitigant already in tree:** the production qwopus Brain is a
`HybridAgentThinkingModule`, whose `considerInterrupt()` returns `false`
unconditionally (hybrid-agent-thinking-module.ts:300). So these two hooks
**cannot abort the hybrid Brain today** — they only bite a `SparkThinkingModule`
or a basic-agent resident. This is why S-INFER-4 already drove usable-rate to
82.9% even with these hooks still `interrupt:true`.

`hooks.ts` is outside the S-INFER-5 allowed-files list. Precise diff-spec for the
follow-up packet (S-INFER-6 or maintainer):

```diff
# src/controller/spark/hooks.ts
         {
             id: 'addressed_by_chat',
             priority: 85,
             condition: { kind: 'event_kind', value: 'chat' },
             cooldownTicks: 2,
-            interrupt: true,
+            // Brain is uninterruptible; this hook still raises the chat context to
+            // the next brain beat, it must not abort an in-flight deliberation (S-INFER-5/6).
+            interrupt: false,
             contextHint: 'Recent chat may be directed at the resident. Respond in character if appropriate.',
         },
         {
             id: 'trade_request',
             priority: 80,
             condition: { kind: 'event_kind', value: 'trade_request' },
             cooldownTicks: 4,
-            interrupt: true,
+            // Brain is uninterruptible; the trade still surfaces to the next brain
+            // beat / Body trade routine, it must not abort deliberation (S-INFER-5/6).
+            interrupt: false,
             contextHint: 'A trade request requires an accept, decline, or social response decision.',
         },
```

Keep the SURVIVAL hooks (`attention_empty`, `took_damage`, `death_seen`)
interrupting at the SPARK layer — those mirror the Body's reflexive-safety role
and do not block the hybrid Brain (which ignores `considerInterrupt` anyway).
After flipping these two, re-audit: the `interrupted_by:trade_request` and
`:addressed_by_chat` buckets should drop to ~0 for any non-hybrid residents.

## Honesty / live-verify recipe (PENDING controller restart)

Proven by unit test: **the Brain is no longer abortable by any nervous reflex**
(production `interruptThinking:true` count = 0); survival actions (eat/flee)
**still execute** via the Body; the **execution-priority invariant HOLDS**
(low-health Body override + `retreat_low_hp` filter a stale unsafe brain attack).
Live cancel-rate impact is **PENDING a controller restart + re-audit** — this
packet does NOT claim the cancel rate hit zero.

Live-verify after restart:

```bash
# restart controller on the new SHA, warm up ~20 min, then re-run inference audit
npm run controller:inference-audit   # (or the inference-health-audit equivalent)
# expect: cancelled → ~0 for nervous causes, usable-brain-rate ~95%+.
grep -oE 'thinking_cancelled(:[a-z_:]+)?|brain_[a-z_]+|empty_completion(_[a-z_]+)?' <trajectory> | sort | uniq -c
# expect ZERO thinking_cancelled:nervous:* (incl. eat-when-low-health). Any residual
# thinking_cancelled:interrupted_by:trade_request / :addressed_by_chat would be a
# non-hybrid resident and is closed by the spark/hooks.ts diff-spec above.
```
