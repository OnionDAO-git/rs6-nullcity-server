# Resident Conversational Reply — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Spec:** `docs/superpowers/specs/2026-06-02-resident-conversational-reply-design.md` (v4). **Overnight runbook:** `docs/superpowers/runbooks/2026-06-02-conversational-reply-loop.md`.

**Goal:** When a human *player* says a resident's display name in chat, the resident replies with a short, in-character, context-grounded line via async inference (never freezing), with an in-voice fallback, speech-only, rate-limited, content-screened.

**Architecture:** A new pure module `social-reply.ts` (detection helpers + context/prompt/format/fallback + an in-memory `SocialReplyCoordinator`). Detection + a detached Body-profile inference + emission are wired into `hybrid-agent-thinking-module.ts`. The detached promise commits its result through a callback that re-reads the **live** `cognition` (never a captured closure). **`resident-runtime.ts` and `llm-client.ts` are NOT touched** — the detached call uses the existing `this.options.llm.complete(..., signal)` and participates in the existing global `maxConcurrent` semaphore.

**Tech Stack:** TypeScript, jest (ambient globals — NO vitest imports), existing SPARK thinking module.

---

## Resolved constants (export all from `social-reply.ts`)

| Constant | Value | Why |
|---|---|---|
| `SOCIAL_REPLY_EXPIRE_TICKS` | `10` | ~6s at 600ms/tick; covers a ~4s inference + margin. Stamped at RESOLVE. |
| `SOCIAL_REPLY_GLOBAL_CAP` | `3` | max simultaneous Body social inferences across all residents. |
| `FOLLOW_UP_WINDOW_TICKS` | `20` | same-speaker 1-turn-memory window (~12s). |
| `SOCIAL_REPLY_COOLDOWN_TICKS` | reuse `WINDOW_TICKS` (10, `hybrid-agent-chat.ts:70`) | per-resident reply cooldown via existing `chatReplyTicks`/`isChatRateLimited`. |
| `SOCIAL_REPLY_TEMPERATURE` | `0.9` | variety; bounded by the ~120-char cap. |
| `SOCIAL_REPLY_MAX_CHARS` | `120` | soft target; 220 is the `cleanSpeech` hard ceiling. |

## File footprint (locked)

| File | Type | Change |
|---|---|---|
| `src/controller/thinking/social-reply.ts` | NEW | all pure fns + `SocialReplyCoordinator` + constants/types |
| `src/controller/thinking/social-reply.test.ts` | NEW | unit + temporal/safety tests |
| `src/controller/memory/runtime-state.ts` | EDIT | +3 optional `CognitiveState` fields (after `chatReplyTicks?`, ~line 76) |
| `src/controller/soul/soul-schema.ts` | EDIT | `deflections?: string[]` in interface (~187) + `soulFrontmatterSchema` (~435) |
| `src/controller/soul/phrasebook.ts` | EDIT | `social_reply.deflection` key, 3 variants × 4 archetypes |
| `src/controller/thinking/hybrid-agent-chat.ts` | EDIT | widen `latestAddressedChat` (1358) to display-name + `player`; `player`-only guard in `directChatAction` (439) |
| `src/controller/thinking/hybrid-agent-thinking-module.ts` | EDIT | coordinator field; detection block (after `combatReaction` ~138); emission block (early in `think()` ~96); `commitSocialReply` method |

**NOT touched:** `resident-runtime.ts`, `llm-client.ts`, `city-integration/`, `patron/`. (Removes Loop-agent collision; only `hybrid-agent-thinking-module.ts` is soft-shared with their T1b telemetry — different regions of `think()`.)

> **Code blocks below are representative.** Each task is TDD: write the failing test against the REAL types first, run it red, then implement minimal code to match the live signatures (`HybridPerception`, `Soul`, `pickPhrase`, etc.). The plan fixes the *what/where/test-cases/constants*; the executor matches exact signatures via the red→green loop.

---

### Task 1: Name-detection helpers (pure)

**Files:** Create `src/controller/thinking/social-reply.ts`; Test `src/controller/thinking/social-reply.test.ts`

- [ ] **Step 1 — failing test** (`social-reply.test.ts`):
```ts
import { isAddressedByName, messageAfterName } from './social-reply';
describe('isAddressedByName', () => {
  it('matches the display name on a word boundary, case-insensitively', () => {
    expect(isAddressedByName('Hans, what are you doing?', 'Hans')).toBe(true);
    expect(isAddressedByName('hey hans where to', 'Hans')).toBe(true);
  });
  it('does not match a substring', () => { expect(isAddressedByName('Hansel, come', 'Hans')).toBe(false); });
  it('is false when display name is missing', () => { expect(isAddressedByName('hi', undefined)).toBe(false); });
});
describe('messageAfterName', () => {
  it('strips the leading name + punctuation', () => {
    expect(messageAfterName('Hans, what are you doing?', 'Hans')).toBe('what are you doing?');
    expect(messageAfterName('hey Hans!', 'Hans')).toBe('');
  });
});
```
- [ ] **Step 2 — run red:** `npx jest src/controller/thinking/social-reply.test.ts` → FAIL (module/exports missing).
- [ ] **Step 3 — implement minimal** in `social-reply.ts`: `isAddressedByName` uses `new RegExp('\\b'+escapeRegExp(displayName)+'\\b','i')` (import `escapeRegExp` from `./hybrid-agent-utils`); `messageAfterName` strips a leading `name[,:\s]*` match then trims.
- [ ] **Step 4 — run green.**
- [ ] **Step 5 — commit:** `git add src/controller/thinking/social-reply.ts src/controller/thinking/social-reply.test.ts && git commit -m "feat(social-reply): name-detection helpers (slice 1)"`

### Task 2: `buildReplyContext` (pure, 4-field packet + 1-turn follow-up)

**Files:** Modify `social-reply.ts`, `social-reply.test.ts`

- [ ] **Step 1 — failing test:** assert the returned `SocialReplyContext` includes field-1 voice (`register` + up to 3 `quirks` + `aesthetic` from soul frontmatter), omits `salienceNote` when nothing notable, includes `followUp` ONLY when the same speaker's `cognition.lastSocialReply` is within `FOLLOW_UP_WINDOW_TICKS`, and sets `bypassRateLimit: true` only for that same-speaker follow-up. Build a minimal fake `perception`/`soul`/`cognition` (mirror the `as never` perception pattern in `acquire-tool.test.ts`).
- [ ] **Step 2 — run red.**
- [ ] **Step 3 — implement:** export interface `SocialReplyContext { voice; activity; speaker; salienceNote?; followUp?; bypassRateLimit; speakerActorId }`. `buildReplyContext(perception, soul, cognition, chatText, speakerName, speakerId)`. Field 2 = `summarizeGoalForSpeech(cognition.activeGoal?.description) ?? 'idle'` (reuse from `hybrid-agent-helpers.ts`). Field 4 = low-health / adjacent-fire / notable-actor, else undefined.
- [ ] **Step 4 — green. Step 5 — commit** `"feat(social-reply): buildReplyContext (slice 2)"`.

### Task 3: `buildReplyPrompt` + `formatReply` (pure, content screen)

**Files:** Modify `social-reply.ts`, `social-reply.test.ts`

- [ ] **Step 1 — failing test:** `buildReplyPrompt(ctx)` string contains each guardrail fragment (`NOT a helpful assistant`, `never mention being an AI`, `No "As a`, `you may decline`). `formatReply`: trims to ≤`SOCIAL_REPLY_MAX_CHARS` target / ≤220 ceiling; returns `undefined` on a denylist word; preserves a one-word reply; extracts from a structured JSON blob; returns `undefined` on a structured echo.
- [ ] **Step 2 — run red.**
- [ ] **Step 3 — implement:** `formatReply(raw)` = `cleanSmallTalkReply(raw)` (import from `./hybrid-agent-chat`, line 268) → sentence-trim to 120 → deterministic denylist screen (small profanity/secret array; on hit return undefined). Reuse `extractStructuredChatReply`/`looksLikeStructuredEcho` via `cleanSmallTalkReply` — do not reimplement.
- [ ] **Step 4 — green. Step 5 — commit** `"feat(social-reply): prompt + formatReply with content screen (slice 3)"`.

### Task 4: `replyFallback` + phrasebook deflections

**Files:** Modify `social-reply.ts`, `social-reply.test.ts`, `src/controller/soul/phrasebook.ts`

- [ ] **Step 1 — failing test:** `replyFallback(soul, seedA) !== replyFallback(soul, seedB)` (rotates); a soul with `deflections:['Busy, friend.','Not now.']` picks from those; absent → falls back to phrasebook `social_reply.deflection`; result is non-assenting (does not start with `yes`/`of course`, not a bare question).
- [ ] **Step 2 — run red.**
- [ ] **Step 3 — implement:** add `social_reply.deflection` to all 4 archetype blocks in `phrasebook.ts` (achiever `["Catch me in a minute.","Busy right now.","Give me a sec."]`; mentor `["One moment, please.","I shall return to you shortly.","I am occupied just now."]`; endurer `["Not now.","Busy. Later.","Give me a moment."]`; default `["In a moment.","Busy just now.","One moment."]`). `replyFallback` prefers `soul.frontmatter.deflections` else `pickPhrase(soul,'social_reply.deflection',seed)`.
- [ ] **Step 4 — green. Step 5 — commit** `"feat(social-reply): in-voice deflection fallback (slice 4)"`.

### Task 5: `SocialReplyCoordinator` (in-memory, settle-once)

**Files:** Modify `social-reply.ts`, `social-reply.test.ts`

- [ ] **Step 1 — failing test:** `admit(name,key)` increments counter + returns `{key,controller:AbortController}`; `admit` over `SOCIAL_REPLY_GLOBAL_CAP` → `undefined`; `admit` when `name` already in-flight → `undefined` (dedup); `settle(name,key)` decrements once and is idempotent; `abort(name)` calls `.abort()` then settles; 100×(admit+settle) → `inFlight === 0`.
- [ ] **Step 2 — run red.**
- [ ] **Step 3 — implement:** `class SocialReplyCoordinator { constructor(cap) ; admit(name,key) ; settle(name,key) ; abort(name) ; get inFlight() }` holding `Map<string,{key,controller}>` + `count`. Settle is keyed/idempotent.
- [ ] **Step 4 — green. Step 5 — commit** `"feat(social-reply): SocialReplyCoordinator (slice 5)"`.

### Task 6: `CognitiveState` fields + soul `deflections` schema

**Files:** Modify `src/controller/memory/runtime-state.ts`, `src/controller/soul/soul-schema.ts`, `social-reply.test.ts`

- [ ] **Step 1 — failing test:** (a) a `CognitiveState` carrying `socialReplyInFlight`/`pendingSocialReply`/`lastSocialReply` round-trips through `JSON.parse(JSON.stringify())` unchanged; (b) a soul YAML with `deflections: ["Not now."]` passes `validateSoulFrontmatter` (add to an existing soul-schema test or a new one).
- [ ] **Step 2 — run red** (schema `.strict()` rejects unknown field until added).
- [ ] **Step 3 — implement:** add to `CognitiveState` (after `chatReplyTicks?`): `socialReplyInFlight?: { key: string; startedAtTick: number }; pendingSocialReply?: { text: string; expiresAtTick: number; speakerId: string }; lastSocialReply?: { text: string; tick: number; speaker: string }`. Add `deflections?: string[]` to `SoulFrontmatter` + `deflections: z.array(z.string()).optional()` to `soulFrontmatterSchema`.
- [ ] **Step 4 — green (typecheck included). Step 5 — commit** `"feat(social-reply): CognitiveState fields + soul deflections schema (slice 6)"`.

### Task 7: Detection wiring (gate widen + player guard + detached inference)

**Files:** Modify `src/controller/thinking/hybrid-agent-chat.ts`, `src/controller/thinking/hybrid-agent-thinking-module.ts`, test files

- [ ] **Step 1 — failing test** (in `hybrid-agent-thinking-module.test.ts`, scripted-LLM + sim ticks): a player chat naming the resident (non-command) → on the detection tick `think()` returns NO new freeze (a normal/noop action), `cognition.socialReplyInFlight` is set, `cognition.activeGoal` unchanged, and `llm.complete` is invoked exactly once with the Body profile; a `from.kind === 'resident'` message naming it → NO inference; a resident-authored message containing the command prefix → command path returns `undefined` (player-only guard).
- [ ] **Step 2 — run red.**
- [ ] **Step 3 — implement:**
  - `hybrid-agent-chat.ts`: `latestAddressedChat(perception, commandPrefix, lastKey, displayName?)` — add a branch matching `isAddressedByName(text, displayName)` when `from.kind==='player'`; add `addressedByName?: boolean` to the return. In `directChatAction`, add `if (chat.from?.kind !== 'player') return undefined;` before command dispatch (closes S3).
  - `social-reply.ts`: add pure `detectSocialReply(perception, cognition, commandPrefix, displayName, currentTick): { key, chat } | undefined` — returns the matched player-name-addressed, non-command, not-rate-limited, not-in-flight event (no inference).
  - `hybrid-agent-thinking-module.ts`: add `private socialReplyCoordinator = new SocialReplyCoordinator(SOCIAL_REPLY_GLOBAL_CAP)`. AFTER the `combatReaction` check (~138): call `detectSocialReply`; if matched and `coordinator.admit` grants a slot → set `cognition.socialReplyInFlight`, advance `cognition.lastDirectChatKey`, push `chatReplyTicks`, fire the detached `this.options.llm.complete({ endpoint:this.endpointFor(this.behavior().body), thinking:false, timeoutMs:DEFAULT_BODY_INFERENCE_TIMEOUT_MS, temperature:SOCIAL_REPLY_TEMPERATURE, signal, prompt:buildReplyPrompt(ctx) })` → `.then(r => this.commitSocialReply(key, formatReply(...)))` `.catch(()=> this.commitSocialReply(key, undefined))`; return a noop for that tick (no freeze).
  - `commitSocialReply(key, text)` (private): re-read `this.options.state.cognition`; if `socialReplyInFlight?.key !== key` → return (superseded); stamp `expiresAtTick = currentTick + SOCIAL_REPLY_EXPIRE_TICKS`; write `pendingSocialReply = { text: text ?? replyFallback(...), expiresAtTick, speakerId }`; `coordinator.settle(name, key)`.
- [ ] **Step 4 — green. Step 5 — commit** `"feat(social-reply): detection + detached Body inference wiring (slice 7)"`.

### Task 8: Emission + combat-cancel + load-survival

**Files:** Modify `src/controller/thinking/hybrid-agent-thinking-module.ts`, test files

- [ ] **Step 1 — failing test:** a few ticks after detection, with `pendingSocialReply` fresh + asker still in `nearby.players` + not in combat → `think()` returns `{kind:'say', text, cause:'social_reply_emit'}` and sets `lastSocialReply`; stale (`tick>expiresAtTick`) → cleared, no say; asker absent → cleared, no say; in-combat → cleared, no say; combat entry while in-flight → `coordinator.abort` called and next tick has no `pendingSocialReply`; **load-survival:** reassign `this.options.state.cognition` to a NEW object between detection and `commitSocialReply` → reply still lands (commit re-reads live cognition).
- [ ] **Step 2 — run red.**
- [ ] **Step 3 — implement:** early in `think()` (~96, before the command/`directChatAction` path) add the emission block reading `cognition.pendingSocialReply` with the four guards; clear-and-emit or clear-and-drop. In the combat path, call `this.socialReplyCoordinator.abort(name)`.
- [ ] **Step 4 — green. Step 5 — commit** `"feat(social-reply): emission + combat-cancel + load-survival (slice 8)"`.

### Task 9: Safety + autonomy + concurrency assertions

**Files:** Modify `social-reply.test.ts`, `hybrid-agent-thinking-module.test.ts`

- [ ] **Step 1 — failing tests:** autonomy (conversational result action kind is only `say`; `activeGoal` identical across a full detect→emit cycle); A↔B loop guard (resident speaker → no inference); rate limit (5 addressed within window → ≤`CHAT_REPLIES_PER_WINDOW` inferences); global cap (`CAP+1` simultaneous → last gets fallback, not a 4th inference); in-flight dedup (2nd message while in-flight → no 2nd inference); same-speaker follow-up bypass (1 inference total while first in-flight). Confirm existing command-path tests still pass unmodified.
- [ ] **Step 2 — run red where new.**
- [ ] **Step 3 — implement** any small gaps surfaced (most behavior exists from prior slices; this slice hardens coverage).
- [ ] **Step 4 — green. Step 5 — full gate + commit:** `npm run fin` (or typecheck + full jest) then `git commit -m "test(social-reply): safety/autonomy/concurrency coverage (slice 9)"`.

---

## Coordination notes (for the Loop agent)
- **No `resident-runtime.ts` edit** — collision eliminated. Only soft-shared file is `hybrid-agent-thinking-module.ts` (their T1b telemetry vs my detection/emission blocks — different regions of `think()`). Flag a `[>]` lock in the status log before Slice 7/8 land.
- The detached call uses the existing global `maxConcurrent` semaphore in `LlmClient` (no new counter there); `SocialReplyCoordinator` is a secondary app-level cap. If their T1b lands per-endpoint accounting first, re-point the cap to respect it.

## Self-review (done)
- **Spec coverage:** every v4 §1–§5 + Safety S1–S5 + the v4 temporal tests map to Tasks 1–9 (gate→T7; player-only→T7; coordinator/settle-once→T5; load-survival→T8; content screen→T3; deflections→T4; emission/asker-presence→T8; autonomy→T9). ✓
- **Placeholders:** constants all resolved in the table; no TBDs. ✓
- **Type consistency:** `SocialReplyContext`, `pendingSocialReply{text,expiresAtTick,speakerId}`, `socialReplyInFlight{key,startedAtTick}`, `commitSocialReply(key,text)`, coordinator `admit/settle/abort/inFlight` consistent across tasks. ✓
