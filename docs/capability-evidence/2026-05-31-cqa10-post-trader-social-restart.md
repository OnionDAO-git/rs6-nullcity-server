# CQA10 Post Trader/Social Restart

Date: 2026-05-31

## Question

After restarting the controller onto `S-SOCIAL-KEEPALIVE-1` and `S-TRADER-TRADE-1`, do the social/trader residents show visible intentional behavior, and does stuck churn improve?

## Commands

```bash
scripts/post-restart-smoke.sh
npm run controller:smoke -- --observe-seconds 60 --allow-recent-visible
npm run controller:normal-life-audit -- --duration-ms 600000 --output-dir data/benchmarks/capability-qa-2026-05-31/cqa10-post-trader-social-restart
```

## Artifacts

- `data/benchmarks/capability-qa-2026-05-31/cqa10-post-trader-social-restart/normal_life_audit_20260531T120751Z.json`
- Controller restart log: `/tmp/nullcity-controller-stack-social-keepalive-1.log`

## Result

Mixed. The rebuilt controller loaded the new trader/social code and the residents visibly spoke, but the progress/stuck tracker still treats those intentional keepalive says as no-progress intervals.

## Evidence

- Controller restarted as pid `92498` with `23` residents online.
- `scripts/post-restart-smoke.sh` returned READY WITH WARNINGS: controller alive, `23/23` residents alive, inbox/health/library routes reachable, and only recent-activity warnings for low-activity residents.
- `controller:smoke` observed most residents OK but returned non-zero because `res:qa-trader` was classified as `decision_loop_without_actions:follow_listen_hold`.
- 10m normal-life audit:
  - Residents: `23`
  - Action submissions: `1221/1221` successful
  - Deaths/logouts: `0`
  - `lowHealthWaits`: `0`
  - Combat/eat/cook/XP still active: `combatActions=2`, `eatingActions=12`, `cookingActions=44`, `combatResupplyActions=47`, `xpEvents=24`
  - Trade recurrence: `tradeRequests=0`, `tradeCompleted=0`, `tradeCancelled=0`
  - Stuck summary: `stuckDetected=79`, `stuckRecovered=51`, `unresolved=28`

Resident slices:

| Resident | Successful actions | Visible keepalive | Stuck signal | Interpretation |
|---|---:|---:|---:|---|
| `res:qa-trader` | `9/9` | `trade_keepalive=2` | `10 detected / 7 recovered / 3 unresolved` | Trade starter speech works, but no tester/player was visible, so no actual trade request/close happened. |
| `res:qa-social` | `21/21` | `social_keepalive=13` | `9 detected / 8 recovered / 1 unresolved` | Social keepalive works repeatedly, but intentional speech is still surrounded by stuck churn. |
| `res:agent` | `9/9` | `0` | `9 detected / 9 recovered / 0 unresolved` | Still a top generic churn resident and should remain a separate target. |

## Conclusion

`S-SOCIAL-KEEPALIVE-1` and `S-TRADER-TRADE-1` loaded correctly and produced visible human-facing behavior. The next fix should not be another trader/social seed tweak; it should make the progress tracker recognize successful intentional public speech causes such as `social_keepalive` and `trade_keepalive` as meaningful visible progress, while preserving true stuck detection for generic loops and failed actions.

## Follow-Up

- `S-VISIBLE-SPEECH-PROGRESS-1`: treat successful `say` actions with `social_keepalive` / `trade_keepalive` as meaningful progress evidence.
- Real trade closure still needs a visible tester/player or a controlled named-trade proof after restart.
