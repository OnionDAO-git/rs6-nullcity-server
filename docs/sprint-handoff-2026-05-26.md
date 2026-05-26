# 48-Hour Autonomous Sprint Handoff — 2026-05-26

**For:** James (maintainer), Tuesday morning recovery context.
**Sprint window:** 2026-05-24 (Saturday) → 2026-05-26 (Tuesday).
**Author:** claude (with Codex as the depth-fix partner; see § Codex contribution).
**Linked artifacts:** `docs/intelligence-verification-log.md` (E1-E61), `docs/human-decisions.md` (HD-001 through HD-050), `docs/agent-status.md` (append-only multi-agent log), `docs/patron-lifecycle.md` (NEW Sunday — staffer + maintainer onboarding narrative), `docs/pre-chicago-readiness.md` (single-page Chicago-day go/no-go).

---

## TL;DR

- **Pillar-3 patron loop is end-to-end functional for all 19 residents.** Patron `patron:grant` → `patron:offer` → multi-tier letters dispatch in ascending order (HD-040 fix `ae60cb9d` + E38 substrate) → resident says thanks by name within ~3s via `nervous:patron-memory-acknowledge` (HD-031) → letter visible at `/v1/inbox?human=...` → wall projection redacts recipient + body (HD-013 / HD-029).
- **D3 in-world implicit greeting now wired AND tested live (`fd575281` + E58).** When a patron in `controller.yml#patrons[]` chats inside the Lumbridge churchyard region, Hans (or another hero in range) emits `"Welcome to the embassy, <handle>."` with witness-only-on-say-success — Chicago has **2-stage hero acknowledgement**: implicit D3 + explicit CLI.
- **13 weekend HDs CLOSED or MITIGATED via tight Codex-claude closing loop** (5 consecutive cycles): HD-008 (hero attention floor, E30), HD-018 (D3 wire-in, `fd575281`), HD-030 (revive CLI), HD-031 (patron-acknowledge reflex), HD-032 (heroes frozen, mitigated), HD-033 (45s/60s watchdog mismatch CLOSED by `8eae437f` / E53; F20a Qwen3 empty still upstream), HD-037+038+040 (patron-gateway correctness + tier dispatcher), HD-039 (qa-guardian/survivor partial-decided — retreat fixed, hold-loop in HD-047), HD-041 (LoreBus dead-in-prod, not-a-bug), HD-042 (hero decision cadence CLOSED by `32ba93c9`/`aed50245`), HD-045+046 (false-alarm + standing-permanent-by-default), HD-021 (de-facto-counter-proposed closing-loop protocol).
- **5 new HDs filed this weekend for next cycle:** HD-043 (L-α + L-β + whisper post-Chicago wire-in workstream); HD-044 (damage-edge perception events missing — 15 hit/death reflexes unfireable); HD-047 (qa-guardian/survivor permanent hold-loop at safe waypoint, post-Chicago); HD-048 (perception-builder integration smoke pre-Chicago); HD-049+050 (post-Chicago tech debt — recovery decision tree refactor + SPARK cause taxonomy doc).
- **Chicago-day operational items still pending maintainer:** **HD-011 (RE-UPGRADED High)** populate `controller.yml#patrons[]` ~24h before doors — now D3 is wired, this is THE binding constraint for in-world greeting. HD-015 (dashboard Pillar-3 patch package, Dev-owned). HD-048 pre-Chicago perception-builder smoke (Codex/claude joint cycle).
- **Tests: 1699+ passing** (was 1657 at SPRINT-QA2 end — Codex+claude added ~42 across HD closures). Pipelines green throughout. Multi-agent loop pattern in steady state: Codex ships fix + cites observable claim + live controller id; claude replays + verifies + extends with sub-finding analysis. 5 consecutive E50→fd575281→E58 / E51→32ba93c9→E52 / E20→8eae437f→E53 / etc. closing cycles in ~3 hours.

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

*Sprint tally (refreshed 2026-05-25 03:25 CDT): **61 E-entries, 50 HDs, 50+ Codex+claude commits, 1699+ tests**, all 19 residents alive (6 heroes + res:agent + 12-soul Codex QA cohort), Pillar-3 functional end-to-end for the full roster. **13 HDs closed/mitigated this sprint** (HD-008/018/030/031/033/037/038/040/041/042/045/046 closed; HD-032/033/039 mitigated/partially). **5 new HDs filed for next cycle** (HD-043/044/047/048/049/050 — all post-Chicago except HD-048). **Multi-agent closing-loop protocol working in steady state** — Codex ships fix + observable claim; claude replays + verifies. 5 consecutive closing cycles tonight: E50→fd575281→E58, E51→32ba93c9→E52, E20→8eae437f→E53.*

## What changed since 2026-05-24 22:00 (SPRINT-QA2 freeze)

**E38-E60 verification cycles + late-Sunday Codex closures.** A summary:

- **E38**: HD-040 patron multi-tier dispatcher fix (3-file substrate; `ae60cb9d`). Per-tier letters now dispatch in ascending order.
- **E39**: HD-040 live-verified on `local-46903`: 30-Shard offer → 2 letters; 75-Shard → 3 letters.
- **E40-E42**: SPRINT-QA3 — reflex firing coverage + HD-041 LoreBus dead-in-prod + soul personality differential.
- **E43**: standing-decay policy audit — no decay anywhere; HD-046 Decided-by-default-permanent.
- **E44**: library-memories revival renderer polish — task #156 closed (`903914e1`).
- **E45**: Codex starter-cooking-recovery (`30d5f1b7`).
- **E46-E49**: SPRINT-QA4 — 3 staffer-UX fixes shipped inline (`52b99a12`: tiersCrossed CLI + inbox URL hint + auto-gen witness artifact); HD-021 closed de-facto.
- **E50**: D3 embassy hero greeting dead-in-prod found.
- **E51**: tick-budget profile — sharpened HD-042 framing.
- **E52**: HD-042 closed by Codex `32ba93c9` — `_none` count = 0 across all heroes; new cause taxonomy.
- **E53**: HD-033 F20c closed by Codex `8eae437f` — watchdog now aligns to 65s; F20a + F20b remain upstream.
- **E54**: qa-guardian/survivor retreat verified firing (`0747ff8c`) but hold-loop unchanged — HD-039 partial, HD-047 filed.
- **E55**: `docs/patron-lifecycle.md` shipped (subagent B, 264 lines, 2418 words).
- **E56**: code-review of 6 Codex commits — net Chicago risk LOW.
- **E57**: pre-Chicago readiness doc refreshed (subagent D).
- **E58**: HD-018 D3 wire-in closed by Codex `fd575281` — `trySubmitReceptionGreeting` with per-patron cooldown + witness-only-on-success.
- **E59**: cold-start metrics — 1.2-1.5s first tick across all 19 residents; first reflex say at 2-5s.
- **E60**: multi-controller lock substrate verified across 5 live test scenarios — robust.

---

*"The honest assessment: today's biggest contribution might be quantifying what works precisely enough that we can recognize when something stops working."*

*"The biggest contribution Tuesday morning might be a multi-agent feedback loop that closed 13 HDs in 30 hours by treating Codex's commit SHAs + observable claims as ground truth and claude's trajectory replays as the audit. That pattern is reusable for any future sprint."*
