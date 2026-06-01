# QA-20260530-022 low-health heal-wait evidence

Date: 2026-05-30 17:45-18:04 CDT

## Problem

The live dress smoke flagged `res:qa-guardian` and `res:qa-survivor` as quiet/catatonic because both were low on health, standing at a recovery waypoint, carrying no edible food, and repeatedly returning empty `low_health_stranded` decisions.

Latest hot-stack trajectory sample before the fix:

- `res:qa-guardian`: 4 current-session decisions, all `low_health_stranded`, 0 actions/results/speech.
- `res:qa-survivor`: 4 current-session decisions, all `low_health_stranded`, 0 actions/results/speech.

Command used:

```sh
python3 - <<'PY'
import json, pathlib, collections
for res in ['res-qa-guardian','res-qa-survivor']:
  p=pathlib.Path('data/controller/memory')/res/'runtime-state.json'
  d=json.load(open(p)) if p.exists() else {}
  print(res, {k:d.get(k) for k in ['tick','attention','lastMeaningfulProgressAt','stuckSince','deceased']})
  trajs=sorted((pathlib.Path('data/controller/memory')/res/'evidence/trajectory').glob('*.jsonl'), key=lambda x:x.stat().st_mtime)
  traj=trajs[-1]
  kinds=collections.Counter(); causes=collections.Counter(); actions=collections.Counter()
  for line in open(traj):
    if not line.strip(): continue
    o=json.loads(line); kinds[o.get('kind')]+=1
    if o.get('cause'): causes[o.get('cause')]+=1
    a=o.get('action')
    if isinstance(a,dict): actions[a.get('kind')]+=1
  print(traj)
  print('kinds', dict(kinds)); print('causes', dict(causes)); print('actions', dict(actions))
PY
```

## Fix

`lowHealthHoldPositionAction` now emits a real, tracked `noop` action with cause `low_health_heal_wait` when the low-health speech beacon is deduped or not due yet. This keeps residents visibly alive in trajectory/action accounting without spamming repeated “I am hurt” speech.

The first eligible stranded beacon still says the resident is hurt and holding near safety. Between speech beacons, the resident records heal-wait action evidence instead of producing an unbounded empty decision loop.

## Verification

- `npm run check:no-ui`: PASS.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "heal-wait action" --runInBand --coverage=false`: PASS, 1 targeted regression.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "low health|low_health|low-health|heal-wait" --runInBand --coverage=false`: PASS, 4 targeted low-health tests.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "beacon is not due" --runInBand --coverage=false`: RED, then PASS after adding quiet heal-wait action for the non-beacon branch.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "low health|low_health|low-health|heal-wait|recovery waypoint" --runInBand --coverage=false`: PASS, 7 targeted low-health/recovery tests.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts --runInBand --coverage=false`: PASS, 255 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, SWC compiled 799 files.
- `npm run lint`: PASS, 973 files checked with no fixes applied.
- `npm run test:fin`: PASS, 217 suites and 3006 tests after the S-STORY-2 queue-snapshot packet landed.

## Live Result

Controlled restart loaded the fresh build into `screen` session `nullcity-controller`, PID `64648`, with the same controller ports and flags.

- `bash scripts/post-restart-smoke.sh --no-color`: READY WITH WARNINGS (9 yellow), but `res:qa-guardian` is now green with 27 rows and 6 actions in the last 5 minutes; `res:qa-survivor` is green with 26 rows and 2 actions.
- `npm run controller:smoke -- --observe-seconds 120 --min-observed-actions 1 --allow-recent-visible --resident res:qa-guardian --resident res:qa-survivor`: PASS.
  - `res:qa-guardian`: OK, observed +106 ticks, 40 actions, 41 results, 40 successes, lastAction=`noop`, lastResult=`success`, lastSay=`I am hurt at 3217,3223. Holding near safety until I find food or heal.`
  - `res:qa-survivor`: OK, observed +107 ticks, 11 actions, 11 results, 8 successes, 1 timeout, 1 failure.

Remaining yellow rows in post-restart smoke are other residents with recent rows but no actions; the original low-health guardian/survivor blocker is cleared.
