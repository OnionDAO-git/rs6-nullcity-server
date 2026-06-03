# Release QA Status

This file is the QA Marshal checkpoint for deciding whether `agents/wip` is safe to squash/merge to `nullcity`.

## Current Marshal

| Field | Value |
|---|---|
| QA Marshal | Unassigned |
| Active branch | `agents/wip` |
| Target branch | `nullcity` |
| Last updated | 2026-06-02 |

## Current Branch Delta

As of the 2026-06-02 process cleanup pass:

| Direction | Count | Meaning |
|---|---:|---|
| `origin/nullcity..origin/agents/wip` | 36 commits | Manageable WIP surface, still needs QA Marshal review before squash/merge. |
| `origin/agents/wip..origin/nullcity` | 0 commits | WIP is not behind the target branch at this checkpoint. |

## Required Gates Before Squash/Merge

- [ ] `git fetch origin`
- [ ] `git status --short --branch` is clean on `agents/wip`
- [ ] `docs/issue-register.md` has no open `P0` issues
- [ ] `docs/issue-register.md` open `P1` issues are either fixed or explicitly accepted with caveats
- [ ] Roadmap Workstream S packet status reflects claimed/completed packet work
- [ ] `docs/resident-capabilities.md` is current for all completed CQA packets
- [ ] `npm run check:no-ui`
- [ ] `npm run fin`
- [ ] `npm run build`
- [ ] Relevant live benchmark/smoke evidence exists for behavior claims
- [ ] Dashboard repo contract changes are documented, with no server-side human UI added
- [ ] `CHANGELOG.md` or changelog draft is prepared for the curated milestone

## Ready To Squash

Status: **No — needs QA Marshal review.**

Reason: branch hygiene is no longer the blocker, but open/in-review P0/P1 rows and fresh gates still need a release owner before another curated squash to `nullcity`.

## Do Not Merge If

- Any `P0` issue in `docs/issue-register.md` is `Open`, `Claimed`, `In Review`, or `Blocked`.
- A capability claim was upgraded without benchmark/log/timeline evidence.
- A paid-model benchmark ran without a named profile, cap, and artifact path.
- `npm run check:no-ui` fails.
- Server repo adds human-facing UI files.
- The merge would include `docs/agent-status.md` if the current convention still excludes it from `nullcity`.

## QA Marshal Review Loop

1. Read `AGENTS.md`, `docs/README.md`, this file, `docs/issue-register.md`, and `docs/agent-status.md` tail.
2. Inspect the commit range since the last curated `nullcity` merge.
3. Check every completed packet has a HANDOFF with tests/evidence.
4. Downgrade or open issues for unsupported claims.
5. Run gates and record exact commands/results.
6. If ready, prepare the squash plan and changelog.
7. If not ready, list the top blockers in `docs/issue-register.md` and leave `Ready To Squash` as `No`.
