# Pre-Doors Readiness — 2026-06-01 (night before)

Written by Claude (E2E verifier lane) after a session that fixed + deployed +
live-verified the core loop. This is the honest "where we stand before doors"
snapshot. Companions: `docs/demo-day-checklist.md` (ops SOP), `docs/dev-demo-readiness.md`.

## Bottom line

**The full loop skeleton works end-to-end on the live stack and is verified.**
For a *guided demo with an operator who knows the framing and can restart*, it's a
confident go. For a *hands-off month-long autonomous economy with crowds*, not yet —
it's a fresh, lightly-fleshed skeleton.

## The loop, verified live this session (all deployed)

1. Define a Soul (goal + personality) — ✅
2. Fund → born — ✅ (resident lives, thinks, **survives a controller restart**)
3. Survive on attention — ✅ human support (AP) **and** sell an NCRI → seller gains attention
4. NCRI → redeem-intent → print queue — ✅ (redeem-COMPLETE is GP-gated; see gaps)
5. Accomplish goal → saved to Library — ✅ (`goal_achieved` written; birth now creates the goal)
6. Death → epitaph + graveyard — ✅ (born-resident death now *sticks*; graveyard fired 0→1 first time)

Fixes deployed today (commits): born-persist `560f1227`, goal-on-birth `f52209b6`,
NCRI-sell-attention `463afd33`, restart-persist+reconcile-isolation `bb90c97d`,
prune-on-death `602d9d8d`. Controller runs in screen `nullcity-controller-codex`
(rebuilt; dist has all fixes).

## Known gaps (none block a guided demo)

- **Heroes are Brain-frozen (HD-032/HD-033).** Named heroes (wise-old-man, thrand,
  mother-anvil, the-hush, …) are *alive* (attention floored) and emit reflex/personality
  `say` lines, but their Brain returns empty ~87% of the time — a **Qwen3 q4 thinking-mode
  quirk, upstream of the controller (not controller-fixable)**. The QA-* residents
  (woodcutter, cook, guardian, scout, survivor, trader, banker, social) ARE actively doing
  real RuneScape work. **Lever: HD-052 (pending maintainer)** — flip heroes-only to paid
  Haiku via OpenRouter (~cents) for genuinely-smart heroes. Needs a key + config + restart.
- **GP is real but concentrated** (corrected 2026-06-01) — GP earning *works*: combat
  residents loot real coins (`res:qa-guardian` holds **19,692 GP** from `combat_loot_pickup`,
  qa-trader 1,368, qa-cook 225). The full **NCRI redeem→3D-print cash-in is verified e2e**
  (qa-guardian NCRI: buy → redeem-intent → redeem-complete burned 500 real GP, 19,692→19,192,
  print queue updated). The gap is *distribution*: skilling residents earn no coins, and
  `res:agent` converts all its GP→AP via the self-initiated survival exchange (no reserve),
  so most residents sit at 0. For an NCRI cash-in demo, use an NCRI owned by a GP-rich
  resident (qa-guardian). AP scarcity is OnionDAO-external (third-party DB) by design.
- **In-game tombstone / Library seal on attention-death** — `/v1/graveyard` works (reads
  runtime-state), but `library/<slug>/index.json` stays `currentState:living` on
  attention-death (the seal only fires on the Spark legacy path). In-game tombstones +
  portrait seal won't reflect such deaths. Cosmetic-ish follow-up.
- **Patron registry thin** — only 1 patron configured; walk-up greeting needs
  `patron:bulk-register` (HD-011) and the OnionDAO landing-app AP sync wired at the venue.
- **`qa-*` test souls are in production `config.residents`** (dev/live muddle).

## Operational notes for whoever runs it

- **Single controller process.** If it dies, the city goes dark until restart. Have a
  babysitter watching for silence / the game-gateway OOM (was a flagged P0).
- **Graceful shutdown sometimes exceeds ~14s** — wait it out; SIGKILL leaves a stale
  `data/controller/memory/nullcity-controller.lock` (rm it before restart if the new
  controller logs "lock already held"). Confirm no live process first.
- **For a pristine cohort, do ONE clean game + controller restart before doors.** Tonight
  I cleaned the test residents I created from the human-facing surfaces (Library, graveyard
  tombstone) and emptied `born-residents.json`, but a live-managed test resident
  (`res:restart-test`) and stale gateway actors remain until a restart clears in-memory /
  world state.
- **Smoke oracle:** `bash scripts/post-restart-smoke.sh`. Expect the heroes to flag YELLOW
  ("frozen, HD-032") — that's the known Brain-empty state, not a new failure.

## Framing for the demo (matters)

Say: "named residents with authored personality, living and dying in a world you
influence — fund a Soul, support it, watch it pursue a goal and be saved to the Library,
or grieve it when it dies." Do NOT say: "autonomous geniuses playing RuneScape." The
QA-* residents do real skilling; the heroes carry identity via reflex lines (smart-Brain
heroes need HD-052).

## Highest-value things still open before doors

1. **Decide HD-052** (paid Haiku for heroes) — the single biggest lever for hero quality.
2. **One full dress rehearsal** in a real browser (Chrome ext was offline tonight) +
   a clean restart to prove recovery.
3. **Decide the physical takeaway story** (GP→print can't fire; what does a person leave with?).
