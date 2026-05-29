# Capability Evidence Notes

Use this folder for append-only evidence notes produced by CQA packets.

`docs/resident-capabilities.md` is the human rollup. To avoid many agents editing the same large table at once, a CQA agent may first write a focused note here, then either update the rollup in the same cycle or leave the note for the QA Marshal to fold in.

## File Naming

Use:

```text
YYYY-MM-DD-<packet>-<short-capability>.md
```

Examples:

- `2026-05-29-CQA1-natural-cook-ingredients.md`
- `2026-05-29-CQA5-combat-survival-qwen-qwopus-haiku.md`

## Template

```md
# <Capability> Evidence — <YYYY-MM-DD>

| Field | Value |
|---|---|
| Packet | CQA# |
| Issue | QA-YYYYMMDD-### |
| Capability row | <row name in docs/resident-capabilities.md> |
| Resident(s) | <resident ids; disposable or named> |
| Mode | scripted / autonomous benchmark / normal controller / operator |
| Model profile(s) | <profile names> |
| Endpoint(s) | <inference endpoints or local profile names> |
| Command | `<exact command>` |
| Artifact(s) | benchmark:<runId>, live-log:<resident>:<date>, timeline:<resident>:<event> |
| Result | pass / fail / partial |

## Claim Tested

<One sentence.>

## Success Criteria

- <metric 1>
- <metric 2>
- <metric 3>

## Evidence Summary

<Short summary of the run, including selected-module actions and game-state deltas when applicable.>

## Root Cause If Failed

Layer: perception / action adapter / SPARK routine / prompt / knowledge / pathing / inventory-equipment / trade FSM / world-plugin / model / unknown

<Short root-cause note.>

## Capability Doc Update

Suggested update for `docs/resident-capabilities.md`:

> <exact concise text or table-cell replacement>

## Follow-Up

<Issue id or next packet.>
```
