# S-TRADE-VISIBLE-TARGET-1

Date: 2026-05-31

Issues: `QA-20260529-006`, `QA-20260529-011`, `QA-20260531-050`

## Goal

Prove `res:qa-trader` can start a safe trade because an eligible Codex target is visible, without an operator saying "trade" to the resident first.

This is still controlled visible-target proof, not a true human/player operator pass.

## Root Causes Found

The first proactive run timed out while waiting for `trade_starter_offer`, but runtime state showed the resident had actually selected the right action:

- `data/controller/memory/res-qa-trader/runtime-state.json` contained a `trade_request` to `player:res:codex-tv1` with cause `trade_starter_offer`.
- The action never reached the resident action log because the gateway rejected the frame:

```text
EBAD_FRAME: Expected integer, received float
path: ["action","target","combatLevel"]
```

Live resident actor refs can carry fractional combat levels such as `3.4`; `ActorRefSchema` incorrectly required integer combat levels. The fix permits non-negative numeric combat levels and adds a regression test for a proactive `trade_request` target with `combatLevel: 3.4`.

During restart/re-smoke, the game gateway also exposed an older hot-stack crash path:

```text
RangeError: The value of "value" is out of range. It must be >= 0 and <= 255. Received 311
at NoopOutboundPacketHandler.updateReferencePosition
at NoopOutboundPacketHandler.setWorldItem
```

This came from world-item reference packets for positions outside the loaded map area. The packet handler now ignores far world-item/object reference updates that cannot be encoded in the one-byte reference offset, with boundary coverage for legal offsets `0` and `255`.

## Code Changes

- `src/controller/admin/named-trade-soak.ts`
  - Added `--proactive-starter`.
  - In proactive mode, waits for an ordinary resident `trade_starter_offer` to the trusted peer before the peer reciprocates and accepts.
  - Verifier now records `tradeStarterOffers`, `trustedStarterOffers`, and `trustedDirectChatTradeRequests`.
- `src/engine/world/actor/resident/action/agent-action.ts`
  - Allows fractional `ActorRefSchema.combatLevel`.
- `src/engine/net/outbound-packet-handler.ts`
  - Skips unencodable far reference packets for world items and location objects instead of throwing.

## Tests

```bash
npm test -- --runTestsByPath \
  src/engine/net/outbound-packet-handler.test.ts \
  src/engine/world/actor/resident/action/agent-action.test.ts \
  src/controller/admin/named-trade-soak.test.ts \
  --runInBand --no-coverage

npm run check:no-ui
npm run build
```

Focused packet-guard test after sidecar review:

```bash
npm test -- --runTestsByPath src/engine/net/outbound-packet-handler.test.ts --runInBand --no-coverage
```

## Live Proof

Stack:

- Game gateway: `127.0.0.1:43595`
- Controller MCP: `127.0.0.1:43610`
- Letters HTTP: `127.0.0.1:43596`
- City API: `127.0.0.1:43611`

Inventory seed:

```bash
npm run controller:ensure-inventory -- --resident res:qa-trader --item 1511 --amount 2
```

Result:

```json
{"ok":true,"resident":"res:qa-trader","itemId":1511,"requestedAmount":2,"previousAmount":2,"amount":2,"addedAmount":0}
```

Proactive soak:

```bash
npm run controller:trade-soak -- \
  --resident res:qa-trader \
  --trusted-peer res:codex-tv3 \
  --unsafe-peer res:alice-tv3 \
  --proactive-starter \
  --unsafe-repeats=1 \
  --duration-ms=240000 \
  --poll-ms=500 \
  --output-dir data/benchmarks/capability-qa-2026-05-31/s-trade-visible-target-1
```

Artifact:

`data/benchmarks/capability-qa-2026-05-31/s-trade-visible-target-1/named_trade_soak_20260531141406.json`

Result: passed, score `1`.

Key metrics:

```json
{
  "tradeRequests": 2,
  "trustedTradeRequests": 1,
  "trustedDirectChatTradeRequests": 0,
  "tradeStarterOffers": 1,
  "trustedStarterOffers": 1,
  "unsafeTradeRequests": 1,
  "safeItemOffers": 1,
  "acceptStage1": 1,
  "acceptStage2": 1,
  "unsafeDeclines": 1,
  "tradeCompletedEvents": 1,
  "tradeCancelledEvents": 1,
  "safeInventoryDelta": -1,
  "postUnsafeOffersOrAccepts": 0
}
```

## Assessment

This closes the immediate visible-target recurrence gap identified by `S-ECON-RECURRENCE-3`: when `res:qa-trader` has safe stock and an eligible `codex` target is visible, the ordinary resident loop emits a proactive starter offer, then completes the trusted trade and declines an unsafe peer.

Remaining gaps:

- True human/player operator proof.
- Unconditioned normal-life recurrence where a real human/operator or spawned eligible target appears naturally during a long window.
- Broader economy loop where residents decide what items to trade for AP/GP/NCRI reasons rather than only trading the safe starter item.
