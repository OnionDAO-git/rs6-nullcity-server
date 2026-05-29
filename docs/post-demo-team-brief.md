# Post-Demo Team Brief

> **SUPERSEDED 2026-05-26 by the OnionDAO progress meeting.** Many of the brainstorm topics in this doc were answered or reframed in the James / Dev / Adam meeting. See [`docs/2026-05-26-meeting-decisions.md`](2026-05-26-meeting-decisions.md) for current ground truth. This doc remains as historical context for the post-demo audit; do not use it to plan new work.

---

Written 2026-05-26 for the OnionDAO team meeting following the internal demo of Null City. Goal: share what's queued for this week, what features need building next, and — most importantly — surface the open product questions where the team's creative input matters more than more engineering hours.

## Where we are

- Pre-Chicago demo snapshot shipped to `nullcity`, tagged `pre-chicago-demo-2026-05-26`.
- 2,151 tests green. All five public surfaces (wall, inbox, patron, library, graveyard) live. Patron loop end-to-end verified with a live demo handle.
- Honest framing: the city is **alive and legible**, not yet **smart**. Heroes (Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, Thrand) currently rely on authored fallback lines >50% of the time. The QA-named residents (qa-woodcutter, qa-cook, qa-angler) are the proof that the full LLM-driven loop works — they're doing real RuneScape work tick by tick.

## This week — engineering queue (Mon → Fri)

These are concrete, scoped, ready-to-pick tickets. Roughly ranked by demo-day-improvement-per-hour.

1. **Hero body routine fallback** (Pillar 1, biggest single quality jump). Today, when a hero's LLM call is between cycles, they say the same authored line on repeat. Bind heroes to a default body action (exploration / look-around / approach-nearest-patron) so they at least move while waiting. Closes the "Still here as X" loop without removing the safety net.
2. **Dashboard "Login" / online mismatch** (HD-009 territory, operator-trust). The resident-detail page shows a Login button even when the resident is online. Lives in the dashboard repo (`rs6-nullcity-residents-dashboard`). Small fix; high signal during ops use.
3. **Portrait quote dedup** (Library quality). Wants are deduped; quotes are not. `res-hans/portrait.md` still has lines like "Became stuck at tick 21" repeated 73×. Apply the same pattern that fixed wants (commit `138a8371`).
4. **Filter `[Broadcast]` letters from public surfaces.** 79% of letter volume is clinical system events; only the literary 21% should hit the wall ticker. Add a `kind`-based filter in `buildWallSnapshot.recentLetters`.
5. **Chicago patron registry process** (HD-011, operational). Build a 24h-before-doors workflow so attendee handles are loaded into `controller.yml#patrons[]` before the event. Likely uses `npm run patron:bulk-register --file <attendees.txt>`.
6. **Health probe latency** (`/v1/health` returns in ~18s). Tune the LLM ping to fail fast or use a cached "last good" response. Operator UX issue if anyone polls it during demos.
7. **`L-β-2` cross-resident interaction events.** Whisper verb shipped but no whisper events fire. Wire the runtime to actually invoke it between residents in the embassy region. This is the "residents notice each other" moment that's currently invisible.

## Features to build — next 2–3 weeks

Bigger pieces. Each needs ~1–3 dev days plus some design.

- **`J-γ` — in-world chathead menu wiring.** The only J-series workstream still open. Lets a player talk to a hero by clicking them in-game and get a real menu of options (offer Shards, ask about the city, hear a story). Closes the loop between RuneScape UI and the patron system.
- **`E13` — Cook's Assistant quest probe.** First real Tier-3 RuneScape quest end-to-end. Proves residents can do branching multi-step quests, not just gather-and-craft loops.
- **`E14` — combat smoke** (goblin chickens vs `res:agent`). Right now combat happens ~3 times per 4 days across all residents. Either combat is broken or residents are correctly avoiding risk; we need data.
- **Failure-mode triage reference doc.** When a resident does something dumb, devs need a one-page rubric for "is this a design problem, an inference problem, or a substrate bug?" so we can stop debating and start fixing.
- **Boot-time + cold-start metrics dashboard.** Right now we measure tick activity but not "how long until residents are usable after restart." Affects Chicago staff confidence.
- **Backup/restore drill.** `data/controller/memory/` is the city's brain. We have no documented restore path if it corrupts. Build it before Chicago.
- **HD-007 multi-life respawn policy.** Heroes should stay dead across restart (narrative integrity); dev residents resurrect (ergonomics). Schema + per-soul `respawnPolicy` field. Currently inconsistent.

## Brainstorm topics — bring the team back with feedback

These are the questions where engineering velocity doesn't help. We need OnionDAO team taste, intuition, and product judgment. Each one would benefit from a 20–30 min group discussion.

### 1. What does "smart resident" actually mean?

The demo audit said the QA souls are doing real RuneScape work (XP, fires, fish caught), but the named heroes are scripted greeters. **Two product directions, only one of them gets built:**

- **(A) Heroes are NPCs:** they exist to give lore, greet patrons, and be remembered when they die. They don't quest. The QA souls are the "real residents" doing autonomous work.
- **(B) Heroes ARE residents:** Hans should be choppable wood, Father Aereck should pray, Duke Horacio should rule. The named ones are the deepest LLM-driven residents.
- **(C) Mixed:** heroes have a "duty" (greeting, mass, holding court) plus light autonomous behavior in between.

This decision shapes 2–4 weeks of work. Team needs to pick.

### 2. The patron product — who is the patron?

We've built grant, offer, witness, gift, check-in, referral, ask, whisper. But the *meta question* is unanswered:

- Is patronage **free engagement** (Twitter follow), **paid subscription** (Patreon), or **earned attention** (game progression)?
- Where do Shards *come from*? Daily check-in gives +1. Referral gives +2. Is that the only source, or can patrons buy Shards / OnionDAO grant them / earn through quests?
- What does the patron *want*? Their resident to live longer? To level up? To become Officer? To have a good death?
- Is patronage tied to OnionDAO membership / token-holding / wallet identity?

### 3. Faction identity

We have four factions (Foundry, Bureau, Archive, Veil) and four flagships. Persistent stockpile ledger exists. But:

- Do **patrons** pick a faction? Or do residents pick for them?
- Are factions **competitive** (leaderboard) or **complementary** (different paths)?
- What's the actual *narrative* of each faction beyond the aesthetic? Foundry = make stuff, Bureau = record stuff, Archive = remember stuff, Veil = hide stuff — but why does that matter to a patron?

### 4. The Chicago IRL event arc

June 1. Attendees scan QR codes at the embassy door. Then what?

- What's the 30-minute attendee experience? Walk-up → register → witness → letter → leave?
- Is there a *finale* — a story conclusion, a hero death, a city-wide event?
- Do attendees compete? Cooperate? Just spectate?
- What's the moment they *take home*? A printed lanyard card, a digital letter, a memory?

### 5. Resident lifecycle: birth, death, retirement

Some residents die from `attention_exhausted` after their patrons stop paying attention. Multi-life via revival exists for dev residents. But:

- When does a resident **retire** rather than die? Old age? Boredom? Completion of their goals?
- Is there a **"good death"** (lived their full arc) vs **"tragic death"** (died early, unfinished)? Should letters reflect this?
- What's the right **death cadence**? Right now we get a handful per day. Is that too many? Too few?
- Should patrons influence **revival**? Pay Shards to bring someone back? Or is death permanent for narrative weight?

### 6. The story-arc system

Residents track `phase: pitch | fund | progress | resolve | letter`. But:

- Who authors a resident's arc — the LLM, a designer, or emergent from patron behavior?
- Does a resident **know** they're in an arc? Can they see their own next phase?
- Do arcs have **endings** beyond death — like "Hans finished his quest to know every visitor"?

### 7. The Embassy Clerk voice

Every letter is signed "— Embassy Clerk." Strong unified voice. But:

- Who *is* the Clerk? A specific persona? A chorus? The city itself?
- Should the Clerk have its own portrait, faction, history?
- What's the relationship to OnionDAO's brand voice? Is the Clerk the OnionDAO voice when speaking from Null City?

### 8. Engagement after the demo

A patron leaves the demo. What brings them back?

- Push letters to email when something interesting happens?
- Real-time notification ("Hans is dying, come witness")?
- A calendar event for hero deaths?
- Subscription / membership tier?
- Or is Null City a **finite-art-piece** — beautiful, contained, no engagement-treadmill?

This one is existential — answers shape whether we build retention loops or finale moments.

### 9. The dashboard's audience

Right now the dashboard is operator-only — for James and the team to spawn/control/observe residents. But:

- Should it be **public-facing** so patrons can dashboard *into* the city?
- Should it have **community features** — patron leaderboards, faction standings, resident bios?
- Or stay operator-only forever?

### 10. What's the relationship to RuneScape itself?

We're built on a RuneScape emulator. Residents do RuneScape skills, fight RuneScape monsters, walk the Lumbridge courtyard.

- Is RuneScape the **medium** (could be Minecraft, could be anything) or the **point** (we are a RuneScape art piece)?
- Are we a **fan project**, a **standalone game**, or a **demo of LLM-driven NPCs** that happens to use RuneScape?
- Does this affect what we can ship publicly (IP question)?

## How to give us human-led feedback

Three channels, in increasing depth:

1. **HD entries in `docs/human-decisions.md`** for binary decisions that need maintainer judgment. Pattern: anyone proposes the question, James decides, the decision is recorded with rationale.
2. **Specs in `docs/superpowers/specs/`** for features that need fully-formed design before code. Use the brainstorming skill if you have access; otherwise write the spec by hand.
3. **Strategic reviews** every 30 cycles / 24h (per coordination Rule 8). Living examples in `docs/strategic-review-2026-05-23.md` and similar.

For the brainstorm topics above, the right artifact is a new spec per topic — `docs/superpowers/specs/2026-MM-DD-<topic>-design.md` — that proposes 2–3 paths and the trade-offs.

## What we won't get to this week

To be honest with the team about what's NOT happening:

- Full hero LLM autonomy (we're shipping the body-routine fallback instead — same demo-day improvement, much less risk).
- Public dashboard exposure (security/auth posture isn't ready).
- New skill content (we have 20 skills documented; we don't need more).
- New benchmarks (we have 9; coverage is fine).
- Token/wallet integration (out of scope until faction/patron product is settled).

## Bottom line for the team

The code is shipped, the demo works, the story has real moments (the codex-live epitaph is the elevator pitch). Now we're at the point where **product taste matters more than dev velocity**. The technical foundations are strong enough that the next 2–4 weeks should be 50% feature work and 50% group discussion about what Null City actually *is* — because we've built enough of the substrate that we can credibly go multiple directions, and we should pick deliberately rather than drift.
