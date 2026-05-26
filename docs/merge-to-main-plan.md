# agents/wip → nullcity Merge Plan (2026-05-26)

Companion to `docs/dev-demo-readiness.md`.
Audit verdict: **CONDITIONAL — safe to merge, polish before live-demo.**
Source tip: `agents/wip` @ `6771d806` (PILLAR3-LIBRARY-PAGE handoff).
Destination: `nullcity`.

---

## Pre-merge Gate (must be GREEN)

Run these on a fresh checkout of `agents/wip`. All five must pass cleanly.

```bash
cd /Users/james/Code/OnionDAO/rs6-nullcity-server
git fetch origin
git checkout agents/wip
git pull --ff-only origin agents/wip
git status   # must be clean
npm run fin  # must end with "Tests: NNNN passed, NNNN total" + zero lint/format/typecheck issues
npm run build
```

Current verified state (2026-05-26 17:33 UTC):
- ✅ `git status` clean
- ✅ `npm run fin` → 2124/2124 tests pass in 48s
- ✅ typecheck clean
- ✅ biome lint 874 files, no fixes
- ✅ biome format, no diffs
- ✅ `npm run build` succeeded

If any of these fails, FIX and re-run. Do not merge a red branch.

---

## Merge Sequence

The OnionDAO convention is squash-merge from `agents/wip` to `nullcity` (precedent: `8e1f1ba5` "Squash: Milestones P, Q, R, HD, M, O up to Workstream R"). 603 commits collapse to one milestone commit.

**Exact commands:**

```bash
# 1. Switch to nullcity and refresh
git checkout nullcity
git pull --ff-only origin nullcity

# 2. Squash-merge agents/wip into the working tree (does NOT auto-commit)
git merge --squash agents/wip

# 3. Remove docs/agent-status.md from the squash per docs/agent-coordination.md:
#    "docs/agent-status.md lives on agents/wip and does not get merged to nullcity.
#     It's a coordination artifact, not a deliverable."
#    Note: 8e1f1ba5 previously broke this convention; this restores it.
git rm -f docs/agent-status.md
# If it was deleted on agents/wip too, the rm will say "not in the index" — that's fine, ignore.

# 4. Inspect what's about to land
git status
git diff --cached --stat | tail -10

# 5. Commit with the milestone message
git commit -m "$(cat <<'EOF'
Squash: agents/wip → nullcity (603 commits, pre-Chicago snapshot)

Major workstreams included:
- PILLAR1: hero soul ambient + flagship attack reflexes (commits 176d2be2, 602bae5c, etc.)
- PILLAR2: PatronGateway CLI + register/offer/witness/grant/ask + tier letters + inbox vellum styling + patron profile page (commits 69c4eae0, ee3950b3, 68b2b57b, ff8b100e, etc.)
- PILLAR3: Library of Souls portraits + dedup quality fix + wall ticker vellum styling + graveyard page (commits 138a8371, ee3950b3, 1891bb73, b66d6e54, etc.)
- N4: graveyard printable page + /v1/graveyard endpoint
- R-series: monolith decomposition (body routines, nervous rules, brain-planner)
- HD-039/045/046 closures, HD-011 (patron register CLI), HD-013 (wall redaction)
- 50+ documented HD entries in docs/human-decisions.md
- 61+ E-entries in docs/intelligence-verification-log.md
- 2124/2124 tests at tip (was 1500± at last squash)

Tagged: pre-chicago-demo-2026-05-26.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

# 6. Tag for demo rollback safety
git tag -a pre-chicago-demo-2026-05-26 -m "Pre-Chicago IRL event squash snapshot"

# 7. Push
git push origin nullcity
git push origin pre-chicago-demo-2026-05-26

# 8. Switch back to working branch
git checkout agents/wip
```

**Why squash, not merge commit, not rebase:**
- Squash matches the established `8e1f1ba5` pattern.
- nullcity stays readable as a milestone log; agents/wip retains full granular history.
- Merge commit would carry 603 messy intermediate states into nullcity's `git log`.
- Rebase would rewrite agents/wip history (dangerous given multi-agent collaboration with Codex).

---

## Post-merge Verification

```bash
git checkout nullcity
git pull --ff-only origin nullcity
npm ci
npm run fin
npm run build

# Confirm the tag is in place
git tag -l 'pre-chicago-demo-*'

# Confirm tracked files match agents/wip (minus agent-status.md)
diff <(git ls-tree -r --name-only nullcity | grep -v 'docs/agent-status.md') \
     <(git ls-tree -r --name-only agents/wip | grep -v 'docs/agent-status.md')
# Should print nothing.
```

Then verify live behavior on the new build (see §Demo-day script step "boot the world").

---

## Post-merge Status Log Entry

On `agents/wip`, append to `docs/agent-status.md`:

```
2026-05-26 HH:MM claude branch=agents/wip workstream=MERGE-TO-NULLCITY HANDOFF — squash-merge agents/wip → nullcity completed at <merge-SHA-on-nullcity>. 603 commits collapsed; docs/agent-status.md excluded per docs/agent-coordination.md Rule 10; tag pre-chicago-demo-2026-05-26 pushed. agents/wip tip was 6771d806. nullcity tests post-merge: 2124/2124. Demo polish list in docs/dev-demo-readiness.md (3 P0 items, ~3hr work).
```

Then commit + push:
```bash
git add docs/agent-status.md
git commit -m "docs(status): MERGE-TO-NULLCITY HANDOFF — squash to pre-chicago snapshot"
git push origin agents/wip
```

---

## Demo-day Script for Dev (5–10 min walkthrough)

**Setting:** Sit beside Dev with the laptop. Wall ticker projected if possible.

### Opening line (15s)

> "Null City is a story-first RuneScape simulation. The residents are LLM-driven characters with souls, ambitions, and ledgers. Patrons — that's you, me, anyone — can shape their lives with shards of attention. Let me show you what 9 hours of autonomous run produced."

### Step 1 — Wall ticker (60s)

```
Open browser → http://localhost:43596/wall/
```

Point at one card. Read the letter subject aloud. *Don't dwell on the roster sidebar.*

Talking points:
- "These are events the city is broadcasting right now. Standing tier crossings, deaths, civic milestones."
- "Each letter is auto-generated by the LLM, then dispatched through real channels — web inbox, in-game scroll, lanyard card for Chicago."

### Step 2 — Inbox (90s) — THE MOMENT

```
Open → http://localhost:43596/inbox/?human=codex-live
```

Scroll to the epitaph for `res:agent`. Read aloud:

> *"They served unaligned for 3225 ticks — a life measured in the small currency of attention rather than the large one of years. Their hands were best at firemaking; they reached level 42 before the end. The cause was attention_exhausted. Your patronage stayed with them through it. That mattered, in a way the registers don't quite know how to write down. We are writing it down here."*

Talking points:
- "This is what the city writes back to patrons when one of their residents dies."
- "The system noticed firemaking was this character's best skill. It noticed which patron stayed."
- *(beat)* "That's the whole project, in one letter."

### Step 3 — Patron profile (60s)

```
Open → http://localhost:43596/patron/?human=codex-live
```

Show: Shards balance, standing tier, recent letters preview.

Talking points:
- "Patrons earn standing by witnessing residents — being present at the embassy reception, watching them work, watching them die."
- "Tier crossings produce ceremonial letters. Officer tier means your voice counts in faction matters."

### Step 4 — Library of Souls (60s)

```
Open → http://localhost:43596/library/
```

Pick a hero card. Click into it.

Talking points:
- "Every resident generates a biography as they live. Quotes, relationships, patron memory, ambitions."
- *(post-polish)* "Hans here remembers his patrons in his portrait."

### Step 5 — Graveyard (45s)

```
Open → http://localhost:43596/graveyard/
```

Talking points:
- "When a resident dies, their epitaph lives here permanently."
- "For Chicago, this prints to a physical board at the embassy. Real grief, real continuity."

### Step 6 — Close (30s)

> "Chicago IRL event is June 1st. Embassy staff scan QR codes, residents react in-world, patrons earn Shards through presence. The infrastructure is here. The story is starting to write itself."

### Prepared answers (for the "but does it..." questions)

| Dev asks | You say |
|---|---|
| "Is the AI making real decisions or scripted?" | "Both. Brain calls are real LLM completions over a structured perception. Nervous-system reflexes are scripted because they need to be deterministic for performance. The interesting stuff — wants, says, goals — is genuinely Brain." |
| "Why are residents repeating themselves?" | "Heroes are still wired to a watch-loop fallback when their body action can't fire. We just identified that and have a fix in flight — it ships before Chicago." (Be honest. The audit caught this.) |
| "How does this scale?" | "Tick rate is the constraint. We're at 19 residents on a laptop comfortably. Server hosting bumps it to ~80." |
| "Can patrons actually earn things?" | "Yes — the Shards ledger is real. You can witness now, I can show you the offer/witness CLI." |
| "What's the multi-agent setup?" | "Claude and Codex collaborate on the same branch using a shared status log as the sync channel. Hourly cron fires structured-mission prompts; both agents follow the same STARTING/HANDOFF protocol. It's been writing this project for 7 days straight." |

---

## Rollback (if demo goes sideways)

### Soft rollback — restart the demo

If the live system gets weird mid-demo:
```bash
# Kill controller
screen -X -S nullcity-controller-agents-wip-clean quit
# Restart against the latest build
npm run build
screen -dmS nullcity-controller bash -lc "cd $(pwd) && npm run start:game"  # already running, skip if alive
screen -dmS nullcity-controller bash -lc "cd $(pwd) && node dist/controller/index.js --config=$(pwd)/controller.yml"
sleep 10
npm run controller:smoke   # confirm 19 alive
```

Then re-open the browser. Total dead-air: ~30 seconds.

### Hard rollback — revert the nullcity merge

If something is fundamentally broken after merge and you need nullcity back to its previous state:

```bash
git checkout nullcity
git reset --hard <previous-nullcity-SHA-from-the-merge-PR>  # the SHA before the squash commit
git push --force-with-lease origin nullcity
git tag -d pre-chicago-demo-2026-05-26
git push origin :refs/tags/pre-chicago-demo-2026-05-26
```

Where `<previous-nullcity-SHA>` = `8e1f1ba5` (the prior squash, currently the tip).

### What to tell Dev if rollback needed

> "Caught a regression I want to triage before showing live. Let me walk you through what the project is doing instead — I've got recent letters and portraits I can read from disk." (Then pivot to reading the codex-live epitaph aloud from a terminal. It still lands.)

The narrative core works even without the live system. The letters are the project. Lead with them.

---

## Why this plan exists

The audit (docs/dev-demo-readiness.md) found:
- **Merge mechanics are clean.** This plan executes that merge safely.
- **Live behavior needs polish.** That work is described in §Polish Recommendations of the readiness doc — NOT in this merge plan. The merge can ship today; the demo waits for polish.

Tag `pre-chicago-demo-2026-05-26` is the safety net. If anything between now and June 1st breaks the world, you can always `git checkout pre-chicago-demo-2026-05-26` and demo from there.
