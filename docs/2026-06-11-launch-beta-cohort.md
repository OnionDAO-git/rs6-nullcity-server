# Launch Beta Cohort

Updated: 2026-06-12 00:27 UTC / 2026-06-11 evening CDT.

## Decision

The launch controller roster is capped to 9 residents in `controller.yml`:

| Resident | Role | Why included |
|---|---|---|
| `res:hans` | Public hero / greeter | Recognizable, narratable, good human-facing anchor. |
| `res:father-aereck` | Public hero / church | Recognizable, strong location identity and death/Library flavor. |
| `res:mother-anvil` | Public hero / forge | Distinct fantasy role, useful for craft/GP/NCRI storytelling. |
| `res:wise-old-man` | Public hero / lore | Recognizable, good conversational and Storyteller material. |
| `res:qa-woodcutter` | Skilling proof | Demonstrates basic resource gathering. |
| `res:qa-cook` | Cooking proof | Demonstrates food/cooking loops. |
| `res:qa-survivor` | Combat/survival proof | Keeps survival behavior visible without broadening the roster. |
| `res:qa-trader` | GP/trade proof | Keeps economy/trade behavior visible. |
| `res:qa-scout` | Movement/scouting proof | Keeps exploration and route behavior visible. |

## Excluded For Launch

`res:agent`, `res:duke-horacio`, `res:qa-guardian`, `res:qa-banker`, and `res:qa-social` are intentionally removed from the default controller roster for launch focus. They can come back after the beta cohort is boring-proof.

`res:wren-calix` and `res:severn-vesta` are not included yet because the live read-only smoke saw them as not online. Reconsider them only after they are alive and doing narratable things.

## Smoke Evidence

Read-only City API smoke on the running stack showed:

- Economy heartbeat healthy: `activeResidentCount=14`, `degradedFlags=[]`.
- The chosen 9 residents returned `online=true` from `GET /api/nullcity/residents/:id/public-snapshot`.
- `res:wren-calix` and `res:severn-vesta` returned `online=false`.

The running controller still needs a steward restart/redeploy before the `controller.yml` roster cut changes the live active count from 14 to 9. Do not restart the live stack casually; this is a launch runtime decision.

## Success Bar

For launch, do not try to fix every resident. The beta cohort is good enough when the dashboard can honestly say: these residents are alive and doing narratable things.
