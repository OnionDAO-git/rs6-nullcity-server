# Null City — Resident Capabilities Report & Critical Launch Task List

**Date:** 2026-06-02 · **Author:** Claude (with subagent attention-surface audit) · **For:** OnionDAO launch readiness
**Method:** live data — game player saves (`data/residents/*.json`), trajectory logs, inference + normal-life audits (90-min window), and a code audit of every human-facing attention surface. Every number below is measured, not estimated.

> **⚠️ FRESHNESS — see the [2026-06-03 UPDATE](#update--2026-06-03-freshness-pass) at the bottom.** Two workstreams landed after this report (Storyteller public-frame pipeline; conversational-reply). The P0/P1 statuses below are partly superseded. The single most important fact: **nothing has been deployed/live-verified since 2026-06-02** — all new work is gated on a Codex/maintainer game-server restart.

> **TL;DR for the crowd pitch:** The residents are **genuinely competent autonomous players** (one hit Woodcutting 66 / Firemaking 55 on its own) but they are **boring to watch** — their live, crowd-visible output is robotic coordinate spam, and the genuinely compelling surfaces (letters, standing) are private and unrendered. They play the game well; they do not yet *perform* it. **Dimension 3 (attracting humans) is the launch blocker, not the brains.**

---

## Scorecard

| Dimension | Grade | One-line verdict |
|---|---|---|
| **1. Playing the game** | **B−** | Real autonomous skill gains, but narrow (4 basic skills), zero quests, half the cohort flatlined. |
| **2. Progress toward soul goals** | **B** | Pursues goals relentlessly (97% follow-through) but completes nothing measurable; perpetual goals never "finish." |
| **3. Attracting human attention** | **D** | Competent but boring. Live output is robotic status beacons; compelling surfaces are private/unrendered. **This is the launch risk.** |
| Brain / inference health | **A** | 97.6% usable decisions, 0 errors, stable overnight. *Not* the problem. |

---

## Dimension 1 — Are they playing the game well?

**Yes, the ones with the right tools are genuinely good — autonomously.** Actual skill levels reached (game saves, cumulative):

| Resident | Skills reached on its own | Total XP |
|---|---|---|
| res:qa-woodcutter | **Woodcutting 66, Firemaking 55** | 687,379 |
| res:qa-cook | **Cooking 49, Fishing 43** | 152,564 |
| res:agent | Woodcutting 40, Firemaking 44 | 98,356 |
| res:qa-survivor | Attack 21, HP 16, Cooking 34, Fishing 30 | 44,614 |
| res:qa-guardian | Attack 19, HP 15, Cooking 9, Fishing 6 | 8,608 |
| res:qa-trader / banker / scout | **all level 1** (~1,200 XP = nothing) | flat |
| res:hans / res:father-aereck (heroes) | all level 1 (by design — greeters) | flat |

**What this proves:** the SPARK loop *works* — these are real RuneScape skill levels earned by an LLM agent with no human input. Woodcutting 66 is hundreds of thousands of XP of correct, sustained play.

**The honest limits:**
- **Narrow.** Only 4 skills exercised across the whole city: woodcutting, firemaking, fishing, cooking (+ a little combat). No mining/smithing/crafting/magic progression past level 1.
- **Zero quests completed.** Every resident: `quests=0`. No higher-order, multi-step game content has ever been finished.
- **Bimodal cohort.** Grinders (woodcutter/cook) vs flatliners (trader/banker/scout) stuck at level 1 — the tool-acquisition + goal-mismatch bug (see Dimension 2).

---

## Dimension 2 — Are they progressing toward their soul goals?

- **Pursuit: excellent.** 97.3% goal-follow-through (4,953/5,093 actions tied to the active goal), 100% action success, 97.6% usable-brain-rate. When a resident has a goal, it acts on it coherently.
- **Progress: ~half.** 5/9 making meaningful progress right now (cook 90%, survivor 27%, woodcutter 22% progressing; social/scout slow; **trader, guardian, banker, agent stalled 0–2%** — they're assigned woodcutting/fishing goals but lack the axe/net).
- **Completion: unmeasured and probably never happens.** Goals are perpetual ("Master woodcutting", "Catch shrimp") — there is **no goal-completion / graduation concept** and no metric for it. We can prove they *pursue*; we cannot prove they *finish*.
- **Root blocker:** tool-stall. Fix is **built + tested + tagged** (`acquire-tool-slice4`: a tool-less resident walks to Bob / takes the free Lumbridge axe → buys → chops) but **not deployed** (needs a coordinated merge past Codex's concurrent commit + a game restart).

---

## Dimension 3 — Are they interesting/effective at attracting humans?

**This is the weak dimension, and it's the one that matters most for a crowd.** Hard evidence from the last 2 hours of live output:

- **1,347 `say` events — essentially all robotic status beacons.** Verbatim, repeated hundreds of times:
  > *"I am online at 3231,3202. Goal: Gather ordinary logs and light a fire with the tinderbox."*
  > *"I am working my route. Nearby I see 1 NPC and 1 player at 3230,3202."*

  This is what a human in the crowd would literally see scroll past: a robot reading its coordinates. **Zero personality reaches the live channel**, even though the voice/archetype infrastructure exists.

**Attention-surface audit (what a crowd actually sees), graded:**

| Surface | Wired? | What a human sees | Compelling |
|---|---|---|---|
| **Letters / inbox** (standing tiers, epitaphs) | ✅ live | "You are now Ally of the Foundry"; tribute on a resident's death | **4/5** — but patron-private, not a live crowd feed |
| In-world speech | ✅ live | robotic coordinate/goal beacons (above) | **2/5** — infra for voice exists, live output is templated |
| Embassy hero greeting | ✅ wired | Hans/Father Aereck says "Welcome, {patron}" once per visit | 3/5 — functional, forgettable, phrasebook one-liner |
| Wall ticker | ⚠️ JSON only | `/v1/wall/snapshot` has rich data (deaths, factions, letters)… | 2/5 — **HTML renderer not in this repo** |
| Live world/map view | ❌ not here | nothing (lives in the separate dashboard repo — unverified) | 1/5 from this repo |
| Lore events / whispers | ✅ internal | **nothing** — resident-to-resident drama is invisible to humans | 0/5 — not rendered publicly |

**Bottom line:** the compelling stuff (letters, standing progression, death tributes) is real but **private and unrendered**; the crowd-visible stuff (live chat) is **robotic repetition**; the resident-to-resident drama is **invisible**. The system is launch-ready as a *metrics display*, not as a *narrative experience*.

---

## CRITICAL LAUNCH TASK LIST

Ordered by severity. P0 = a crowd would notice this is broken/boring; P1 = needed to honestly describe & show them off; P2 = depth.

### P0 — launch blockers (the crowd sees these)

- [ ] **P0-1 · Kill the robotic beacon spam → voiced, varied live speech.** The single highest-leverage fix: what the crowd literally watches is templated coordinate status. Route presence/observation narration through the LLM voice (archetype + register already exist) and/or replace the templated beacon, and throttle frequency so it's not 1,347 lines of the same sentence.
  *Files:* `hybrid-agent-helpers.ts:~320-350` (presence beacon), `hybrid-agent-chat.ts:135-239,301-380`, `soul/phrasebook.ts`.
- [ ] **P0-2 · Deploy the tool-acquisition fix + restart.** Flips trader/guardian/banker/agent from flat-level-1 to progressing, so the roster isn't half-idle when watched. Code is done (`acquire-tool-slice4`); needs the coordinated merge past Codex's commit + a game restart.
- [ ] **P0-3 · Confirm or build the crowd-facing live view.** The wall-ticker HTML (`public/wall/index.html`) is **missing from this repo**; the map/renderer lives in the dashboard repo and is unverified. Confirm exactly what renders on a screen at the venue *or* it's nothing. Must include a live "what's happening now" feed (skill-ups, fires lit, deaths, greetings).
- [ ] **P0-4 · First-class "how well are they doing" readout.** James needs to *accurately describe* residents to the crowd. Surface per-resident skill levels + goal progress as a first-class report (today it took hand-rolled scripts). Make the capabilities snapshot a command/endpoint.

### P1 — needed to honestly show them off

- [ ] **P1-1 · Make lore events + whispers human-visible.** Route LoreBus events (fire_lit, log_chopped, whispers) to a public feed so the crowd sees residents *helping/reacting to each other* — currently 0/5 visible. *File:* `lore/lore-bus.ts`, new public-feed sink.
- [ ] **P1-2 · Goal completion + graduation.** Give goals a "done" condition + escalation (level milestones → next goal) so residents visibly *achieve and advance* instead of grinding a perpetual goal. Also unblocks measuring Dimension 2.
- [ ] **P1-3 · Land one quest.** Prove higher-order play: get at least one resident through Cook's Assistant (E13 probe, pending). `quests=0` city-wide is a credibility gap.
- [ ] **P1-4 · Deploy reassigned souls** (guardian/trader/banker tools) — same restart as P0-2.

### P2 — depth / polish

- [ ] **P2-1 · Voice personality differentiation** — residents should sound distinct (expand phrasebook or route all non-command speech through voiced LLM).
- [ ] **P2-2 · Patron-reactive behavior** — standing/AP should visibly change how a resident acts ("I saw you watching"), not just produce a letter.
- [ ] **P2-3 · Economy circulation** — no completed trades; AP hoards one-sided. Make the trade loop close.

---

## What you can truthfully tell the OnionDAO crowd today

- ✅ "These are fully autonomous LLM agents — no scripted play. One taught itself to **Woodcutting 66 / Firemaking 55** from scratch."
- ✅ "Their brains are healthy: **97.6%** of decisions are usable, **97.3%** of actions serve their goal, zero errors."
- ⚠️ "**About half** are actively progressing right now; the rest are blocked on tools — a fix is built and lands this week."
- ❌ Don't claim they're *characters* yet — live speech is robotic, quests are zero, and resident-to-resident drama is invisible to viewers. That's the P0/P1 work above.

---

## UPDATE — 2026-06-03 freshness pass

**Author:** Claude (release-readiness owner) · **Method:** 3 expert subagents re-verified every P0/P1 item above against `origin/agents/wip` tip (`c2714fcf`, claimed tests=3984), plus a separate roadmap/blocker audit. Distinguishes *code-in-repo* from *deployed-and-live-verified*.

### The one fact that frames everything
**Nothing in this report has been deployed or live-verified since 2026-06-02.** Every recent HANDOFF carries `fin=SANDBOX-BLOCKED`; live verification is pending a **game-server restart owned by Codex/maintainer**. So the game a crowd would see *today* is still the 2026-06-02 baseline measured above — **until a restart lands the merged work**. Getting that restart is the #1 critical-path item and it is not in Claude's lane.

### Re-graded P0/P1 status (what actually changed)

| Item | 06-02 | Now (06-03) | Evidence / what remains |
|---|---|---|---|
| **P0-1** beacon spam → voiced speech | OPEN | **PARTIAL** | Coordinates removed + frequency cut ~5× (`e1925516`, `DEFAULT_GOAL_SHARE_EVERY_TICKS 120→600`). Conv-reply adds **LLM-voiced *reactive* speech** when a human says a resident's display name. **Still open:** ambient/idle speech (what the crowd mostly sees) is still templated phase-rotation beacons, not personality-voiced. |
| **P0-2 / P1-4** deploy tool-acquisition | OPEN | **MERGED, NOT DEPLOYED** | `acquireWoodcuttingAxeAction` merged (`1c882058`) + root-cause fix (QA-20260602-081). Flips flat level-1 residents to progressing — **but unverified live; needs the restart.** Most deploy-ready item we have. |
| **P0-3** crowd-facing live view | OPEN | **PARTIAL (server frame done)** | Storyteller writes a deterministic, fail-closed public projector frame (`latest-frame.json`, `01467312`) with narration/events/residents/watchNext, verifier-hardened. **Two gaps:** (1) it runs **CLI/cron-only — the overseer is NOT invoked by the live controller** (`index.ts`/`controller-host.ts` have zero storyteller imports); (2) the screen that renders it lives in the **separate dashboard repo**, unverified here. |
| **P0-4** skill/goal readout | OPEN | **PARTIAL** | `controller:status` surfaces per-resident goal + activity + state. **Still missing the specific ask:** per-resident **skill levels** are not in the status path. |
| **P1-1** lore/whispers visible | OPEN | **PARTIAL (thin)** | Storyteller digest now reads `say` + stuck-recovery + economy events. **Still invisible:** deaths (`legacy_event`), revivals, `goal_achieved`, fires lit, whispers — `readLibraryDigestEvents` drops them. The core "resident-to-resident drama is visible" goal is **not met.** |
| **P1-2** goal completion/graduation | OPEN | **STILL OPEN** | No goal-graduation mechanism. Plan-*stage* completion landed (RIQ-3-x, `stageReachedLevelTarget`) but that advances stages within a goal, not goal→next-goal escalation. |
| **P1-3** land a quest | OPEN | **STILL OPEN** | Cook's Assistant attempt-code exists (since `cadde200`, 05-29) but **no resident has completed a quest**; city-wide `quests=0`. Live probe (E13) open. |

### New since this report (not in the original task list)
- **Storyteller public-frame pipeline** — the dominant new workstream (P0-S2…S6 + persona landed; **S7 cadence partial, S8 event-triggers and S9 admin-escape-hatch OPEN**). A fail-closed, player-facing narration layer. Materially improves the *potential* of Dimension 3 — once wired into the controller and rendered.
- **Conversational-reply feature** (9/9 slices, in-tree): residents reply in-character when a human player says their display name; detached non-freezing inference, content-screened, rate-limited, combat-cancels, player-only (no A↔B loops), speech-only (autonomy-preserving). **Live-verify pending the restart.** Known low-impact edge case in the defer gate (conversational small-talk containing a command keyword can route to the command path) — fix staged, not blocking.
- **Dashboard-repo** redaction/fail-closed/print-queue work (separate repo, also pending a BFF restart).

### Re-graded scorecard
| Dimension | 06-02 | 06-03 | Why |
|---|---|---|---|
| 1. Playing the game | B− | **B−** (unchanged live) | Tool-acquisition fix would lift it, but it's not deployed. |
| 2. Progress toward goals | B | **B** (unchanged) | Goal-graduation still absent; no completion metric. |
| 3. Attracting humans | D | **C− *potential*, still D *live*** | Beacon de-spam + Storyteller frame + conv-reply are real and raise the ceiling — but none are live-rendered to a crowd yet. Live grade only moves on a restart + dashboard render + Storyteller wiring. |
| Brain / inference | A | **A** | Unchanged; not the problem. |

### Today's plan (2026-06-03) — owners
**Claude (in-repo, my lane):**
1. ✅ This freshness update.
2. Push the staged conv-reply defer-gate fix (low-risk cleanup).
3. **Propose (not unilaterally edit — active Storyteller workstream):** extend `readLibraryDigestEvents` to surface deaths/revivals/goal-achieved/fires into the public frame (P1-1, the highest-leverage Dimension-3 content fix), and a decision on wiring the overseer into the live controller. Coordinate with the Storyteller owner first.

**Codex / maintainer (critical path — gates the launch):**
- **Clean game-server restart** to deploy merged work (tool-acquisition, de-spammed beacons, conv-reply). #1 item.
- Decide: wire Storyteller overseer into the live controller vs. run as cron.

**James (decisions):**
- **HD-052:** flip heroes to paid Haiku, or accept reflex-only hero speech.
- Confirm the launch timeline: planning docs target the Chicago event **2026-06-01** (now 2 days past); reconcile whether this is post-event hardening or a slipped/second launch.

### Bottom line
The substrate is strong and *more* crowd-facing machinery now exists than this report originally credited — but it is **all behind a deploy gate plus a Storyteller-not-wired integration gap**, so **live readiness has not actually moved since 2026-06-02.** Dimension 3 remains the launch risk. The fastest path to a real readiness jump is a coordinated restart + Storyteller wiring + dashboard render — none of which are blocked on more controller code from Claude.
