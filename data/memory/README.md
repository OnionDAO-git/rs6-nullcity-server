# Resident memory

Each resident gets a directory named from a safe resident slug. The controller owns the following files:

- `INDEX.md`: always included in prompt envelopes and useful as a manual overview.
- `hooks.md`: controller-managed JSON-backed hooks and variables proposed by completions.
- `runtime-state.json`: attention, tick counters, budgets, cooldowns, and deceased markers.
- `events/`, `social/`, `items/`, `geography/`, `monsters/`, `skills.md`: routed memories and memo writes.

If `qmd` is available, the controller attempts to add each resident directory as a collection and query it for reflective excerpts. If `qmd` is missing or returns an unexpected shape, the controller falls back to markdown reads and keeps running.

Manual edits are allowed, but keep paths inside the resident directory. LLM memo writes reject absolute paths and `..` segments.
