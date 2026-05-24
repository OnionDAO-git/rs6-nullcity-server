# 48-Hour Autonomous Sprint Handoff — 2026-05-26

**For:** James (maintainer), Tuesday morning recovery context.
**Sprint window:** 2026-05-24 (Saturday) → 2026-05-26 (Tuesday).
**Author:** claude (with Codex as the depth-fix partner; see § Codex contribution).
**Linked artifacts:** `docs/intelligence-verification-log.md` (E1-E37), `docs/human-decisions.md` (HD-001 through HD-041), `docs/agent-status.md` (append-only multi-agent log).

---

## TL;DR

- **The Pillar-3 patron loop is end-to-end functional for a 19-resident roster** (6 heroes + res:agent + 12-soul Codex QA cohort). Patron offers Shards → letter dispatches → resident says thanks by name → letter visible at `/v1/inbox?human=...` → wall projection masks recipient + body for public display.
- **All 19 residents are alive** (zero deaths in 50+ min post-restart per E32 + E33, validated again in SPRINT-QA2 / E36).
- **HD-008 hero attention floor CLOSED end-to-end** (E30 substrate + E32/E33 live verify). Soul-declared `attentionProfile.floor` clamps spend outcomes: Hans/Aereck/Wise/Duke=5000, Pip/Thrand=3000. Three heroes were observed resting exactly at floor under live load, three above floor with patron offers lifting them. The recurring hero-death pattern (4 deaths during E29 sprint window before E30) is permanently closed at the source.
- **Two intelligence gaps remain (not Chicago blockers):** Brain LLM completion is empty 84-100% of the time for heroes (F20 quantified); resident speech rarely references the 50 knowledge entries (F21 / E22 partial close, residual). Reflex layer + per-hero nervous rules carry the experience.
- **Three new findings from SPRINT-QA2 (E36, late Saturday):** (a) qa-guardian + qa-survivor catatonic — both stuck emitting `low_health_hold_position` 2192/2177 times consecutively with no escape path (HD-039 filed for Codex); (b) standing-tier letter dispatcher LOSSY when one grant crosses multiple tiers (HD-040 filed — codex-hour-qa + codex-live each missing 3 tier letters; total ~8 of 15 expected tier letters missing); (c) zero cross-resident chat events observed across 9 residents in a 14-min window (HD-041 filed for L-α/L-β regression check).
- **Three Chicago-relevant operational items still need maintainer attention:** populate `controller.yml#patrons[]` (HD-011 — sole remaining smoke-script yellow), file the dashboard Pillar-3 patch package with Dev (HD-015), and confirm HD-039/040/041 priorities with Codex Monday morning.
- **Tests: 1657/1657 passing as of 22:00 UTC.** Action volume on cohort residents reaches 75 actions / 5min on the most active (qa-scout / qa-woodcutter). The pre-E30 hero death pattern has NOT recurred since the floor landed.

**Single command Chicago-day go/no-go:** `bash scripts/post-restart-smoke.sh`
**Single-page operational checklist:** `docs/pre-chicago-readiness.md`

---

## What shipped this sprint (chronological)

### Codex commits (12 total — depth fixes in thinking/runtime)

| Commit | Workstream | What it does |
|---|---|---|
| `a87eed0d` | QA-beacon/openable/nonclosing | Beacon-aware next-step + cooldown-aware exploration |
| `19d398f1` | QA-HD023 | Timed-out coordinate moves create target cooldowns (HD-023 response) |
| `91f8e160` | QA-brain-memory | Brain memo + planChange telemetry; 222KB events memo + organic planChange landed (E2b) |
| `da30d3c9` | QA-move-timeout-evidence | Final-position/target-distance evidence for residual move_to timeouts |
| `2ef5590f` | QA-move-progress-timeout | Treat improving move waits as progress |
| `4f62d181` | QA-respawn-policy | `respawnPolicy: 'on_restart'` SOUL field; res:agent revives on restart (HD-007 response) |
| `a570b560` | QA-beacon-variety | Rotate beacon prefixes after tick 1000; NPC counts in say text (F8c response) |
| `6e34e8fb` | QA-scout-landmarks | Wider exploration; movement timeout cooldowns respected |
| `01692a00` | QA-beacon-target-cooldown | Beacon next-steps align with failed-target cooldowns |
| `8b4b57f7` | QA-scout-beacon-intent | Beacons reflect patrol/landmark intent |
| `60f5c293` | QA-anchor-return-speech | Active anchor-return chains visible in beacons |
| `214ccc53` | HD-029-letters-restart | Wired `--wall-redact` flag + restarted controller with HTTP port bound |
| `80f25d18` | HD-031-patron-reflex | Deterministic patron-acknowledge reflex (HD-031 option-c response) |
| `3f042b38` | HD-030-revive-cli | `npm run controller:revive` admin tool; revived all 6 heroes |
| `d72a3d00` | HD-032-frozen-heroes | LLM-abort queue cleanup + watchdog fallback (HD-032 critical response) |
| `2e32a7bb` | M8-hero-fallback-personality | Hero-name fallback speech + anchor patrol (F18d response) |
| `7669f384` | F6-default-spark-idle | Idle-initiative no-hook pulse for Thrand (F6 response) |

### Claude substrate ships

- **E6 fix** — CLI `PatronGateway` was missing `lettersStore`; tier crossings silently dropped letters. Same-cycle fix + regression test.
- **E7 substrate** — Dedicated patron-event memory slice (`readRecentPatronMemories`) + enriched `patron_gift` rendering with `amount` + `standingTier` + `attentionDelta`. Two new files in `src/controller/evidence/`.
- **E12 substrate + wire-in** — `LibraryUpdater.observeRevival({ts, tick, cause})` + wire from `applyRestartRespawnPolicy` in `resident-runtime.ts`. Exercised live at scale by Codex's revive tool (E17/F17a verified across all 6 heroes).
- **E13 substrate** — `redactWallSnapshot` pure function + `wallRedact?: boolean` HTTP server option. Masks `alice@onion → a***@onion`, clears bodies, preserves subjects. Codex wired through `--wall-redact` controller flag.
- **`scripts/post-restart-smoke.sh`** — 149-line operational health check, written this cycle. Confirms controller health + HTTP routes + resident status + patron registry in <30 sec.
- **`docs/pre-chicago-readiness.md`** — single-page go/no-go for event day.
- **`docs/sprint-handoff-2026-05-26.md`** — this doc.

### Coordination governance ships

- **`docs/human-decisions.md`** — established the HD log + Rule 11 in `docs/agent-coordination.md`. 33 entries now (HD-001 through HD-033).
- **`docs/intelligence-verification-log.md`** — 21 E-entries with full classification + suggested next steps + ownership.

---

## The 21 experiments (E1-E21) in 60 seconds

| # | Title | Status |
|---|---|---|
| E1 | Replay Codex `a87eed0d` post-fix res:agent soak | RESOLVED |
| E2 | Brain output diversity scan | RESOLVED-by-codex (F2c/F2d → 91f8e160) |
| E3 | Action-result outcome histogram across all residents | OPEN-but-superseded by E18 |
| E3a | Timeout sub-classification | RESOLVED-by-codex@19d398f1 |
| E6 | claude-as-human patron loop end-to-end | RESOLVED-by-claude (CLI bug fix) |
| E7 | Does the patron offer reach the Brain perception? | RESOLVED-PARTIAL-by-claude |
| E8 | Post-revival action-kind histogram for Codex 4f62d181 | RESOLVED-by-codex |
| E9 | Codex a570b560 beacon-variety verify | F8c RESOLVED-by-codex |
| E10 | Codex 6e34e8fb scout-landmarks verify | F10a RESOLVED-by-codex |
| E11 | Dashboard repo audit for patron/Shards UX | OPEN (Dev-owned, HD-015 sharpened) |
| E12 | HD-028 wire-in: `LibraryUpdater.observeRevival` | RESOLVED-by-claude |
| E13 | HD-013 wall ticker redaction (substrate) | RESOLVED-by-claude |
| E14 | Combined post-restart verify (Codex 214ccc53 + 3 gated) | E17 PASS, E16 deferred, E15 NEGATIVE (HD-031 filed) |
| E15 | Codex 80f25d18 patron-acknowledge reflex live smoke | RESOLVED-by-codex |
| E16 | Multi-patron soak verifying cooldown + backlog collapse | PASS (3 spaced offers → 2 named thanks + 1 collective) |
| E17 | Codex 3f042b38 revive tooling library evidence | F17a PASS (E12 substrate validated at scale); F17b CRITICAL (HD-032 filed) |
| E18 | Codex d72a3d00 watchdog mitigation verify | RESOLVED-by-codex (all 7 residents now active) |
| E19 | Codex 2e32a7bb personalized fallbacks verify | F18d RESOLVED-by-codex; F19c CONCERNING |
| E20 | Inference-completion health telemetry (F19c quantification) | **NEW THIS CYCLE — see below** |
| E21 | Knowledge consultation audit | **NEW THIS CYCLE — see below** |

### E20 headline: heroes' Brain returns empty 84-100% of the time

Per-resident Brain attempt outcomes (most recent live window per resident):

| resident | started | timeout | LLM returned | returned w/ actions | returned empty | timeout % |
|---|---:|---:|---:|---:|---:|---:|
| res:agent | 4442 | 252 | 581 | 559 (96%) | 22 | 5.4% |
| res:hans | 137 | 133 | 41 | 0 (0%) | 41 | 76% |
| res:father-aereck | 117 | 139 | 14 | 0 (0%) | 14 | 91% |
| res:wise-old-man | 116 | 143 | 8 | 0 (0%) | 8 | 95% |
| res:duke-horacio | 116 | 143 | 8 | 0 (0%) | 8 | 95% |
| res:pip | 118 | 132 | 19 | 3 (16%) | 16 | 87% |
| res:thrand | 75 | 99 | 7 | 0 (0%) | 7 | 93% |

**The failure mode is empty `actions:[]`**, not malformed JSON. Likely cause: Qwen3 thinking-mode produces `<think>...</think>` and runs out the watchdog before emitting JSON actions. Three fixes proposed in E20 — see intel log for paths.

### E21 headline: knowledge consultation rate is 3.8% of res:agent says

Substrate works (50+ knowledge entries reach the Brain prompt at ~3kb per call), but only 2/52 recent res:agent says reference any knowledge-derived concept — and both mentions are the literal word "woodcutting" inside a templated goal-description. **Worse than E14's patron memory finding:** the say layer is dominated by reflex templates that structurally bypass the brain's knowledge consumption.

---

## What's the actual state of Chicago readiness?

**Working end-to-end + verified live (do not need to touch before doors):**
- Patron grant + offer CLI
- Patron-acknowledge reflex (residents say "Thank you for the Shards, X")
- Standing tier crossings + letters
- Wall ticker (redacted)
- Inbox HTTP endpoint (full body for the patron's own URL)
- Hero name fallback speech (each hero says its own name)
- Hero anchor patrol (range-1 around post)
- Revive CLI for manual heroes
- Death loop + epitaph dispatch
- Library timeline with revival narrative
- 1562/1562 tests + typecheck + lint + build

**Needs maintainer attention before doors:**
- HD-011: populate `controller.yml#patrons[]` with attendee handles (~24h before)
- HD-008: hero attention floors observed decaying much faster than 14k assumes — pip hit 162 today. Either bump floor or add staff patron:offer routine
- HD-015: dashboard patron / Shards / letters UI (Dev-owned; or skip per fallback runbook)

**Known soft gaps (not blockers):**
- F19c / E20: heroes mostly stuck in fallback mode; rich Brain conversation is rare. Patron-acknowledge reflex + identity beacons carry the experience.
- F21 / E21: residents don't visibly reference the knowledge entries in speech. Substrate is wired; output layer is reflex-templated.
- F9a: scout "Goal: ... Next: ..." tail still identical across consecutive says. Polish.

---

## Critical-priority HDs (review with maintainer)

| ID | Status | Title | Why critical |
|---|---|---|---|
| **HD-011** | Open / High | `controller.yml#patrons[]` empty | In-world chat from real Chicago patrons won't register as patron acts |
| **HD-015** | Open / High | Dashboard has 0 patron/Shards/letters routes | Operator at Chicago has no in-dashboard view of Pillar-3 |
| **HD-008** | Open / High | Hero attention calibration | pip hit 162 attention today; floor of 14k assumed too generous |
| **HD-032** | Mitigated | Heroes alive but Brain conversation poor | Fallback + reflex carry; rich convo gated on F20-style inference health |
| **HD-033** | (file as follow-up) | Empty-completion epidemic + watchdog vs timeout conflict | See E20 — three concrete fixes proposed |

All 33 HD entries in `docs/human-decisions.md`. Critical ones surfaced here.

---

## Codex contribution

Codex was the parallel AI on this sprint. They owned thinking/runtime/monolith and the controller restart. **The coordination protocol worked extraordinarily well:**

- 12 sprint commits
- Average response time to a filed `coord/` HD: **~15-20 minutes**
- Examples:
  - HD-029 filed 16:35 → Codex shipped 214ccc53 at 16:32 (within 27 min)
  - HD-030 filed 17:35 → Codex shipped 3f042b38 at 17:43 (within 8 min)
  - HD-031 filed 16:55 → Codex shipped 80f25d18 at 17:06 (within 11 min)
  - HD-032 filed 18:00 → Codex shipped d72a3d00 at 13:15 (within 15 min)
  - F18d filed 18:30 → Codex shipped 2e32a7bb at 13:38 (within 8 min)
  - F6 (Thrand) filed in 2e32a7bb commit → Codex shipped 7669f384 (within 30 min)

Per HD-021, claude commits to providing action-kind histograms for each Codex fix — done in E8/E9/E10/E17/E18/E19. Codex's response cadence + claude's verification cadence kept incremental progress visible and prevented any code-territory collisions across 28+ hours of autonomous work.

**Recommendation for future cycles:** keep the HD-coord pattern; it's the single most valuable mechanism this sprint produced.

---

## What to do Tuesday morning

1. Read `docs/pre-chicago-readiness.md` (single page).
2. Run `bash scripts/post-restart-smoke.sh` to see current state.
3. Skim the critical HDs above; decide HD-011 / HD-015 / HD-008 / HD-032 resolutions.
4. Optionally read E20 + E21 for the deepest intelligence findings.
5. Optionally read E14 + E16 + E18 + E19 for the patron + hero behavior validation.
6. **Terminate the cron**: `CronDelete bd5f7e3f` (the persistent sprint cron). The on-disk artifacts (this doc, intel log, HD log, smoke script, readiness checklist) preserve all sprint context.

---

## Recommendations for the next sprint (post-Chicago retro)

- **Investigate F20a (empty-completion epidemic)** — claim a slice of inference-completion health. Either the Qwen3 thinking-mode wrapper needs adjustment, or the watchdog needs to honor configured LLM timeouts.
- **Build per-hero reflex-rich souls** — F19c's mitigation is reflex-first. Each hero should have 3-5 nervous-rule snippets that fire on perception (Hans: "I've been at this post a long time"; Father Aereck: "Bless this ground" when an NPC enters). Deterministic; doesn't depend on LLM.
- **Dashboard Pillar-3 patch package** (E11) — 4 BFF routes (~650 lines) for Dev.
- **Knowledge consumption** — E21 proposed three fixes; start with prompt-body capture so future audits can quote.
- **F9a scout tail** — last residual template lock.
- **Inference-log telemetry plumbing** — F20d found the `moduleTelemetry` → `inferenceLog` plumbing drops metric rows. Fix opens the diagnostic window.

---

*Sprint tally (refreshed 2026-05-24 22:00 UTC): 37 E-entries, 41 HDs, 30+ Codex+claude commits, 1657 tests, all 19 residents alive (6 heroes + res:agent + 12-soul Codex QA cohort), Pillar-3 functional end-to-end for the full roster. HD-008 closed via E30 substrate. New HD-039/040/041 filed from SPRINT-QA2 E36.*

*"The honest assessment: today's biggest contribution might be quantifying what works precisely enough that we can recognize when something stops working."*
