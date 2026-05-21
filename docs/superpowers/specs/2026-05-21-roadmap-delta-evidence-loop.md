# Roadmap Delta — Evidence Layer And Library Of Souls

**Date:** 2026-05-21.
**Purpose:** Patch additions to `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`. **Do not apply yet.** The roadmap file currently has uncommitted edits on the `nullcity` branch (Codex). Apply this delta after Codex's `combat-prayer-10m` work merges.

**How to apply:** open the roadmap file, find the markers below, and insert the indicated sections. Then resolve any whitespace conflicts and run `npm run lint:fix` over the file.

---

## Patch 1 — Add Workstream I to the workstream list

**Anchor:** end of file, after `## Workstream H: Railgun And OnionDAO Operations` section.

**Insert before** `## Recently Completed`:

```markdown
## Workstream I: Evidence Layer And Library Of Souls

**Purpose:** Give SPARK an objective record of every resident's life — perception, decision, action, outcome — so the kernel can detect stalls, humans can read residents' stories, and benchmarks become reproducible. Adopts five RuneBench conventions (see `docs/runebench-conventions-adopted.md`). Spec: `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md`.

- `[~]` **I1: Build the Evidence foundation (P1).**
  - Files: `src/controller/evidence/evidence-store.ts`, `src/controller/evidence/trajectory-builder.ts`, `src/controller/evidence/progress-tracker.ts`, `src/controller/evidence/mock-perception.ts`, `src/controller/evidence/schemas.ts`, plus tests.
  - Touches: `src/controller/spark/spark.ts` (scope-guard `endTick` discipline + 7 insertion points), `src/controller/resident-runtime.ts` (instantiate `EvidenceStore` per resident, wire `onAckReady + onEffectResolved` callback), `src/controller/actions/action-coordinator.ts` (add `onAckReady + onEffectResolved` callback to `ActionCoordinatorSubmitInput`), `src/controller/memory/runtime-state.ts` or equivalent (`lastMeaningfulProgressAt`, `stuckSince` fields), `src/controller/logging/inference-log.ts` (add `promptHash`, `completionHash`), `src/controller/spark/module-context.ts` (expose new RuntimeState fields through facade snapshot).
  - Deliverable: `trajectory.jsonl` and `progress.jsonl` written per resident per session; `MockPerceptionAdapter` enables SPARK kernel tests without a RuneJS server; `lastMeaningfulProgressAt` and `stuckSince` surface on `RuntimeState` and through the read-only state facade; `ActionCoordinator.submit()` accepts and invokes an `onAckReady + onEffectResolved` callback; inference log lines carry `promptHash`+`completionHash`.
  - Verification: focused unit tests; integration test with mock perception adapter; trajectory+progress files non-empty after `make-fire-5m` autonomous smoke; existing benchmarks (`make-fire-5m`, `woodcutting-firemaking-10m`, `starter-fishing-5m`, `explore-report-5m`, `follow-and-chat-5m`) continue to pass with no behavior change.

- `[~]` **I2: Add verifier conventions (P3).**
  - Files: `src/controller/benchmarks/verifier-conventions.ts` + tests.
  - Deliverable: every benchmark emits `reward.json`, `reward.txt`, stdout `__REWARD_JSON_START__...__REWARD_JSON_END__` markers, and `failure_reason: 'none' | 'timeout' | 'exception' | 'goal_not_met' | 'died' | 'budget_exhausted' | 'kernel_aborted' | 'unknown'`. Benchmark output dir also receives a copy of the per-run `evidence/` files.
  - Gate: P1 stability check (one clean run of `make-fire-5m` and `woodcutting-firemaking-10m` with zero Evidence Layer errors) runs before P3 regression to separate P3 changes from P1 noise.
  - Verification: unit tests for each emission format; regression run of these specific benchmarks shows unchanged pass/fail and new fields present: `make-fire-5m`, `woodcutting-firemaking-10m`, `starter-fishing-5m`, `explore-report-5m`, `follow-and-chat-5m`, and (once Codex merges) `combat-prayer-10m`.

- `[~]` **I3: Build the Library of Souls (P2).**
  - Files: `src/controller/evidence/library-updater.ts`, `src/controller/evidence/significance.ts`, `src/controller/evidence/portrait-template.ts`, `src/controller/evidence/patron-events.ts` + tests.
  - Touches: `src/controller/spark/legacy-tracker.ts` (extend `LegacyUpdate` with `legacyProgress` payload).
  - Deliverable: per-resident `library/<resident>/portrait.md`, `portrait.json`, `timeline.jsonl`, and `index.json`. Two-lane significance (story vs. diagnostic); verbatim `say` capture; per-life chapter structure with template-generated epithets; `## Patrons` section accepting `patron_gift`/`patron_witness`/`patron_sponsor` events; `## In their own words` with 5–12 verbatim quotes; "last words" tagged per death.
  - Verification: significance unit tests; portrait.json structural-marker snapshot test (epithet, quote count, named peer, unfulfilled wants); portrait.md section-header snapshot; live smoke checklist (name, epithet, quotes, peer, want, "How it ended", "Patrons" section).

- `[ ]` **I4: Adopt TOML task manifests.**
  - Files: `benchmarks/manifest.toml` (new), updates to benchmark CLI to read it.
  - Deliverable: SPARK benchmark tasks listed with name + content-hash + version; runs reference manifest entries by name.
  - Verification: manifest schema unit test; CLI dry-run accepts `--task` by name and resolves via manifest.
  - Note: low priority; ship when a leaderboard view is being built.

- `[ ]` **I5: Adopt unified pricing.**
  - Files: `src/controller/pricing/model-pricing.ts` (new), extraction-time backfill into inference logs.
  - Deliverable: per-profile input/cache/output token costs; cost-per-resident-life surfaced in `portrait.json`.
  - Verification: pricing schema unit test; portrait snapshot includes cost field when pricing data is available.
  - Note: small slice; ship independently when convenient.

## Workstream J: Patron / Human-Attention Loop

**Purpose:** Give Runescape players a reason to care about residents — attention spending, mercy infusion, letters, credit surfaces, standing tiers, visitor-birth ritual. Adapted from v2 main canon with rs6-specific in-world surfaces. Detailed rationale and item provenance in `docs/null-city-ideation-backlog.md` Theme 4.

- `[ ]` **J1: Resident attention as the universal clock.** Decay per tick; refill via human spending. Currency name + decay rate pinned in rs6.
- `[ ]` **J2: Mercy infusion / refill verb.** In-game interaction (e.g., "pray for", "offer to") at resident chathead → +N attention for M Shards.
- `[ ]` **J3: Standing tier system.** Four-tier rs6 reputation (acquaintance/ally/officer at canonical 10/30/75 thresholds, rs6 names TBD).
- `[ ]` **J4: Letters system.** Four kinds (`standing | epitaph | civic | broadcast`). In-game delivery (scroll/postbag) + web inbox parity. Denormalised sender snapshot.
- `[ ]` **J5: Credit surfaces.** "Funded by / founded by / witnessed by" signs near landmarks; founder names on plaques.
- `[ ]` **J6: Visitor-born resident ritual.** Three-part cost (renamed for rs6) totaling 24 Shards + 24h cooldown per Handler.
- `[ ]` **J7: Daily check-in + referral Shard drips.** +1 daily, +2 referral via staff scan.
- `[ ]` **J8: Patron event ingestion.** Wire OnionDAO Shards flow / staff attestation / dashboard human attestation to emit `patron_*` events into the Evidence Layer (consumer side is `[I3]`).

## Workstream K: Factions Adapted For Runescape

**Purpose:** rs6 needs its own four factions; v2's Solder Saints / Hatchery / Locksmiths / Ledgerwrights are Onion-DAO-flavored and don't translate. The *shape* of v2's faction design (four factions, two tension axes, named flagships, home rooms, motto/color/visual) transfers. Backlog Theme 5.

- `[ ]` **K1: Name the four rs6 factions.** With mottos, colors, home POIs.
- `[ ]` **K2: Define the two rs6 tension axes.** Analog of v2's body-vs-mind and secrets-vs-receipts.
- `[ ]` **K3: Seed four flagship NPCs.** ~30-day lifespan, full soul fields, idempotent seed (mirrors v2's `seed.ts` pattern).
- `[ ]` **K4: Place the five rs6 rooms.** Four faction homes + one neutral atrium. Every `say` line carries a `room` field.
- `[ ]` **K5: Pick a "redacted" visual treatment for the secrets faction.** Fog-of-war or hidden parcels.

## Workstream L: Cross-Resident Memory & Lore

**Purpose:** Residents that affect each other beyond independent action. Largely unmined in v2. Backlog Theme 7.

- `[ ]` **L1: `interact_resident` action.** Verbs: `whisper`, `gift`, `assist_skill`, `challenge_duel`. Typed action catalog entries with preconditions.
- `[ ]` **L2: Resident-owned projects.** Long-running funded artifacts (shop, citadel room, herb patch). Picks three project archetypes for rs6 MVP.
- `[ ]` **L3: `world_events` table or broadcast channel.** A shared data surface; ambient utterances propagate to adjacent rooms.
- `[ ]` **L4: Resident-perceived in-game events.** Player-level-ups, PKs, quest completions, faction territory shifts in the perception envelope.

## Workstream M: Hero Residents & Story Arcs

**Purpose:** Named residents who become event focal points. Backlog Theme 8.

- `[ ]` **M1: Hero story-arc shape.** Pitch → fund → progress → resolve → letter. Resolution event template + faction effect.
- `[ ]` **M2: Lifespan tiers.** Flagships ~30 days, visitor-born ~24 hours. Asymmetry is intentional.
- `[ ]` **M3: `request_attention` action.** Hero NPC dialog or in-world begging surface; can also dispatch a letter to a recent patron.
- `[ ]` **M4: `prepare_epitaph` action.** When `lifespanTicks < threshold`, hero spends a tick writing its own epitaph, which overrides the templated one at death.
- `[ ]` **M5: `trade_resource` action.** Hero proactively offers a resource to a patron who's neglected them.
- `[ ]` **M6: Hero-as-resource-gatherer at faction-controlled landmarks.** Heroes skill-train at rs6 zones; output → faction stockpile.

## Workstream N: Physical Event & Embassy

**Purpose:** IRL June 1 surfaces. Most owned by Dev (dashboard) or shared with v2 (staff scanner, print queue), but rs6 needs its own placement decisions. Backlog Theme 9.

- `[ ]` **N1: Pick the rs6 embassy POI.** In-game location for handler interaction, ritual redemption, standing display.
- `[ ]` **N2: Wall map rs6 projection.** Coordinate with Dev — rs6 events feed the v2 wall ticker, OR rs6 gets its own wall view.
- `[ ]` **N3: In-game graveyard zone.** Tombstones examinable for name/faction/epitaph/cause/ticks-lived. Mirror on dashboard library page.
- `[ ]` **N4: IRL graveyard wall.** Printed epitaphs at the embassy; refresh cadence + printing pipeline.
- `[ ]` **N5: Mortician's Ribbon.** Civic achievement for humans witnessing N resident deaths (N TBD). In-game cape/title + lanyard variant.

## Workstream O: Engineering & Tooling Polish

**Purpose:** Reusable infrastructure patterns from v2 and RuneBench that don't fit in other workstreams. Backlog Theme 11.

- `[ ]` **O1: Tick worker discipline.** Graceful SIGTERM, per-tick stats log line, `status='alive'` guard on decrement UPDATE.
- `[ ]` **O2: Shard + attention ledger discipline.** Append-only ledgers with denormalised balance caches updated in same tx.
- `[ ]` **O3: Static catalog in code audit.** Confirm rs6 factions/resources/achievements/rooms/emotions live in typed catalogs, not DB rows.
- `[ ]` **O4: Real-completion inference health check.** Health endpoint exercises a real LLM call, not just connect.
- `[ ]` **O5: Layered Docker base image (RuneBench convention 11).** Pre-cache engine + deps to cut per-iteration build time.
- `[ ]` **O6: GitHub Pages auto-deploy from result JSON (RuneBench convention 12).** Static site rebuilt when results change.
- `[ ]` **O7: `MODEL_CONFIG`-style precomputed UI metadata dictionary (RuneBench convention 14).** Single source for module IDs, faction colors, emotion presets.
- `[ ]` **O8: env + CLI dual config audit (RuneBench convention 17).** Document conventions and apply across rs6 CLIs.
```

---

## Patch 2 — Update Workstream C reference

**Anchor:** in `## Workstream C: Benchmark Harness`, after the `C7` task block.

**Insert** a short cross-reference note:

```markdown

**Note:** New benchmark output conventions (3-tier reward, failure taxonomy) are tracked in Workstream I as `[I2]` rather than amending each task here. Existing tasks continue to produce the current artifact; `[I2]` adds new outputs alongside.
```

---

## Patch 3 — Update Workstream D reference

**Anchor:** in `## Workstream D: Dashboard Debugging`, after the `D4` task block.

**Insert** a short cross-reference note:

```markdown

**Note:** Dashboard pages `[D2]/[D3]/[D4]` will read `portrait.json`, `timeline.jsonl`, and `reward.json` produced by Workstream I once `[I1]` and `[I3]` ship. The portrait and timeline schemas are documented in `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` and follow the cross-repo contract policy in `docs/agent-coordination.md`.
```

---

## Patch 4 — Update "Immediate Recommended Next Slice"

**Anchor:** `## Immediate Recommended Next Slice`.

**Append** to the bullet list:

```markdown
- `[~]` Workstream I evidence loop: ship `[I1]` first (unlocks mock-perception adapter for fast SPARK iteration), then `[I2]` (low risk, enables dashboard leaderboard later), then `[I3]` (highest emotional payoff for June 1).
```

---

## Patch 5 — Reference RuneBench conventions doc

**Anchor:** top of file, in the "Architecture" paragraph that says "Reviewed SPARK modules provide RuneScape thinking, workflows, knowledge, benchmarks, and experiments through explicit capability seams."

**Append a sentence** to that paragraph:

```markdown
RuneBench-derived conventions adopted across workstreams are cataloged in `docs/runebench-conventions-adopted.md`.
```

---

## Apply Order

1. Wait for Codex to merge the `nullcity` branch with `[C4]` complete.
2. `git pull` on a fresh branch.
3. Apply patches 1–5 in order.
4. Run `npm run lint:fix` over the roadmap file.
5. Mark `[I1]` `[>]` before starting plan P1 implementation.
6. Commit with message: `Add Workstream I (Evidence Layer & Library of Souls) to roadmap`.

## Open Questions To Resolve Before Applying

- Does Codex's in-flight `[C4]` work introduce conventions that affect `[I2]`? Likely no, but inspect the merged `combat-prayer-10m` artifact format and reconcile if needed.
- Should the Library of Souls have a separate Workstream J for downstream emotional/UX work (Library readers, ceremonial pages, faction integration)? Probably yes, but defer until `[I3]` ships and we see how the artifact reads in practice.
