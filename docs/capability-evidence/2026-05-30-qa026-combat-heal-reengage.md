# QA-20260530-026 — combat heal/re-engage live soak

Packet: `QA-20260530-026` / `CQA5b`

Resident: `res:qa-survivor`

## Question

Can an ordinary named resident recover after combat and then re-engage, rather than
dying, looping unsafe attacks, or sitting in an opaque idle state?

## Commands

```bash
npm run build
screen -dmS nullcity-controller zsh -lc 'cd /Users/james/Code/OnionDAO/rs6-nullcity-server && node dist/controller/index.js --config=/Users/james/Code/OnionDAO/rs6-nullcity-server/controller.yml --mcp-http-port=43610 --letters-http-port=43596 --wall-redact --city-http-port=43611 --city-http-token=operator-token 2>&1 | tee /tmp/nullcity-controller-demo.log'

npm run controller:smoke -- --resident res:qa-survivor --observe-seconds=60 --allow-recent-visible --json

npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --prefix survive \
  --duration-ms=300000 \
  --poll-ms=500 \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa026-combat-heal-reengage
```

## Results

Initial resident smoke passed:

```json
{
  "resident": "res:qa-survivor",
  "status": "ok",
  "recent": { "actions": 13, "results": 18, "successes": 16, "failures": 0, "timeouts": 2, "says": 4, "decisions": 16 },
  "observed": { "durationMs": 60000, "actions": 13, "successes": 16, "timeouts": 2, "visibleEvents": 35 },
  "lastAction": "attack",
  "lastSay": "Down."
}
```

The 5-minute combat heal/re-engage soak failed, but produced useful evidence:

```json
{
  "artifactPath": "data/benchmarks/capability-qa-2026-05-30/qa026-combat-heal-reengage/named_combat_soak_20260531010315.json",
  "status": "failed",
  "score": 0,
  "metrics": {
    "ordinaryActionEntries": 496,
    "commandSubmitted": 1,
    "perceptionCount": 501,
    "attackActions": 0,
    "safeAttackActions": 0,
    "unsafeAttackActions": 0,
    "lowHealthRefusals": 1,
    "combatEvidence": 1,
    "bonesEvidence": 1,
    "prayerEvidence": 0,
    "survivalActions": 495,
    "deathEvents": 0
  },
  "failureReason": "Resident refused combat while low on health before a safe attack"
}
```

Action-cause histogram inside the artifact:

```text
495 low_health_heal_wait
1   say
```

Timeline context shows this was a real post-combat state, not a cold-start
failure:

- `2026-05-31T00:57:23Z`: first Attack XP in the active session.
- `2026-05-31T00:57:25Z`: first Hitpoints XP in the active session.
- `2026-05-31T00:58:15Z`: resident said, "My health is too low to fight right now."
- From tick 415 through tick 910, the resident emitted `low_health_heal_wait`
  noops, did not die, and did not submit unsafe attacks.

The live save also explains why re-engage failed: `data/residents/res:qa-survivor.json`
showed an empty inventory after earlier combat tests. The soul starts with three
shrimp, but those starter supplies had already been consumed by prior live runs.

## Assessment

This is a survival pass but a recovery/re-engage failure.

What works:

- Resident refused to fight while low health.
- Resident avoided unsafe attacks.
- Resident did not die.
- The state is now observable as `low_health_heal_wait` rather than silent idle.

What does not work yet:

- A foodless, hurt combat resident can strand at the recovery waypoint for many
  ticks.
- The resident does not reliably rest back above the safe threshold within a
  5-minute soak.
- The resident does not resupply food before or after combat once starter food is
  exhausted.

## Next Fix

Implement a combat recovery loop that can complete without operator help:

1. Before combat, avoid starting a voluntary fight with no carried food unless HP is
   high enough and the target is extremely safe.
2. When hurt and foodless, gather or acquire food instead of waiting forever:
   prefer visible cooked food, then starter fishing/cooking if the resident has a
   net/raw fish, then a safe food-source route.
3. Add a benchmark assertion for "hurt -> food/recover -> re-engage" rather than
   only "hurt -> refuse."

Keep `QA-20260529-004` open until this re-engage loop passes on at least one named
resident and one benchmark clone.
