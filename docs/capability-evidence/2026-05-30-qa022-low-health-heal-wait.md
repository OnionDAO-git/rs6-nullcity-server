# QA-20260530-022 low-health heal-wait evidence

Date: 2026-05-30 17:45-17:50 CDT

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

`lowHealthHoldPositionAction` now emits a real, tracked `noop` action with cause `low_health_heal_wait` when the low-health speech beacon is deduped. This keeps residents visibly alive in trajectory/action accounting without spamming repeated “I am hurt” speech.

The first eligible stranded beacon still says the resident is hurt and holding near safety. During the speech dedupe window, the resident records heal-wait action evidence instead of producing an unbounded empty decision loop.

## Verification

- `npm run check:no-ui`: PASS.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "heal-wait action" --runInBand --coverage=false`: PASS, 1 targeted regression.
- `npx jest src/controller/thinking/hybrid-agent-thinking-module.test.ts -t "low health|low_health|low-health|heal-wait" --runInBand --coverage=false`: PASS, 4 targeted low-health tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, SWC compiled 799 files.
- `npm run test:fin`: PASS, 217 suites and 3004 tests.
- `npm run lint`: PASS, 973 files checked with no fixes applied.

## Live Follow-Up

This fix was verified at unit/build level. The running controller still needs a controlled restart before live `controller:smoke` can prove that `res:qa-guardian` and `res:qa-survivor` now emit `low_health_heal_wait` actions instead of empty `low_health_stranded` loops.
