# agents/wip -> nullcity Merge Plan (2026-05-26)

Companion to `docs/dev-demo-readiness.md`.

Verdict: **CONDITIONAL**. The code can become a merge candidate after a curated squash and fresh gates. Do not merge or push to `nullcity` from this audit.

## Pre-Merge Gate

Run from a clean server repo:

```bash
git fetch origin
git checkout agents/wip
git pull --ff-only origin agents/wip
git status --short --branch
npm run fin
npm run build
```

Required result:

- Clean worktree.
- `npm run fin` passes typecheck, lint, format, and full Jest.
- `npm run build` succeeds.
- No unreviewed local controller config, memory, or generated-data changes are staged.

Current audit evidence on 2026-05-26:

- `npm run fin` reached `170/170` suites and `2124/2124` tests passed.
- `npm run build` compiled `705` files.
- Live restart plus `scripts/post-restart-smoke.sh` reported `READY`.
- `controller:smoke -- --observe-seconds 120 --allow-recent-visible` reported all `23` residents `OK`.

## Why This Is Not A Blind Merge

The prior `nullcity` update was a squash commit, while `agents/wip` kept granular history. That means the branch topology is intentionally stale:

- `agents/wip` contains hundreds of granular commits not in `nullcity`.
- `nullcity` contains prior squash commits not in `agents/wip`.
- `docs/agent-status.md` is a coordination artifact and must not land on `nullcity`.
- Release review found a direct merge/squash risks duplicate-change conflicts and an accidental `CHANGELOG.md` deletion.

Recommendation: apply only the post-Workstream-R milestone range on top of `origin/nullcity`, exclude `docs/agent-status.md`, preserve `CHANGELOG.md`, then squash into one human-readable milestone commit.

## Merge Sequence

Set up a clean release branch:

```bash
git fetch origin
git checkout -B release/pre-chicago-demo origin/nullcity
git status --short --branch
```

Apply the curated post-R range:

```bash
# Antigravity's Workstream R handoff commit is the current squash baseline marker.
# Apply everything after it from agents/wip, but keep the coordination log out.
git diff --binary baf96459..origin/agents/wip -- . ':(exclude)docs/agent-status.md' | git apply --index
```

Protect files that should not change accidentally:

```bash
# Keep nullcity's changelog unless the maintainer explicitly approves deleting or replacing it.
git restore --source=origin/nullcity --staged --worktree CHANGELOG.md 2>/dev/null || true

# Confirm the coordination log is not staged.
git diff --cached --name-only | grep -q '^docs/agent-status.md$' && {
  echo "ERROR: docs/agent-status.md is staged; remove it before committing."
  exit 1
} || true
```

Inspect the staged payload:

```bash
git status --short
git diff --cached --stat
git diff --cached --name-only
```

Rerun gates on the staged release branch:

```bash
npm run fin
npm run build
```

Write the changelog entry for this release. See `docs/changelog-workflow.md` for the format — Keep a Changelog with `## [YYYY-MM-DD] — <tag>` headers and `### Added / Changed / Fixed` sub-sections, 3 to 5 dev-facing bullets per sub-section, no jargon or SHAs. Promote any pending `[Unreleased]` bullets, then draft any missing ones by scanning the commit range you're about to squash:

```bash
git log --oneline baf96459..agents/wip | head -60
```

Edit `CHANGELOG.md` on the release branch — new section at the top:

```bash
$EDITOR CHANGELOG.md
git add CHANGELOG.md
```

The changelog edit lands in the same squash commit as the code. If you forget and have already pushed, follow up with a small `docs(changelog): backfill entry for <tag>` commit; don't amend.

Commit:

```bash
git commit -m "Squash: Chicago patron, library, graveyard, and resident polish" -m "$(cat <<'EOF'
Curated squash from agents/wip after Workstream R.

Includes:
- patron profile, grant/offer/witness/gift/register flows, standing letters, and recent correspondence preview
- public wall, inbox, patron, graveyard, and Library of Souls surfaces
- hero and faction flagship ambient SOUL rules for non-LLM personality fallback
- human-readable lifespan language in letters and graveyard
- resident smoke/test improvements and HD follow-up documentation

Excluded:
- docs/agent-status.md coordination log

Includes a CHANGELOG.md entry per docs/changelog-workflow.md.

Verification before commit:
- npm run fin
- npm run build
- scripts/post-restart-smoke.sh after controller restart
- controller:smoke with an observation window

Risk notes:
- resident intelligence is still routine-heavy; do not sell this as full questing autonomy
- attendee patron registry and exact demo handle must be seeded before showtime
EOF
)"
```

Push only after maintainer approval:

```bash
git push origin HEAD:nullcity
git tag -a pre-chicago-demo-2026-05-26 -m "Pre-Chicago Null City demo snapshot"
git push origin pre-chicago-demo-2026-05-26
```

Then return to WIP:

```bash
git checkout agents/wip
git pull --ff-only origin agents/wip
```

## Post-Merge Verification

On `nullcity` after push:

```bash
git checkout nullcity
git pull --ff-only origin nullcity
npm run fin
npm run build
```

Restart the live services from the merged build:

```bash
# Use the event controller config and keep public wall redaction enabled.
npm run build
node dist/controller/index.js --config=controller.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact
```

In another terminal:

```bash
bash scripts/post-restart-smoke.sh
npm run controller:smoke -- --observe-seconds 120 --allow-recent-visible
```

Probe public/demo routes:

```bash
curl -fsS http://127.0.0.1:43596/v1/wall/snapshot >/tmp/wall.json
curl -fsS http://127.0.0.1:43596/v1/library >/tmp/library.json
curl -fsS http://127.0.0.1:43596/wall/ >/tmp/wall.html
curl -fsS 'http://127.0.0.1:43596/inbox/?human=demo@onion' >/tmp/inbox.html
curl -fsS 'http://127.0.0.1:43596/patron/?human=demo@onion' >/tmp/patron.html
curl -fsS http://127.0.0.1:43596/graveyard/ >/tmp/graveyard.html
curl -fsS http://127.0.0.1:43596/library/ >/tmp/library.html
curl -fsS http://127.0.0.1:8787/api/residents >/tmp/dashboard-residents.json
```

Expected:

- `scripts/post-restart-smoke.sh` says `READY`.
- Controller smoke reports all residents `OK`.
- Public pages all return `200`.
- Wall snapshot redacts public letter body/recipient data.
- Dashboard BFF returns the same resident count as the live smoke.

## Demo-Day Script For Dev

Opening line:

> "Null City is a story-first RuneScape simulation. Residents live in-game, patrons influence them with Shards, and the city writes back through letters, walls, portraits, and graves."

1. **Show the system is alive.**
   - Run `bash scripts/post-restart-smoke.sh`.
   - Point at `READY`, `23 residents alive`, and recent actions.

2. **Show the operator dashboard.**
   - Open `http://127.0.0.1:5174/`.
   - Point at online residents, live position/feed, final action outcomes, and recent activity.
   - Avoid resident detail pages until the online/Login mismatch is fixed.

3. **Show the public wall.**
   - Open `http://127.0.0.1:43596/wall/`.
   - Point out redacted public letters and resident roster.
   - Do not dwell on QA resident names if they are still visible.

4. **Close the patron loop live.**
   - Run:

```bash
npm run patron:grant -- --human demo@onion --amount 5
CONTROLLER_MCP_HTTP_PORT=43610 CONTROLLER_MCP_TOKENS=operator-token npm run patron:offer -- --human demo@onion --resident res:hans --amount 5
npm run patron:witness -- --human demo@onion --resident res:hans
```

   - Open `http://127.0.0.1:43596/inbox/?human=demo@onion`.
   - Show the new letter.

5. **Show the Library and Graveyard.**
   - Open `http://127.0.0.1:43596/library/`.
   - Open `http://127.0.0.1:43596/graveyard/`.
   - Frame these as generated story surfaces. Do not open raw `portrait.md`.

6. **Close honestly.**
   - Say: "The city is alive and legible. The next pass is making residents less routine-heavy and more human in long observation windows."

Prepared answers:

| Dev asks | Answer |
|---|---|
| "Is the AI actually playing?" | "It is taking real actions and recovering in-game. Some workflows use deterministic body routines, and some language comes from SOUL reflexes; long-horizon questing is not ready yet." |
| "Can patrons influence residents?" | "Yes. The grant/offer/witness loop writes standing, attention, letters, and Library history. We can run it live." |
| "Why do some lines repeat?" | "The audit caught that. We have reliable liveness, but the next quality pass is reducing budget-pause/template loops and adding varied agendas." |
| "Is this ready for Chicago?" | "The infrastructure is close. Event readiness still needs attendee registry seeding, dashboard polish, and a final live soak." |

## Rollback

Soft rollback for a bad live demo:

```bash
# Stop the new controller, restart from the previous known-good checkout or tag.
git checkout nullcity
git pull --ff-only origin nullcity
git checkout pre-chicago-demo-2026-05-26
npm run build
node dist/controller/index.js --config=controller.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact
```

Hard rollback for a bad `nullcity` squash:

```bash
git checkout nullcity
git pull --ff-only origin nullcity
git revert <squash-commit-sha>
git push origin nullcity
```

What to say if rollback is needed:

> "We found a demo stability issue after the squash, so we reverted the milestone commit and are keeping the working branch active. The resident data and event plan are intact; this is release hygiene, not a project reset."

## Handoff After Merge

After an approved merge, append a short line to `docs/agent-status.md` on `agents/wip` with:

- merge SHA
- test count
- whether `docs/agent-status.md` was excluded
- live smoke result
- remaining demo blockers

Keep it under the coordination-log line limit.
