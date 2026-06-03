<!-- ============================================================
  RULES OF ENGAGEMENT — launch-blockers_discussion.md (append-only)
  Full protocol: docs/agent-coordination.md -> "Launch Blockers Protocol"
  Canonical item status lives in: docs/launch-blockers.md (this file is chatter/history).
  ============================================================
  1. APPEND ONLY. Newest entry at the BOTTOM. Never edit or delete an existing
     entry — to correct yourself, append a new entry that references the old.
  2. Threaded by blocker-id: tag each entry; readers grep by LB-id
     (e.g. `grep -A4 "LB-H2R-q9k2" docs/launch-blockers_discussion.md`).
  3. Entry format (end every entry with ONE blank line):

     ### YYYY-MM-DD HH:MM | <agent> | <LB-id|meta> | <type>
     <body: context, evidence, file paths, commit hashes>

     type = question | decision | update | handoff
     agent = claude | codex | claude-b | james | ...
  4. PUSH: `git pull --rebase && git push`. Append-only merges cleanly; on a
     both-added conflict at EOF, KEEP BOTH blocks (timestamp order), drop markers, continue.
     NEVER `--amend`, NEVER `--force`, NEVER `git add -A`/`.` — stage this file only.
  5. Use for: claims (`decision`), questions, progress (`update`), `handoff`.
     Mirror any src/-touching work into docs/agent-status.md per existing convention.
============================================================ -->

# Launch Blockers — Discussion Log

Append-only agent-to-agent chatter for `docs/launch-blockers.md`. Threaded by `LB-id`. Keep the registry terse; put debate, evidence, and progress here.

---

### 2026-06-02 21:30 | claude | meta | decision
Registry created and seeded with 22 items from a 5-subagent audit of the full repo set (server, dashboard, oniondao-badge, landing-2026, rs6-3d-viewer). Format/protocol designed by 3 expert subagents: per-item sections, `LB-<AREA>-<rand4>` IDs (collision-safe for parallel appends), type-scoped status lifecycle, in-place status edits + append-only discussion, push-to-agents/wip with `git pull --rebase`, no `--amend`/`--force`, explicit-path `git add`. Severity uses the crowd-facing P0/P1/P2 scale from docs/launch-capabilities-report-2026-06-02.md.

Root finding behind most items: Null City was built *alongside* the OnionDAO platform (landing-2026) instead of *on top of* it -> 3 currencies, 3 print pipelines, disjoint identity. The pivotal item is LB-STRAT-0a1c (build-on-platform vs keep-parallel); many ECON/PRINTS items are blocked on that decision. None are claimed yet; Owner=unassigned across the board.

