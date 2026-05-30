# Final 32-Hour Sprint Plan — Chicago IRL (2026-06-01)

Drafted: **2026-05-30 ~23:00 CDT** (Saturday night).
Doors open: **2026-06-01 Monday** (~32 hours from this writing).
Supersedes the planning sections of `docs/2026-05-29-weekend-sprint-plan.md` (the shipped-packet log + Weekend Closeout Summary in that file are still authoritative for what's done).

## Reading order for the next agent

1. This file (triage + critical path).
2. `docs/pre-chicago-readiness.md` (T-24 and T-2 ops checklist).
3. `docs/issue-register.md` (open P0/P1).
4. `docs/agent-status.md` tail (live STARTING locks).
5. `docs/2026-05-29-weekend-sprint-plan.md` § Weekend Closeout Summary (what shipped).

## Demo definition (the loop the viewer will see in Chicago)

In one sentence: **a viewer walks up to the dashboard, sees Null City alive, can spend AP to support a resident, sees the resident react, and reads a Storyteller dispatch about it.**

The full first-experience flow (must work end-to-end with attendees):

1. Viewer opens dashboard. Sees a population of live residents (AP, GP, goals).
2. Viewer reads the Storyteller feed — recent narrated events grounded in real evidence.
3. Viewer picks a Soul proposal and funds it with AP (or watches an existing resident).
4. Viewer sees the resident respond — say line, action, AP/GP delta visible within seconds.
5. Optional: viewer redeems an NCRI for a printable item (substrate-side only is acceptable; the 3D-printer is a stretch).

If 1–4 work cleanly with one viewer and the wall ticker is readable from across the room, the demo lands.

## Triage by demo-readiness

Every open packet, classified by whether it blocks the demo flow above.

### MUST-SHIP-FOR-DEMO (gate items — Chicago demo is degraded without these)

| Packet | What "done at the demo" looks like | Status / owner | Notes |
|---|---|---|---|
| **HD-011 patron registry populated** | Real attendee handles loaded into `controller.yml#patrons[]` before doors; embassy greeting reflex fires for at least one walk-up. | event-staff onboarding task; `npm run patron:bulk-register` exists. Maintainer-owned. | Single biggest live-flow gap per `pre-chicago-readiness.md`. Without this, only CLI-grant flow works. |
| **Live stack restart with `--wall-redact` + `--letters-http-port=43596`** | `bash scripts/post-restart-smoke.sh` returns READY (not READY-WITH-WARNINGS). | Maintainer + Codex own controller restart. | Per HD-029 / HD-013. |
| **Dashboard D5 Storyteller feed visible** | Browser shows recent Storyteller dispatch with operator-review panel. | Dashboard repo `d8a798/7b1db56/37d94ec` shipped substrate; needs final QA pass against live controller. | Substrate-ready. Last unknown: does it render with `/storyteller/latest` redacted output. |
| **Dashboard D1 viewer profile (AP/GP visible)** | Viewer can scan a QR code → personal page → see Shards/AP, standing tier, letters. | Dashboard repo: HD-016 C/D closed (`/patron/?human=<h>` HTML page), needs final dress-rehearsal. | "First-experience" anchor for attendees. |
| **At least 3 heroes reliably saying things** | Hans / Father Aereck / Wise Old Man (or any 3) emit a soul-distinctive line within 30s. | HD-008 attention floor + HD-032/033 mitigated. | Heroes carry the visible-alive signal even when Brain returns empty (87.5% per HD-033 F20a). |
| **Wall ticker projection readable** | Public projection shows redacted recent letters; readable from 5+ feet. | D6 + D6-page shipped. | Visual centerpiece. Needs a paper test (per pending task #164) in the venue. |
| **At least one Storyteller dispatch per ~10-30 min** | `/storyteller/latest` returns a grounded body with no unsupported claims. | S7b shipped fallback + paid run; S-STORY-1 overseer is queued but **NOT required** for demo if maintainer runs `storyteller:run --latest` manually on a 20-min cron. | Manual cron suffices for one event. S-STORY-1 is a NICE-TO-HAVE. |

### NICE-TO-HAVE-FOR-DEMO (visible polish; deficient demo without is still usable)

| Packet | Why nice | Status |
|---|---|---|
| **S-STORY-1 overseer (continuous mode)** | Removes the manual `storyteller:run` step at the venue. | Unclaimed; QA-20260530-004. |
| **S-NCRI-1 listing + pricing** | Lets viewers SEE a marketplace, not just abstract NCRIs. | Claude STARTING at 20:13 (in flight per `agent-status.md`). |
| **S-NCRI-2 atomic AP-debit + ownership transfer** | First time a viewer can ACTUALLY buy an NCRI in a live demo. | Blocked by S-NCRI-1. |
| **D10 dashboard NCRI marketplace** | The buy button. | Dashboard repo; depends on S-NCRI-1/2. |
| **S-GOAL-1 SoulOrientation schema** | Lets new viewer-proposed Souls have aspirational orientation text. | Claude STARTING at 15:15 (in flight). |
| **S-ECON-VIEW-3 SSE stream** | Lower-latency dashboard refresh (today: 2s poll via `max-age=2`). | Polling works fine for ~25 residents and a handful of viewers. |
| **D8 readiness dashboard panel** | One-glance "city healthy" for staff. | Dashboard repo `31d0f8f` shipped; needs verify on live data. |
| **HD-018 D3 embassy greeting** | Auto-greet walk-up attendee by handle. | Substrate shipped (HD-018 closed); live firing needs HD-011 + restart. Gates on MUST-SHIP items above. |

### POST-DEMO (defer; track for post-event work)

| Packet | Why defer | Owner / next action |
|---|---|---|
| **S-STORY-3 paid model dispatch with persona** | Needs hot stack + paid profile; cost cap design is a fresh decision the maintainer hasn't approved. Manual run covers the demo. | Spec is ready (`storyteller-overseer-design.md`); maintainer decides post-event. |
| **S-MEM-1..4 resident memory system** | Substrate-ready by S-MEM-1 alone, but no demo viewer needs to SEE a smarter memory. CIC-decision: pick mem0/qmd/MCP hybrid is still open. | QA-20260530-006. Post-event. |
| **S-GOAL-2/3/4 orientation scorer + bias + nudge** | Builds on S-GOAL-1; not visible in a 5-minute demo flow. | QA-20260530-007. Post-event. |
| **S10b/S10c model twins on GP/goal-planning** | Needs paid profiles + hot stack + multi-hour runs. | Run post-event with calmer infra. |
| **S12b human capability summary** | Re-write after S10b/c. | Post-event. |
| **CQA1 Cook's Assistant natural ingredient sourcing** | CIC scope cut — quest expansion is explicitly NOT weekend MVP. | QA-20260529-001. Defer. |
| **S-AUDIT-FIX-3 through -11** | Mostly P1/P2 polish; F3 (needs-hierarchy wiring) is **CLOSED** today; remaining items are concurrent-write safety, log efficiency, status helpers. None block demo flow. | QA-20260530-013..017. Post-event. |
| **S-AUDIT-FIX-6 concurrent-writer safety** | Real only if multi-controller Docker Compose lands. Not landing pre-Chicago. | Codex `4567ce94` already documented + added concurrent-appender test today (In Review). |
| **HD-043 LoreBus + whisper wire-ins** | Explicit "not happening at the event" per `pre-chicago-readiness.md`. | Post-event integration. |
| **F9a say tail enrichment** | Closed-ish (`5fba2c06`); residual polish only. | Post-event. |
| **Cron prompt PID + scope fix (#180)** | Addressed by Deliverable 2 of THIS packet (proposed v2 to maintainer). | See `docs/cron-prompt-v2-proposed.md`. |
| **Post-Chicago retro template (#181)** | By definition post-event. | Spawn after the show. |
| **All E18/E20/E21/E22/E23 instrumentation experiments** | Knowledge work; doesn't change the demo flow. | Post-event. |
| **E13 Cook's Assistant tier-3 probe / E14 combat smoke** | Same — instrumentation, not demo flow. | Post-event. |
| **EXP-HARD-1 combat-survival-1h soak + failure classification** | The highest-leverage post-Chicago intelligence experiment. Converts substrate into real failure-mode signal across the DESIGN/INFERENCE/BODY/PERCEPTION/KNOWLEDGE/ENGINE taxonomy. | Spec: `docs/superpowers/specs/2026-05-30-hard-task-soak-experiment-design.md`. Sub-slices EXP-HARD-1-A/B/C. Schedule 2026-06-02. |
| **Patron lifecycle / cold-start metrics / backup-restore drills (#175/#176/#177/#178)** | Operational hygiene, not demo flow. | Post-event. |

## Critical path (32 hours to doors)

The minimum sequence to land MUST-SHIP-FOR-DEMO. Each step gates the next.

```
NOW (Sat 23:00 CDT)
  │
  ├─ [P1, ~2h, maintainer + Codex]
  │    Controller restart with --wall-redact + --letters-http-port=43596.
  │    Smoke: scripts/post-restart-smoke.sh → READY (not READY WITH WARNINGS).
  │    Heroes alive, 23+ residents emitting trajectory rows.
  │
  ├─ [P2, ~1h, dashboard agent]
  │    Live-verify D5 Storyteller feed renders /storyteller/latest correctly
  │    against the freshly-restarted controller. Fix any render bug here.
  │
  ├─ [P3, ~1h, dashboard agent]
  │    Live-verify D1 /patron/?human=<h> against a real test patron.
  │    Confirm QR-to-page works end-to-end.
  │
  ├─ [P4, ~30min, maintainer]
  │    Decide: bulk-register attendee handles now (cleaner) OR at-door staffer
  │    onboarding (slower). HD-011. Either way, the recipe is `npm run patron:bulk-register`.
  │
  ├─ Sun morning (T-24h)
  │    Dress rehearsal #1: full smoke + live-greeting walk-through with a fake patron.
  │    Pre-Chicago checklist T-24 section, line by line. Capture any RED items.
  │
  ├─ Sun afternoon (T-18h)
  │    Fix any RED. Final restart. Confirm READY.
  │    Optional: ship S-NCRI-1 (claude is mid-flight) — IF clean push, IF tests
  │    green. Do NOT push at T-12h; risk too high.
  │
  ├─ Sun evening (T-12h)
  │    Code freeze. No commits to agents/wip touching server.
  │    Docs-only after this.
  │
  ├─ Mon AM (T-4h)
  │    Set up wall projection in venue. Paper test from 5+ feet.
  │    Bookmarklet / QR-code handout ready (per pre-chicago-readiness § T-2).
  │    Staff trained on patron-grant CLI fallback.
  │
  └─ Mon (T-0)
       Doors open. Run on staff fallback if anything red.
```

## Risk register (32h horizon)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **HD-033 F20a Qwen3 thinking-mode empty 87%** | Confirmed | Heroes' Brain conversation degraded — reflex fallback carries identity. | Already mitigated by F19c/F20c. Demo flow does not require deep Brain output. Wall ticker + reflex says + identity beacons are enough. |
| **Empty `patrons[]` at doors** | Medium | Embassy greeting reflex never fires for walk-ups; only CLI-grant works. | HD-011 — explicit go/no-go question for maintainer at T-24. |
| **Push race on agents/wip causing stale dashboard build** | Low-medium | Dashboard could show old contract. | Code freeze at T-12h. Pin dashboard build to a tagged SHA Sun evening. |
| **3D-printer / NCRI redeem expects substrate not shipped** | Medium | A viewer redeem flow could 500. | NCRI redeem is NICE-TO-HAVE. Show metadata + AP-debit substrate; defer print bridge to operator-only demo or skip entirely. |
| **Live LLM endpoint saturated under attendee load** | Medium | All Brain calls empty. | Reflex fallback says still emit. Wall ticker still updates from real economy events. Acceptable degradation. |
| **Single controller process dies mid-event** | Low | Total dark. | Staff runbook covers restart. `scripts/post-restart-smoke.sh` is the recovery oracle. Practice this Sunday. |
| **Cron picks an irrelevant packet and burns budget during event** | Low-medium | Distraction; wasted spend. | Maintainer disables / pauses cron for event window. (Also see Deliverable 2 — cron-prompt-v2-proposed.md.) |

## What's NOT in this plan on purpose

- Squash-merge of agents/wip to nullcity (QA-20260529-007: 689 commits ahead). **Not happening before Chicago.** Demo runs from agents/wip. Squash is post-event.
- Any new feature work that touches `src/controller/spark/`, `resident-runtime.ts`, `action-coordinator.ts` after Sunday afternoon. Hot zones for breakage.
- Stretch decisions on Storyteller persona / name / spice. Manual run uses default persona; persona is a post-event design call.

## EXP-HARD-1 placement

Deliverable 3 of this planning packet adds packet **EXP-HARD-1** (hard-task soak experiment) — see `docs/superpowers/specs/2026-05-30-hard-task-soak-experiment-design.md`.

**EXP-HARD-1 is POST-DEMO.** It is the highest-leverage post-event experiment because it converts the AP/GP substrate into actual intelligence-signal data, but running it pre-Chicago risks two things: (a) confounding the live stack right before the demo, and (b) the failure classification it produces is most useful AFTER the demo audience has put real pressure on the system. Schedule EXP-HARD-1 for Tuesday 2026-06-02.

## Open decisions still blocking polish (not blocking demo)

From the original sprint plan's "Meeting Decisions Needed" section — none of these block the MUST-SHIP flow but they remain open and the maintainer should answer them within ~2 weeks:

1. AP birth threshold for Soul proposals (default chosen ad-hoc).
2. AP decay rate calibration.
3. AP-for-GP exchange pricing model.
4. First GP-earning activity to optimize.
5. First 3 NCRIs to seed.
6. 3D-printer GP costs.
7. Storyteller name + tone.
8. "AP" abbreviation vs spell-out.

See `docs/human-decisions.md` for the canonical log; add `HD-###` rows for any of the above before the demo if a viewer is likely to ask.

---

**One-line summary**: The demo runs on what's already shipped. The critical path is restart + dress-rehearsal + patron-registry loading; everything else is polish or post-event. Code freeze Sunday evening.
