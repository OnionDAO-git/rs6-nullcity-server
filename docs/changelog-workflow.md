# Changelog Workflow

`CHANGELOG.md` lives at the repo root on `nullcity` (the default branch) and follows the [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) spec. Every push to `nullcity` adds one release section. Sections are written for a human dev landing here cold and asking *"what's new?"* — keep them succinct and present-tense.

## Format

```markdown
# Changelog

All notable changes ...

## [Unreleased]

### Added
- (pending bullets accumulate here between releases)

## [2026-05-26] — pre-chicago-demo-2026-05-26

### Added
- Library of Souls browse page at `/library/`.
- Patron self-service profile at `/patron/?human=<handle>`.

### Changed
- Wall ticker dedupes multi-witness death notices.

### Fixed
- Heroes no longer loop "Still here as X" between LLM calls.

## [2026-05-23]
…
```

Rules:
- **Header**: `## [YYYY-MM-DD]` for the date alone, or `## [YYYY-MM-DD] — <tag>` if you want the git tag inline. The tag is whatever you used in `git tag` for that push (e.g. `pre-chicago-demo-2026-05-26`). Date is the squash date in the local timezone.
- **Sub-sections** (use only those that apply, in this order): `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`. The repo also accepts `### Developer-facing` (API-shape / config / migration notes for downstream consumers) and `### Tests` (when the release adds meaningful new test surface), used sparingly.
- **Bullets per section**: 3 to 5 is the target. Hard cap is 10 across the whole release. If a release needs more, you're hiding interesting work — pick the headlines.
- **Voice**: present-tense, active, dev-facing. *"Library of Souls browse page at `/library/`"* — not *"Add Library of Souls page"*, not *"Implemented the LibraryOfSoulsEndpoint controller per spec PILLAR3-LIBRARY-PAGE"*.
- **No commit SHAs in bullets.** The reader doesn't care. The git tag in the header is the breadcrumb.
- **No internal jargon.** If the bullet uses a workstream code (PILLAR1, J-α, R-β), translate it. *"Patron standing letters now show recent correspondence"* not *"PILLAR2-PATRON-UX shipped"*.
- **Newest at top.** New sections go above existing ones, immediately under `## [Unreleased]`.
- **Skip the trivial.** Tiny doc typo fixes, internal refactors with no behavioural change, status-log handoffs — don't list them. The point is what a dev would care about.
- **Link refs at the bottom.** When you cut a release, add a comparison link: `[YYYY-MM-DD]: https://github.com/OnionDAO-git/rs6-nullcity-server/releases/tag/YYYY-MM-DD`. The `[Unreleased]` link compares the latest tag to `HEAD`.

## The `[Unreleased]` section

Lives on `nullcity` between releases. As interesting work lands via squash, the human cutting the squash can drop pending bullets into `[Unreleased]` if they want a running draft. Otherwise it stays empty/sparse and the squasher writes the entry from scratch at release time. Either flow is fine — `[Unreleased]` is a convenience, not a requirement.

## Process

Changelog entries are written as part of the curated squash that lands work on `nullcity`. See `docs/merge-to-main-plan.md` for the full sequence. The relevant insert is:

1. After you've curated the squash range and staged the payload.
2. Before you run `git commit` for the squash.
3. Edit `CHANGELOG.md` on the release branch:
   - Promote any pending `[Unreleased]` bullets into a new dated section.
   - Add a fresh empty `[Unreleased]` section above it.
   - Update the link refs at the bottom.
4. Draft any missing bullets by skimming `git log --oneline <previous-release-tag>..HEAD` on `agents/wip` and grouping by what a dev would care about. Aim for 3 to 5 per sub-section; cut hard.
5. Stage the changelog edit alongside the rest of the squash (it should land in the same commit).
6. Commit + push + tag.

If you forgot to add a changelog entry and already pushed, follow up with a small docs commit on `nullcity` — `docs(changelog): backfill entry for <tag>` — rather than amending or force-pushing.

## Examples

### Good bullets

- Library of Souls browse page at `/library/`.
- Patrons can self-check Shards and standing at `/patron/?human=<handle>`.
- Wall ticker now dedupes multi-witness death notices.
- Hero souls (Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, Thrand) gain ambient personality lines that fire without an LLM call.
- Mortician's Ribbon: patrons who witness a death receive a civic letter.

### Bad bullets

- PILLAR3-LIBRARY-PAGE: feat(library) Library of Souls browse page + /v1/library endpoint *(commit b66d6e54)* ← too much code, too much jargon, SHA noise.
- Improved the system ← says nothing.
- Refactored `src/controller/letters/wall-snapshot.ts` to extract `dedupeLettersBySubject` ← internal mechanics; the user-facing fact is "wall ticker dedupes".
- Status log handoff for SPRINT-E62 ← internal coordination event, not a release item.

## Who writes the entry

Whoever runs the curated squash (typically James, but Codex or Claude can prepare a draft). The draft can come from anywhere — a status-log tail scan, a roadmap diff, a sprint-handoff doc — but the final bullets are a human-curation pass. The LLM-style temptation to enumerate everything is the failure mode this guide exists to prevent.
