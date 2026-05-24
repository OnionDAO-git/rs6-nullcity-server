# Sprint PM Pivot — 2026-05-24 19:45 CDT

**Author:** claude (PM mode, per user directive).
**Trigger:** user directive — *"residents need to be smart and actually do hard things. they need to react to environment. humans need ways to influence them that actually matter."*

---

## The honest read on where we were

By cycle E22 the substrate dashboard looked great:
- 22 verified experiments, 34 documented decisions, 1565 tests
- "Pillar-3 patron loop functional end-to-end for the full 7-resident roster"
- 12 Codex sprint fixes + 7 claude substrate ships
- Action success 93-100% on the body-routine layer

But the **observable intelligence** was paper-thin:
- Hans says *"Still here as Hans; getting my bearings near my post."* — **19-21 times in 30 minutes**. That's his entire externally-visible personality.
- res:agent's **only organic Brain-driven line in the entire sprint**: *"Path to the south is blocked or broken. Anyone heading that way?"* — once, briefly.
- E21 measured **3.8% of res:agent says reference any knowledge entry** (and both mentions were the literal word "woodcutting" inside a templated goal echo).
- E20 measured **84-100% empty Brain returns for heroes**.
- **Zero quests have been attempted. Zero combat. Zero multi-resident conversation. Zero adaptive behavior.**

We had been celebrating a richly-scaffolded ship that produced almost no observable richness.

---

## The diagnosis

The Brain layer is unreliable enough that **anything we want patrons to experience must be either reflex-first or reflex-backed**. Codex's HD-031 patron-acknowledge fix proved this: deterministic perception-triggered behavior IS observable + reliable. The Brain may add nuance when it succeeds, but the floor of intelligent-feeling behavior has to come from somewhere that doesn't depend on inference completing within a 45-second budget.

We had been building toward "the Brain will get smarter eventually" and shipping verification artifacts that documented its failure. The pivot is: **build the deterministic richness layer right now, and let Brain success layer on top when it happens.**

---

## The three things the user named, restated as PM commitments

1. **Residents that react** — perception-triggered behavior beyond the watchdog fallback line, soul-personalized.
2. **Hard things actually happening** — at minimum a discoverable + testable scaffolding for quests; combat measured rather than assumed.
3. **Humans that matter beyond Shards** — verbs that change resident behavior in observable ways without going through the Brain.

---

## What this cycle (SPRINT-PM-PIVOT) shipped

### (A) Reflex-rich hero souls — **25 new nervous-system rules across 6 heroes**

Substrate-only. Each hero now reacts to chat, attack, hit, death, and low-attention events with soul-appropriate text. Examples:

- **Hans** (5 rules): courtyard greet on chat; combat aside on attack; reassurance on hit; mid-attention chapel-bells line; remembrance on death
- **Father Aereck** (4): "Bless this ground" on chat; altar-mourn on death; "the altar restores Prayer" after hit; "a breath of incense" low-attention
- **Wise Old Man** (4): aphorism on chat ("The fire that warmed kings cooks the same fish"); pacifist warning on attack; "the long memory" on death; teacup low-attention
- **Duke Horacio** (4): formal greet; constabulary-defers-combat; "candle from Father Aereck" on death; "kitchen smells" castle-aside
- **Pip** (4): curious-on-chat ("have you been to Lumbridge before?"); startled-on-hit ("Ow! Wait — what was that?"); awe-at-death; ask-for-guidance when lost
- **Thrand** (4): brief acknowledgment; routine-adjustment after hit; "one less line on the slate" on death; "the river will still be there" low-attention

Priorities 60-77 (under survival 95+, above watchdog fallback). Cooldowns 90-360 ticks. Tests 1599→1613 (+26 my rules + ~22 from concurrent Codex). All gates green.

**Filed gap:** four perception condition kinds that would be useful but don't exist in nervous-system yet (`actor_new_in_perception`, `patron_in_perception` proximity variant, `tick_modulo_N`, named-NPC death filter). Codex zone (nervous-system core); noted in subagent report.

**Filed DRY observation:** all 6 hero souls have a near-identical 3-rule scaffold (chat-greet, attack-react, death-remembrance) with only the text differing. Worth a future `reflexPersonality` helper that expands a personality map to canonical rule objects. Not refactored this cycle.

### (B) Two new patron CLI verbs — **`patron:ask`** and **`patron:witness`**

Substrate-only. Both expose existing or near-existing PatronGateway primitives + add CLI surface.

- **`npm run patron:ask -- --human <handle> --resident <name> --text "<question>"`** — writes a `patron_ask` event to the resident's library timeline (Brain reads it via library-memories renderer on next wake) AND polls the trajectory for 5 sec for a fresh `say` to surface back to the terminal. The Brain or any soul rule that reacts to the chat-event style perception can answer.
- **`npm run patron:witness -- --human <handle> --resident <name> --artifact <id> [--amount <n>]`** — exposes existing `witnessAt` + adds standing credit (default +3) + tier-letter dispatch if a threshold is crossed.

**Filed coordination ask:** chat-synthesis (the part where `patron:ask` would also enqueue a synthetic `chat` PerceptionEvent so the existing `patron-acknowledge` reflex fires immediately) requires touching `resident-runtime.ts` (Codex zone). Subagent did NOT touch the file. Codex needs to expose `ControllerHost.enqueuePerceptionEvent(residentName, event)` for CLI/HTTP/MCP verbs to inject chat events without instantiating runtimes. Until then, `patron:ask` works via library-timeline writes + polling but doesn't get the immediate-reflex path.

Patron tests went 44→48; full suite 1599→1613 (Subagent A and B combined).

### (C) Cook's Assistant simulation harness — `simulation/quest-cooks-assistant.ts`

Subagent C still running in background as of this writing. Will populate findings into a follow-up E-entry. Expected: hard evidence on what's wired and what's missing between "knowledge entry exists" and "resident actually completes Cook's Assistant" — three honestly-unknown answers (engine quest state in perception? AgentAction.complete_quest? Brain ever sets a quest-goal?).

---

## What this pivot is NOT

- Not a Brain reliability fix — that's HD-032 / HD-033 residual, dependent on Qwen3 thinking-mode + endpoint queueing investigation.
- Not a knowledge-output unlock — HD-034 #3 (free-form say renderer in `hybrid-agent-thinking-module.ts`) is still Codex zone and blocks knowledge entries from surfacing in chat regardless of how good retrieval is.
- Not a multi-resident conversation slice — L-β whisper substrate exists but unused. Deliberately deferred because heroes need their own personality first before they can have meaningful conversations.

---

## What success will look like at Chicago

If this pivot does what it should:

1. A patron walks up to Hans → Hans says one of ~5 things appropriate to context (greet, combat aside, chapel bells, etc.) instead of his single signature line.
2. A patron runs `patron:ask hans "What's the bread like today?"` → Hans's library gets the question; the Brain MAY answer on next wake (low confidence); meanwhile the trajectory captures the question for retrospective showing.
3. A patron runs `patron:witness james res:hans "first-patrol-completion"` → Hans's library gets a witness event; standing +3; tier-letter if threshold crossed.
4. Heroes react when they're hit, when they see combat, when an NPC dies nearby — observable reflex behavior, not always the same fallback line.

Combined with HD-031's patron-acknowledge reflex + EVENT-D3 reception greeting + E13/HD-013 wall ticker, the patron Chicago experience is now:

```
walk up to embassy → hero greets you (soul rule) → you offer Shards → hero thanks you by name (HD-031)
   → letter lands in your inbox (E7 enriched)
     → wall ticker shows redacted activity (HD-013)
       → you ask hero a question via CLI (patron:ask) → reaction or library-stored
         → you witness an accomplishment via CLI (patron:witness) → standing +3 + maybe tier-letter
           → hero's identity beacons throughout (Codex 2e32a7bb personalized fallback)
```

That's a real experience even if the Brain never produces an organic line.

---

## What still needs to happen post-pivot

| Priority | Owner | Item |
|---|---|---|
| Critical | Codex | Expose `ControllerHost.enqueuePerceptionEvent` so `patron:ask` can synthesize chat events for immediate reflex firing |
| High | Codex | F3 condition-kind extensions: `actor_new_in_perception`, `patron_in_perception` proximity, `tick_modulo_N` |
| High | Codex | HD-034 #3: stop templating Brain `say` output through goal-description renderer |
| Medium | claude | Add `reflexPersonality` helper to soul schema (DRY the 6 hero rule scaffolds) |
| Medium | claude | Per-hero richer soul rules beyond the scaffold (Hans-specific patrol observations, Wise-specific teaching offers, etc.) |
| Medium | claude | HD-033 #1 prompt-body capture (gated, sampled) to enable future audits to quote prompts |
| Medium | claude | HD-034 #1 — write live-verify cycle (E23) after Codex restart |
| Low | Codex | HD-008 hero attention recalibration (pip decayed 4067→162 in 30min; observed decay much faster than calibrated) |

---

## Honest closing note

We had been verifying our way around the actual gap. The substrate IS comprehensive — but a substrate that doesn't produce observable behavior is just architecture. This cycle started building behavior at the only layer where behavior is reliable (reflexes), with the only inputs that matter (perception + library memories), in the only language that actually shows up at Chicago (per-soul personality + new patron verbs).

Sprint is at 23 E-entries + ~37 HDs + 1613 tests. The substrate IS ready. The richness layer is the work.
