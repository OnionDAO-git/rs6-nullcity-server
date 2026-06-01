# Goal As Orientation — Design (S-GOAL)

**Status:** Design draft. Implements Dev's CIC proposal that residents receive one large unknown goal and emergent behavior fills the rest.
**Author:** claude (autonomous, D-WEEKEND-DESIGN packet).
**Date:** 2026-05-30.
**Roadmap:** Workstream S, extension of S8c (needs hierarchy + Library strategy). Proposes adding **S14: Goal As Orientation** parent task.
**Read first:**
- `docs/2026-05-29-cic-meetup-decisions.md` — "A Soul goal can be aspirational and may never complete... generate a plausible plan toward the goal, act on survival/GP needs, and learn from the Library."
- `src/controller/spark/runescape-brain-planner.ts` — existing planner that converts Brain output into goals.
- `src/controller/evidence/library-updater.ts` — `observeGoalAchieved` (S9a) and the binary-completion path.
- Existing soul schema: `src/controller/soul/soul-schema.ts` — `goal` field already exists.

---

## Purpose

Today a Soul's `goal` is one of: (a) bounded binary like "complete Cook's Assistant", (b) skilling milestone like "reach Firemaking 10", or (c) a vague aspiration ignored by the planner. Dev's CIC proposal is that residents get a **large unknown goal** (his example: "kill the King Black Dragon"), and the planner uses that goal as an **orientation** that biases small daily actions toward it without ever expecting completion. AP survival, GP earning, and Library strategy stay the immediate needs; the big goal is the compass.

This spec defines how a `goal` text becomes an *orientation* that influences exploration, plan generation, partial-progress detection, and the abandon decision — without requiring goal completion to ship value.

## Decisions to make (maintainer-blocking)

1. **Goal grammar.** Should orientation goals be free text (LLM interprets) or structured (`{intent: 'reach_capability', target: 'king_black_dragon'}`)? Recommendation: **free text with optional `orientationHints` block** so authors can write evocative goals without losing structured retrieval.
2. **Influence weight.** How much should the orientation push the planner vs immediate needs (AP/GP/Library)? Recommendation: **survival > GP > orientation > Library**; orientation is *third*, never overrides survival.
3. **Partial progress detection.** Should every action be scored against the orientation, or only milestones (level-up, item-acquire, place-visit)? Recommendation: **milestones only**, to keep cost down.
4. **Abandon condition.** When can a resident decide their goal is impossible and propose a new one? Recommendation: **only the operator can change a Soul's goal**; residents may *flag* a goal as "stuck-for-N-cycles" but cannot rewrite themselves.

## Proposed approach

Add an **OrientationPlanner** layer between the existing Soul-`goal` field and the existing `runescape-brain-planner`. The OrientationPlanner doesn't replace the planner; it injects orientation-aware context into the prompt envelope and scores Brain decisions against the orientation post-hoc.

### Soul schema extension

```ts
interface SoulOrientation {
  goal: string;                       // free text, e.g. "kill the King Black Dragon someday"
  orientationHints?: {
    targetCapabilities?: string[];    // e.g. ['combat:60', 'prayer:43', 'gold:200000']
    forbiddenActions?: string[];      // e.g. ['suicide-rush-dragons-at-level-1']
    progressMilestones?: string[];    // e.g. ['first_lobster_caught', 'first_dragonhide_seen']
    completionEvidence?: string;      // e.g. 'library_event:king_black_dragon_killed'
  };
  meta?: {
    aspirationalOnly?: boolean;       // if true, never expect completion; default true for unknown goals
  };
}
```

Backward compatible: existing souls with plain `goal: string` continue to work; `orientationHints` defaults to empty (LLM-only interpretation).

### Prompt envelope injection

The envelope gets a new "Orientation" block (small, ≤200 tokens):

```
ORIENTATION: <goal text>
LONG-TERM HINTS: <hints if present, else "interpret from goal text">
IMMEDIATE NEEDS (in priority): 1) AP survival, 2) GP preservation/earning, 3) progress toward orientation, 4) Library writeback
RULE: orientation does not override survival or GP. If you can take one small step today that brings you closer to your orientation without harming AP/GP, prefer it.
```

S8c already injects an AP/GP needs hierarchy; this block extends it.

### Progress scoring

After each Brain decision and corresponding action result, the **OrientationScorer** (cheap, rule-based, not an LLM call) inspects whether the action moved a milestone:

- Did the resident reach a target capability level? (`stats.attack >= hints.targetCapabilities['combat:60']`)
- Did they acquire / sight a target item? (`inventory.contains('dragonhide')`)
- Did they visit a place tagged on the orientation route?

Each milestone hit appends a `library_event:orientation_progress` row, citing the orientation goal text and the specific milestone. The Storyteller (via S-STORY) can narrate progress without invention because the milestone evidence is real.

### Stuck-for-N-cycles flagging

If the OrientationScorer sees zero milestone progress across `STUCK_WINDOW` cycles (default 100), the runtime emits `library_event:orientation_stalled`. The resident is **not** allowed to rewrite their own goal; the event surfaces to the operator dashboard. The operator can:

- (a) Approve goal edit via admin CLI;
- (b) Hand the resident a sub-goal hint (writes a `nudge:` library entry);
- (c) Accept that the resident is aspirational and ignore the stall.

### Interaction with S9 (binary goal completion)

- If a goal has `completionEvidence` in its hints, S9a's `observeGoalAchieved` path still applies; the Library moment is canonical.
- If a goal is `aspirationalOnly`, S9 never fires; orientation events accumulate forever. Resident never "wins" but may still produce a beautiful arc.

### Influence on action selection

The existing `runescape-brain-planner` already picks one of several body-routine modules per tick. The OrientationPlanner adds a soft preference: when survival and GP needs are met, prefer modules whose tags overlap with the orientation hints. (E.g. if `combat:60` is a hint, prefer `combatTrainingAction` over `explorationAction` on a tie.) Survival reflexes (eat-at-low-HP) remain hard-priority.

## Definition of done

- `SoulOrientation` schema added to `soul-schema.ts`; existing soul files load without migration.
- `OrientationPlanner` reads the orientation, writes the envelope block, and exports a `preferModuleByTag` hint consumed by the existing planner.
- `OrientationScorer` is rule-based (no LLM), takes `{action, actionResult, residentState, hints}` and returns `{milestonesHit: [], orientationDelta: number}`.
- Library event `orientation_progress` and `orientation_stalled` schemas added; tests prove they only fire on real milestone hits.
- A hero or disposable benchmark resident is given an aspirational orientation (`"kill the King Black Dragon"`) and the prompt envelope shows the new block; capability test proves at least one orientation_progress event fires from a real action (e.g. visiting Edgeville).
- `npm run check:no-ui` passes.
- `docs/resident-capabilities.md` gains a "interprets aspirational goal as orientation" row.

## Open questions

- **OQ-1:** Should orientation hints be human-authored only, or can a smart model infer them from goal text at soul-creation time? Default: human-authored at first; later, an "orientation interpreter" sub-spec can add LLM-suggested hints with operator approval.
- **OQ-2:** When the Storyteller narrates orientation progress, does it cite the long-term goal each time or only on big milestones? Default: only on the first orientation event of the digest window.
- **OQ-3:** Should two residents with the same orientation goal coordinate? (e.g. both want to kill KBD, they form a party.) Default: no — orientation is private to the Soul; cross-resident cooperation is L workstream.
- **OQ-4:** Should the scorer ever *demote* a milestone (e.g. resident lost the dragonhide they had)? Default: no — milestones are append-only achievements, but the orientation_stalled event captures regression in aggregate.

## Out of scope

- LLM-decided goal rewrites (operator-only).
- Multi-orientation per Soul (one orientation per resident at a time).
- Cross-resident goal coordination (L workstream territory).
- Automated route planning to the orientation target (planner stays at module-selection altitude).
- Hard penalties for not progressing (no resident dies for being aspirational).

## Packet decomposition

- **S-GOAL-1: Soul schema + envelope block** (cloud-doable). Add `SoulOrientation` to soul-schema, wire OrientationPlanner to inject the envelope block, backward-compat test for old souls without hints. DoD: a soul with `aspirationalOnly: true` and free-text goal produces the new envelope block; old-format souls load unchanged. **No live stack needed.**

- **S-GOAL-2: OrientationScorer + progress events** (cloud-doable). Build the rule-based scorer, emit `orientation_progress` and `orientation_stalled` library events, focused tests on milestone-hit and stall-detection. DoD: a fixture action stream produces the right event sequence deterministically. **No live stack needed.**

- **S-GOAL-3: Module-preference hint + benchmark proof** (needs hot stack). Wire `preferModuleByTag` into existing planner, run live benchmark `orientation-bias-10m` showing a resident with `combat:60` orientation hint prefers combat modules over exploration when survival/GP are met. DoD: live benchmark artifact + capability row update. **Needs hot stack.**

- **S-GOAL-4: Operator nudge + admin CLI** (cloud-doable). Add `npm run resident:nudge <resident> <text>` to write a nudge library entry, add `resident:goal-edit` admin CLI with audit. DoD: focused tests on nudge entry shape + operator-only goal edit guard. **No live stack needed.**
