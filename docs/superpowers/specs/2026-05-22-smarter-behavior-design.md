# Smarter Behavior (F2/F3/F5/G4/G5 Finish) — Design

**Status:** Draft v1, pending maintainer approval and expert subagent review.
**Author:** Claude (with the maintainer in brainstorming).
**Date:** 2026-05-22.
**Supersedes:** the floating partial-state notes for F2/F3/F5/G4/G5 in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.
**Coordinates with:** Workstream A (capability facades) and the planned Workstream B extraction of `hybrid-agent-thinking-module.ts`. See "Dependency on Workstream A/B" below.

**Revision history:**
- v1 (2026-05-22): initial draft from brainstorming. Decomposes the five sub-features into one plan each, all TDD-doable in 1–3 hours.

## Why This Spec Exists

The roadmap has five partially-shipped or unstarted human-behavior tasks (`[F2]`, `[F3]`, `[F5]`, `[G4]`, `[G5]`) that collectively decide whether `res:agent` reads as "a person responding to me" or "a state machine ignoring everyone but their goal." Each is small enough to be a side quest but together they shape the entire feel of the June 1 demo.

Today the resident:

- Hears direct commands (prefix-addressed or name-mentioned) and reacts via `directChatAction` — but ignores all other public chat.
- Detects stationary ticks and opens a nearby door, or once-reports a fence blocker — but never asks for help when no local recovery exists.
- Reacts to combat with eat/retaliate/retreat via `combatReaction` — but does not narrate the decision in chat.
- Has a working trade flow when *commanded* — but never *initiates* a trade unprompted, and trust-checks only via a hardcoded predicate.
- Has a fixed command vocabulary in `directChatAction` (follow/return/stop/status/look/inventory/pickup/drop/train/attack/retreat/trade/explore/make-fire/cook) — but no "come here", "stop following", "wait", or polite-rejection path for unknown commands.

This spec defines the behavior contracts, integration points, test fixtures, and open questions for each gap. It is deliberately decomposed so the five sub-features ship independently and Codex can pick any of them up in parallel.

## Goals

- Residents respond to *all* public chat in earshot, in character, with bounded inference cost — not just directly-addressed commands.
- Ambiguous commands trigger one clarifying question instead of guessing.
- Stuck recovery escalates: local recovery → alternate target → "I'm stuck near the eastern fence — can someone open the gate?" → patrol step.
- Combat decisions are narrated verbatim in chat so observers learn the resident's personality.
- Residents can *initiate* a trade with a trusted peer when they have a surplus the peer plausibly wants.
- The command vocabulary covers the conversational basics ("come here", "stop", "wait", "follow X", "stop following") and politely declines unknown commands instead of falling through silently.

## Non-Goals

- Replacing the Brain inference loop with a chat-first architecture. Small-talk replies are bounded, infrequent, and pass through the same budgeted inference facade.
- Open-ended natural-language command parsing. The vocabulary stays a finite enumerated set; ambiguity → clarifying question, not heuristic guessing.
- Cross-resident social graph or rumor propagation. F2 is one-to-one only (resident hears one chat line, optionally replies). Cross-resident lore is `Workstream L`.
- Trade *pricing*, market-clearing, or persistent ledgers. G4 is the gesture, not the economy.
- Eliminating combat-reaction reflexes from the kernel. F5 narrates the decision; the decision itself stays where it is.

## Constraints

- **TypeScript, Node 24+, existing repo conventions** (Zod for schemas, Jest for tests, Biome for lint/format).
- **Patrons-don't-control invariant.** Residents may *politely decline* commands that override their internal goals. Decline must cite an in-voice reason; the decline itself is an `AgentAction` of `kind: 'say'`, not a silent noop. This invariant is the single most important behavior bound in this spec.
- **Voice preservation.** Every chat output must match `soul.voice.register` and `soul.quirks`. No hardcoded English phrasings in the module — phrasing comes from a small per-soul phrasebook with a deterministic seeded picker, OR from the budgeted inference facade with the soul fields in the prompt envelope.
- **Constrained action catalog.** Residents only emit typed `AgentAction` verbs. The five sub-features add NO new action kinds — they compose existing ones (`say`, `move_to`, `eat`, `attack`, `interact`, `drop`, `trade_request`, `trade_offer_item`, `trade_accept`, `trade_decline`, `dialogue_choice`, `dialogue_continue`). If a new verb is required, it is flagged as an Open Question and deferred.
- **Single-process, kernel-owned safety.** Combat reflexes, attention budget, and inference admission stay where they are. This spec adds behavior on top of those facets; it does not move them.
- **Bounded inference cost.** Small-talk replies are admitted by the existing inference budget. When the budget is exhausted, the resident silently observes instead of replying. This is intentional: a quiet resident is preferable to one that spams trivial replies.
- **No new files outside `src/controller/thinking/` and tests** until Workstream A's public module contract or Workstream B's extraction lands. Helper functions added in this spec live alongside the existing private helpers in `hybrid-agent-thinking-module.ts` so the diff is local to one file.

## Dependency on Workstream A/B

`hybrid-agent-thinking-module.ts` is 2578 lines today and growing. Workstream B (`[B2]–[B5]`) plans to extract it into composable modules (`runescape-workflows.ts`, `runescape-body-routines.ts`, `runescape-brain-planner.ts`, `runescape-nervous-rules.ts`). The five sub-features here are designed so that:

1. **Pre-extraction:** all integration points live in `hybrid-agent-thinking-module.ts`. The diff is one file per sub-feature.
2. **Post-extraction:** each sub-feature has a named destination. F2 → workflows + brain. F3 → body routines + brain. F5 → nervous rules + workflows. G4 → workflows + brain. G5 → workflows. The behavior contracts in this spec are stable across the move; only the file paths change.

**Concrete coordination rule.** If Workstream B has started when a sub-feature here ships, the implementer routes the new code to the *extracted* file and updates this spec's "Integration point" line with a one-line note. If B has not started, the code lands in the monolith and the spec is unchanged. Both paths are valid; the contracts do not depend on which is true.

This dependency is flagged on each sub-feature below.

---

## Cross-cutting design: chat-reply guardrails

All five sub-features share one mechanism: the resident may emit a `say` action that is voiced, not scripted. To keep this from becoming an LLM chatbot, every chat-reply path runs through these guardrails:

1. **Earshot filter.** Only chat lines whose speaker is within `EARSHOT_TILES` (default 8, configurable) are considered. Lines beyond earshot are dropped at the perception layer.
2. **Self-filter.** The resident never reacts to its own resident chat (already enforced; documented here for completeness).
3. **Per-tick reply cap.** At most one `say` reply per tick from chat-reactive paths. Combat narration (F5) is separate and may add at most one more `say` per tick (e.g., "This goblin is too strong — retreating").
4. **Rolling cap.** At most `CHAT_REPLIES_PER_WINDOW` (default 3 per 60 ticks, configurable) chat-reactive replies. When the cap is exceeded, the resident silently observes — soul quirks may surface this as `*shrugs*` emotes or similar.
5. **Inference admission.** Any reply that requires inference (small-talk, clarifying question, combat narration) goes through `module-inference.ts` with a named profile (`chat_reply`). Budget-exhausted → silent observation.
6. **Phrasebook fallback.** For deterministic-enough cases (acknowledgments, declines, stuck-help requests, trade-offer pitches), the module composes the chat line from a small per-soul phrasebook seeded by resident name + soul fields. No inference call. Each phrasebook entry has 3–5 phrasings to avoid robotic repetition.
7. **Voice tag on emission.** Every `say` action this spec emits carries a `cause` string in the existing telemetry, AND (new) a `voiceSource: 'phrasebook' | 'inference' | 'scripted'` field on the `AgentAction` for evidence trajectory. The evidence-loop spec already accepts field-additive trajectory schema bumps; this is one such bump.

`EARSHOT_TILES`, `CHAT_REPLIES_PER_WINDOW`, and `WINDOW_TICKS` are constants in `hybrid-agent-thinking-module.ts` (or the extracted file if B has landed). They are intentionally not soul fields — these are kernel-style invariants, not per-resident knobs.

---

## F2 — Non-command small talk + clarifying questions

### Behavior contract

**Success looks like:**

- A nearby player says something in earshot that is NOT a direct command:
  - "What a nice day."
  - "I hate goblins."
  - "Anyone seen a tinderbox?"

  The resident may (subject to guardrails) emit one in-character reply within the next 1–3 ticks:
  - `say: "The sun's good for drying logs."` (matches a `voice.register: 'plain-spoken'` soul)
  - `say: "Goblins are the worst. I lost a fight to one last week."` (matches a soul with combat experience)
  - `say: "I had one yesterday. Lost it to the river."` (a soul that remembers an unfulfilled want)

- A nearby player says something that *looks like* a direct command but is ambiguous:
  - "agent go" (where to?)
  - "agent make" (make what?)
  - "agent give" (give what to whom?)

  The resident emits one clarifying-question `say`:
  - `say: "Where would you like me to go?"`
  - `say: "Make what? Fire, fishing net?"` (limited to actions the resident knows)
  - `say: "Give what? I've got logs and a tinderbox."` (limited to current inventory)

- A nearby player says a command the resident *cannot* fulfill right now (no tinderbox, no axe, busy, low HP):
  - `say: "I'd light a fire but I lost my tinderbox. Got one to spare?"`

**Decline-with-coded-reason.** Refusals carry an enumerated `refusalReason` in telemetry: `missing_tool`, `missing_consumable`, `low_hp`, `busy_higher_priority_goal`, `unknown_command`, `out_of_earshot`, `target_not_visible`, `command_unsafe`. The reason is *coded*; the speech is *voiced*.

### Integration point

**Pre-extraction:** insert between `directChatAction` (line 112) and `combat` (line 117) in `hybrid-agent-thinking-module.ts:think`. New private methods:

- `nonCommandChatReaction(perception): { action; cause } | undefined`
- `clarifyingQuestionReaction(perception): { action; cause } | undefined`
- `politeDeclineReaction(perception, attemptedCommand): { action; cause } | undefined`

The clarifying-question path runs *before* falling through to `directChatAction`, since `directChatAction` already commits to a parse. Concretely:

```
think()
  ├─ directChatTryParse(perception) → { command, ambiguity? }
  ├─ if ambiguity: clarifyingQuestionReaction(...)
  ├─ if recognized + cannot fulfill: politeDeclineReaction(...)
  ├─ if recognized + can fulfill: directChatAction(...)  // existing path
  ├─ else (no direct address): nonCommandChatReaction(...)
  └─ ... rest of think()
```

The polite-decline path replaces today's silent "no axe" fallthrough on a few `directChatAction` branches.

**Post-extraction:** small-talk and clarifying-question logic moves to `runescape-workflows.ts` as a `chat-reply` workflow. The brain planner (`runescape-brain-planner.ts`) can choose to *suppress* the chat reply if it's mid-critical-task (low HP, mid-combat, mid-trade). The suppression rule is a brain prerogative, not a workflow concern.

### Test fixtures

`hybrid-agent-thinking-module.test.ts` (or extracted-equivalent):

- **F2-T1:** Perception: peer says "what a nice day" within earshot. Assert: emitted action is `kind: 'say'` AND `voiceSource: 'inference'` OR `voiceSource: 'phrasebook'`. Assert: text contains no scripted phrase like "I am res:agent".
- **F2-T2:** Perception: peer says "agent go" within earshot. Assert: emitted `say` text contains a question mark and one of the phrasebook "where?" templates.
- **F2-T3:** Perception: peer says "agent make fire" while resident has no tinderbox in inventory. Assert: `say` text mentions tinderbox AND `refusalReason: 'missing_tool'` is recorded in telemetry.
- **F2-T4:** Perception: peer says "agent make fire" while resident is mid-combat. Assert: NO `say` reply emitted this tick (combat reaction wins); `refusalReason: 'busy_higher_priority_goal'` recorded.
- **F2-T5:** Perception: peer says "what a nice day" but `CHAT_REPLIES_PER_WINDOW` is exhausted. Assert: no `say` action; telemetry records `chat_reply_suppressed: 'rate_limited'`.
- **F2-T6:** Perception: peer says "what a nice day" but inference budget exhausted. Assert: no `say` action; telemetry records `chat_reply_suppressed: 'budget_exhausted'`.
- **F2-T7:** Perception: peer says "what a nice day" at 12 tiles distance (out of earshot). Assert: no reply.
- **F2-T8:** Voice preservation. Two souls with different `voice.register` see the same peer line. Assert: replies differ structurally (different phrasebook entries OR different inference outputs); both honor their respective register.

### Open questions

- Does `Perception` carry chat range distance natively, or do we filter by Euclidean tile distance from the perception's speaker position? *Assumed: filter by tile distance; verify the perception envelope shape during P-F2 implementation.*
- Should ambiguity detection use a fixed token-trigger list ("go", "make", "give" without object) or a parser that flags incomplete commands? *Default: token-trigger list with explicit known incomplete commands; LLM-driven disambiguation deferred.*
- Should clarifying questions count against `CHAT_REPLIES_PER_WINDOW`? *Default: yes; clarifying questions are still chat output.*
- Where does the phrasebook live? *Proposal: `src/controller/soul/phrasebook.ts` with `pickPhrase(soul, situation, seed)`; or, if the SOUL schema already supports phrasebook entries, in the SOUL file itself.*

---

## F3 — Deeper stuck recovery with help-request speech

### Behavior contract

**Success looks like:**

The resident builds on the existing stationary-tick tracking in `hybrid-agent-thinking-module.ts:506-524`. Recovery escalation order:

1. **Open obstacle.** If a nearby openable door/gate is in path direction → `interact` to open it. (Already exists.)
2. **Report blocker once.** Fence or other named blocker → emit a one-time `say` ("There's a fence in my way."). (Already exists.)
3. **Try alternate target.** If the active goal has an alternate same-kind affordance within `ALTERNATE_TARGET_RADIUS` (default 12), retarget. New behavior.
4. **Patrol-step recovery.** Step to a known-walkable nearby tile, then re-evaluate. (Already exists as the fallthrough.)
5. **Help-request.** If steps 1–4 have all been tried without making progress for `STUCK_HELP_THRESHOLD_TICKS` (default 40 ticks, configurable; minimum 20 to avoid spammy help-asks), emit a help-request `say` that names the obstacle, the direction, and the desired help:
   - `say: "I'm stuck near the eastern fence — can someone open the gate?"`
   - `say: "The bridge is broken. I need to get to Lumbridge — anyone heading that way?"`
   - `say: "I keep getting blocked by a guard. Can someone draw his attention?"`
6. **Return-to-anchor.** If help-request has been emitted and `STUCK_RETURN_THRESHOLD_TICKS` (default 80) has elapsed without progress, the resident abandons the goal and returns to anchor. The return is announced (`say: "I'll come back to this later."`).

The help-request `say` is phrasebook-composed, NOT inference (deterministic and bounded; help-request fidelity matters more than poetic phrasing).

**Coded help-request reasons** in telemetry: `blocked_by_obstacle`, `blocked_by_npc`, `blocked_by_unreachable_target`, `path_to_goal_unknown`, `repeated_movement_failure`.

### Integration point

**Pre-extraction:** extend the stuck-recovery block at `hybrid-agent-thinking-module.ts:506-524`. New private helpers:

- `tryAlternateTarget(perception, goal, here): AgentAction | undefined`
- `helpRequestAction(perception, here, stuckContext): AgentAction | undefined`
- `returnToAnchorAfterStuck(perception, here): AgentAction | undefined`

The stuck-context structure (already partially present as `ActiveMoveState`) is extended with:

```ts
interface StuckContext {
  stationaryTicks: number;
  blockerReported: boolean;        // existing
  helpRequested: boolean;          // new — one help-request per stuck episode
  helpRequestedAt?: number;
  alternateTargetTried: boolean;   // new
  lastObstacleKind?: 'fence' | 'door' | 'npc' | 'unknown';
  goalAtStuck?: string;
}
```

Reset on next meaningful movement (lateral position change > 0) OR on goal change.

**Post-extraction:** moves to `runescape-body-routines.ts` as a `stuck-recovery` routine. The help-request `say` composition stays in the routine (phrasebook), not the brain.

### Test fixtures

- **F3-T1:** Perception: resident stationary 5 ticks adjacent to closed gate. Assert: `interact` open-gate action (existing behavior preserved).
- **F3-T2:** Perception: resident stationary 8 ticks adjacent to fence (no openable). Assert: blocker-report `say` once (existing behavior).
- **F3-T3:** Perception: resident stationary 20 ticks, alternate level-1 tree visible within 12 tiles. Assert: `move_to` alternate tree, NOT help-request.
- **F3-T4:** Perception: resident stationary `STUCK_HELP_THRESHOLD_TICKS` (40) ticks, fence blocks, no alternate. Assert: help-request `say` emitted exactly once; text mentions "fence"; `voiceSource: 'phrasebook'`; telemetry records `helpRequestReason: 'blocked_by_obstacle'`.
- **F3-T5:** Perception: same as F3-T4 plus 80 more ticks. Assert: return-to-anchor announcement `say` ("I'll come back to this later.") + `move_to: anchor`.
- **F3-T6:** Perception: stuck → help-requested → meaningful movement (lateral tile change). Assert: stuck context reset; subsequent stuck cycle re-permits help-request.
- **F3-T7:** Per-window cap. Stuck context resets and re-arms within `CHAT_REPLIES_PER_WINDOW`. Assert: second help-request still emits (it's a different stuck episode), but counts against the chat-reply window cap as a regular chat reply.
- **F3-T8:** Voice. Two souls with different `voice.register` produce different help-request phrasings.

### Open questions

- Should help-request also tag `peerRequested` on visible peers nearby (so the dashboard / library can credit a peer who helped)? *Yes, but ingestion of the help-fulfillment event is out of scope. Mark visible peers at help-request time in telemetry; matching is deferred.*
- What counts as "meaningful movement" for resetting stuck context? *Default: lateral tile change (x or y delta ≥ 1). Same as ProgressTracker's position delta when available.*
- Should stuck recovery be suppressed when goalkind = `explore`? *No — exploration goals can stuck on water/cliffs and need the same escalation, especially help-request.*

---

## F5 — Combat survival personality

### Behavior contract

**Success looks like:**

The existing `combatReaction` at `hybrid-agent-thinking-module.ts:944-973` decides (eat / retaliate / retreat). F5 adds *narration* of the decision:

- Decision = retaliate (safe target, HP ok): `say: "Bring it on."` OR similar phrasebook entry.
- Decision = eat then retaliate (HP low but safe target): `say: "Hold on — eating."`
- Decision = retreat (HP low + no food, OR unsafe target): `say: "This goblin is too strong — retreating."`
- Decision = eat then retreat (HP very low, food available, target unsafe): `say: "Need to heal — get back."`

**Narration is at-most-once-per-combat-episode.** A combat episode starts when `inCombat` becomes true and ends when `inCombat` becomes false for ≥3 ticks. The narration `say` is emitted in addition to the existing combat action (eat / attack / move_to) on the same tick.

**Aggressor selection.** Today the combat reaction reacts to whatever attacked. F5 adds: when multiple visible aggressors exist, prefer the *weakest* visible (lowest `hpFraction` or, if not visible, lowest `level` if it leaks) as the retaliate target. Tie-broken by closest tile. This is a personality knob: the resident picks fights it can win.

**Outmatched threshold.** Coded heuristics (no inference):

- HP > 60% AND target HP < own HP AND target.kind in `SAFE_COMBAT_TARGET_PATTERN` → retaliate.
- HP 30–60% AND food available → eat then retaliate.
- HP < 30% OR target NOT in safe pattern OR target.combatLevel > resident.combatLevel + 5 → retreat.
- HP < 15% → retreat AND drop nothing; if food slot exists, eat *while* retreating (existing behavior).

Each of these maps to a phrasebook entry tagged with the decision reason:

- `combat_decision: 'retaliate_confident'`
- `combat_decision: 'retaliate_after_eat'`
- `combat_decision: 'retreat_outmatched'`
- `combat_decision: 'retreat_low_hp'`

The phrasebook returns 3–5 phrasings per decision reason per soul register.

**Constraint preservation.** Combat reflexes (eat / attack / move_to) remain kernel-priority and unchanged. F5 ADDS a `say` action emitted alongside; if action-budget caps prevent emitting both, the survival action wins and the narration is dropped silently. (Implementation: combat reaction returns `[survivalAction, narrationSay]` and the kernel scheduler trims.)

### Integration point

**Pre-extraction:** modify `combatReaction` at `hybrid-agent-thinking-module.ts:944-973` to (a) classify the decision into one of the coded `combat_decision` values, and (b) attempt to compose a narration `say` from the phrasebook. New private helpers:

- `classifyCombatDecision(perception, target, foodSlot): CombatDecision`
- `combatNarrationAction(soul, decision, target): AgentAction | undefined`
- `selectPreferredAggressor(aggressors): Actor`

The result block changes from `return { action, cause }` to `return { actions: [action, ...maybeNarration], cause }`. The `think()` shape already supports multi-action returns (see `result([...])`).

**Post-extraction:** moves to `runescape-nervous-rules.ts` (decision classification) + `runescape-workflows.ts` (narration composition). The kernel still owns admission.

### Test fixtures

- **F5-T1:** Perception: resident HP 95%, attacked by chicken (`SAFE_COMBAT_TARGET_PATTERN`). Assert: actions = [`attack`, `say`]; `say.cause: 'combat_retaliate'`; phrasebook tag `retaliate_confident`.
- **F5-T2:** Perception: resident HP 40%, food slot 3, attacked by cow. Assert: actions = [`eat`, `say`]; phrasebook tag `retaliate_after_eat`.
- **F5-T3:** Perception: resident HP 20%, no food, attacked by goblin. Assert: actions = [`move_to: fleeTarget`, `say`]; phrasebook tag `retreat_low_hp`.
- **F5-T4:** Perception: resident HP 80%, attacked by "Greater Demon" (NOT in safe pattern). Assert: actions = [`move_to: fleeTarget`, `say`]; phrasebook tag `retreat_outmatched`.
- **F5-T5:** Aggressor selection. Perception: two visible aggressors, one chicken (low hp) and one goblin (high hp), both in melee range. Assert: attack target is chicken.
- **F5-T6:** Episode dedupe. Two consecutive ticks of combat. Assert: narration emitted only on tick 1; tick 2 emits combat action without narration.
- **F5-T7:** Episode reset. Combat ends (3+ ticks `inCombat: false`), then a new aggressor appears. Assert: narration re-emits.
- **F5-T8:** Budget exhaustion. Inference budget exhausted at combat tick. Assert: combat action still emits; narration falls back to phrasebook (still emits — phrasebook is inference-free). Distinct test: if phrasebook AND inference are both unavailable (degraded mode), narration is silently dropped, combat action still emits.
- **F5-T9:** Voice. Two souls with different `voice.register` produce different narration phrasings for the same decision.

### Open questions

- Does the perception expose `target.combatLevel` reliably? *Verify during P-F5 implementation; if not, fall back to `hpFraction` + safe-pattern test only.*
- Should the resident also narrate a *successful kill* (`say: "Down."`)? *Yes, but as a follow-up phrasebook entry on combat-end, gated by the same per-episode dedupe.* This is part of F5; included in P-F5.
- If combat reaction returns multiple actions and one fails (e.g., eat fails because slot is empty), does the narration still emit? *Yes — the narration tracks the *intent*, not the outcome. If the outcome differs (eat failed, switched to retreat), the next tick may re-narrate the new decision.*

---

## G4 — Trading/giving items

### Behavior contract

**Success looks like:**

Today the resident:

- Reacts to direct trade commands (`agent trade me`, `agent offer logs`, `agent accept`) via `directChatAction:841-876`.
- Reacts to incoming trades from trusted peers via `tradeReaction:995-1029`.
- Has a hardcoded `isTrustedTradePartner` predicate.

G4 adds:

1. **Proactive trade offer to a trusted patron.** When the resident has a surplus item the patron is plausibly interested in, the resident may *initiate* a trade. Conditions:
   - Patron is visible within `TRADE_OFFER_RADIUS` (default 6).
   - Patron has been in earshot for ≥`TRADE_OFFER_PRESENCE_TICKS` (default 30).
   - Resident has ≥`TRADE_OFFER_SURPLUS_THRESHOLD` of a surplus-eligible item (default 5 logs OR 3 cooked fish OR 1 tinderbox if resident has 2+).
   - Resident is NOT mid-critical-task (no active combat, HP > 50%, no help-request pending).
   - Cooldown: at most one proactive offer per peer per `TRADE_OFFER_COOLDOWN` ticks (default 600).

   On all conditions met:
   - `say: "I've got spare logs — want some?"` (phrasebook)
   - Then on next tick, if the peer responds positively or simply remains nearby for 5 ticks → `trade_request` action.

2. **Accept/decline based on perceived value.** Today `tradeReaction` accepts trusted-peer offers blindly and declines untrusted-peer trades. G4 adds a value heuristic:
   - For trusted peers: accept if offered items have estimated value ≥ 50% of own offer. Value estimate is a static table in `src/controller/soul/item-value.ts` (TBD; see Open Questions).
   - For trusted peers offering a *significantly worse* trade (estimated value < 25% of own offer): polite decline with explanation (`say: "That's not a fair trade — I'd need more."`).
   - Untrusted peers: existing decline behavior preserved.

3. **Describe trade state.** When a trade is active, the resident may emit a status `say` at most once per `TRADE_STATUS_COOLDOWN` ticks (default 20):
   - `say: "Trading with Foo. I offered logs, waiting on them."`
   - On the resident's accept: `say: "Done. Thanks."`
   - On decline: `say: "Not this time."`

4. **Refined trust.** The hardcoded `isTrustedTradePartner` predicate is extended to consult:
   - SOUL-level trusted handle list (existing).
   - In-memory rolling list of peers the resident has had ≥`TRUSTED_INTERACTION_THRESHOLD` (default 3) positive interactions with (chat acknowledgments, prior successful trades). Storage: per-resident memory namespace via the existing memory facade.

### Integration point

**Pre-extraction:** extend `tradeReaction:995-1029` and add a new path `proactiveTradeOfferReaction(perception)` between the combat path and the dialogue path in `think()`. New helpers:

- `findTradeSurplus(inventory, soul): SurplusItem | undefined`
- `findTradePatron(perception, here, presenceHistory): Actor | undefined`
- `estimateTradeValue(items): number`
- `tradeStatusNarration(perception, lastNarrationTick): AgentAction | undefined`
- `updateTradeTrustMemory(peer, kind: 'positive_interaction' | 'completed_trade'): void`

The presence-history tracker is a small ring buffer in cognition: `{ peerId: string; firstSeenTick: number; lastSeenTick: number; interactionCount: number }[]`. Capped at 16 entries; oldest evicted.

**Post-extraction:** moves to `runescape-workflows.ts` as a `trade` workflow with three phases (offer, status, accept/decline). The trust memory moves to the resident-scoped memory facade.

### Test fixtures

- **G4-T1:** Perception: trusted peer present 30+ ticks, resident has 6 logs, no active goal that needs logs. Assert: `say` proactive offer emitted; trade_request scheduled for next tick.
- **G4-T2:** Perception: same as G4-T1 but resident has only 4 logs. Assert: no proactive offer (under `TRADE_OFFER_SURPLUS_THRESHOLD`).
- **G4-T3:** Perception: same as G4-T1 but resident in combat. Assert: no proactive offer (busy_higher_priority_goal).
- **G4-T4:** Perception: trusted peer offers 1 log for resident's tinderbox. Static value table: log=2, tinderbox=20. Assert: polite decline `say` with "not a fair trade" phrasing.
- **G4-T5:** Perception: trusted peer offers 12 logs for resident's tinderbox (value ≈ 24 ≥ 50% of 20). Assert: accept action.
- **G4-T6:** Perception: untrusted peer initiates trade. Assert: existing decline behavior preserved AND a polite decline `say` ("I don't know you well enough yet.").
- **G4-T7:** Trust escalation. Peer interacts positively 3 times. On the 4th tick: peer is added to in-memory trusted list (`isTrustedTradePartner` returns true). Subsequent trade offer from peer: accept path runs.
- **G4-T8:** Trade status narration. Active trade for 50 ticks. Assert: `say` status emitted at tick 0 of trade and again at tick 20 and again at tick 40; not on intermediate ticks.
- **G4-T9:** Voice. Two souls with different `voice.register` produce different proactive-offer phrasings.
- **G4-T10:** Cooldown. Proactive offer to peer P, peer P leaves, peer P returns 200 ticks later. Assert: no second proactive offer (cooldown active until tick 600+).

### Open questions

- Where does the item-value table live? Options:
  - `src/controller/soul/item-value.ts` — static, repo-wide, easy to maintain.
  - SOUL field — per-resident, supports soul-specific valuations (a logger soul values logs less because surplus).
  - Knowledge doc — `docs/runescape-skill/items.md` already lists item kinds; could extend with value column.
  *Default: static repo-wide table; SOUL-override field reserved as a future enhancement.*
- Trust escalation: should "positive interaction" include any chat acknowledgment, or only acknowledgments of *the resident's* contributions? *Default: any acknowledgment within 5 ticks of the resident speaking to that peer.*
- Should the resident *ever* initiate a trade with an *untrusted* peer? *Default: no — the proactive offer path is trusted-only. Future enhancement could add a "test trade" with low-value items.*
- Trust persistence: does the in-memory trust list survive resident death/rebirth? *Default: per-life — clears on rebirth. Trust is earned per life.*

---

## G5 — Broader command vocabulary

### Behavior contract

**Success looks like:**

Today `directChatAction` matches an enumerated set of command intents (`isFollowIntent`, `isStopIntent`, `isStatusIntent`, etc.). G5 adds:

1. **"come here"** → resident walks to speaker's tile (or one tile before, to avoid overlap). Distinct from "follow" because it's a one-shot. Phrasebook ack: `say: "On my way."`
2. **"stop"** → resident clears active goal AND clears follow-target AND emits ack. (Today `isStopIntent` exists; verify it covers all three clears; if not, extend.) Phrasebook ack: `say: "Stopping."`
3. **"wait"** → resident pauses active goal for `WAIT_DURATION_TICKS` (default 60) then resumes. Phrasebook ack: `say: "Waiting."`. After timeout: `say: "Resuming."`. If `wait` is called while already waiting: extends the timer (`say: "Still here."`).
4. **"follow X"** where X is a named peer in earshot → resident follows X with `DEFAULT_FOLLOW_RADIUS` (already 2). Phrasebook ack: `say: "Following ${X}."`. If X not visible: `say: "I don't see ${X} nearby."` (polite decline with reason `target_not_visible`).
5. **"stop following"** → resident clears follow-target, optionally falls back to prior active goal if one was paused for following. Phrasebook ack: `say: "Stopped following."`.
6. **"make fire" / "light a fire"** → existing `isFiremakingIntent` (verify coverage; this is already partly handled).
7. **"unknown command" polite decline.** When `commandPrefix` (e.g., "agent") is detected but the rest of the line matches NO intent in the enumerated catalog:
   - `say: "I'm not sure what you mean by '${rest}'. I can follow, stop, wait, come, train, fight, eat, drop, trade, explore, make fire, or cook."`
   - Phrased to match soul voice; the listed capabilities are pulled from the catalog at runtime so it stays accurate as G5 expands.

**Intent precedence (revised in G5).** The current `directChatAction` order is mostly intent-by-intent without dedupe. G5 normalizes precedence:

1. `stop` (highest — interrupts everything).
2. `wait`.
3. `stop following` / `follow X` (mutually exclusive).
4. `come here`.
5. `return home`.
6. `attack` / `retreat` / `eat`.
7. `train_*` / `bury_bones`.
8. `pickup` / `drop`.
9. `make_fire` / `cook`.
10. `talk` / `look` / `inventory` / `status`.
11. `trade*`.
12. `explore`.
13. Unknown-command polite decline.

The implementation can keep `directChatAction` as a flat if-chain but the order matches this list.

**"Patron doesn't override the resident" invariant.** If the resident is mid-critical-internal-task (active combat with HP < 30%, or mid-trade with an accepted offer), then `come here`, `wait`, and `follow X` are politely declined:
- `say: "Hold on — I'm in combat."`
- `say: "Mid-trade, give me a sec."`

`stop` always succeeds (it's the override-the-override). This honors the patrons-don't-control invariant: a patron can call attention but cannot pull a resident out of a survival reflex.

### Integration point

**Pre-extraction:** add the new intent matchers (`isComeHereIntent`, `isWaitIntent`, `isStopFollowingIntent`, `isFollowNamedIntent`) alongside the existing matchers, then extend `directChatAction` with branches in the precedence order above. The unknown-command polite-decline goes at the end of `directChatAction`, replacing the current silent fallthrough.

New helpers:

- `isComeHereIntent(command, normalizedText): boolean`
- `isWaitIntent(command, normalizedText): { extend?: boolean }`
- `isStopFollowingIntent(command, normalizedText): boolean`
- `isFollowNamedIntent(command, normalizedText): { targetName?: string } | undefined`
- `politeDeclineUnknownCommand(soul, commandText): AgentAction`
- `commandCatalogForVoice(soul): string[]` — returns the list rendered in the unknown-command decline, soul-flavored.

**Post-extraction:** moves to `runescape-workflows.ts` as a `chat-command` workflow. The intent matchers extract to `runescape-workflows.ts` helpers.

### Test fixtures

- **G5-T1:** Perception: peer says "agent come here". Assert: `move_to: speakerTile`; `say` ack containing "on my way" or equivalent.
- **G5-T2:** Perception: peer says "agent wait". Assert: active goal paused, wait timer started; `say` ack "waiting".
- **G5-T3:** Perception: resident waiting at tick 30, peer says "agent wait" again. Assert: timer extended; `say: "Still here."` (extend phrasing).
- **G5-T4:** Perception: tick 60 after a "wait", no new command. Assert: goal resumed; `say: "Resuming."`.
- **G5-T5:** Perception: peer says "agent follow Bob" where Bob is visible. Assert: follow-target set to Bob; `say: "Following Bob."`.
- **G5-T6:** Perception: peer says "agent follow Bob" where Bob is NOT visible. Assert: no follow set; `say` polite decline with reason `target_not_visible`.
- **G5-T7:** Perception: resident following Bob, peer says "agent stop following". Assert: follow-target cleared; `say: "Stopped following."`.
- **G5-T8:** Perception: peer says "agent dance". Assert: `say` polite decline citing the runtime catalog ("I can follow, stop, wait, ...").
- **G5-T9:** Precedence. Perception: peer says "agent stop" while resident in combat. Assert: `stop` honored (clears goal, narrates), combat reaction still wins on action emission (kernel priority). Trade-off: `stop` is a goal-level signal; combat is reflex-level. Both fire; combat action is the executed verb, `stop` clears the goal so post-combat behavior changes.
- **G5-T10:** Patrons-don't-override. Perception: resident HP 20%, in combat, peer says "agent come here". Assert: no `move_to: speaker`; polite decline `say` with reason `command_unsafe`.
- **G5-T11:** Voice. Unknown-command decline differs between two `voice.register` souls (different phrasing of the same catalog list).

### Open questions

- Should `wait` accept a duration (`agent wait 30`)? *Default: no — fixed `WAIT_DURATION_TICKS`. Duration parsing deferred.*
- Should `come here` interrupt active goal or pause it (like `wait`)? *Default: pause + resume after arrival. After arrival, resume prior goal automatically.*
- "follow X" when X is ambiguous (two visible "Bob"s)? *Default: pick closest; polite-decline if there are visible Bobs and the resident genuinely cannot disambiguate.*
- Does the unknown-command decline route through F2's clarifying-question path? *Yes — they share infrastructure. F2 ships the framework; G5 ships specific intents that plug into it.*

---

## Cross-feature concerns

### Voice preservation

Every `say` emitted by these features carries `voiceSource: 'phrasebook' | 'inference' | 'scripted'`. The portrait template (evidence-loop spec) treats `phrasebook` and `inference` quotes equally for the "In their own words" section; `scripted` quotes (e.g., the existing `presence_beacon` and `directChatAction` literal strings) are NOT promoted to portrait quotes since they don't reflect the soul.

**Migration of existing literal strings.** Existing literal `say` strings in `directChatAction` (e.g., `"I need to see you nearby before I can trade."`) are progressively migrated to phrasebook entries. The migration is incremental — a sub-feature may convert the literals on its path as it ships, but is not required to convert literals on other paths.

### Telemetry additions

Each sub-feature adds telemetry fields via the existing redacted module-telemetry facade:

- F2: `chat_reply_emitted` (boolean), `chat_reply_kind` (`small_talk | clarifying_question | polite_decline`), `refusalReason?`, `voiceSource`.
- F3: `help_request_emitted`, `helpRequestReason`, `stuckEpisodeTicks`.
- F5: `combat_decision` (one of the four coded values), `combat_narration_emitted`.
- G4: `proactive_trade_offer_emitted`, `trade_decline_reason?`, `trust_escalation_event?`.
- G5: `unknown_command_declined`, `command_intent` (resolved intent name or `unknown`).

These fields are field-additive to existing telemetry; readers tolerate absence.

### Performance

- Phrasebook lookups: O(1) hash lookup + O(k) where k ≤ 5 phrasings. Negligible.
- Inference admissions: bounded by existing budget facade. F2 small-talk is the only new inference-consuming path; budget exhaustion silently suppresses replies.
- Memory: each resident gains ~16 entries × ~120 bytes for the presence-history ring buffer (G4). Negligible.

### Failure modes

| Failure | Behavior |
|---|---|
| Inference budget exhausted during F2 small-talk | Silently observe; telemetry records `chat_reply_suppressed: 'budget_exhausted'`. |
| Phrasebook missing entry for soul + situation | Fall back to a default register phrasebook; log warning once per session. |
| F3 help-request emitted but no peer in earshot | Still emit (the world might be listening). Telemetry records `peers_in_earshot: 0`. |
| F5 narration action conflicts with survival action budget | Drop narration; survival action wins. |
| G4 trust memory write fails (memory facade error) | Treat peer as not-yet-trusted; retry next interaction. |
| G5 wait timer never fires (tick counter weirdness) | After `2 × WAIT_DURATION_TICKS`, automatically resume goal; log warning. |

---

## Testing

### Unit tests

Per sub-feature, the fixtures above. Each plan owns its test additions; no shared test file beyond `hybrid-agent-thinking-module.test.ts` (pre-extraction).

### Integration tests

One end-to-end fixture per sub-feature that runs the full `think()` against a scripted perception sequence:

- **F2-INT:** 5-tick perception sequence: idle, peer-arrives-and-talks, idle, peer-asks-ambiguous, idle. Assert: at most 2 `say` actions, both within guardrails.
- **F3-INT:** 50-tick perception sequence: walking → blocked → no recovery → help-request → eventual return-to-anchor.
- **F5-INT:** 20-tick perception sequence: idle → attacked by chicken → HP drops → eats → finishes → narrates kill.
- **G4-INT:** 100-tick perception sequence: peer arrives → resident surveys inventory → proactive offer → peer accepts → trade flow → status narrations.
- **G5-INT:** Scripted dialog covering each new intent in precedence order with appropriate decline branches.

### Voice / snapshot tests

For each sub-feature, two souls with different `voice.register` and `quirks` see the same scripted perception. Assert structurally:

- Phrasebook keys hit (same), final text (different).
- Phrasings honor the register (assert by simple keyword presence — e.g., a `voice.register: 'terse'` soul's reply is shorter than a `'florid'` soul's).

Snapshot tests capture the structure, not the exact text — text is allowed to evolve as phrasebooks grow.

### Live smoke

After all five sub-features land, one live `res:agent` session that includes:

- A peer says "nice day" → resident replies.
- A peer says "agent go" → resident asks clarifying question.
- A peer leads the resident into a dead-end → resident asks for help.
- A peer attacks the resident with a goblin → resident narrates retreat.
- A peer offers a trade → resident accepts/declines based on value.
- A peer says "agent dance" → resident politely declines and lists capabilities.

Smoke is graded against a checklist; any missing item is a smoke failure.

---

## Decomposition Into Plans

The spec is decomposed into five plans, one per sub-feature. Each plan is TDD-doable in 1–3 hours. Plans are mostly independent; the only ordering preference is that **P-F2 ships first** because it introduces the chat-reply guardrails (earshot, rolling cap, voiceSource) that the other plans reuse. After P-F2, the remaining four can ship in any order.

### Plan P-F2 — Non-command small talk + clarifying questions
- **Files (pre-extraction):** `src/controller/thinking/hybrid-agent-thinking-module.ts`, `src/controller/thinking/hybrid-agent-thinking-module.test.ts`, `src/controller/soul/phrasebook.ts` (new).
- **Files (post-extraction):** `src/controller/spark/runescape-workflows.ts`, `src/controller/spark/runescape-workflows.test.ts`, `src/controller/soul/phrasebook.ts`.
- **Acceptance:** all F2-T1..T8 pass; existing tests still pass; one live smoke beat (peer says "nice day", resident replies in voice).
- **Estimated:** 2–3 hours.

### Plan P-F3 — Stuck recovery + help-request
- **Files:** `hybrid-agent-thinking-module.ts` (extends 506-524 block), `hybrid-agent-thinking-module.test.ts`, `phrasebook.ts` (help-request entries).
- **Post-extraction:** `runescape-body-routines.ts`, `runescape-body-routines.test.ts`.
- **Acceptance:** all F3-T1..T8 pass; existing stuck tests still pass; live smoke (resident walks into dead-end, asks for help).
- **Estimated:** 1–2 hours.

### Plan P-F5 — Combat survival narration
- **Files:** `hybrid-agent-thinking-module.ts` (extends 944-973), `hybrid-agent-thinking-module.test.ts`, `phrasebook.ts` (combat entries).
- **Post-extraction:** `runescape-nervous-rules.ts` + `runescape-workflows.ts`.
- **Acceptance:** all F5-T1..T9 pass; existing combat tests still pass; live smoke (resident retreats from goblin narrating).
- **Estimated:** 1–2 hours.

### Plan P-G4 — Proactive trade + value-aware accept/decline
- **Files:** `hybrid-agent-thinking-module.ts` (extends tradeReaction + adds proactiveTradeOfferReaction), `hybrid-agent-thinking-module.test.ts`, `phrasebook.ts` (trade entries), `src/controller/soul/item-value.ts` (new).
- **Post-extraction:** `runescape-workflows.ts` (trade workflow).
- **Acceptance:** all G4-T1..T10 pass; existing trade tests still pass; live smoke (resident offers logs to a returning visitor).
- **Estimated:** 2–3 hours (largest of the five due to value table and trust memory).

### Plan P-G5 — Broader command vocabulary
- **Files:** `hybrid-agent-thinking-module.ts` (extends directChatAction), `hybrid-agent-thinking-module.test.ts`, `phrasebook.ts` (command entries + unknown-command decline).
- **Post-extraction:** `runescape-workflows.ts` (chat-command workflow).
- **Acceptance:** all G5-T1..T11 pass; existing direct-chat tests still pass; live smoke (resident handles come/wait/follow/stop/dance cycle).
- **Estimated:** 1–2 hours.

**Recommended order: P-F2 → (parallel) P-F3, P-F5, P-G5 → P-G4.** P-F2 establishes the phrasebook + chat-reply guardrails. P-F3/F5/G5 reuse them. P-G4 is last because it adds the most new state (trust memory, value table) and benefits from the others being settled.

**Parallelism note for Codex.** Codex may pick up any of the five plans in parallel after P-F2 ships, with the caveat that simultaneous edits to `hybrid-agent-thinking-module.ts` will collide. Use the file-level lock pattern from `multi_agent_codex_overnight.md` (mark the plan as `[>]` in the roadmap before editing). Once Workstream B extracts the monolith, the file collisions disappear and the five plans become trivially parallel.

---

## Open Questions

(Carried over from sub-feature sections, plus cross-cutting items.)

1. **Phrasebook location.** Repo-wide `src/controller/soul/phrasebook.ts` vs. SOUL-file embedded vs. external JSON? *Default: repo-wide TS module, soul-keyed lookup.*
2. **Item value table.** Per G4 Open Questions — repo-wide vs. SOUL-override vs. knowledge doc. *Default: repo-wide.*
3. **Trust persistence across rebirth.** *Default: per-life.*
4. **Ambiguity detection mechanism.** Token-trigger list vs. LLM-driven. *Default: token-trigger list.*
5. **Earshot tile threshold.** 8 tiles is a guess. *Verify against in-game chat range during P-F2 implementation; adjust if RuneJS exposes a canonical value.*
6. **`combatLevel` exposure in perception.** Required for F5 outmatched threshold. *Verify during P-F5; fall back to `hpFraction` + safe-pattern if absent.*
7. **Per-soul phrasebook coverage.** What if a soul has no entries for `combat_retaliate_after_eat`? *Default: fall back to a register-default phrasebook; warn once per session.*
8. **Wait duration parsing.** *Deferred.*
9. **Cross-feature ordering with Workstream B.** If B starts during this spec's implementation, who reroutes? *Default: the implementer of the active plan; flag at plan-start.*
10. **Library quote dedupe.** If F2 phrasebook produces "Nice day, isn't it?" five times across a resident's life, does the portrait quote all five? *Default: dedupe at portrait-render time, not at evidence-write time. The trajectory has all five; the portrait picks one representative.* This is a P2 (library) concern, not this spec.

## Risks

- **Voice flatness.** Phrasebook with only 3–5 entries per situation will sound repetitive after a long session. Mitigation: per-soul phrasebooks are expansion-friendly; inference fallback is available for small-talk; portrait dedupe (above) prevents the repetition from polluting the legacy artifact.
- **Inference budget pressure.** Adding small-talk replies to the budget could starve Brain/Body. Mitigation: small-talk uses a separate named profile with a stricter per-tick cap. Brain is priority 5, Body is priority 4, chat-reply is priority 2.
- **Chat spam.** A chatty crowd could trigger the resident to reply on every tick. Mitigation: `CHAT_REPLIES_PER_WINDOW` rolling cap is enforced before inference admission.
- **Patron-override edge cases.** "agent stop" while bleeding out is the canonical edge. Mitigation: `stop` clears the *goal* but the *kernel-priority survival reflex* still runs. Test G5-T9 covers this.
- **Trade exploitation.** A malicious peer could grind trust then propose a bad trade. Mitigation: value-aware accept/decline (G4) catches obvious imbalances; trust without value-check would be exploitable.
- **Monolith collision with Codex.** Five plans, all editing one file, mid-Codex-work. Mitigation: P-F2 first (lone), then file-lock-marker pattern via roadmap `[>]`. Post-extraction, this risk evaporates.
- **F2 ambiguity false positives.** Token-trigger list might catch legitimate commands ("agent go to Lumbridge"). Mitigation: ambiguity check only fires when the rest-of-line lacks any *object* token (no place, item, or named target). Real commands have objects.

## Multi-Agent Coordination Notes

- Claude (this branch) owns this spec and may pick up any of the five plans.
- Codex (branch `nullcity`) is the second hands on `hybrid-agent-thinking-module.ts`; coordination protocol per `docs/agent-coordination.md` and `multi_agent_codex_overnight.md`.
- Dev (separate repo) is not directly impacted, but the dashboard's resident detail (`[D2]`) benefits from the new telemetry fields and refusal reasons being surfaced. Telemetry additions are field-additive; dashboard reads gracefully.
- File-level lock via roadmap `[>]` is the operating rule until Workstream B lands. Any agent starting one of P-F2..P-G5 marks the task `[>]` before the first edit.

## RuneBench Convention Adoption

This spec adopts two conventions from `docs/runebench-conventions-adopted.md`:

- **Refusal-with-coded-reason** (Theme 1) — all polite declines carry an enumerated `refusalReason` in telemetry.
- **Probe-then-loop discipline** (prompt-level) — clarifying questions are a probe step; the resident asks once and then either acts or declines, never spins.

The other conventions (TOML task manifests, unified pricing, Docker layering) are not affected by this spec.
