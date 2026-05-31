# S-EXCHANGE-RUNWAY-1 - No-Floor AP/GP Self-Funding Threshold

Date: 2026-05-31

## TL;DR

The one-hour CQA10 soak showed residents with real GP and falling AP were not self-funding because no-floor residents only exchanged below the emergency `20 AP` buffer. This packet raises only the no-floor trigger band to `300 AP`, preserving floor-protected residents' existing `floor + 20` behavior.

## Why

`docs/capability-evidence/2026-05-31-cqa10-60m-companion-soak.md` showed:

- `res:qa-social` ended at low AP while holding real GP.
- `res:qa-angler` ended at low AP while holding real GP.
- Both stayed above the old no-floor emergency threshold, so neither emitted `city_exchange_ap_gp`.

The exchange substrate itself was already proven by `S-EXCHANGE-RECURRENCE-2`; the gap was when ordinary no-floor residents decide to use it.

## Change

File: `src/controller/spark/self-initiated-ap-gp-exchange.ts`

- Added `SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD = 300`.
- Residents with declared attention floors still use `attentionFloor + SELF_INITIATED_EXCHANGE_GP_FLOOR_BUFFER`.
- Residents without declared floors now self-fund when AP is below `300`, as long as they hold at least `10` real GP item `995`.
- Existing spend guards remain unchanged: 2 AP per GP, target 500 AP runway, max 250 GP burned per exchange.

## Red/Green Evidence

Red command:

```bash
npm test -- --runInBand src/controller/spark/self-initiated-ap-gp-exchange.test.ts src/controller/nervous-system/nervous-system.test.ts --no-coverage
```

Expected failures observed:

- Missing `SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD` export.
- No-floor nervous-system integration at `181 AP` returned no self-funding reaction.

Green command:

```bash
npm test -- --runInBand src/controller/spark/self-initiated-ap-gp-exchange.test.ts src/controller/nervous-system/nervous-system.test.ts --no-coverage
```

Result: 2 suites passed, 53 tests passed.

Additional gates:

```bash
npm run check:no-ui
npm run build
```

Results:

- `check:no-ui`: server UI boundary clean.
- `build`: 817 files compiled successfully.

## Risk Notes

- Overspend remains bounded by `SELF_INITIATED_EXCHANGE_MAX_GP = 250`.
- The trigger is below the 500 AP target, so residents do not churn tiny top-offs at 499 AP.
- Floor residents keep the previous behavior; this avoids forcing GP burns for hero/floor profiles that are meant to ask humans near their floor.

## Next Verification

Restart the controller on a build containing this commit, then rerun a 30-60m CQA10 normal-life audit. Expected improvement: at least one GP-backed no-floor resident should emit `nervous:self-initiated-ap-gp-exchange`, `city_exchange_ap_gp`, `city_gold_burn`, and `city_attention_credit` without a directed benchmark.
