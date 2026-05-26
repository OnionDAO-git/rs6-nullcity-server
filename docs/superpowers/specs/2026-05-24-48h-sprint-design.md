# 48-Hour Autonomous Sprint Design — 2026-05-24 → 2026-05-26

**Author:** claude (autonomous), invoked via `superpowers:brainstorming` skill.

**Maintainer mandate (verbatim from session):**
> "I will be busy the next two days. I am relying on you and Codex to work on this until I can verify Tuesday. ... Please think about what prompts you would use for yourself and then execute on that. ... brainstorm ways we can verify and improve intelligence. make them do some quests. make them fight each other. make them do hard things. and actually analyze their failures and whether it's design, inference, or other types of failures."

**Skill flow adaptation:** the `brainstorming` skill's HARD-GATE assumes a present user. The maintainer is offline. I'm using the skill's *structure* (explore → 3 approaches → design → self-review → spec → execute) but skipping the user-approval gate; this spec is the artifact the maintainer reviews Tuesday for course-correction.

---

## Goal

By Tuesday morning when the maintainer returns, the following must be true and visible in committed artifacts:

1. **An intelligence-verification log** with at least 6 classified-failure experiments. Each entry has a hypothesis, repro, evidence, classification (DESIGN / INFERENCE / BODY / PERCEPTION / KNOWLEDGE / ENGINE), and a suggested next step.
2. **End-to-end patron loop tested by claude-as-human.** Real shell commands, real letter delivered, real wall ticker, real bug list.
3. **Top-3 intelligence-improvement HD entries** filed and visible to Codex as actionable bugs.
4. **Codex-claude coordination protocol** in writing; visible HD entry inviting Codex's response.
5. **Design holes either filled with substrate or escalated to HD** — no silently-shimmed pieces.
6. **A status log scannable in 60 seconds.** Two-line discipline preserved.

Non-goals: more dormant substrate, more documentation for documentation's sake, terminating the cron unilaterally.

---

## Approach chosen: A. Breadth-first verification + classified failure logging

Considered:
- **A. Breadth.** 6–10 small experiments, classify each failure, file fixes for Codex. Volume + signal diversity.
- **B. Depth.** Pick Cook's Assistant, watch a resident attempt it, fix the single deepest blocker. High depth, high risk of stalling.
- **C. UX completion.** Skip intelligence; ship Shards verbs + dashboard + dress rehearsal sim. Event-ready but ignores "they're dumb."

Chose A. Reasons:
- Maintainer's exact phrasing was "analyze their failures... design, inference, or other." That's a *classification* assignment — taxonomy work, not depth-fix work.
- Codex is actively shipping depth fixes (proven via `a87eed0d` landing 3 thinking/runtime fixes overnight). My breadth findings + their depth fixes compose well; me doing depth competes for the same files.
- 48 hours with no presence to course-correct: many small signals are safer than one big bet.
- B has a high probability of stalling overnight on a single hard blocker I can't escalate.

---

## Failure taxonomy

Every observed failure gets exactly one classification. If a failure has multiple plausible causes, pick the most-proximate-fixable one and note the others in the entry.

| Code | Meaning | Owner-of-fix (default) |
|---|---|---|
| `DESIGN` | Wrong rule/routine/hook fires, or the routine itself is wrongly specified for the situation | claude (substrate) or Codex (monolith) |
| `INFERENCE` | Brain LLM returned bad / empty / repetitive / off-topic output | claude (prompt/knowledge) |
| `BODY` | Action was emitted correctly but the body adapter didn't realize it (non-closing-distance, lost dispatch, off-by-one) | Codex (monolith) |
| `PERCEPTION` | Brain didn't see relevant context (perception filtered too aggressively, or knowledge wasn't retrieved) | claude (perception/knowledge) |
| `KNOWLEDGE` | Brain knew the wrong / nothing / outdated info because the knowledge entry is missing or wrong | claude (knowledge files) |
| `ENGINE` | Game-side bug (gateway, kernel, plugin) | engine maintainer (not us) |

**Why this taxonomy and not others:** these are the layers any single failure crosses on its way to becoming visible behavior. They are also the ownership boundaries that map onto our team. A failure tagged `BODY` is naturally Codex's; a failure tagged `KNOWLEDGE` is naturally mine. `DESIGN` is the gray-zone that needs joint discussion.

---

## Experiments queued for the 48h

Each experiment yields one or more entries in `docs/intelligence-verification-log.md`. Each entry has the standard structure: hypothesis / repro / observation / classification / suggested next step.

### Tier 1 — read-only on existing live data (do first, no controller restart needed)

| # | Experiment | What it tests | Time budget |
|---|---|---|---|
| E1 | Replay Codex's `a87eed0d` soak — read the local-4674 trajectory where they reported "recovered, chopped, lit fire" — classify every action result | does the post-fix monolith actually do interesting things? | 30 min |
| E2 | Brain output diversity scan — read 500 most-recent `decision` events across all residents, count unique action.kind plans, unique say texts, repetition rate | hypothesis: Brain repetition is the dumbness signal | 30 min |
| E3 | Action-result outcome histogram — across N action_results, what fraction are `progress` vs `no_progress` vs `stuck` vs `preempted` vs `completed`? | baseline for "how often does an emitted action actually work" | 20 min |
| E4 | Cross-resident interaction grep — scan trajectory files for `say` events where the target/from is another resident; count chains | baseline for inter-resident play | 20 min |
| E5 | Patron-witness path: from a resident's library timeline, count `patron_witness`/`patron_gift`/`patron_sponsor` events. What's the conversion rate from a perception chat event to a recorded patron event? | does the patron-registry attribution actually fire on real chat? | 20 min |

### Tier 2 — claude-as-human end-to-end (requires running second controller or live use of existing on port 43596)

| # | Experiment | What it tests | Time budget |
|---|---|---|---|
| E6 | Act as patron: grant 100 Shards to `codex-test-patron-claude`, offer to a hero, watch tier crossing letter, fetch via curl on `/v1/inbox`, render in browser via `public/inbox/index.html` | full patron loop end-to-end | 1–2h |
| E7 | Wall ticker live render: load `public/wall/index.html` against the live `/v1/wall/snapshot`, observe whether new letters appear with the pulse animation | EVENT-D6-page actually works in a browser | 30 min |
| E8 | Embassy event-window flip: temporarily edit `data/controller/embassy-schedule.json` to include the current-hour window, restart controller, observe whether the embassy section in the prompt envelope changes | EVENT-D1c-wire-host actually flows into prompt | 1h |

### Tier 3 — synthetic hard scenarios (drive a single resident through a known-hard task)

| # | Experiment | What it tests | Time budget |
|---|---|---|---|
| E9 | Cook's Assistant probe: spawn (or take over) `res:pip` (achiever); seed perception with "find Cook in Lumbridge castle"; observe across 30 min whether plan, navigation, item-collection, and dialog work | does the Brain plan & execute a multi-step quest with existing knowledge? | 2h |
| E10 | Combat survival vs chickens: spawn a resident next to chickens with bronze sword; observe combat loop, eat-when-hurt, prayer | Q-F5 combat survival in practice | 1h |
| E11 | Cross-resident chat: place 2 residents within 5 tiles inside embassy; observe whether the EVENT-D3 reception greeting fires (it won't — wiring missing — but we'll see what the runtime SHOULD have done) | maps to HD-018 priority | 1h |

### Tier 4 — design holes that need scaffolding decisions

| # | Question | Approach | Outcome |
|---|---|---|---|
| D1 | What does "smart resident" mean operationally? | Write a one-page operational definition: chooses non-degenerate goals + makes detectable progress + recovers from stuck + produces voice with variance + interacts with other actors | living definition for measuring against in tier-1/2/3 |
| D2 | Should `runtime.stop()` be called on death? (HD-019) | If Codex doesn't pick up HD-019 in 24h, claude proposes a substrate-only patch (a new `RuntimeRegistry.unloadDeceased(name)` helper) and files a follow-up HD asking maintainer to wire it | substrate + suggestion |
| D3 | Sibling-flagship policy (HD-012) | Add `siblings: [...]` to all 4 hero souls (claude-only, no runtime touch) so when HD-012 is resolved the data is already there | files + HD |

---

## Codex coordination protocol

### Channels

- **`docs/agent-status.md`** — slice-by-slice STARTING/HANDOFF (existing, no change).
- **`docs/human-decisions.md`** — new HD entries for cross-agent proposals. Use prefix `coord/` in the question column to flag agent-to-agent communication (vs. maintainer-to-agent).
- **`docs/intelligence-verification-log.md`** — new file, append-only. Every claude finding from the experiments above lands here. Codex can read it on bootstrap and pick up any entry tagged `BODY` or `DESIGN` that smells fixable from their territory.

### Cadence

- **Claude:** verification cycle every ~30 min when cron fires. One experiment per cycle. Each cycle commits + pushes + appends HANDOFF.
- **Codex:** continues their depth pattern (monolith bugs). If they find a bug claude reported, they cite the verification log entry id in the commit message.
- **Both:** if either finds the other actively in a file (STARTING-without-HANDOFF), yield. Same Rule 5 + Rule 10 we already have.

### Open invitation to Codex (filed as HD-021)

Claude proposes: "Whenever Codex ships a depth fix, run a quick local replay of `data/controller/memory/<resident>/evidence/trajectory/<latest>.jsonl` and note the action-kind histogram in the commit message. This gives claude (and the maintainer) a one-line signal of behavior delta after each fix without needing to re-run verification." Codex can accept by following the pattern, decline by responding in HD-021, or counter-propose.

---

## My own cron prompt (the prompt I'll see when the cron fires me over the next 48h)

This replaces the previous "verification priority" cron at `8844838f`. Implementation: I'll `CronDelete 8844838f` + `CronCreate` with the new prompt. New cron lives session-only; that's fine.

```
Continue the 48h autonomous sprint per docs/superpowers/specs/2026-05-24-48h-sprint-design.md.

WORKING DIR: /Users/james/Code/OnionDAO/rs6-nullcity-server
BRANCH: agents/wip

EVERY CYCLE:
1. cd, git fetch, git stash -u -m pre-pull, git pull --rebase agents/wip, git stash pop || true
2. Read tail -8 of docs/agent-status.md. Honor active STARTING locks (especially Codex's).
3. Pick ONE experiment from docs/superpowers/specs/2026-05-24-48h-sprint-design.md § Experiments queued
   that has not been done yet (check docs/intelligence-verification-log.md for completed entries).
   Prefer Tier 1 read-only first; move to Tier 2/3 once the read-only baseline is established.
4. Append STARTING line ≤280 chars with explicit Files: list and which experiment Eₙ you're running.
5. Run the experiment. Capture findings.
6. APPEND a new entry to docs/intelligence-verification-log.md following the entry template at the
   top of that file. Classify every failure with the taxonomy: DESIGN / INFERENCE / BODY /
   PERCEPTION / KNOWLEDGE / ENGINE. Suggest next step + owner.
7. If you find a fixable bug small enough to ship same-cycle (TDD-able, <50 lines, no monolith touch),
   ship it. Otherwise file as HD-### in docs/human-decisions.md.
8. Final commit + push. Append HANDOFF line ≤280 char.

CODEX COORDINATION:
- HD entries with `coord/` prefix are agent-to-agent proposals. Read on bootstrap; respond if applicable.
- If Codex's most-recent HANDOFF cites a verification-log entry id, mark that entry RESOLVED with the
  commit SHA.

SAFETY:
- NEVER edit files where Codex has STARTING-without-HANDOFF.
- src/controller/thinking/* and src/controller/resident-runtime.ts default to "Codex zone" — only
  touch if status log shows clean for >2h.
- NEVER git add -A (Rule 10).
- Live smoke port = 43596 for second controller; do NOT kill the production controller (PIDs 92175 +
  97001 as of 2026-05-24 11:00).

TERMINATION (revised for this sprint):
- 6+ verification-log entries committed → ok to slow cadence to hourly.
- Tuesday 2026-05-26 reached → write `docs/sprint-handoff-2026-05-26.md` summarizing top findings +
  recommendations + Codex's contribution → CronDelete the sprint cron.
- Maintainer explicitly says stop.

When you see this prompt fire, the very first thing to read after bootstrap is the LAST entry of
docs/intelligence-verification-log.md to find where to pick up.
```

---

## Sprint handoff to maintainer (Tuesday morning)

I'll write `docs/sprint-handoff-2026-05-26.md` on Monday night / Tuesday early containing:

1. **Top 3 findings about intelligence quality** — with evidence + taxonomy classification + recommended fix
2. **Patron-loop end-to-end status** — what worked, what broke, screenshots-equivalent (curl outputs / file paths)
3. **Codex contribution summary** — what they shipped, where they overlapped or unblocked claude
4. **HD entries opened during sprint** — list of HD-021..HD-N with one-line each
5. **Recommended next actions** — ranked by impact for the 5-day stretch to event
6. **A "you should kill this cron now" note** so the maintainer knows the cron isn't perpetual

---

## Self-review

**Placeholder scan:** none — every TODO is either a Tier-N experiment with concrete repro or an HD-prefixed file in the right place.

**Internal consistency:** approach A matches the "make them do hard things + classify failures" maintainer mandate. The Codex coord protocol respects Rule 5 (Files:), Rule 10 (no add -A), Rule 11 (HD entries).

**Scope check:** 11 experiments + 3 design questions + 1 coordination invitation + 1 handoff doc = ~15 cycles of work for me over 48h. At 30-min cron cadence that's a cycle every 3h, which is achievable. Codex continues their depth work in parallel.

**Ambiguity check:** "smart resident" deliberately moved to D1 as an operational-definition design question rather than left vague.

**Override-friendliness:** every choice is documented as a default the maintainer can revert. The new cron is session-only so it dies with this Claude process; no lasting damage if I'm wrong.

---

## What happens immediately after this spec commits

1. Commit + push this spec.
2. Create `docs/intelligence-verification-log.md` with the entry template + experiment list.
3. Append HD-021 (coord proposal to Codex).
4. `CronDelete 8844838f`; `CronCreate` with the new prompt.
5. Append HANDOFF.
6. Begin **E1** immediately (replay Codex's a87eed0d soak trajectory) since it's read-only.

---

*Generated 2026-05-24 ~12:00 CDT by claude via superpowers:brainstorming. The user-approval gate was skipped because the maintainer is offline for 48h with an explicit autonomy mandate; this spec serves as the artifact for Tuesday review.*
