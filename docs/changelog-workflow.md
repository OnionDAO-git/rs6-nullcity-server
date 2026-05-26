# Changelog Workflow

`CHANGELOG.md` lives on `nullcity` (the default branch). Every push to `nullcity` adds one section. Sections are short — 3 to 5 bullets, written for a human dev who hasn't been watching this repo. The audience is OnionDAO devs landing here for the first time and asking *"what's new?"*

## Format

```markdown
# Changelog

## 2026-05-26 — pre-chicago-demo-2026-05-26
- Library of Souls browse page at `/library/`.
- Hero and faction-flagship souls speak distinctive ambient lines.
- Wall ticker collapses repeated death notices, hides QA fixtures.
- New `/` landing page with nav to the five public surfaces.

## 2026-05-23 — (pre-tag squash)
- (existing entry, preserved verbatim)
```

Rules:
- **Header**: `## YYYY-MM-DD — <tag-or-marker>`. The tag is whatever you used in `git tag` for that push (e.g. `pre-chicago-demo-2026-05-26`). If no tag, use `(squash)`. Date is the squash date in the local timezone.
- **Bullets**: 3 to 5. Hard cap is 7 — if a release needs more, you're hiding interesting work; pick the headlines and link the rest to the milestone tag.
- **Voice**: present-tense, active, dev-facing. *"Library of Souls browse page at `/library/`"* — not *"Add Library of Souls page"*, not *"Implemented the LibraryOfSoulsEndpoint controller per spec PILLAR3-LIBRARY-PAGE"*.
- **No commit SHAs in bullets.** The reader doesn't care. The tag in the header is the breadcrumb.
- **No internal jargon.** If the bullet uses a workstream code (PILLAR1, J-α, R-β), translate it. *"Patron standing letters now show recent correspondence"* not *"PILLAR2-PATRON-UX shipped"*.
- **Newest at top.** New sections go above existing ones.
- **Skip the trivial.** Tiny docs typo fixes, internal refactors with no behavioural change, status-log handoffs — don't list them. The point is what a dev would care about.

## Process

Changelog entries are written as part of the curated squash that lands work on `nullcity`. See `docs/merge-to-main-plan.md` for the full sequence. The relevant insert is:

1. After you've curated the squash range and staged the payload.
2. Before you run `git commit` for the squash.
3. Edit `CHANGELOG.md` on the release branch — add a new section at the top with today's date and the tag you plan to push.
4. Draft the bullets by skimming `git log --oneline <previous-release-base>..HEAD` on `agents/wip` and grouping by what a dev would care about. Aim for 3 to 5; cut hard.
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

- PILLAR3-LIBRARY-PAGE: feat(library) Library of Souls browse page + /v1/library endpoint *(commit b66d6e54)*  ← too much code, too much jargon, SHA noise
- Improved the system  ← says nothing
- Refactored `src/controller/letters/wall-snapshot.ts` to extract `dedupeLettersBySubject`  ← internal mechanics; the user-facing fact is "wall ticker dedupes"
- Status log handoff for SPRINT-E62  ← internal coordination event, not a release item

## Who writes the entry

Whoever runs the curated squash (typically James, but Codex or Claude can prepare a draft). The draft can come from anywhere — a status-log tail scan, a roadmap diff, a sprint-handoff doc — but the final bullets are a human-curation pass. The LLM-style temptation to enumerate everything is the failure mode this guide exists to prevent.
