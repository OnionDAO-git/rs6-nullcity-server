# Resident souls

Soul files are authored markdown documents with YAML frontmatter. The controller loads one file per configured resident and never mutates it at runtime.

Required frontmatter:

- `name`: resident id, for example `res:pip`
- `archetype`: `mentor`, `achiever`, or `endurer`

Common optional fields:

- `display`, `voice`, `fears`, `loves`
- `attentionProfile.startingAttention`
- `attentionProfile.decayCurve`: `gentle`, `standard`, or `steep`
- `legacy.kind` and `legacy.parameters`
- `model.endpoint` and `model.temperature`
- `startingBeliefs`
- `spawnPosition`
- `variables`: deterministic scalar state recomputed each tick
- `hooks`: soul-owned hooks, capped to priority `80`

Resident-authored changes belong in `data/memory/<resident>/`, not in souls.
