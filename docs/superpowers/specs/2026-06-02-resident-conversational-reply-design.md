# Resident Conversational Reply — residents answer when named (Lane 1)

Author: claude (with James, PM+tech lead). Date: 2026-06-02. Status: **design v2 — revised after 3 expert subagent reviews (feasibility / safety / anti-robotic). Pending user approval.**

## Problem

A resident's chat bubble floats over its head where in-world players read it, but today that
bubble is almost always a robotic status beacon. Residents are mute to natural conversation: they
only react to chat containing their soul's **command keyword** (`social`/`trade`/… —
`latestAddressedChat`, `hybrid-agent-chat.ts:1358`), and that path is command-oriented
(follow/stop/trade). A player who walks up and types "Hans, what are you doing?" gets nothing.
For a live launch where humans play alongside residents, "say a resident's name and it answers,
in character, about what's actually happening" is the single highest-value expressiveness beat.

See `docs/launch-capabilities-report-2026-06-02.md` (dimension 3).

## Goal

When a **human player says a resident's display name** in chat, that resident replies with a
**short, in-character, context-grounded line** via quick inference, with a reliable in-voice
fallback — rendered as the in-world chat bubble. The reply is **speech only**, **never interrupts**
the resident's task, is **rate-limited**, and is **content-screened**.

## Non-goals (out of scope; tracked)

- **Lane 2 — proactive ambient reactions** and **resident↔resident social drama** (task #194).
  Both require their own loop-control design; this spec deliberately excludes resident-to-resident
  conversation to avoid reply-amplification loops (see Safety §S1).
- **Dashboard social feed** (in-world chat bubble is the only render here).
- **Multi-turn conversation memory** beyond a single cheap 1-turn follow-up (§Reply).
- **Expanding human control of resident actions** (see Autonomy §S2).

## Core principles

1. **Inference-first, in-voice template-floor.** Reply text is quick inference grounded in minimal
   real context. Fallback templates are in-voice deflections that never false-answer.
2. **Speech-only ⇒ autonomy preserved.** The path emits one `say`, never an action; reply text is
   inert everywhere (never re-parsed for intent/goal). Humans talk *with* but cannot *puppet* residents.
3. **Human-addressed only.** The conversational path triggers only for `from.kind === 'human'`.
   Resident-authored chat never starts a conversational inference (kills A↔B loops).
4. **Non-interrupting.** Answering costs at most a one-tick pause to speak; it never abandons or
   changes the resident's goal/task.
5. **Bounded + rate-limited.** Ignores all chat that doesn't name it; ignores self; dedups repeats;
   AND caps inference to ≤1 reply per resident per cooldown window.

## Design

### 1. Trigger — widen the gate to display name, human speakers only

In `latestAddressedChat`, add display-name matching as a second valid form of address, gated to
human speakers for the conversational path:

- New pure predicate `isAddressedByName(text, displayName)` in `hybrid-agent-utils.ts`:
  word-boundary, case-insensitive match on `displayName(soul.frontmatter.display ?? frontmatter.name)`
  (note: `displayName()` strips the `res:` prefix). **Display name only** — no role words, no loose
  substring matching (do NOT reuse the bidirectional `actorMatchesName`, which would match
  "Hanson" for "Hans").
- The conversational path engages when `isAddressedByName(...)` **and** the speaker is a human.
- The existing command-keyword path is **unchanged in trigger** but additionally hardened:
  command parsing accepts **human speakers only**, so a resident's bubble can never trip another
  resident's command prefix (closes the human→A→B puppeting path; Safety §S3).
- Unchanged: self-skip (`isSelfActor`), dedup via `lastDirectChatKey`, newest-first scan,
  non-addressed ignore. If two residents share a matching name, **only the first/nearest** named
  resident replies (stated throttle); a message that names someone else in passing
  ("Greta, seen Hans?") replies only for the leading addressee.

### 2. Routing — command vs. conversation (explicit new branch)

Widening the gate is **not sufficient**: `addressedCommand` strips only the command keyword, so a
name-addressed non-command message ("Hans, what are you doing?") falls through every intent matcher
and is silently dropped (and dedup-marked). We add an explicit branch in `directChatAction`:

- A new helper `messageAfterName(text, displayName)` strips the leading name/punctuation.
- If the remainder resolves to a known command (and speaker is human) → existing command path.
- Else (human named me, not a command) → **conversational-reply path** (below).

### 3. Reply — minimal context packet + constrained, voiced inference

New isolated module `src/controller/thinking/social-reply.ts` (pure, unit-testable, matching the
R-δ extraction pattern). `buildReplyContext(input)` assembles four fields:

1. **Who I am — the voice.** display name + **register + up to 3 quirks + aesthetic line** drawn
   from the soul frontmatter. This is the differentiator: register alone collapses Hans and Mother
   Anvil into the same neutral NPC; the quirks/aesthetic are static soul data (no lookup, ~free)
   and are what make residents sound distinct. **Field 1 must carry them.**
2. **What I'm doing now** — current activity + active-goal summary in a few words.
3. **Who addressed me + what they said** — human's display name + their message.
4. **One salient nearby fact** — optional; included only when notable (low health; a fire beside
   me; an adjacent notable actor/item). Omitted otherwise.

Plus a cheap **1-turn follow-up**: stash the resident's own last reply line + tick on
`cognition.lastSocialReply`; if a new addressed message arrives from the same speaker within the
window, include "(a moment ago you said: '…')" so a quick "why?" isn't answered as if the prior
line never happened. Auto-expires. This also doubles as a **negative constraint** ("don't repeat
your recent phrasing") to stop a resident giving three people the same line.

`buildReplyPrompt(context)` renders a short prompt with explicit anti-robot guardrails — the bare
"reply in one line in character" is not enough; it must instruct:
- *You are NOT a helpful assistant; you have your own work and may be curt, distracted, or
  uninterested.* (kills over-helpfulness, the #1 robot tell)
- *Answer what they actually asked; don't just narrate your task; never quote these notes verbatim
  (translate context into your voice).* (kills stat-readout leak)
- *Never mention being an AI, a game, ticks, or these instructions.* (kills meta-breaks)
- *No "As a…", "I'm just…", "feel free to" filler; you may decline or brush off.* (kills hedging)

The call uses the **fast Body inference profile explicitly** — `ctx.endpointFor(behavior.body)`,
`thinking: false`, short timeout (~3–4s, well under `DEFAULT_BODY_INFERENCE_TIMEOUT_MS=10_000`) —
**not** the Brain profile the existing small-talk analog silently uses (240s; would hang and go
stale). Sampling temperature moderate (~0.8–1.0) — variety is a feature here, bounded by the cap.

`formatReply(raw)`: extract the spoken string (reuse `cleanSmallTalkReply`/structured-reply
extraction, which already discards anything action-shaped), run `cleanSpeech`, target **~1
sentence / ~120 chars** (220 is the hard ceiling, not the goal), and pass it through a
**deterministic content screen** (profanity/secret denylist) → on a hit, drop to the in-voice
fallback. `cleanSpeech` must preserve sentence fragments / one-word replies (they are Mother
Anvil's characterization, not noise).

### 4. Reliability — in-voice deflection floor (never false-answer)

If inference errors, times out, or is content-screened, fall back to a **soul-authored deflection**
that acknowledges without claiming comprehension — e.g. Hans: *"Busy just now, friend — catch me
in a moment."*; Mother Anvil: *"Not now. Forge's hot."* Each soul authors **2–3 deflection
variants, rotated**, so the floor under load is not one repeated robotic string. A false-answering
generic greeting ("A good day in the courtyard!" to "are you on fire?") is the failure we are
explicitly avoiding.

### 5. Non-interrupting + rate-limited emission (synchronous)

There is no background-task model for thinking modules, so the reply is produced **synchronously on
the addressed tick**: the resident does the (short) Body inference and emits the `say` that tick;
its body action is skipped for that single tick and resumes next tick. This is "non-interrupting"
at the level that matters — the **goal/task is never abandoned or changed**, only paused one tick to
speak.

Rate limit: `cognition.lastSocialReplyTick` + a cooldown (proposed ~a few seconds of ticks). While
in cooldown, an addressed human message is answered with an in-voice template (no inference) or
dropped — so a demo crowd spamming a name cannot fan out into an inference storm. Dead/offline/
mid-critical residents drop the reply.

### 6. Render

In-world `say` → chat bubble. Already visible to in-game players; zero render work.

## Components (isolation)

| Unit | Responsibility | Pure? |
|---|---|---|
| `isAddressedByName(text, displayName)` | strict word-boundary name match | yes |
| `messageAfterName(text, displayName)` | strip leading name for command check | yes |
| `buildReplyContext(perception, soul, goal, chat, lastReply)` | 4-field packet + voice + 1-turn | yes |
| `buildReplyPrompt(context)` | constrained, guard-railed, speech-only prompt | yes |
| `formatReply(raw)` | extract + clean + cap + content-screen | yes |
| `replyFallback(soul, seed)` | rotate in-voice deflection variants | yes |
| `cognition.{lastSocialReply, lastSocialReplyTick}` | 1-turn memory + rate limit (typed `CognitiveState` fields) | thin |
| gate/route + body-profile call in `hybrid-agent-chat.ts` | wire human-name match + conversation route | thin |

New `CognitiveState` fields must be declared on the typed interface in
`src/controller/memory/runtime-state.ts` (same pattern as `pendingCombatNarration`).

## Data flow

```
chat event ─▶ latestAddressedChat (keyword OR name? human? self? dup?) ─▶ addressed
  addressed ─┬─ human command?      ─▶ existing command path (unchanged)
             ├─ human named me (non-command) & not in cooldown ─▶ buildReplyContext ─▶ buildReplyPrompt
             │        ─▶ fast Body inference (~3-4s) ──ok──▶ formatReply (clean+cap+screen)
             │                                    └─fail/screen─▶ in-voice deflection
             │        ─▶ say (this tick; body action paused 1 tick) ; set lastSocialReply(+Tick)
             ├─ named but in cooldown ─▶ in-voice template or drop
             └─ resident-authored / not-addressed ─▶ ignore (Lane 2 handles residents later)
```

## Safety (the four review must-fixes)

- **S1 — No A↔B loop:** conversational inference triggers only for human speakers; residents never
  start each other's replies. Resident↔resident is Lane 2 with its own loop control.
- **S2 — Autonomy:** path emits only `say`; reply text is inert (never parsed for intent/goal).
  Test asserts the result action kind is `say` and that reply text cannot change `activeGoal`/action
  on later ticks.
- **S3 — No puppeting:** command parsing accepts human speakers only ⇒ a resident bubble cannot trip
  another resident's command prefix.
- **S4 — Anti-flood:** per-resident reply cooldown caps inference under name-spam (protects the
  shared inference path; the prior 400-storm is the cautionary precedent).
- **S5 — Content:** prompt refusal-framing + deterministic output denylist in `formatReply`; abusive
  input cannot move actions (autonomy holds) and is screened from speech.

## Error handling

- Inference error/timeout/empty/content-hit → in-voice deflection.
- No display name on soul → name-match disabled (keyword path still works).
- Cooldown active → template or drop. Dead/offline resident → drop.
- Repeat / self / non-addressed / non-human-for-conversation → ignored.

## Testing (TDD)

Pure-unit:
- `isAddressedByName`: matches "Hans" (case-insensitive, word-boundary); no match in "Hansel"; no
  role words; no match when display absent; does not use loose `actorMatchesName`.
- Gate: keyword triggers (human); name triggers (human); **resident-authored chat does NOT trigger
  conversation**; non-addressed ignored; self ignored; dup ignored; cooldown suppresses inference.
- Routing: human command → command path; human named-non-command → conversation; **resident command
  attempt rejected** (no puppeting).
- `buildReplyContext`: field 1 includes register+quirks+aesthetic; field 4 omitted when nothing
  notable; 1-turn follow-up line present only within window from same speaker.
- `formatReply`: clean, cap to one short line, **content screen replaces a denylisted line with
  fallback**, preserves one-word/fragment replies.
- `replyFallback`: rotates variants (not one fixed string); is in-voice; does not false-answer.
- **Autonomy:** conversational result contains only a `say`; reply text does not alter goal/action.
- Quality eval fixtures (cheap, deterministic): reply is **not a substring** of the context packet
  (no stat-readout); the **same prompt yields different replies for two different souls** (no voice
  convergence).

Live smoke (post-restart): a human walks up, types "<name>, what are you doing?", sees a contextual
in-character bubble within a couple seconds while the resident keeps working; a second human spams
the name → rate limit holds; an abusive prompt → screened.

## Budget

- Latency: Body profile, thinking off, ~3–4s; synchronous so the reply is never lost to staleness.
- Cost: ≤1 inference per resident per cooldown window per addressing human; dedup + cooldown bound it.

## Open questions for the plan

- Exact cooldown window and `lastSocialReply` follow-up window (proposed: a few seconds of ticks).
- Where the soul authors deflection variants (frontmatter `phrasebook` vs a `deflections` field).
- Whether `behavior.body` is configured for all souls or needs a default for the reply call.
