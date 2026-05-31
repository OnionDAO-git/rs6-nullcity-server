# QA031 - Low-Health Cook/Eat/Re-Engage Soak

Date: 2026-05-30 CDT / 2026-05-31 UTC
Branch: `agents/wip`
Resident: `res:qa-survivor`

## Question

After QA027/QA028/QA029/QA030 fixed the first survival blockers, can the live named resident perform the full loop?

`hurt -> fish -> cook -> eat -> safely re-engage combat`

## Harness Change

Added an opt-in strict mode to `npm run controller:combat-soak`:

```bash
npm run controller:combat-soak -- \
  --resident res:qa-survivor \
  --target goblin \
  --prefix survive \
  --duration-ms=180000 \
  --poll-ms=500 \
  --require-low-health-recovery-chain \
  --output-dir data/benchmarks/capability-qa-2026-05-30/qa031-low-health-cook-eat-reengage
```

The new `--require-low-health-recovery-chain` verifier requires ordered action-log evidence:

1. successful low-health fishing action,
2. successful low-health cooking action,
3. successful low-health eating action,
4. later successful safe re-engage attack against the requested target.

The verifier also rejects a re-engage attack against a different safe target, because "attack Man" should not satisfy a `--target goblin` recovery proof.

## Unit Verification

```bash
npm test -- --runInBand src/controller/admin/named-combat-soak.test.ts
```

Result: PASS, 15 tests.

Added tests cover:

- passing ordered fish/cook/eat/re-engage chain,
- failing if the safe attack happens before eating,
- failing if re-engage attacks a different target than requested,
- CLI parsing for `--require-low-health-recovery-chain`.

## Live Result

Before running the soak, the live resident was checked for the small fishing net:

```bash
npm run controller:ensure-inventory -- --resident res:qa-survivor --item 303 --amount 1
```

Result: `ok: true`, `previousAmount: 1`, `addedAmount: 0`.

The 180s chain-required soak failed usefully:

```json
{
  "status": "failed",
  "failureReason": "Resident refused combat while low on health before a safe attack",
  "metrics": {
    "ordinaryActionEntries": 11,
    "commandSubmitted": 1,
    "perceptionCount": 300,
    "attackActions": 0,
    "safeAttackActions": 0,
    "unsafeAttackActions": 0,
    "lowHealthRefusals": 2,
    "combatEvidence": 0,
    "deathEvents": 0,
    "lowHealthFishActions": 0,
    "lowHealthCookActions": 0,
    "lowHealthEatActions": 0,
    "lowHealthRecoveryReengageAttacks": 0,
    "lowHealthRecoveryChain": 0
  }
}
```

Artifact:

`data/benchmarks/capability-qa-2026-05-30/qa031-low-health-cook-eat-reengage/named_combat_soak_20260531022908.json`

## Root-Cause Evidence

The resident did not reach the food chain. It repeatedly tried to walk from the Lumbridge courtyard cluster toward the same combat waypoint and made no pathing progress:

```json
{"action":{"kind":"move_to","target":{"x":3249,"y":3238,"level":0},"range":6,"cause":"combat_seek_safe_target"},"result":{"ok":true,"status":"queued","requestId":"controller-1780194540319-4408"}}
```

Trajectory final-result evidence for that request:

```json
{
  "kind": "action_result",
  "requestId": "controller-1780194540319-4408",
  "status": "timeout",
  "reason": "timeout",
  "evidence": {
    "kind": "movement_timeout",
    "target": { "x": 3249, "y": 3238, "level": 0 },
    "range": 6,
    "startPosition": { "x": 3234, "y": 3237, "level": 0 },
    "finalPosition": { "x": 3234, "y": 3236, "level": 0 },
    "startDistance": 15,
    "finalDistance": 15,
    "improved": false,
    "timeoutMs": 22000
  }
}
```

This means QA031 did not fail at cooking logic yet. It failed earlier: target seeking repeatedly selected `{3249,3238}` and the actor could not path closer from `{3234,3236/3237}` inside the soak window.

Read-only sidecar review narrowed the likely code cause:

- `combatTrainingAction` has a single fixed fallback waypoint near `{x:3249,y:3238}` when no safe target is visible.
- `resident-runtime` already records no-progress movement timeouts into `targetFailureCooldowns`.
- The combat goal path in `hybrid-agent-helpers.ts` was not passing those cooldowns into `combatTrainingAction`.
- The body routine can therefore re-emit the same failed `combat_seek_safe_target` before active-move/stuck recovery has a chance to take over.

## Important Harness Caveat

The action log records the controller's immediate queued ACK for submitted actions. For strict future proof, the low-health recovery verifier should also join each action's `requestId` to trajectory `action_result` finality. This QA031 patch improves the chain shape and target specificity, but a later harness hardening packet should make the proof effect-aware before closing the combat survival issue.

## Status

Not proven.

What is proven:

- The soak can now demand the exact ordered low-health fish/cook/eat/re-engage chain.
- The live resident stayed alive and made no unsafe attacks during this failed soak.
- The next blocker is now concrete: combat target seeking/pathing to the safe target waypoint, not raw-food accounting or missing net inventory.

## Next Packet

QA032 should fix combat seek/movement recovery before rerunning the chain:

1. Add a regression around `combat_seek_safe_target` choosing/repeating an unreachable waypoint from the Lumbridge courtyard.
2. Pass target-failure cooldowns into combat/prayer training from the hybrid thinking helper.
3. Make fallback combat waypoint selection target-failure aware; if the waypoint is cooling down and no safe NPC is visible, fall through to exploration/stuck recovery instead of replaying the failed move.
4. Re-run the same chain-required soak.
5. Harden the verifier to connect queued action log entries to final trajectory `action_result` by `requestId`.
