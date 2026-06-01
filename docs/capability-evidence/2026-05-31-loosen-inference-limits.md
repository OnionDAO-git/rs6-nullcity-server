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

---

## S-INFER-6 — the spark decision loop only lets SURVIVAL abort the in-flight Brain

### The last brain-cancellation source (root-caused from live data)

Live inference audit: **525/777 = 68%** of brain decisions ended
`thinking_cancelled:interrupted_by:trade_request | addressed_by_chat`. Root
cause: `Spark.considerInterrupt` (`src/controller/spark/spark.ts`) is the gate
the runtime calls (`resident-runtime.ts:518`) when a brain deliberation is
in-flight; for the `SparkThinkingModule` path it decides whether a newly-won
hook supersedes the in-flight Brain via `abortInflight(\`interrupted_by:${winner.id}\`)`.
With 23 social residents, non-survival hooks (`trade_request`, `addressed_by_chat`)
fire constantly and were aborting the slow (~40s qwopus) Brain before it finished.

Architecture intent (maintainer-confirmed): the Brain is a deliberate planner
that should run to completion; only **SURVIVAL** events may abort it. The Body +
Nervous System handle everything else in real time without killing the Brain.
This generalizes S-INFER-4/5 (which removed `interruptThinking` at the nervous
layer) to the spark decision loop — same principle: **only survival aborts the
Brain.**

### What was already in tree (HEAD 90c377d2, "preserve brain deliberation through reflexes")

The bulk of the gate already landed before this packet:

- `spark.ts` `considerInterrupt` already short-circuits on the winner's interrupt
  flag: `if (!winner?.hook.interrupt || winner.priority < this.interruptionMargin()) return false;`
  — non-survival winners (`interrupt:false`) never reach `abortInflight`.
- `hooks.ts`: `addressed_by_chat` and `trade_request` were flipped
  `interrupt: true → false`.
- `resident-runtime.ts`: the nervous-reflex `thinking.stop` was removed.

### S-INFER-6 fix (this packet)

1. **`hooks.ts`** — `attention_empty` (priority 100, the dying-resident hook) had
   **no `interrupt` flag**, so under the now-correct gate it would NOT abort an
   in-flight Brain even though it is a survival event. Set `interrupt: true` so the
   survival set is complete and consistent: `took_damage`, `death_seen`,
   `attention_empty` may abort; everything else preserves the Brain.

2. **Behavioral coverage (was missing)** — added
   `src/controller/spark/spark-interrupt.test.ts`: with a real in-flight mailbox
   request (parked `llm.complete` promise), `considerInterrupt` is probed mid-
   deliberation:
   - `trade_request` winner → returns `false`, in-flight Brain preserved.
   - `addressed_by_chat` winner → returns `false`, preserved.
   - `took_damage` winner → returns `true`, Brain aborted (survival).
   - `death_seen` winner → returns `true`, aborted (survival).
   - `attention_empty` winner (attention drained to 0) → returns `true`, aborted
     (survival) — this was the red test that drove fix #1.
   - no in-flight Brain → `false` (behavior unchanged).

3. **Flag invariant** — extended `hook-evaluator.test.ts` with an S-INFER-6 test
   asserting the full partition: survival hooks (`took_damage`, `death_seen`,
   `attention_empty`) = `interrupt:true`; non-survival (`addressed_by_chat`,
   `trade_request`, `new_actor_or_chunk`, `idle_reflection`) = `interrupt` false
   or unset.

The non-survival hook's own body/reflex action still proceeds via the normal
Body/Nervous path — it simply no longer kills the Brain.

### Gates

`npm run check:no-ui` clean. `npm run fin` = 241 suites / 3474 tests PASS
(typecheck + biome lint/format clean). Out-of-scope biome auto-format of
`benchmarks/tasks/goal-follow-through-5m.ts` was reverted (not staged).

### Honesty / live-verify (PENDING controller restart)

Proven by unit test: **non-survival hooks (`trade_request`, `addressed_by_chat`)
no longer abort the in-flight Brain**; **survival (`took_damage`, `death_seen`,
`attention_empty`) still aborts**. Live cancel-rate impact is **PENDING a
controller restart + re-audit** — this packet does NOT claim the cancel rate hit
zero.

```bash
# restart controller on the new SHA, warm ~20 min, then re-run the inference audit
npm run controller:inference-audit
# expect: thinking_cancelled:interrupted_by:trade_request / :addressed_by_chat → ~0,
# usable-brain-rate ~95%+ even under heavy social activity (23 residents).
grep -oE 'thinking_cancelled(:[a-z_:]+)?' <trajectory> | sort | uniq -c
# expect ZERO interrupted_by:trade_request / interrupted_by:addressed_by_chat.
# Any residual interrupted_by:took_damage / :death_seen / :attention_empty is
# CORRECT (survival aborts are intended).
```

## S-INFER-7 — debounce the Brain: an in-flight deliberation is never superseded by a non-survival trigger

### The 360-cancel evidence (the reason)

Stable-window audit (post S-INFER-4/5/6, controller quiet): **usable-brain-rate
~60%, `cancelled=360` (~38%)**. The hook-interrupt path was already closed
(S-INFER-4/5/6) and for the live hybrid qwopus residents the brain can't be
aborted by hooks at all (`HybridAgentThinkingModule.considerInterrupt()` returns
`false`). So the residual cancels are the Brain being **re-triggered by the next
tick/decision cycle before the previous ~40s deliberation completes** — a new
think supersedes the in-flight one.

### Supersede root cause (the site)

`src/controller/llm/mailbox.ts:20` — `Mailbox.start()` **unconditionally** calls
`this.abort('replaced_by:' + id)` before installing the new in-flight request. So
**any new Spark `decide()` that reaches `mailbox.start()` while a deliberation is
in-flight aborts the in-flight one** (a new think supersedes; the aborted think is
recorded as `thinking_cancelled`). This is the literal "new think supersedes
in-flight" supersede.

Two control-flow facts bound the blast radius:

- The **live hybrid Brain** (`HybridAgentThinkingModule`) is already protected at
  the runtime level: `resident-runtime.ts:514` `if (this.deciding) { … return; }`
  skips a NEW `think()` while one is in-flight (and `controller-host.ts:487` fires
  `onPerception` un-awaited per tick, so overlapping ticks DO arrive — the
  `deciding` guard is what catches them). The hybrid module also doesn't use the
  Spark `Mailbox`, so it never self-supersedes.
- The **SparkThinkingModule / basic-resident path** has NO such re-entry guard
  around `mailbox.start()` — it self-supersedes. That is the residual supersede
  this packet closes.

`mailbox.ts` is in `llm/*` (out of the allowed-files scope), so the fix is placed
at the in-scope seam: the Spark decision loop itself.

### The debounce (the fix)

`src/controller/spark/spark.ts`, in `tick()`, immediately **before**
`mailbox.start()`:

```ts
// S-INFER-7: while a deliberation is already in-flight, a NEW *non-survival*
// trigger must NOT supersede it. Skip the new think (no mailbox.start, no abort).
if (this.mailbox.current() && !winner.hook.interrupt) {
    endReason = 'hook_noop';
    return { actions: [], cause: 'brain_inflight_debounced', nooped: true };
}
```

Invariants preserved:

- **Survival STILL aborts.** Survival hooks are `HookDefinition.interrupt:true`
  (`took_damage` / `death_seen` / `attention_empty`, partition made correct in
  S-INFER-6). They are exempt from the debounce guard (`!winner.hook.interrupt`)
  and abort the in-flight brain via `considerInterrupt() → abortInflight()`. The
  life-saving reflex is never blocked.
- **The Body still runs every tick.** The debounce applies to the Brain tier only.
  In the live hybrid path the Body runs inside the same `think()` as the Brain and
  is governed by the runtime `deciding` re-entry guard, which this change does not
  touch. The Spark `tick()` change only short-circuits a *redundant Brain
  deliberation*; the first/normal decision of every tick still proceeds. (978
  spark/thinking/runtime tests stay green — no Body starvation.)
- **The watchdog still applies.** A brain that runs absurdly long is still stopped
  by `watchdogFallback() → abortInflight('thinking_watchdog_timeout')`
  (resident-runtime watchdog timeout = 75s). No hang is introduced — the debounce
  returns a non-aborting noop synchronously; it never awaits.

### Tests (TDD, `src/controller/spark/spark-debounce.test.ts`, +4)

1. A second non-survival trigger (`trade_request`) during an in-flight brain does
   NOT abort it: `firstController.signal.aborted === false`, `llm.complete` called
   only once, the in-flight request is unchanged, and the tick returns
   `cause: 'brain_inflight_debounced'` (RED before the fix: the tick hung because
   `mailbox.start()` aborted + re-entered the never-resolving completion).
2. A survival trigger (`took_damage`) during an in-flight brain STILL aborts it
   (`considerInterrupt → true`, `signal.aborted === true`).
3. After the in-flight brain completes, a fresh tick (past the idle-reflection
   cooldown) starts a new brain think normally (NOT debounced).
4. The watchdog still aborts a parked in-flight brain (`watchdogFallback`).

### Gates

`npm run check:no-ui` clean. `npm run fin` = 244 suites / 3484 tests PASS
(typecheck + biome lint/format clean). testsBefore=3480 → testsAfter=3484 (+4).

### Honesty / live-verify (PENDING controller restart)

Proven by unit test: **a non-survival Brain trigger no longer supersedes an
in-flight deliberation** (no `thinking.stop`, no `abortInflight`, no
`mailbox.start`); the in-flight brain completes. **Survival still aborts; the Body
still runs every tick; the watchdog is intact.** Live cancel-rate impact is
**PENDING a controller restart + re-audit** — this packet does NOT claim the live
cancel rate dropped.

```bash
# Deploy the bundled final stack (S-INFER-6 + S-WIKI-1 + S-INFER-7), warm ~20 min,
# then re-run the inference audit ONCE in a quiet window (no back-to-back restarts).
npm run controller:inference-audit
# expect: cancelled → ~0, usable-brain-rate ~90%+.
grep -oE 'thinking_cancelled(:[a-z_:]+)?|brain_inflight_debounced' <trajectory> \
  | sort | uniq -c
# expect: ZERO thinking_cancelled:replaced_by:* (supersede gone); a healthy count
# of brain_inflight_debounced (the next tick correctly DEFERRED to the running
# brain instead of cancelling it). Any residual thinking_cancelled:interrupted_by:
# took_damage / :death_seen / :attention_empty is CORRECT (survival aborts).
```

## CLEAN-WINDOW RESULT (2026-05-31 ~22:21Z) — inference fix verified DONE

Stable-window `npm run controller:inference-audit` (window 21:51–22:21Z, 23 residents, 641 brain decisions):
- **usable-brain-rate = 89.1%** (clean=571, recovered=0)
- broken: **timeout=0, empty=0, think_only=0**, schema=2, cancelled=68 (~10.6% residual, basic-resident/minor-churn)
- planning: goalsEmitted=22, goal-follow-through=44.3%
- survival: 10 active residents, `degradedFlags=[]`, zero deaths/logouts/ap_fades

**Arc closed:** qwen3.6-27b non-serving (0% usable, S-INFER-AB-1) → switched brain+body to qwopus3.5-27b (S-INFER model switch) → raised brain timeout 20s→75s (qwopus p50 ~40s) → max_tokens 1536→4096 → made brain uninterruptible by non-survival reflexes/hooks (S-INFER-4/5/6) → in-flight debounce (S-INFER-7) → resolved restart-contention (one stable steward-owned controller). From 0.3% → **89.1% usable** in a clean window. Residents think (qwopus, thinking ON), the Body executes (thinking OFF), the Nervous System protects without aborting the Brain. Survival reflexes + AP self-trade keep residents alive. HD-053 records the qwopus-only model policy.

## S-INFER-8 (2026-05-31 evening) — brain timeout + watchdog are GENEROUS server-broken ALARMS, not a guillotine on real thinking

**Maintainer intent (verbatim):** "the timeout should be for 'the inference server failed' which should raise alarm bells and not even close to cutting off a real thinking session — I'd hate for timeouts to break real resident thinking on goals."

### Finding — the 45s watchdog was the REAL guillotine
The brain **request** timeout was 75s (`DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS` in `hybrid-agent-chat.ts`, `hybrid-agent-helpers.ts`, `hybrid-agent-thinking-module.ts`). But the **thinking watchdog** in `resident-runtime.ts` was only **45s** (`DEFAULT_THINKING_WATCHDOG_MS = 45_000`). The watchdog fires from `thinkWithWatchdog()` via `setTimeout` and calls `thinking.stop('thinking_watchdog_timeout')` — so it fires BEFORE the 75s request timeout. A legitimate full-envelope q4 qwopus brain call runs **~40s**; the 45s watchdog left almost no margin and would cut real deliberations the moment they ran slightly long (and would unconditionally cut the future longer-thinking deliberative planner). **The 45s watchdog — not the 75s request timeout — was the guillotine on legitimate thinking.**

### Fix — alarm-shaped, generous ceilings (NOT thinking bounds)
- **Brain request timeout 75s → 240s** in all three `DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS` files. ~6x a real ~40s deliberation; headroom for the deliberative planner.
- **Thinking watchdog 45s → 250s** (`DEFAULT_THINKING_WATCHDOG_MS`), set slightly ABOVE the 240s request timeout so the request timeout is the cleaner first signal and the watchdog is a pure last-resort backstop. A legitimate ~40s — or even ~150s — deliberation is no longer cut.
- **Body timeout UNTOUCHED** (`DEFAULT_BODY_INFERENCE_TIMEOUT_MS = 10_000`) — the Body runs thinking-OFF / fast; a stuck body call SHOULD time out fast. The fast **action** watchdogs (`ACK_ONLY_ACTION_WATCHDOG_MS=15_000`, `SAY_ACTION_WATCHDOG_MS=10_000`, `ACTION_EFFECT_WATCHDOG_GRACE_MS=10_000`) are UNTOUCHED — they guard fast action EXECUTION, not deliberation.
- **Endpoint `timeoutMs` 75000 → 240000** in the LIVE untracked `controller.yml` (`llm.endpoints.default`) so the HTTP client layer never cuts earlier than the request timeout. (Gitignored local config — NOT committed; steward picks it up on the next deploy.)
- **Loud alarm logging:** both the thinking watchdog firing (`resident-runtime.ts`) AND the brain `request_timeout` path (`hybrid-agent-helpers.ts`) now `console.warn` a `[inference-alarm] … the inference server may be degraded` message pointing at `src/controller/llm/inference-health.ts` (`degradedFlags`) — the real fast "server dead" detector. A brain timeout is now a RARE "investigate the server" event, not routine.
- **Model UNCHANGED** (qwopus q4, thinking ON).

### Proof (unit test, deploy-independent)
- `DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS === 240_000` asserted in all three files; `DEFAULT_THINKING_WATCHDOG_MS === 250_000` (> 240_000) asserted.
- A simulated ~40s AND ~150s brain deliberation is NOT cut by the watchdog (fake-timers: `thinking.stop('thinking_watchdog_timeout')` never called, no `thinking_watchdog_timeout` inference log) — the previous 45s cut is gone.
- Fast action watchdogs (ack/say/action-effect) asserted unchanged (15s/10s/10s).
- The watchdog-fires path emits the loud anomaly `console.warn` (spy assertion).
- Existing brain-timeout assertions updated 75s → 240s; existing watchdog-recovery tests still green.

### Live impact — PENDING DEPLOY
Cancel-rate / cut-rate impact is **not** claimed live by this packet. After deploy + warm window: audit → expect **timeout/watchdog cancels → 0**, usable-brain-rate up; and a brain timeout firing now means **investigate the inference server** (check `inference-health.ts` degradedFlags), not "throttle thinking."

```bash
npm run controller:inference-audit   # expect: broken.timeout=0, usable-brain-rate ~90%+
# histogram a hero trajectory for watchdog/timeout cuts (expect ~0):
grep -oE 'thinking_watchdog_timeout|request_timeout|brain inference request_timeout' <trajectory> | sort | uniq -c
# any [inference-alarm] line in the controller log now = a RARE server-degraded signal to investigate:
grep -n 'inference-alarm' <controller.log>
```
