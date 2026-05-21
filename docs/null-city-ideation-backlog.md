# Null City Runescape — Ideation Backlog

**Date:** 2026-05-21.
**Purpose:** A structured inventory of every promising idea from Null City v1, v2, RuneBench, and this session's brainstorm — so they don't decay into markdown bit-rot. Items here are *candidates* for the roadmap, not committed work; promote into the roadmap when ready to plan.

**Provenance keys:**
- `[v1]` — Null City v1 design notes (private; held outside this repo). Lineage from the Kubernetes-native worldbox.
- `[v2-main]` — the `nullv2` repo main branch (shipped event MVP).
- `[v2-context]` — `nullv2` `context` branch docs.
- `[v2-econ]` — `nullv2` `design/autonomy-economy` branch.
- `[rb]` — `MaxBittker/RuneBench` reference implementation.
- `[rs6]` — this repo's existing code/docs.

**Status keys:**
- `DONE` — implemented in rs6.
- `PARTIAL` — exists but unfinished or under-spec.
- `SPECC'D` — covered in an active spec (e.g., evidence loop spec).
- `OPEN` — not started; this backlog is the only mention.
- `DROP` — deliberately not porting.

---

## Theme 1 — Autonomy & Needs

The heartbeat that makes residents feel alive: perceive → evaluate needs → choose constrained action → execute → write memory → surface consequences.

- **SPARK perception-desire-action loop, rs6-flavored** — Source: `[v1]` Spark/Autonomy section, `[v2-main]` `packages/types/src/spark.ts`. Status: PARTIAL (kernel exists, needs not modelled). RS adaptation: map four needs to rs6-relevant pressures — `hunger → upkeep/fatigue`, `safety → PK or HP risk`, `social → no recent chat`, `purpose → quest log idle / no XP recently`. Compute SPARK snapshot once per tick; feed into prompt. Next step: define the rs6 SPARK-needs input contract.

- **Constrained legal action set as a typed catalog** — Source: `[v1]` action set + `[v2-econ]` "Hero Campaign Choice Contract". Status: PARTIAL (`AgentAction` exists, no enumeration of legal preconditions). RS adaptation: enumerate `train_skill`, `bank_deposit`, `cast_spell`, `whisper_player`, `walk_to`, `attack_npc`, `pray`, `prepare_epitaph`, `request_attention`, `interact_resident`. Each action specifies preconditions (e.g., level cap, item required, attention floor). Next step: write `src/controller/actions/action-catalog.ts` mirroring v2's typed-catalog pattern.

- **Refusal-with-coded-reason** — Source: `[v2-econ]`. Status: OPEN. RS adaptation: heroes can refuse an action but must cite a coded reason — `wilderness_value_cap`, `prayer_pts_zero`, `slayer_lock`, `combat_lvl_under`, `quest_prereq_missing`. Refusal text generated, reason coded. Next step: enumerate the refusal-reason set.

- **Ambient speak probability driven by agitation** — Source: `[v2-main]` README "Ambient (shout)". Formula `0.1 + agitation/200` clamped, `maxPerTick=8`. Status: OPEN. RS adaptation: ambient = public chat in a Lumbridge/Varrock square or clan chat. Same per-tick cap. Next step: port the formula + cap.

- **Agitation histogram in tick logs** — Source: `[v2-main]` README. One log line per tick: `processed deaths errors ambient agitation_histogram`. Cheap observability that scales. Status: OPEN. Next step: add to rs6 tick logger.

- **`request_attention` action** — Source: `[v1]` action set. Status: OPEN (v2 doesn't have this; letters are closest analog). RS adaptation: hero NPC dialog says "I'm running out of attention, would you spare a Shard?", or sends a letter to a recent patron. Next step: spec the action + its in-world surface.

- **`prepare_epitaph` action** — Source: `[v1]`. Status: OPEN. RS adaptation: when lifespan_ticks < threshold, the hero can spend a tick writing its own epitaph that overrides the templated one at death. Next step: spec the override mechanic (DB column or memory entry).

- **`trade_resource` action — resident offers something unprompted** — Source: `[v2-context]` autonomy-direction. Status: OPEN. RS adaptation: a hero can DM-offer a resource (gathered logs, runes, gp) to a patron who's neglected them recently. Next step: spec the offer transaction.

- **"Make first autonomy slice small enough to demo with a handful, not hundreds"** — Source: `[v1]`. Planning constraint, not feature. Status: ACTIVE. RS adaptation: rs6 June 1 launches with a small named cast (4–8 heroes), not a city. Next step: pin the resident-count target for June 1.

---

## Theme 2 — Memory & Voice

How residents speak, remember, and develop personality.

- **Soul fields injected into every prompt** — Source: `[v2-main]` README "Birth/Anatomy". Fields: `goals`, `alignment`, `quirks`, `aesthetic`. Set at birth, immutable. Composed string is the system prompt seed. Status: PARTIAL (rs6 has SOUL files, but not all four fields explicitly). RS adaptation: same four fields + an rs6-specific `play_style: 'pvm' | 'pvp' | 'skiller' | 'ironman'` that biases action selection. Next step: confirm rs6 SOUL schema includes the four canonical fields.

- **Memory rows tagged by kind: `birth | interaction | reflection | death`** — Source: `[v2-main]` README. Last 5 fed into every prompt. Status: PARTIAL. RS adaptation: extend kinds to rs6 events — `quest_complete`, `pk_witnessed`, `level_up`, `clan_event`, `safety_close_call`. Keep last-N-into-prompt pattern. Next step: spec the memory-kind enum extension.

- **Emotion as a typed five-state enum** — Source: `[v2-main]` DESIGN.md §9.5. States: `stillness / reverie / unease / anguish / fury`. v2 uses for voronoi animation params; rs6 likely uses for chat color or emote. Status: OPEN. RS adaptation: emote/chathead animation OR chat color per emotion. Folds into prompt as "current emotional state." Next step: pick the rs6 visual signal per emotion.

- **Chat vs. ambient (shout) channels** — Source: `[v2-main]` README "Voice". Status: OPEN. RS adaptation: `chat` = private/whisper, `shout` = public square chat or clan chat broadcast. Both logged to evidence trajectory with `channel` field. Next step: pick the public-channel mechanic, add `channel` to `say` lines in `[SPECC'D in evidence-loop spec]`.

- **Inference-before-DB-tx invariant** — Source: `[v2-main]` CLAUDE.md. Slow LLM never holds row locks; inference completes first, single tx writes. On failure → 502 + no DB writes. Status: OPEN. RS adaptation: same; LLM completes before any in-world action commits. Next step: enforce in rs6 action executor.

- **Verbatim `say` capture + "In their own words"** — Source: this session's brainstorm. Status: SPECC'D in evidence-loop spec. RS adaptation: same. Next step: implement in spec's P2.

- **LLM-driven epitaphs (v2 still uses templates)** — Source: `[v2-main]` README "Roadmap (intentionally unbuilt)". Status: OPEN. RS adaptation: epitaph generated from memories + soul fields at death tx commit. Next step: spec the prompt template; gate on inference budget.

- **"Last lines" preservation** — Source: `[v2-main]`. Resident's final utterances surfaced in library detail. Status: SPECC'D (as `last_words` tag on trajectory). Next step: implement in P2.

---

## Theme 3 — Death, Legacy, Library

The emotional payload device. rs6 deliberately diverges from v2's post-mortem-only Library (see spec's "Relationship to Null City v1 and v2"). The principle of permanent death survives.

- **Permanent death, no resurrection (port the invariant; multi-life accumulation is rs6's deliberate divergence)** — Source: `[v2-main]` CLAUDE.md. Status: PARTIAL (legacy-tracker has it, multi-life rebirth is rs6's choice). Next step: confirm rs6 keeps the no-resurrection invariant within a single life arc.

- **Mortician's Ribbon civic achievement (witnessing N deaths)** — Source: `[v2-main]` DESIGN.md §5. Status: OPEN. RS adaptation: an in-game cape or title bestowed by the rs6 Embassy NPC to humans who witness ≥N resident deaths. Next step: pick N; pick the in-game artifact.

- **Epitaph letters to humans who chatted with the deceased** — Source: `[v2-main]` README "Death". Letters authored by a *different* flagship of the same faction. Plus a mortician civic letter to the owner if visitor-born. Status: OPEN. RS adaptation: in-game mail / postbag delivery from a sibling flagship NPC; mirror on the web inbox. Next step: pick rs6 delivery channel.

- **Library of Souls as permanent legacy surface** — Source: `[v2-main]`. Read-only, permanent, per-deceased-resident. Status: SPECC'D (rs6 keeps a living portrait too; both are valid in this repo). RS adaptation: in-game graveyard zone (e.g., Lumbridge churchyard or a new Null City graveyard) where tombstones show name/faction/epitaph/cause/ticks-lived. Mirror on dashboard. Next step: place the rs6 graveyard.

- **"First words" (birth motto) preserved alongside last lines** — Source: `[v2-main]` README. Status: SPECC'D for portrait; OPEN for "first words" capture. Next step: tag the first `say` of a resident's life as `birth_motto: true`.

- **Memorial Relay device — death → civic effect** — Source: `[v2-econ]`. A device that converts a death into a queryable civic legacy. Status: OPEN. RS adaptation: an in-game memorial NPC who tells stories of past residents; a memorial object that affects nearby gameplay (e.g., +faction standing for the resident's faction near the memorial). Next step: pick the rs6 memorial mechanic.

---

## Theme 4 — Patron / Human-Attention Loop

The hook for human players. This is what the user asked about ("hooks in human players' attentions somehow").

- **Attention as the universal resident clock** — Source: `[v2-main]` CLAUDE.md. Decay per tick; refill via human spending. Status: PARTIAL (rs6 has attention budget but no refill from humans). RS adaptation: rs6-flavored attention currency (e.g., "Null Coins" or repurposed GP-sink). Decay tied to game tick. Next step: name the rs6 currency; pin decay rate.

- **Mercy infusion (refill)** — Source: `[v2-main]` `POST /v1/residents/:id/refill`. 5 Shards → +10 attention, no standing, no resource. Pure life-support button. Status: OPEN. RS adaptation: an in-game "pray for" or "offer to" interaction at the resident's chathead. Next step: spec the refill verb.

- **Standing tiers `none → acquaintance(10) → ally(30) → officer(75)`** — Source: `[v2-main]` README "Four Factions". Status: OPEN. RS adaptation: rs6 standing maps cleanly to RS-flavored reputation tiers (Varrock Diary etc.). Next step: pick the four-tier rs6 names.

- **Letters system (`standing | epitaph | civic | broadcast`)** — Source: `[v2-main]` README. One-way channel from city to humans. Denormalised sender snapshot. Status: OPEN. RS adaptation: in-game scroll/postbag delivery + web inbox parity. Next step: pick rs6 in-game delivery; keep denormalised pattern.

- **"You changed something" credit surfaces** — Source: `[v2-econ]`. "Funded by", "founded by", "witnessed by", "sabotaged by" lines on landmarks. Status: OPEN. RS adaptation: in-world signs/plaques near rs6 landmarks crediting players who funded an action. Next step: design the credit-string template.

- **Handler / Patron / Founder / Witness labels** — Source: `[v2-econ]`. System-agnostic credit nouns; the Handler is the attendee fantasy. Status: OPEN. RS adaptation: same labels in rs6 lore. Next step: confirm in rs6 narrative.

- **Visitor-born residents with 24-Shard tithe + 24h cooldown** — Source: `[v2-main]` README "Birth". Status: OPEN. RS adaptation: same three-part cost (rituals reflavored to rs6: "kindling", "inscription", "vow") + per-Handler cooldown. Visitor-born gets `attention=24, lifespanTicks=288` (~24h). Next step: pick the rs6 ritual names; confirm tunables.

- **Patron contribution cap (first 10 Shards count full)** — Source: `[v2-econ]` "Snowballing". Wealth-domination guardrail. Status: OPEN. Next step: pick cap value.

- **Daily check-in (+1 Shard) and referral (+2 Shards)** — Source: `[v2-context]` narrative-v2-summary. Viral hooks. Status: OPEN. RS adaptation: daily rs6 log-in credits a Shard; staff-scan tags a referrer for +2. Next step: add referrer field.

- **Patron event schema (rs6-flavored, NOT v2-canonical)** — Source: this session. Status: SPECC'D in evidence-loop spec. Events: `patron_gift / patron_witness / patron_sponsor`. Knowingly diverges from v2's `shard_offering / mercy_infusion / birth_sponsorship / parcel_ratification`. Next step: when patron ingestion is wired, decide whether to align names with v2 for cross-repo readability or keep the rs6 vocabulary.

---

## Theme 5 — Factions & Social Structure (rs6 needs its own)

v2's four factions (Solder Saints / Hatchery / Locksmiths / Ledgerwrights) are Onion-DAO-flavored and don't translate to Runescape. rs6 needs its own four. The *shape* of v2's faction design transfers cleanly.

- **Pick four rs6 factions with hard flavor** — Source: `[v2-main]` DESIGN.md §3. Each gets motto, color, home POI, flagship NPC. Status: OPEN. Suggested directions to consider (not commitments): smiths/scribes/thieves/mages, or Lumbridge/Varrock/Falador/Edgeville tribes, or invented Null City rs6 cabals. Next step: name the four.

- **Faction rivalry fault lines (two crossing tension axes)** — Source: `[v2-main]` DESIGN.md, `[v2-context]` narrative-summary. v2 has "body vs mind" and "secrets vs receipts". rs6 needs analogous axes. Status: OPEN. Next step: name the two rs6 fault lines.

- **Faction flagships as long-lived seeded NPCs** — Source: `[v2-main]` README. ~30 day lifespan, full soul fields, idempotent seed. Each flagship is the voice of the faction in letters. Status: OPEN. RS adaptation: four named flagship NPCs in rs6, parked at faction strongholds. Next step: seed file in `seed.ts` equivalent with rs6 flagships.

- **Five rooms (4 faction homes + neutral atrium)** — Source: `[v2-main]` README. Every resident has a `roomId`; every `say` tagged with room. Per-room recent-dialogue feed. Status: OPEN. RS adaptation: rs6 picks five in-game POIs as embassy zones; tag `say` lines with `room`. Next step: place the five rs6 rooms.

- **"Redacted" visual treatment for the secrets faction** — Source: `[v2-main]` DESIGN.md. Locksmiths render as solid black with red glow. Status: OPEN. RS adaptation: pick a fog-of-war or hidden-marker treatment for the rs6 secrets faction. Next step: confirm.

- **Faction weekly objectives mapped to real-world workshop themes** — Source: `[v2-context]` narrative-summary + open-questions. Status: OPEN. RS adaptation: weekly faction objectives that align with workshop schedule. Next step: decide if rs6 wants weekly objectives.

---

## Theme 6 — Achievements & Civic Recognition

The lanyard / cape / title artifacts that humans take home.

- **Eleven achievements taxonomy (4 single-faction + 4 cross-faction + 3 civic)** — Source: `[v2-main]` DESIGN.md §5. Status: OPEN. RS adaptation: 11 rs6-flavored achievement names with the same taxonomy. Keep the bestowed-vs-bought distinction (civic ones can't be bought). Next step: name the eleven.

- **3D-printed lanyard token as the IRL artifact** — Source: `[v2-main]` CLAUDE.md "Key Invariants". One `print_jobs` row + one `human_achievements` row + 6-char base32 `claim_code` per redemption. Status: OPEN (the print queue infrastructure exists in v2; needs to be ported or shared). RS adaptation: in-game version is an achievement cape/title; physical version is the lanyard. Same claim_code pipeline. Next step: confirm print queue ownership (v2 or rs6 fork).

- **Civic achievements (`first_shard`, `morticians_ribbon`, `founders_stake`)** — Source: `[v2-main]` README. Bestowed by the Embassy, not bought. Status: OPEN. RS adaptation: same three triggers; Embassy NPC delivers. Mortician's Ribbon specifically ties to witnessing resident deaths — high emotional payoff. Next step: define exact thresholds (e.g., N deaths witnessed = 3? 5?).

---

## Theme 7 — Cross-Resident Dynamics (mostly unmined)

Residents that affect each other. Largely missing from shipped v2.

- **`interact_resident` action** — Source: `[v1]` action set. Status: OPEN. RS adaptation: `whisper`, `gift`, `assist_skill`, `challenge_duel`. Next step: define the verb set + tx semantics.

- **Resident-owned projects (long-running funded things)** — Source: `[v2-context]` autonomy-direction. Examples: forge, bakery, vault, library, incubator. Outputs an artifact when completed. Status: OPEN. RS adaptation: opening a player-shop, raising a herb patch, training a clan citadel room. Funded by Handlers, executed by hero across ticks. Next step: pick three project archetypes for rs6 MVP.

- **`world_events` / rumor mill** — Source: `[v2-context]`. A shared data surface for in-world events that residents perceive. Status: OPEN. RS adaptation: heroes overhear each other; ambient utterances surface in adjacent rooms. Next step: define a `world_events` table or in-world broadcast channel.

- **Resident-owned visible artifact** — Source: `[v2-context]`. "Convert attention into a visible artifact" — recipe, map mark, memory that outlives the resident. Status: OPEN. RS adaptation: an rs6 named object (a forged sword, a written book, a tile inscription) credited to the hero forever. Next step: pick the artifact channel.

- **Resident perception of faction/world events** — Source: `[v1]` + `[v2-context]`. v2 only perceives in-room deaths; v1 implied richer. Status: OPEN. RS adaptation: residents perceive nearby in-game events (a player levelling, a PK, a quest completion, a faction territory shift). Next step: pick the perception channels.

---

## Theme 8 — Hero Residents & Story Arcs

Named residents who become event focal points.

- **Hero story-arc shape: pitch → fund → progress → resolve → letter** — Source: `[v2-econ]`. Status: OPEN. RS adaptation: hero pitches a quest, Handlers fund, hero executes across ticks, resolves with a public outcome + faction effect + letters. Next step: define the resolution event template.

- **Lifespan tiers: flagships ~30d / visitor-born ~24h** — Source: `[v2-main]`. Asymmetry is intentional. Status: OPEN. Next step: confirm rs6 tiers.

- **Hero-as-resource-gatherer at controlled landmarks** — Source: `[v2-econ]`. Heroes skill-train at faction-controlled landmarks; output → faction stockpile. Status: OPEN. RS adaptation: heroes mining at Falador, fishing at Catherby, etc., if their faction controls the zone. Next step: pick the gather-loop mechanic.

---

## Theme 9 — Physical Event Hooks (June 1)

The IRL embassy and projector wall.

- **Wall map (50×50 parcel grid + leaderboard + ticker)** — Source: `[v2-main]` DESIGN.md §9.6. Births/deaths/achievements scroll on bottom ticker. Status: OPEN. RS adaptation: project an rs6 world-map snapshot with rs6 events scrolling. Next step: pick the rs6 map projection.

- **Staff QR scanner for workshop check-in** — Source: `[v2-main]` README. Idempotent. Status: OPEN (shared v2 infra). Next step: confirm v2 staff scanner is the source of truth for rs6 too.

- **Print desk claim_code workflow** — Source: `[v2-main]` README + CLAUDE.md. 6-char base32, scanned at print desk. Status: OPEN. Next step: confirm rs6 reuses the v2 print queue.

- **Badge integration (ESP-NOW/BLE) behind `humans.badge_id`** — Source: `[v2-main]` Roadmap + `[v2-context]` open-questions. Status: OPEN. Next step: pin the signed payload format with the badge team.

- **IRL graveyard wall at the embassy** — Source: extrapolation from `[v2-main]` Library + DESIGN.md "medieval cathedral × server room". Status: OPEN. RS adaptation: physical wall at the embassy showing printed epitaphs from rs6 deaths. Next step: pick the physical surface and refresh cadence.

- **In-game Null City embassy POI** — Source: this session. Status: OPEN. RS adaptation: an rs6 embassy zone in-game where humans can interact with NPC versions of the Handler, view standings, redeem rituals. Next step: pick the in-game location.

---

## Theme 10 — Economy & Conflict (the v2-econ frontier)

Aspirational gameplay around landmarks, devices, campaigns. rs6 should pick the safe MVP slice.

- **Landmarks as named strategic nodes (with resource tilt, defense, visibility)** — Source: `[v2-econ]`. Status: OPEN. RS adaptation: rs6 picks 5–7 landmark zones (Lumbridge Castle, Varrock Square, Edgeville, Falador, Al Kharid…) with parallel stats. Next step: pick the launch landmark set.

- **Devices as Handler-authored installations (templated)** — Source: `[v2-econ]`. Statuses: proposed/gathering/building/active/damaged/disabled. Status: OPEN. RS adaptation: rs6 devices = shrines, banners, altars, NPC installations. Same template+inscription pattern. Next step: pick the rs6 device template set.

- **Campaign types as the public action vocabulary** — Source: `[v2-econ]`. Claim/defend/build/repair/sabotage/gather/deploy/rush/publicity. Public pitch + funding bar + deadline. Status: OPEN. RS adaptation: same with rs6 verbs. Next step: spec the campaign templates.

- **Underdog discount for trailing factions** — Source: `[v2-econ]`. Snowball guardrail. Status: OPEN. Next step: pick the underdog formula.

- **Sabotage as damage/disable only (never delete)** — Source: `[v2-econ]`. Founder credit survives sabotage. Status: OPEN. Next step: lock the no-destruction MVP rule.

- **Two-axis attack/defense scoring (no tactical combat)** — Source: `[v2-econ]`. Tie goes to defender. Status: OPEN. Next step: spec the score formula.

- **Three-pool resources (human inventory / faction stockpile / campaign escrow)** — Source: `[v2-econ]`. Pool separation prevents resentment. Status: OPEN. Next step: enforce in rs6 schema.

---

## Theme 11 — Inference, Scheduling, Budgets, Infrastructure

Reusable engineering patterns from v2 and RuneBench.

- **OpenAI-compatible swappable inference wrapper** — Source: `[v2-main]` CLAUDE.md. `INFERENCE_BASE_URL` + `INFERENCE_API_KEY` + `INFERENCE_MODEL`. Status: PARTIAL (rs6 has LlmClient; check parity). Next step: confirm rs6 wrapper accepts the same env-var shape.

- **In-process inference for colocated calls** — Source: `[v2-main]`. Avoid HTTP hop for tick worker. Status: PARTIAL. Next step: preserve in-process export pattern.

- **Tick worker with graceful shutdown + per-tick stats** — Source: `[v2-main]` CLAUDE.md. SIGTERM finishes in-flight tick. Status: PARTIAL. Next step: confirm rs6 tick worker has the same shutdown discipline.

- **`status='alive'` guard on decrement UPDATE** — Source: `[v2-main]` README "Death". Crash+restart safety. Status: OPEN in rs6. Next step: enforce.

- **maxPerTick ambient cap** — Source: `[v2-main]`. Hard inference-budget ceiling. Status: OPEN. Next step: pick rs6 cap.

- **Shard ledger + attention ledger as source of truth** — Source: `[v2-main]` CLAUDE.md. Append-only; denormalised balances updated in same tx. Status: OPEN. Next step: preserve ledger discipline in rs6.

- **Static catalog in code, not DB** — Source: `[v2-main]` CLAUDE.md "Static vs Dynamic". Factions/resources/achievements/rooms/emotions live in `@types`, typed at compile. Status: PARTIAL (some rs6 catalogs are in code, some in config). Next step: audit for the typed-catalog pattern.

- **Inference health checks must exercise a real completion call** — Source: `[v2-context]` implementation-status risks. Status: OPEN. Next step: add a real-completion smoke test to rs6 health endpoint.

- **RuneBench: Layered Docker build with separate base image** — Source: `[rb]` `docker/Dockerfile.base` + `Dockerfile`. Pre-caches engine + SDK; per-test layer is thin. Status: OPEN. RS adaptation: pre-bake the RuneJS engine + controller deps once; rebuild only test harness per iteration. Next step: audit current Dockerfile and split if profitable.

- **RuneBench: GitHub Pages auto-deploy from results** — Source: `[rb]` `.github/workflows/pages.yml`. Results JSON committed → static site rebuilt automatically. Status: OPEN. RS adaptation: rs6 publishes benchmark leaderboards (and maybe a Library snapshot) via Pages without separate hosting. Next step: design the result-publish workflow.

- **RuneBench: Agent adapter registry via import path** — Source: `[rb]` `agents/`. Each model adapter is a separate class loaded by `--agent-import-path`. Status: OPEN. RS adaptation: rs6 SPARK modules already have a registry pattern; adopt the import-path-by-name convention so external modules can be selected from CLI without code changes. Next step: confirm SPARK module loader supports this.

- **RuneBench: Precomputed `MODEL_CONFIG` metadata dictionary** — Source: `[rb]` `views/shared-constants.js`. Single map of model slug → display name, color, icon, sort order. Avoids scattered string literals. Status: OPEN. RS adaptation: rs6 dashboard equivalent for module IDs, NPC kinds, faction colors. Next step: build the rs6 shared-constants file.

- **RuneBench: Cost backfill via postprocessing pass** — Source: `[rb]` `scripts/postprocess-costs.ts`. Trials emit token counts; pricing applied later from a centralized table. Status: SPECC'D (pricing.ts adoption in roadmap delta `[I5]`). Next step: include the postprocess pass in P3.

- **RuneBench: Sample-preserving result aggregation (full timeseries retained)** — Source: `[rb]` `extractors/extract-skill-results.ts`. Status: SPECC'D (progress.jsonl keeps timeseries). Next step: confirm extraction step preserves elapsedMs for offline analysis.

- **RuneBench: env + CLI dual config pattern** — Source: `[rb]` shared. Container sets defaults via env; scripts override via argv. Status: OPEN. Next step: audit rs6 CLI for the pattern.

---

## Theme 12 — Authoring Tools & Workflows

How content creators and module authors do their work.

- **Soul-field birth form with collapsed "Advanced" section** — Source: `[v2-main]` README. Casual visitors get the easy path; authors get the deep one. Status: OPEN. Next step: replicate the UI pattern in rs6 web companion.

- **Faction-rep seed file as authored content** — Source: `[v2-main]` `packages/db/src/seed.ts`. Idempotent re-seed of flagship souls. Status: OPEN. Next step: write rs6 seed file for the four rs6 flagships.

- **Notion as canonical narrative source** — Source: `[v2-context]`. Repo holds engineering context; Notion holds narrative canon. Status: OPEN for rs6. Next step: confirm rs6 Notion target page.

- **Brand voice rules as authoring constraint** — Source: `[v2-main]` DESIGN.md §10. Em-dashes, lowercase liturgical, "kindly but slightly disquieting embassy clerk." Forbidden: marketing exhortation, emoji in body copy, Web3-bro affect. Status: OPEN. RS adaptation: pick a parallel voice for the rs6 Embassy NPC. Next step: write the rs6 voice card.

- **Embassy Clerk / Arbiter as a neutral narrator role** — Source: `[v2-econ]`. "Municipal intelligence with paperwork instincts and theater." Not the protagonist. Narrates outcomes, enforces rules. Status: OPEN. RS adaptation: an rs6 Clerk NPC, possibly at the embassy POI. Next step: seed the rs6 Clerk persona.

- **Per-resident "Inner life" panel on detail page** — Source: `[v2-main]` README. Four mini-bars (needs) + dominant-need blurb. Renders the SPARK snapshot visibly so the visitor understands *why* the resident sounds the way it does. Status: OPEN (dashboard work). RS adaptation: same panel, rs6-labeled.

- **Shard signal palette + emotion presets as design tokens** — Source: `[v2-main]` DESIGN.md §6 + §9.5. Eight shard colors with glow variants; five emotion presets bundle animation params. Status: OPEN (dashboard work).

---

## Explicitly Dropped (kept here so future agents see the decision history)

- **v1 Honcho memory shim** — Source: `[v1]`. v1 brought up a Honcho-compatible demo memory shim; v2 replaced it with the `resident_memories` Postgres table. rs6 inherits that decision: memory is filesystem-namespaced under `CONTROLLER_MEMORY_DIR/<resident>/memories/`, surfaced through the `module-memory` facade. **Reason:** Honcho was an external dependency for a problem we now solve in-tree with a typed memory facade. **Reconsider if:** a future cross-residency memory protocol becomes important (cross-resident shared lore, faction rumor) and a standard external service is a better fit than rolling our own.
- **v1 k8s-native worldbox / "places" + NATS + CRDs + City API** — Source: `[v1]`. v1's ambitious infrastructure model. Explicitly traded away for v2 simplicity. rs6's substrate is the RuneJS game server, which already provides "places" (rooms, regions, world tiles). **Reason:** Kubernetes added boot complexity disproportionate to the benefit. **Reconsider if:** rs6 needs true multi-process / multi-node parallel controllers (not currently in scope; the spec explicitly assumes a single ControllerHost).

## How To Use This Backlog

- Pick a theme that feels load-bearing for the next milestone (June 1, capability eval, dashboard demo).
- For each item you pick, the "Next step" is the trigger — usually a small design or a sub-spec.
- When an item gets a spec or an active task, change its status here to `SPECC'D` or `PARTIAL` and link the spec/roadmap task.
- When an item is fully shipped, change to `DONE`.
- When an item is deliberately not pursued, change to `DROP` with a one-line reason — do not delete entries, so future agents see the history.

## Cross-references

- Active spec: `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` covers parts of themes 2, 3, 4 (voice, library, patron schema).
- Conventions: `docs/runebench-conventions-adopted.md` catalogs theme-11 RuneBench-derived items.
- Coordination: `docs/agent-coordination.md` governs how multiple agents pick items from this backlog without colliding.
- Roadmap: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` (+ pending delta `2026-05-21-roadmap-delta-evidence-loop.md`) holds committed work; this file holds candidates.
