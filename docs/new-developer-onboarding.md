# New Developer Onboarding

Welcome to the Null City server/controller repo. This repo runs the RuneJS
server, autonomous residents, controller APIs, logs, benchmarks, and runtime
data. Human-facing dashboard UI lives in `../rs6-nullcity-residents-dashboard`.

## First 10 Minutes

Run these before editing:

```bash
git checkout agents/wip
git pull --ff-only
git status --short --branch
npm install
npm run check:no-ui
npm test -- --runInBand src/controller/config.test.ts
```

If `git pull --ff-only` cannot run cleanly, stop and read the dirty files before
continuing. Do not overwrite another developer or agent's work.

## Read These In Order

1. `AGENTS.md` for the current operating rules.
2. `docs/README.md` for the docs map and source-of-truth order.
3. `docs/agent-status.md` tail for active locks and recent handoffs.
4. `docs/issue-register.md` for open P0/P1 defects.
5. `docs/launch-blockers.md` for launch-critical work.
6. `docs/resident-capabilities.md` before making capability claims.

After that, read the spec or plan linked by the one issue you intend to claim.

## Pick One Safe First Task

Choose the smallest high-value item in this order:

1. An unclaimed `Open` P0/P1 issue in `docs/issue-register.md`.
2. An unassigned open row in `docs/launch-blockers.md`.
3. A small active roadmap packet linked from the current docs.
4. A weak capability row that you can turn into evidence or a precise issue.

Claim one task by appending a short `STARTING` line to `docs/agent-status.md`
with the issue or packet id, exact files, evidence plan, and collision check.

## Repo Boundaries

Do server work here:

- resident runtime, controller behavior, typed actions, logs, memory, benchmarks
- JSON/control APIs consumed by dashboard or operator tools
- resident SOUL files and SPARK module behavior
- docs about runtime truth, capabilities, and server-side launch status

Do not build human-facing UI here. Dashboard, attendee pages, wall, inbox,
Library, Graveyard, Storyteller feed, print queue UI, and Svelte/HTML/CSS work
belong in `../rs6-nullcity-residents-dashboard`.

## Shared Runtime Safety

The local shared stack may already be running. Read-only checks are fine, but do
not restart, kill, deploy, or mutate live residents unless James or the runtime
steward explicitly authorizes it.

Useful read-only orientation:

```bash
screen -ls
lsof -nP -iTCP -sTCP:LISTEN
npm run controller:status
npm run controller:smoke -- --observe-seconds 30 --allow-recent-visible
```

If you need a restart, append a `RUNTIME-REQUEST` in `docs/agent-status.md`
instead of doing it casually.

## Verification Before Handoff

For code changes, run the focused tests for your files plus:

```bash
npm run check:no-ui
npm run typecheck
npm test -- --runInBand
```

When practical for server code changes, run:

```bash
npm run fin
npm run build
```

For docs-only changes, at minimum run:

```bash
git diff --check
npm run check:no-ui
```

## Commit And Handoff

Stage explicit files only:

```bash
git add path/to/file path/to/test
git commit -m "area: concrete behavior summary"
git push origin agents/wip
```

Then append a `HANDOFF` line to `docs/agent-status.md` with the commit SHA,
tests, evidence, blockers, and recommended next task. Keep long explanations in
the commit body or a packet doc, not in the status log.

## Good First Packets

- Add a focused regression test for a filed P1 bug.
- Turn a weak capability row into a verified evidence note.
- Fix a stale or misleading status surface without changing live residents.
- Improve a typed JSON/control API contract needed by the dashboard.

Avoid broad refactors, live resident mutation, and cross-repo changes until you
have completed at least one small packet cleanly.
