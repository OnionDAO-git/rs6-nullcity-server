# Human Decision Log

Track choices that James or OnionDAO need to make. Do not keep them only in chat.

## Decision Rules

- **Critical** means the current task cannot continue without an answer, or continuing risks secrets, data loss, irreversible public API churn, or broken launch commitments.
- **Open** means useful to decide later, but agents should keep building with the listed default assumption.
- **Decided** means use the recorded answer until James or OnionDAO changes it.
- If a decision becomes critical, mark the related roadmap task `[!]` and write the exact blocker there.
- Until **June 1, 2026**, OnionDAO work is pre-launch development. Prefer fast local progress with good design over Railgun hardening or secure third-party module infrastructure unless those concerns directly block the task.

## Current Decisions

| ID | Status | Priority | Decision Needed | Default Assumption Until Answered |
| --- | --- | --- | --- | --- |
| HD-001 | Decided | Normal | How should agents balance speed vs Railgun/security work before OnionDAO starts? | Before June 1, 2026, optimize for fast local development and good design. Track Railgun/security questions, but do not let them block gameplay, dashboard, benchmark, or SPARK module progress unless they become critical. |
| HD-002 | Open | Normal | What exact Railgun topology will OnionDAO use? Gateway URL/path, dashboard URL, secret names, persistent volume paths, and artifact/log sink are still unknown. | Keep Railgun docs as templates. Do not block local controller/dashboard work on this. |
| HD-003 | Open | Normal | Are OnionDAO member-authored modules allowed now if PR-reviewed in-repo, or blocked until the public safe module contract is fully wired? | Treat reviewed in-repo modules as allowed for dev experiments. Do not load arbitrary code from SOUL, memory, packages, or remote URLs. |
| HD-004 | Open | Normal | Should SPARK module distribution stay bundled in the controller build, or eventually use pinned artifact/digest modules? | Keep modules bundled in the controller build. Design APIs so pinned artifacts could be added later. |
| HD-005 | Open | Normal | When do multi-controller Railgun deployments need `external-store` instead of per-instance JSONL suggestion files? | Use local JSONL/persistent-volume suggestion files for dev and single-controller runs. Revisit before multi-controller Railgun deployment. |
| HD-006 | Open | Normal | Which model/provider profile should be the default for long-running agent experiments? | Use the current configured local/nullcity inference endpoint unless the task explicitly needs another model. |
| HD-007 | Open | High | Should `RuntimeState.deceased` persist across controller restart, or clear so the resident "reincarnates"? Live obs found 4 epitaphs for `res:agent` with different `livedTicks` because restart re-spawns the deceased. See `docs/live-verification-2026-05-24.md` § Findings #2 + commit `0b9007f4`. | Heroes stay dead across restart (narrative integrity); dev residents (`res:agent`, `res:pip`, `res:thrand`) keep restart-resurrection. Suggested impl: optional `respawnPolicy: 'on_restart' \| 'manual' \| 'never'` per-soul; heroes default `'manual'`. |
| HD-008 | Open | High | Right calibration for hero `startingAttention`? Original 6k-8k caused mass-die in unattended overnight session; bumped to 14k as emergency floor. See `docs/live-verification-2026-05-24.md` + commit `0b9007f4`. | 14000 per hero soul AND a controller-level safety floor `MIN_HERO_ATTENTION_FLOOR=10000` applied at load that overrides lower soul values. Maintainer can drop floor / per-soul when calibration data exists. |
| HD-009 | Open | High | Who triggers squash-merge `agents/wip` → `nullcity`, with whose review? `agents/wip` is ~160 commits ahead; one mid-weekend merge (`52a5db38`); the Rule-3 48h cadence floor has fired multiple times without action because AI agents feel presumptuous merging 160 commits of multi-author work. | Maintainer (James) cuts release tags on `nullcity` manually. Drop the AI-driven cadence floor in `docs/agent-coordination.md` § Rule 3 if confirmed. |
| HD-010 | Open | High | Cron prompt header is stale: says `BRANCH: nullcity (push directly)` when actual rule is `agents/wip`; says `DO NOT PICK J/K/L/M/N` when the entire weekend has been J/K/L/M/N work per maintainer override. New cron `8844838f` (in-memory session-only) has refocused text; persistent cron likely still stale. | Refresh whatever persistent cron exists; replacement text in `docs/strategic-review-2026-05-23-pm.md` § "Recommendations to the maintainer". Until then, AI agents bootstrap-correct via `docs/agent-coordination.md`. |
| HD-011 | Open | High | Who populates `controller.yml`'s `patrons:` block with real attendee badges before doors? Currently empty. Without it, in-game chat from real patrons doesn't register as patron acts even if the speaker's name matches a known badge. EVENT-D3 reception greeting depends on this. | Event-staff onboarding step ~24h before doors writes `data/controller/event-patrons.yml` (or extends `controller.yml`) with the attendee list. Add to `docs/embassy-staff-runbook.md` pre-event checklist. |
| HD-012 | Open | Normal | Sibling-flagship sender policy for hero deaths: which surviving hero "speaks for" a deceased hero in the epitaph letter? `buildEpitaphDispatchRequests({senderResident})` accepts the override; nothing populates it. Currently always uses the deceased themselves. | Add `siblings: [res:hans, res:duke-horacio]` to hero soul frontmatter; pick first living sibling at death-time. Order = explicit narrative network. |
| HD-013 | Open | Normal | `/v1/wall/snapshot` auth/redaction posture at event: currently surfaces full letter `body` + `recipient` on the wall ticker. Epitaph bodies have emotional content; patrons may consider their inbox semi-private. | Wall endpoint shows only `kind` + `subject` + redacted recipient (`a***@onion`). Full body only via `/v1/inbox` (patron's own URL). Implement as a `wallRedact: true` flag on `LettersHttpServerOptions`. |
| HD-014 | Open | Normal | Lanyard-card print automation: build a `print-queue.jsonl` + CUPS bridge, or stay with browser-Cmd-P at the event? Lanyard channel currently has no automated dispatch. | Browser-Cmd-P for event 1 per runbook. Build print-queue automation as a post-event-1 polish if staff feedback shows real friction. |
| HD-015 | Open | Normal | Which dashboard fields most matter for event-day operators? Dashboard repo is `../rs6-nullcity-residents-dashboard` (Dev-owned). Pillar-3 fields the dashboard does not yet surface: per-hero attention curve + decay slope, recent-letters feed, deceased-today counter, embassy event-active flag, patron leaderboard. | File a single GitHub issue on the dashboard repo with this list; let Dev prioritize. Claude has not audited the dashboard repo yet. |
| HD-016 | Open | High | Shards UX priority: which non-CLI patron verb ships first? Substrate exists for `sponsorBirth`, `sendGift`, `witnessAt` but none are exposed beyond `patron:grant`/`patron:offer` CLI. | C/D first (balance lookup + standing-tier visibility — self-service, low-stakes). B next (`sendGift` — tangible, observable in-world). A last (`sponsorBirth` — complex, high-engagement). Never E (Shard transfer between patrons — creates gray market). |
| HD-017 | Open | Normal | Build N-β reception clerk NPC (engine plugin) before event 1, or rely on EVENT-D3 greeting reflex via existing hero souls? | Skip N-β for event 1. Hero greeting reflex carries the experience; re-evaluate based on event-1 staff/patron feedback. |
| HD-018 | Open | High | EVENT-D3 reception greeting wire (~30 line runtime hook): when does it actually land? Blocked all weekend by Codex's `resident-runtime.ts` QA-hour-humanlike WIP. Substrate at `b38b937e`; wiring template in `docs/next-week-handoff-2026-05-26.md` § Slice 1. | Next cycle in which `git status` shows `resident-runtime.ts` clean. Whichever agent (claude/codex/antigravity) hits that window lands it. |

## How To Add A Decision

Append a row with:

- a stable `HD-###` id
- status: `Open`, `Critical`, or `Decided`
- priority: `Critical`, `High`, `Normal`, or `Low`
- a concrete question
- the default assumption agents should use meanwhile

Keep this file short. Move long rationale into specs or task docs and link it from the row when needed.
