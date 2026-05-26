# Null City - Dev Demo Readiness (2026-05-26)

Audit run: 2026-05-26 12:33-12:50 CDT. Code tip audited: `6771d806`; docs refresh tip: `8a42905d`. Live controller was rebuilt from the audited code and restarted before smoke checks.

## TL;DR - VERDICT: CONDITIONAL

Null City is **conditionally ready for an internal OnionDAO practice demo**, and **not ready for a blind merge or founder show-off without the listed conditions**.

Top reasons:

1. Static gates are green: `npm run fin` reached `2124/2124` tests across `170/170` suites, and `npm run build` rebuilt `705` files cleanly.
2. Live proof improved after restart: `scripts/post-restart-smoke.sh` reported `READY`, all `23` residents alive, and every resident had recent actions in the last five minutes.
3. Patron and story surfaces are real: `/wall/`, `/inbox/`, `/patron/`, `/graveyard/`, `/library/`, `/v1/wall/snapshot`, and `/v1/library` all returned `200`; a live `demo@onion` grant/offer/witness produced an inbox letter.

Top blockers:

1. Do **not** merge `agents/wip` directly into `nullcity`; branch topology is stale after the prior squash, `docs/agent-status.md` must be excluded, and `changelog.md` must not be accidentally deleted.
2. Resident intelligence is visibly alive but still routine-heavy: many heroes spend >50% of decisions in `budget_exhausted:pause`, and `res:agent` is mostly `stuck_pre_inference_explore` movement rather than rich long-horizon play.
3. Dashboard/product trust has polish blockers: reviewer observed a `Login` button on an already-online resident detail page, `/v1/library` exposes raw patron handles in JSON, and `portrait.md` files can still become huge repeated stuck/recovery logs.

Confidence: **MEDIUM**. Infra evidence is strong; "smart enough" evidence is still mixed.

## Readiness Matrix

| Area | Status | Evidence | Blockers / Polish |
|---|---|---|---|
| Pillar 1 - Smart gameplay | Yellow | `controller:smoke --observe-seconds 120 --allow-recent-visible` reported all 23 residents OK. `res:agent` had observed `actions=6 results=6 success=6`; qa-woodcutter had `actions=24 results=26 success=26`; qa-cook/angler used fishing/eating loops. | Not founder-grade "smart" yet. Cause histogram still flags routine loops: heroes mostly `budget_exhausted:pause`; `res:agent` stayed on `stuck_pre_inference_explore`; guardian/survivor/trader had isolated failures. |
| Pillar 2 - Patron economy | Green for demo, Yellow for event | `npm run patron:grant -- --human demo@onion --amount 5`; live MCP offer accepted with event `mercy-demo@onion-res:hans-1779817372934`; witness moved standing `5 -> 8`; `/v1/inbox?human=demo@onion` returned one civic milestone letter. | Real attendee registry remains a human/ops dependency (HD-011). Use `demo@onion`, not `demo@oniondao`, unless that handle is seeded. |
| Pillar 3 - Narrative artifacts | Yellow | Public routes returned `200`: wall `24159` bytes, inbox `12281`, patron `18971`, graveyard `10091`, library `13670`; `/v1/library` returned `23` portrait summaries. | `portrait.md` can be unshowably long: sampled `res-agent/portrait.md` was `65,882` words and repeated stuck/recovered prose. Use `/library/` cards for demo, not raw portrait markdown. |
| Infra - tests + build | Green | `npm run fin`: `170/170` suites and `2124/2124` tests passed in `48.444s`; `npm run build`: `Successfully compiled: 705 files with swc`. | The first `post-restart-smoke` from the isolated worktree gave false red because that worktree has no live memory; run live smokes from the repo root that owns `data/controller/memory`. |
| Infra - live boot | Green with caveat | Controller restarted from audited build, pid `73188`, ports `43610` MCP and `43596` letters. Canonical smoke: all `23` residents alive; all residents had recent activity. `/v1/health` returned `ok: true`, model `qwen/qwen3.6-27b`. | `/v1/health` latency was high (`18009ms`). Keep health checks out of the live narrative unless asked. |
| Dashboard/product | Yellow | Dashboard web root `http://127.0.0.1:5174/` returned `200`; dashboard API `http://127.0.0.1:8787/api/residents` returned `23` residents; dashboard repo was clean at `a075c41` ("Show final action outcomes in dashboard"). | Expert reviewer found resident detail could show `Login` while the resident is already online. Fix before using detail page as proof. |
| Ops - merge hygiene | Red until curated | Release review found `nullcity` has 5 commits not on `agents/wip` due previous squash; `agents/wip` is 604 ahead. `docs/agent-status.md` is coordination-only. | Use a curated squash of the post-`baf96459` range; exclude `docs/agent-status.md`; preserve `changelog.md`; HD-009 remains open on who owns merge approval. |
| Open HDs | Yellow/Red | Open High/Blocking-impact items remain: HD-009 merge ownership, HD-011 attendee registry, HD-033 upstream empty completions, HD-047 routine/hold-loop residue. | Any open High HD prevents a full GO verdict. |

## Evidence

Commands and checks run:

- `git status --short --branch` in the audit worktree: clean except the local readiness status append before pulling the docs commit; canonical server repo clean on `agents/wip`; dashboard repo clean on `main @ a075c41`.
- `git log --oneline nullcity..agents/wip` / `git diff --stat nullcity..agents/wip`: branch is hundreds of commits ahead because `agents/wip` retained granular history after a prior squash.
- `npm run fin`: typecheck, lint, format, and Jest completed; final summary `Test Suites: 170 passed, 170 total` and `Tests: 2124 passed, 2124 total`.
- `npm run build`: `Successfully compiled: 705 files with swc`.
- Controller restart from audited build: `node dist/controller/index.js --config=<repo>/controller.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact`.
- `bash scripts/post-restart-smoke.sh` from the live-memory repo root: `READY`; all `23` residents alive; all residents had recent activity.
- `npm run controller:smoke -- --observe-seconds 120 --allow-recent-visible`: all residents reported `OK`; examples include `res:agent` `success=6 timeout=0 fail=0`, `res:hans` `success=20 says=10`, and `res:qa-woodcutter` `success=26 says=2`.
- Public route probes on letters server: `/v1/health`, `/v1/wall/snapshot`, `/v1/library`, `/wall/`, `/inbox/`, `/patron/`, `/graveyard/`, and `/library/` all returned `200`.
- Patron probe:
  - `npm run patron:grant -- --human demo@onion --amount 5` credited Shards.
  - `CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token npm run patron:offer -- --human demo@onion --resident res:hans --amount 5` returned "Live controller accepted the offer."
  - `npm run patron:witness -- --human demo@onion --resident res:hans` moved standing `5 -> 8`.
  - `/v1/inbox?human=demo@onion` returned one civic milestone letter.
- Dashboard probes: Vite root `:5174` returned HTML; BFF `:8787/api/residents` returned `23` residents with live `res:agent` body/feed fields.
- Expert subagents:
  - Release engineer: direct merge unsafe; curated squash required.
  - RuneScape evaluator: demoable as alive routines, not deep questing.
  - Dashboard reviewer: public routes and overview are useful; detail/login mismatch and raw patron handles need polish.
  - Narrative/SOUL reviewer: authored SOUL layer strong, but raw local data/config assumptions and portrait log-dumps need care.

## Demo Readiness

Yes, show it to OnionDAO as a **practice/internal demo** with candid framing: "residents are alive, narrating, accepting patron influence, and producing story artifacts; long-horizon gameplay intelligence is still under active QA."

Five-minute script:

1. Run `bash scripts/post-restart-smoke.sh` and show `READY`.
2. Open `http://127.0.0.1:5174/` and point at 23 online residents, live position/feed, and recent action outcomes.
3. Open `http://127.0.0.1:43596/wall/` and show redacted public letters plus live resident roster.
4. Run the demo patron loop with `demo@onion`, then open `http://127.0.0.1:43596/inbox/?human=demo@onion`.
5. Open `http://127.0.0.1:43596/library/` and `http://127.0.0.1:43596/graveyard/`; present them as story surfaces, not final literary biographies.

Avoid showing raw `portrait.md`, raw QA residents as "characters," or claiming quest/combat autonomy.

## Blockers

Critical before merge:

- Curated squash only. Exclude `docs/agent-status.md`; do not use a blind `git merge --squash origin/agents/wip` from the stale topology.
- Maintainer must decide HD-009: who owns the nullcity squash and final push.
- Rerun `npm run fin`, `npm run build`, and live smoke after the curated squash is staged on `nullcity`.

Critical before founder/team show-off:

- Fix the dashboard online/login mismatch on resident detail pages.
- Seed the exact demo handle that will be used on stage.
- Keep controller launched with wall redaction enabled.
- Improve or hide the routine-heavy surfaces: suppress repetitive "Still here..." lines, filter QA rows from public demo pages, and avoid raw portraits.

Non-blocking follow-ups:

- Deduplicate `portrait.md` "Life I" stuck/recovery paragraphs.
- Redact or omit `patronHandles` from `/v1/library`.
- Add a public landing page that links wall, inbox, patron, library, and graveyard.
- Make combat/questing demonstrably real or explicitly out of scope for the demo.

## Agent Intelligence Assessment

The residents are **not yet "smart" in the way a human expects from a RuneScape player**. They are, however, visibly alive: they move, say lines, accept Shards, recover from stuck states, use items in some workflows, and record progress.

The best current claim is: "Null City has autonomous residents with reliable routines, visible personality overlays, patron influence, and story memory." The wrong claim is: "They can play RuneScape like skilled human players." `res:agent` still looks like a scout/recovery agent more than a planner; heroes have good authored soul voice but often rely on cadence/reflex speech.

## Dashboard Assessment

The dashboard and public BFF surfaces are useful enough for a practice demo:

- Dashboard overview can show live online state and resident body/feed data.
- Wall shows redacted public story events.
- Inbox and patron pages close the human loop.
- Library and graveyard now load after restart.

Trust gaps remain: the detail page login mismatch could confuse Dev, health latency is high, `/v1/library` JSON contains raw patron handles, and raw portraits can read as logs rather than biographies.

## Merge Recommendation

**Merge after listed blockers.** Specifically: merge only after a maintainer approves the curated squash plan, reruns static/live gates, and confirms `docs/agent-status.md` is excluded.

Do not merge now with a blind branch merge.

## Next Best Work

1. Fix demo trust: dashboard detail login mismatch, `/v1/library` patron-handle redaction, and a small public landing page.
2. Improve live intelligence optics: reduce hero budget-pause/template loops; give heroes and `res:agent` more varied, goal-linked body routines.
3. Clean story outputs: dedupe raw portrait markdown, filter QA residents from public demo surfaces, and seed a polished demo patron path.
