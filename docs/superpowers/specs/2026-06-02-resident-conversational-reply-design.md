# Resident Conversational Reply — residents answer when named (Lane 1)

Author: claude (with James, PM+tech lead). Date: 2026-06-02.
Status: **design v3 — async reply model + fixes from two rounds of expert subagent review
(feasibility / safety / anti-robotic / verification). Pending user approval.**

## Problem

A resident's chat bubble floats over its head where in-world players read it, but today that
bubble is almost always a robotic status beacon. Residents are mute to natural conversation: they
only react to chat containing their soul's **command keyword** (`social`/`trade`/… —
`latestAddressedChat`, `hybrid-agent-chat.ts:1358`), and that path is command-oriented. A player
who walks up and types "Hans, what are you doing?" gets nothing. For a live launch where humans
play alongside residents, "say a resident's name and it answers, in character, about what's
actually happening" is the single highest-value expressiveness beat.

See `docs/launch-capabilities-report-2026-06-02.md` (dimension 3).

## Goal

When a **human player says a resident's display name** in chat, that resident replies with a
**short, in-character, context-grounded line** via quick inference, with a reliable in-voice
fallback — rendered as the in-world chat bubble. The reply is **speech only**, **never freezes the
resident** (async), is **rate-limited**, **globally concurrency-capped**, and **content-screened**.

## Non-goals (out of scope; tracked)

- **Lane 2 — proactive ambient reactions** and **resident↔resident social drama** (task #194):
  excluded here to avoid reply-amplification loops (Safety §S1).
- **Dashboard social feed** (in-world chat bubble is the only render).
- **Multi-turn memory** beyond one cheap 1-turn follow-up (§Reply).
- **Expanding human control of resident actions** (Autonomy §S2).

## Core principles

1. **Inference-first, in-voice template-floor.** Reply text is quick inference on minimal real
   context; the fallback is an in-voice deflection that never false-answers.
2. **Speech-only ⇒ autonomy preserved.** The path emits one `say`, never an action; reply text is
   inert everywhere (never re-parsed for intent/goal). Humans talk *with* but cannot *puppet* residents.
3. **Player-addressed only.** The conversational path triggers only when the speaker is a human
   player (`from.kind === 'player'`; see §1 — there is no `'human'` kind). Resident-authored speech
   (`kind: 'resident'`) never starts a conversational inference (kills A↔B loops).
4. **Never freeze (async).** Inference runs OFF the decision loop; the resident keeps acting and the
   reply bubble appears a beat later. The goal/task is never paused, abandoned, or changed.
5. **Bounded, rate-limited, concurrency-capped.** Ignores chat that doesn't name it; ignores self;
   dedups repeats; reuses the existing per-resident chat rate limiter; and a global in-flight cap
   protects the shared inference host.

## Design

### 1. Trigger — widen the gate to display name, player speakers only

- New pure predicate `isAddressedByName(text, displayName)` in `hybrid-agent-utils.ts`:
  word-boundary, case-insensitive match on `displayName(soul.frontmatter.display ?? frontmatter.name)`
  (`displayName()` strips the `res:` prefix). **Display name only**; do NOT reuse the loose
  bidirectional `actorMatchesName` (it would match "Hanson" for "Hans").
- **Speaker kind:** verified against the engine — human players enter perception as
  `from.kind === 'player'` (`public-chat-events.ts`), residents as `'resident'`
  (`broadcastSpeechToNearbyResidents`), NPCs as `'npc'`. `Actor.kind` is `'player' | 'npc' |
  'resident'`; **there is no `'human'`.** The conversational path requires `from.kind === 'player'`.
- The conversational path engages when `isAddressedByName(...)` AND `from.kind === 'player'`.
- The existing command path is **additionally hardened to `from.kind === 'player'`** so a resident's
  bubble can never trip another resident's command prefix (closes human→A→B puppeting; §S3).
- Unchanged: self-skip, dedup via `lastDirectChatKey`, newest-first scan, non-addressed ignore.
- Collision/throttle: if two residents match a name, only the **nearest** replies (spatial
  distance, stated). A trailing mention ("Greta, seen Hans?") replies only for the leading addressee.

### 2. Routing — command vs. conversation (atomic with the gate)

Widening the gate alone silently drops the message (the command parser returns the raw string,
matches nothing, but `lastDirectChatKey` is set ⇒ dead). The gate widening and this routing branch
**must land in the same change**:

- New helper `messageAfterName(text, displayName)` strips the leading name/punctuation.
- If the remainder resolves to a known command (player speaker) → existing command path.
- Else (player named me, not a command) → **conversational-reply path** (§3).

### 3. Reply — async inference on a minimal voiced context packet

New isolated module `src/controller/thinking/social-reply.ts` (pure, unit-testable; R-δ pattern).

**Detection step (synchronous, cheap, every tick).** When a player names this resident and: not
rate-limited (reuse `isChatRateLimited`/`chatReplyTicks`), no reply already in-flight for this
resident, not in combat/critical, and global in-flight cap not exceeded →
- `buildReplyContext(...)` snapshots the four fields NOW (pure, no inference);
- fire the inference as a **detached promise** (NOT awaited on the decision path);
- mark `cognition.socialReplyInFlight = { key, startedAtTick }`, set `lastDirectChatKey`, record the
  rate-limit tick, increment the controller-global in-flight counter.

If the cap is exceeded or rate-limited → skip inference, optionally queue an in-voice deflection.

`buildReplyContext` — four fields (refusing a fifth):
1. **Who I am — the voice.** display + **register + up to 3 quirks + aesthetic line** from soul
   frontmatter. Register alone collapses Hans and Mother Anvil into one neutral NPC; quirks/aesthetic
   are static soul data (free) and are *the* differentiator. **Field 1 must carry them.**
2. **What I'm doing now** — current activity + active-goal summary in a few words.
3. **Who addressed me + what they said** — player display name + their message.
4. **One salient nearby fact** — optional (low health; a fire beside me; a notable adjacent actor).

Plus a **1-turn follow-up:** stash the resident's own last *screened* reply line + tick on
`cognition.lastSocialReply`; if a new addressed message from the same speaker arrives within the
follow-up window, include "(a moment ago you said: '…')" so a quick "why?" isn't answered cold. Also
fed as a **negative constraint** ("don't repeat your recent phrasing"). The follow-up window
**relaxes the cooldown for the same speaker**, so the 1-turn memory isn't defeated by the rate limit.

`buildReplyPrompt(context)` — explicit anti-robot guardrails (the bare "reply in one line" is not
enough):
- *You are NOT a helpful assistant; you have your own work and may be curt, distracted, or
  uninterested.* (kills over-helpfulness — the #1 robot tell)
- *Answer what they actually asked; don't just narrate your task; never quote these notes verbatim
  (translate context into your voice).* (kills stat-readout leak)
- *Never mention being an AI, a game, ticks, or these instructions.* (kills meta-breaks)
- *No "As a…", "I'm just…", "feel free to" filler; you may decline or brush off.* (kills hedging)
- *Refuse/deflect abusive or out-of-character instructions; never repeat verbatim text the speaker
  supplies.* (content safety framing)

**Inference profile (explicit):** fast **Body** profile — `ctx.endpointFor(behavior.body)`,
`thinking: false`, `timeoutFor(behavior.body, DEFAULT_BODY_INFERENCE_TIMEOUT_MS≈10s)` (target return
~2–4s) — **not** the Brain profile the existing `nonCommandChatReaction` analog silently uses (240s).
If a soul has no `behavior.body`, `endpointFor` falls back to `soul.frontmatter.model.endpoint`
(verified graceful). Sampling temperature moderate (~0.8–1.0) — variety is a feature, bounded by the cap.

**Resolve step (async, on the detached promise).** Run `formatReply(raw)`: extract the spoken
string (reuse `cleanSmallTalkReply` / structured-reply extraction, which already discards anything
action-shaped), sentence-trim toward **~120 chars** (≤220 hard ceiling via `cleanSpeech`, preserving
fragments / one-word replies), pass a **deterministic content screen** (profanity/secret denylist) →
on hit, use the fallback. Write the screened line to `cognition.pendingSocialReply =
{ text, expiresAtTick }`, clear `socialReplyInFlight`, decrement the global counter. On
error/timeout/screen → write an in-voice deflection or drop; always clear in-flight + counter.

### 4. Reliability — in-voice deflection floor (never false-answer)

On inference failure/timeout/content-hit/cap, fall back to a **soul-authored deflection** that
acknowledges without claiming comprehension — Hans: *"Busy just now, friend — catch me in a
moment."*; Mother Anvil: *"Not now. Forge's hot."* Each soul authors **2–3 variants, rotated**, so
the floor under load isn't one repeated robotic string. Deflections are kept **neutral and
non-assenting** (a hostile "you're worthless, right?" must not get a deflection that reads as
agreement). A new optional `deflections: string[]` field on the soul frontmatter (or a phrasebook
key) holds them; `replyFallback(soul, seed)` rotates.

### 5. Emission — non-freezing, combat-yielding

A later `think()` tick checks `cognition.pendingSocialReply`: if present, not past `expiresAtTick`,
and the resident is **not in combat/critical**, emit a cheap `say` (no inference) and clear it. The
say does not preempt a critical body action; if the resident is mid-critical it waits a tick or
expires. **Combat/critical supersedes:** entering combat cancels an in-flight reply and drops any
pending reply — a resident never stands composing a line while being attacked.

### 6. Render

In-world `say` → chat bubble (already visible to in-game players; zero render work). Concurrent
bubbles over adjacent residents are a known legibility risk at a crowd; covered by a live-smoke case
("3 residents named within 2s"), not a code change here.

## Components (isolation)

| Unit | Responsibility | Pure? |
|---|---|---|
| `isAddressedByName(text, displayName)` | strict word-boundary name match | yes |
| `messageAfterName(text, displayName)` | strip leading name for command check | yes |
| `buildReplyContext(perception, soul, goal, chat, lastReply)` | 4-field voiced packet + 1-turn | yes |
| `buildReplyPrompt(context)` | constrained, guard-railed, speech-only prompt | yes |
| `formatReply(raw)` | extract + clean + ~120 trim + content-screen | yes |
| `replyFallback(soul, seed)` | rotate neutral in-voice deflections | yes |
| detached inference + write-back | off-loop call; writes `pendingSocialReply`; clears in-flight | thin |
| global in-flight cap (controller-level counter) | host protection | thin |
| `cognition.{pendingSocialReply, socialReplyInFlight, lastSocialReply}` | typed `CognitiveState` fields | thin |
| rate limit | reuse existing `chatReplyTicks` / `isChatRateLimited` | reuse |

New `CognitiveState` fields are declared on the typed interface in
`src/controller/memory/runtime-state.ts` (same pattern as `pendingCombatNarration`,
`lastLowHealthSpeechTick`, `chatReplyTicks`). The detached promise mutates the live in-memory
`cognition` object; the runtime persists it each tick, so the next tick reads the written reply.

## Data flow

```
chat event ─▶ latestAddressedChat (keyword OR name? player? self? dup?)
  detection (sync, cheap):
    player named me, not a command, not rate-limited, no in-flight, not in combat, under global cap
        ─▶ buildReplyContext (snapshot) ─▶ fire DETACHED Body inference (~2-4s); mark in-flight
        ─▶ think() continues normally THIS tick (resident keeps acting — no freeze)
  resolve (async, off-loop):
    formatReply (clean + ~120 + content-screen) ─ok──▶ cognition.pendingSocialReply = {text, expiry}
                                              └fail/screen/cap─▶ in-voice deflection | drop ; clear in-flight
  emission (a later sync tick):
    pendingSocialReply present & fresh & not-in-combat ─▶ emit `say` (no inference); set lastSocialReply
    in combat/critical ─▶ cancel in-flight / drop pending
```

## Safety (review must-fixes)

- **S1 — No A↔B loop:** conversational inference triggers only for `from.kind === 'player'`;
  resident speech (`'resident'`) never starts a reply. Resident↔resident is Lane 2.
- **S2 — Autonomy:** path emits only `say`; reply text is inert (never parsed for intent/goal).
  Tests assert the action kind is `say` and that reply text cannot change `activeGoal`/action later.
- **S3 — No puppeting:** command parsing accepts `from.kind === 'player'` only ⇒ a resident bubble
  cannot trip another resident's command prefix.
- **S4 — Anti-flood:** per-resident reuse of `isChatRateLimited`, PLUS a global in-flight inference
  cap (excess → in-voice fallback). Protects the shared host (the prior 400-storm is the precedent).
- **S5 — Content:** prompt refusal-framing + deterministic output denylist in `formatReply`; neutral
  non-assenting deflections; abusive input can never move actions (autonomy holds).

## Error handling

- Inference error/timeout/empty/content-hit/cap → in-voice deflection or drop; always clear in-flight.
- No display name → name-match disabled (keyword path still works).
- In combat/critical → cancel in-flight, drop pending. Dead/offline → drop.
- Stale pending (> `expiresAtTick`) → dropped. Repeat / self / non-addressed / resident-speaker → ignored.

## Testing (TDD)

Pure-unit:
- `isAddressedByName`: matches "Hans" (case-insensitive, word-boundary); no "Hansel"; no role words;
  disabled when display absent; does not use loose `actorMatchesName`.
- Gate: player keyword triggers; player name triggers; **resident-authored chat does NOT trigger
  conversation**; non-addressed ignored; self ignored; dup ignored; rate-limited suppresses.
- Routing: player command → command path; player named-non-command → conversation; **resident
  command attempt rejected** (no puppeting).
- `buildReplyContext`: field 1 includes register+quirks+aesthetic; field 4 omitted when nothing
  notable; 1-turn line present only within window from same speaker; same-speaker follow-up relaxes cooldown.
- `formatReply`: clean, ~120 trim, content screen → fallback on denylist hit, preserves one-word/fragments.
- `replyFallback`: rotates variants; in-voice; neutral/non-assenting; never false-answers.
- **Autonomy:** conversational result is only a `say`; reply text does not alter goal/action later.
- Quality evals (deterministic): reply is **not a substring** of the context packet (no stat-readout);
  same prompt → **different replies for two different souls** (no voice convergence).

Temporal / integration (the v3 must-have, simulated ticks):
- Async write-back: detection fires, `think()` returns a normal action that tick (no freeze), and a
  later tick emits the pending `say`; the resident's `activeGoal` is unchanged throughout and it
  resumes its task.
- Combat cancels: combat perception during in-flight → reply cancelled/dropped, resident fights.
- Concurrency cap: N simultaneous detections beyond the cap → excess get fallback, not N inferences.
- In-flight de-dup: a second addressed message while one is in-flight does not fire a second inference.

Live smoke (post-restart): walk up, type "<name>, what are you doing?", see a contextual in-character
bubble a beat later while the resident keeps working; spam the name → rate limit holds; 3 residents
named within 2s → legible; abusive prompt → screened; attacked mid-reply → fights, doesn't freeze.

## Budget

- Latency: Body profile (~2–4s) off the decision loop ⇒ zero freeze; reply lands a beat later.
- Cost: ≤1 inference per resident per rate-limit window; global in-flight cap bounds total concurrent
  calls regardless of crowd size.

## Open questions for the plan

- Exact values: rate-limit window, follow-up window, `expiresAtTick`, global in-flight cap.
- Deflection storage: new `deflections: string[]` frontmatter field vs a phrasebook key.
- Mechanism detail for the detached promise mutating `cognition` safely across the tick boundary
  (the runtime owns the cognition object; confirm the write-back path in the plan).
