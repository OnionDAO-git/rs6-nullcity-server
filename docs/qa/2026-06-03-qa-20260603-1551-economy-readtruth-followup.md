# QA Follow-up: Economy Read Truth Still Stale

Packet: `qa-20260603-1551-economy-readtruth`

Date: `2026-06-03`

Classification: `READ-ONLY`

## Scope

Re-check the AP/GP dashboard read path after the earlier `qa-20260603-1403-apgp-ncri-readtruth` handoff. Confirm whether the human-facing dashboard still contradicts the live controller/runtime state.

## Runtime context

- Shared runtime owner remains the active Codex desktop thread per `docs/runtime-stewardship.md`.
- No services were restarted.
- No resident/AP/GP/NCRI/story state was mutated.

## Evidence

### Source 1: live controller smoke

Command:

```bash
npm run controller:smoke -- --observe-seconds 5 --allow-recent-visible
```

Observed:

- Memory root: `data/controller/memory`
- Active residents observed: `10`
- Live cohort proved active during the window:
  - `res:agent`
  - `res:hans`
  - `res:qa-woodcutter`
  - `res:qa-cook`
  - `res:qa-survivor`
  - `res:qa-guardian`
  - `res:qa-trader`
  - `res:qa-banker`
  - `res:qa-social`
  - `res:qa-scout`
- Result summary: `9 OK / 1 WARN`
- The only warning was `res:qa-guardian` with `issues=effect_timeouts:1`

Interpretation:

The live controller cohort is active now. This rules out a simple "controller is down / no residents are moving" explanation for the economy page's zero-activity claims.

### Source 2: live attendee dashboard route

Route:

```text
http://127.0.0.1:5174/economy
```

Observed visible copy:

- `31 residents carrying 599,246.5 AP`
- `0 RESIDENTS WITH ECONOMY EVENTS IN 15M`
- `AP DELTA 0`
- `GP DELTA 0`
- `ACTIVE 0`
- `CONTROLLER HEARTBEAT 10 / 31 residents active`
- `281 ECONOMY EVENTS`
- `LAST GP OBSERVED 14H AGO`
- `DIGEST 4M AGO`
- `0 AP/GP EVENTS`

Interpretation:

The same human-facing economy page simultaneously reports:

1. the controller heartbeat sees `10 / 31` residents active now, and
2. the economy live window reports `ACTIVE 0` with no AP/GP events in-window.

That is the same contradiction flagged earlier. The stale-economy read problem is still live on the attendee surface.

### Source 3: live operator dashboard route

Route:

```text
http://127.0.0.1:5174/debug
```

Observed visible copy:

- `GATEWAY connected`
- `CONTROLLER available`
- `ONLINE 10`
- `RUNTIME 27`
- `Resident cohort 10 ACTIVE IN CONTROLLER COHORT; 13 PAUSED/COHORT-EXCLUDED OF 23 KNOWN RESIDENTS`

Interpretation:

Operator/debug truth matches the smoke result: the runtime is up and the controller cohort is active. That makes the attendee economy page's `ACTIVE 0` state misleading, not merely conservative.

## Result

Status: `Reproduced`

The stale economy read-path mismatch remains present on the live dashboard:

- controller/runtime truth says the city is active now,
- attendee economy truth still renders `ACTIVE 0` and a dead 15-minute AP/GP window.

## Safe next action

- Update the canonical issue row for `QA-20260603-090` when `docs/issue-register.md` is no longer dirty in another thread.
- Dev follow-up should trace the dashboard/BFF economy window source and explain why controller heartbeat is fresh while economy window activity remains stale/zeroed.

## Notes

- Shell and local Node HTTP probes were blocked in this sandbox with `connect EPERM`, so route verification used the in-app browser plus local smoke output.
- No repo code was changed in this packet.
