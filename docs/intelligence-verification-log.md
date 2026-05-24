# Intelligence Verification Log

**Purpose.** Append-only log of resident-intelligence experiments and findings, run during the 48h autonomous sprint of 2026-05-24 → 2026-05-26 and beyond. See `docs/superpowers/specs/2026-05-24-48h-sprint-design.md` for the sprint design + experiment queue.

**Audience.** The maintainer (James) scans this on Tuesday to assess what residents actually do well + badly. Codex reads this on bootstrap and can pick up any entry tagged `BODY` or `DESIGN` that smells fixable from their territory.

**Append-only.** Do not edit prior entries. To revise, add a new entry with `Follow-up to E-N`.

---

## Failure taxonomy (per `2026-05-24-48h-sprint-design.md` § Failure taxonomy)

| Code | Meaning | Owner-of-fix (default) |
|---|---|---|
| `DESIGN` | Wrong rule/routine/hook fires, or the routine itself is wrongly specified | claude (substrate) or Codex (monolith) |
| `INFERENCE` | Brain LLM returned bad / empty / repetitive / off-topic output | claude (prompt/knowledge) |
| `BODY` | Action emitted correctly but body adapter didn't realize it | Codex (monolith) |
| `PERCEPTION` | Brain didn't see relevant context | claude (perception/knowledge) |
| `KNOWLEDGE` | Brain knew the wrong / nothing / outdated info | claude (knowledge files) |
| `ENGINE` | Game-side bug (gateway, kernel, plugin) | engine maintainer (not us) |

---

## Entry template

```markdown
### E-N — short experiment title

**Status:** OPEN | RESOLVED-by-Codex@<sha> | RESOLVED-by-claude@<sha> | RESOLVED-noop
**Tier:** 1 (read-only) | 2 (claude-as-human) | 3 (synthetic hard) | 4 (design hole)
**Date:** YYYY-MM-DD HH:MM agent

**Hypothesis.** One sentence: what we expected to see.
**Repro.** Exact command(s) / file path(s) / experiment setup someone else could re-run.
**Observation.** What actually happened. Quote actual sample text/JSON where short enough; cite file paths + line numbers where long.
**Classification.** DESIGN | INFERENCE | BODY | PERCEPTION | KNOWLEDGE | ENGINE — one code, with a sentence explaining why this layer.
**Suggested next step.** One paragraph. Concrete. Names a file or function or commit.
**Owner suggestion.** claude | Codex | maintainer | engine.

(If RESOLVED, append:)
**Resolution.** What changed + commit SHA. Date.
```

---

## Experiments

*(empty — first entry follows this commit)*
