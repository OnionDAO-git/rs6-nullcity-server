# S-WIKI-1 — Enable the maintainer's RuneScape wiki as a knowledge source (prompt-budget bounded)

Date: 2026-05-31
Author: claude (subagent)
Result: shipped (substrate + live config); live retrieval-quality verify PENDING a steward redeploy.

## TL;DR for the maintainer

> "Would the entire wiki be in the prompt? Wouldn't that overload context?"

No. The wiki is now enabled, but **the brain prompt does not grow**. Measured across three
representative scenarios, enabling the wiki changed the brain knowledge section by
**-496, -369, and 0 bytes** — i.e. it shrank or stayed equal, never grew. The corpus
size is irrelevant to prompt size because the runtime caps knowledge to the top ~8
relevant entries and hard-truncates the rendered section at 2600 chars.

## Root cause (why it was disabled)

Two independent gates kept `wiki=disabled` in the boot log:

1. `knowledge.runebenchWikiDir` was unset in `controller.yml` (config gate).
2. Even if it had been set, `STARTER_WIKI_PAGES` in
   `src/controller/knowledge/game-skill-entries.ts` listed **four files that do not
   exist** in this repo (`npcs/chicken.md`, `npcs/cow.md`, `npcs/goblin.md`,
   `shops/lumbridge-general-store.md`). The importer (`wiki-importer.ts`) silently
   skips missing files, so the wiki would have imported **zero pages** even with the
   path set. The importer takes an *explicit page list* — it does not auto-discover.

The maintainer's actual wiki is `docs/runescape-skill/` — 41 markdown pages
(`skills/*`, `npcs/*`, `places/*`, `quests/*`, `monsters.md`, `items.md`,
`economy.md`, …), all standard `# Title` markdown the importer can ingest verbatim.

## What changed

- `src/controller/knowledge/game-skill-entries.ts`: replaced the 4 phantom
  `STARTER_WIKI_PAGES` with a curated list of **22 real pages** (core skills,
  monsters/items/economy references, key places + NPCs, two starter quests). Hoisted
  the per-page cap into a named constant `WIKI_MAX_CHARS_PER_PAGE = 600`. Exported
  `STARTER_WIKI_PAGES` so a test can assert every path exists on disk.
- `controller.yml` (live, untracked, repo root): added
  `knowledge.runebenchWikiDir: ./docs/runescape-skill`. Verified the config loader
  resolves it and the boot status flips `disabled → configured`.
- New test `src/controller/knowledge/wiki-budget.test.ts` (the proof, see below).
- Updated the pre-existing fixture in `game-skill-entries.test.ts` to use a real
  curated path (`skills/combat.md`) instead of the removed `npcs/chicken.md`.

**No caps were lowered.** The existing caps (`maxCharsPerPage: 600`, retrieval
`limit: 8`, `tokenBudget: 1500`, `formatKnowledgeForPrompt maxChars: 1600`,
`renderSection` 2600-char section cap) were already sufficient; the measurement
confirmed worst-case stays well under budget, so nothing needed tightening.

## The byte math (why it cannot bloat)

The brain knowledge section is bounded by **four independent caps**, all enforced
*after* retrieval, so corpus size is irrelevant:

| Cap | Location | Value |
|-----|----------|-------|
| Per-page text truncation | `game-skill-entries.ts` → `wiki-importer.ts` | 600 chars/page |
| Retrieval result count | `game-skill-context.ts` `retrieveKnowledge({limit})` | 8 entries |
| Knowledge token budget | `game-skill-context.ts` `tokenBudget` | 1500 tokens |
| Knowledge block char cap | `game-skill-context.ts` `formatKnowledgeForPrompt({maxChars})` | 1600 chars |
| **Whole brain section cap** | `game-skill-context.ts` `renderSection(...)` | **2600 chars** |

`renderSection` adds sections one at a time and stops before exceeding the cap, so the
**worst-case injected knowledge is ~2600 chars (~2.6 KB)** regardless of how many wiki
pages exist. Against the S-INFER-3 ~11 KB total brain-prompt budget that is a small
fraction, and the test asserts a defensible 16 KB ceiling on the section (>5x margin).

Wiki entries do not *add* to the prompt — they *compete* with engine entries for the
same bounded slots. The perception (1.5x) and goal (3x) relevance boosts in
`knowledge-retriever.ts` keep contextually-relevant entries (engine or wiki) on top.

## Measured (jest, real docs/runescape-skill, 2026-05-31)

```
TOTAL_ENTRIES_WITH_WIKI 104  WITHOUT 82  WIKI_ENTRIES 22
MAX_WIKI_SUMMARY_CHARS 600     # per-page cap holds exactly

GOAL=make-fire       enabledBytes=1683 disabledBytes=2179 delta=-496 chars=1676
                     wikiHits=[woodcutting, items, monsters, prayer]
GOAL=safe-combat     enabledBytes=1619 disabledBytes=1988 delta=-369 chars=1608
                     wikiHits=[monsters, prayer, combat, items, cooking, wilderness]
GOAL=explore-varrock enabledBytes=1518 disabledBytes=1518 delta=0    chars=1517
                     wikiHits=[places/varrock, places/draynor-village, npcs/varrock]
```

- Worst-case injected-knowledge bytes: **1683 (≈1.7 KB)** in these scenarios; hard
  ceiling 2600 chars. Far under the 16 KB test ceiling and the ~11 KB brain budget.
- Delta from enabling the wiki: **≤ 0 bytes** in every scenario. `promptBudgetOk = true`.
- Wiki entries are retrieved in all scenarios → corpus is loaded and searchable.

## Gates

- `npm run check:no-ui` — PASS (server UI boundary clean).
- `npm run fin` — PASS: **3479 tests / 242 suites**, typecheck + lint + format green.

## Honesty / what is NOT proven

This proves the substrate (corpus loads, is searchable) and the safety bound (prompt
stays bounded) by unit test + measurement. It does **not** prove residents actually
*cite* the wiki in live trajectories — that requires a controller redeploy with the new
config, which the steward owns (the parent committed to stop restarting). A
RUNTIME-REQUEST is posted.

## Live-verify recipe (post-redeploy, steward)

1. Confirm boot log reads `wiki=configured` (was `wiki=disabled`).
2. Warm up the controller a few minutes so Brain calls land.
3. Grep a hero/agent trajectory for a wiki-sourced knowledge cite. Wiki entries carry
   `source` = an absolute path under `docs/runescape-skill/` and titles prefixed
   `RuneBench Wiki:`. Example:
   ```bash
   grep -rohE 'RuneBench Wiki: [A-Za-z ]+|runebench-wiki:[a-z/-]+' \
     data/controller/logs/ | sort | uniq -c | sort -rn | head
   ```
   Expect to see `runebench-wiki:*` ids appear in knowledge-retrieval/prompt context
   for combat/exploration goals. A say that references monsters/places content
   sourced from the wiki is the qualitative win.
4. Optional regression guard: re-run `npm run controller:inference-audit` and confirm
   usable-brain-rate did NOT drop (the prompt did not bloat past timeout pressure).
