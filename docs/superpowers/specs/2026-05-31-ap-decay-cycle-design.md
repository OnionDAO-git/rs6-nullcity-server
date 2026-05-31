# S-AP-CYCLE-DESIGN-1 — AP Organic Cycle: Root Cause + Post-Chicago Fix

Spec date: 2026-05-31.
Owner: unclaimed.
Status: **Design only — no code change. Schedule after 2026-06-02 (post-Chicago).**
Packet id: `S-AP-CYCLE-DESIGN-1`
Issue: `QA-20260531-054`

---

## Why this spec

Multiple 60-minute normal-life audits (QA-20260529-006, latest: `CQA10-fresh-gp-scan-60m`) consistently
show `apGpExchangeEvents=0` despite `aboveRunwayThresholdWithGpResidents=5`: five residents hold real
coin item `995` but their AP never dips below the 300 AP self-initiation threshold in an hour-long
unconditioned window.

The CIC meetup loop (humans earn AP → support residents → residents spend AP → earn GP → redeem) only
CLOSES autonomously when residents organically need to self-fund. Without organic AP drain below the
threshold, the loop requires an operator manually draining a resident's AP via the admin endpoint.

---

## Root cause

**AP drain rate vs. exchange threshold are mismatched by ~10×.**

Per `src/controller/spark/attention.ts`:
- Standard curve: **1 AP per resident tick** (each decision cycle, ~every 5-12 seconds under live load)
- Per-action spend: 0.5–2 AP (say, move_to, attack, etc.)
- Per-LLM-complete: **5 AP**

Observed rate from 60m audit data (6694 actions / 23 residents / 60 min ≈ 4.8 actions/resident/min):
- Tick decay at ~8 decision cycles/min: **~8 AP/min**
- Action spend at 4.8 actions/min × ~1 AP avg: **~5 AP/min**
- LLM spend at ~1 Brain call per action cycle × 5 AP: **~8-10 AP/min**
- **Total: ~21–23 AP/min per resident**

Default starting attention: **5000 AP** (from `AttentionProfile.startingAttention || 5000`).

Time to reach the 300 AP exchange threshold from 5000 AP at 21 AP/min:
```
(5000 - 300) / 21 ≈ 224 minutes ≈ 3.7 hours
```

For heroes with `floor=5000`, they NEVER drop below 5000 AP — the exchange threshold of
`floor + 20 = 5020` is unreachable because AP is clamped at floor.

**Result**: residents earning GP via combat (S-GP-FUEL-1, S-GP-HARVEST-1) are almost entirely heroes
with floors. Their GP accumulates but can never trigger a self-initiated exchange. Cohort residents
without floors need 3+ hours of uninterrupted operation to trigger once.

---

## Demo workaround (use at Chicago)

The admin drain endpoint ships in this codebase:
```
POST /api/nullcity/admin/residents/:id/ap-drain
Body: { "amount": 4800, "reason": "demo: trigger AP/GP exchange cycle" }
```
Drains resident to ~200 AP. The self-initiation reflex fires on the next nervous-system tick,
spending GP item 995 to restore ~500 AP runway. This is visible in `/economy/live`.

Recommended demo script: drain `res:qa-guide` (already proven organic exchanger) or
`res:qa-banker`, observe the `city_exchange_ap_gp` event appear within 30s.

---

## Fix options (post-Chicago, choose one)

### Option A — Raise the no-floor exchange threshold (lowest risk)
Change `SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD` from 300 → ~3000 and
`SELF_INITIATED_EXCHANGE_TARGET_RUNWAY_AP` from 500 → 3500.

Effect: no-floor residents with GP self-fund any time their AP drops below 3000 (roughly every
90–120 min of continuous operation).

Tradeoff: heroes with floor=5000 still never trigger (threshold for floor residents = floor+20 = 5020,
but they're clamped at 5000). Heroes need Option B or C to participate.

Files: `src/controller/spark/self-initiated-ap-gp-exchange.ts` (constants only).
Test changes: `self-initiated-ap-gp-exchange.test.ts` thresholds.
Risk: low.

### Option B — Per-tick AP decay scaled to make exchange visible within ~30 min (medium risk)
Keep threshold at 300 but raise the standard `decayByCurve.standard` from 1 → 5.

Effect: no-floor residents drain 5× faster; 5000 AP drains to 300 in ~45 min. Heroes unaffected
(clamped at floor). Benchmarks use `steep` (2 AP/tick); standard becomes 5 AP/tick.

Tradeoff: residents without GP would die 5× faster; must tune starting attention upward or
add patron automation. Could cause unexpected deaths if patron grants don't keep pace.

Files: `src/controller/spark/attention.ts` (one constant), soul-schema defaults.
Risk: medium — affects ALL residents, not just exchange reflex.

### Option C — Heroes participate via "GP surplus → AP reserve" top-up (cleanest long-term)
When a hero holds GP above a configurable surplus threshold (e.g., 500 GP) AND AP is within
10% of floor, proactively convert GP → AP. Hero floors stay stable; surplus GP cycles back
into AP visibility.

Effect: makes the hero GP-earning / hero AP-maintenance loop visible. Heroes earn GP via combat
(S-GP-FUEL-1), then spend some on AP top-up, creating a visible self-sustaining cycle even with
a high floor.

Tradeoff: requires new reflex logic and a per-soul surplus-threshold configuration.

Files: `src/controller/spark/self-initiated-ap-gp-exchange.ts` (new `heroSurplusExchange` helper),
wired into `src/controller/nervous-system/nervous-system.ts` or spark.ts.
Risk: medium — new decision path, needs focused tests.

### Option D — Resident GP earnings fund AP automatically (architectural)
When a `city_gold_observed` event fires (resident picks up GP), automatically trigger a small
AP grant proportional to the GP amount. Turns every GP pickup into an AP event.

Tradeoff: bypasses the explicit exchange action (less visible). Requires city-integration wiring.
Probably post-event infrastructure decision with the maintainer.

---

## Recommended packet

**S-AP-CYCLE-1** (post-Chicago, schedule 2026-06-02+):
1. Implement **Option A** (raise no-floor threshold to 3000) — easiest, provable with a 30m
   unconditioned audit.
2. Add a `residentsApproachingExchangeThreshold` audit field to `normal-life-audit.ts` so the
   operator can see how far each GP-holding resident is from triggering.
3. Evaluate Option C (hero surplus top-up) in a separate packet after Option A proves out.

Evidence gate: `npm run controller:normal-life-audit -- --duration-ms=1800000` shows
`organicSelfInitiatedApGpExchangeEvents >= 3` across at least 2 different residents in 30 min
with no operator drain.

---

## Open decision for maintainer

What's the intended cadence of the AP/GP cycle? The CIC meetup implies "residents spend AP to live and
earn GP to refund it." Three design choices depend on this:

1. **Fast cycle (≤60 min)**: residents exchange once per hour. Option A at threshold=3000 or
   Option B at decay×5.
2. **Slow cycle (hours)**: exchange is rare, driven by operator patron activity. Current behavior
   is acceptable; demoed via admin drain. Threshold stays at 300.
3. **GP-driven cycle**: residents only exchange after accumulating GP above a minimum. Option C.

Recommend (1) for post-Chicago: it makes the economy alive without requiring operator intervention.
