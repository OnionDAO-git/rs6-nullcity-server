# SPARK Module Experiments

Use this process to compare reviewed SPARK modules without mistaking scripted smokes for autonomous play.

## Experiment Loop

1. Pick one module id/version and one task from the roadmap.
2. Record the controller commit, module config, model profile, and whether the run is scripted or autonomous.
3. Run the benchmark or live smoke.
4. Inspect action, inference, and telemetry logs for module id/version, request ids, and failure reasons.
5. Update the roadmap with the result before opening a PR that changes resident behavior.

## Commands

Current benchmark tasks are scripted engine smokes:

```bash
npm run controller:bench -- --task make-fire-5m --module onion.runescape.standard --dry-run
npm run controller:bench -- --task explore-report-5m --module onion.runescape.standard --dry-run
```

Do not use scripted smoke scores as proof that the module made autonomous decisions. C6 must add autonomous mode before benchmark scores can rank modules.

## What To Compare

- Pass/fail and score.
- Time to first useful action.
- Invalid or repeated actions.
- Unsafe actions.
- Inference call count and token counts when available.
- Clear chat/status reports visible to a human.
- Whether the action evidence proves a real game effect.

## Artifact Expectations

Artifacts should include module id/version, task id/version, run mode, resident, model profile, commit or dirty state, action attempts, inference summaries, telemetry, and failure reason. Railgun runs should also include the instance id and artifact URI or durable path.
