# Launch Beta Cohort

Updated: 2026-06-12 00:27 UTC / 2026-06-11 evening CDT.

## Decision

The launch controller roster is capped to 9 residents in `config/controller.launch-beta.yml`.
The five functional QA archetypes are preserved as named launch souls, not public `QA *` residents.

| Resident | Role | Why included |
|---|---|---|
| `res:hans` | Public hero / greeter | Recognizable, narratable, good human-facing anchor. |
| `res:father-aereck` | Public hero / church | Recognizable, strong location identity and death/Library flavor. |
| `res:mother-anvil` | Public hero / forge | Distinct fantasy role, useful for craft/GP/NCRI storytelling. |
| `res:wise-old-man` | Public hero / lore | Recognizable, good conversational and Storyteller material. |
| `res:bramble-ash` | Skilling / fire proof | Named woodcutter-firemaker with a small achievable goal: keep visible fires and logs around Lumbridge. |
| `res:mara-kettle` | Cooking proof | Named cook with a small achievable goal: turn starter food into meals for residents in danger. |
| `res:brom-breadshield` | Combat/survival proof | Named survivor with a small achievable goal: live through danger by eating and retreating early. |
| `res:tally-copperpot` | GP/trade proof | Named quartermaster with a small achievable goal: complete fair small trades and narrate inventory. |
| `res:nix-lanternstep` | Movement/scouting proof | Named scout with a small achievable goal: map three safe short routes and return. |

## Excluded For Launch

`res:agent`, `res:duke-horacio`, `res:qa-guardian`, `res:qa-banker`, and `res:qa-social` are intentionally removed from the default controller roster for launch focus. They can come back after the beta cohort is boring-proof.

The old `res:qa-woodcutter`, `res:qa-cook`, `res:qa-survivor`, `res:qa-trader`, and `res:qa-scout` souls remain in the repo as test fixtures, but launch config uses their named replacements.

`res:wren-calix` and `res:severn-vesta` are not included yet because the live read-only smoke saw them as not online. Reconsider them only after they are alive and doing narratable things.

## Smoke Evidence

Read-only City API smoke on the running stack showed:

- Economy heartbeat healthy: `activeResidentCount=14`, `degradedFlags=[]`.
- The original functional archetypes returned `online=true` from `GET /api/nullcity/residents/:id/public-snapshot`.
- `res:wren-calix` and `res:severn-vesta` returned `online=false`.

The running controller still needs a steward restart/redeploy with `config/controller.launch-beta.yml` before the roster cut changes the live active count from 14 to 9. Do not restart the live stack casually; this is a launch runtime decision.

## Success Bar

For launch, do not try to fix every resident. The beta cohort is good enough when the dashboard can honestly say: these residents are alive and doing narratable things.
