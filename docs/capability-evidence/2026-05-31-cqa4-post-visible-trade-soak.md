# CQA4 Post-Visible Trade Soak

Date: 2026-05-31

## Scope

After `S-TRADER-TRADE-1` and `S-VISIBLE-SPEECH-PROGRESS-1`, prove the current rebuilt stack can still close the safe named-resident trade path, not merely say trade instructions.

This is controlled named-resident proof, not a manual human/player proof.

## Commands

The first attempt failed before behavior proof because the game gateway/controller socket reset during a stack recycle:

```bash
npm run controller:trade-soak -- --resident res:qa-trader --unsafe-repeats=3 --duration-ms=180000 --poll-ms=500 --output-dir data/benchmarks/capability-qa-2026-05-31/cqa4-post-visible-trade-soak-1
# [controller:trade-soak] read ECONNRESET
```

Root-cause notes:

- Controller process was gone after repeated gateway `list_residents` timeouts.
- Game gateway came back on `127.0.0.1:43595`; controller was restarted on `43610` / `43596` / `43611`.
- A 30-second live smoke after restart exited non-zero only for `res:qa-banker` movement timeout; `res:qa-trader` was live, saying keepalive trade instructions, and not warning on `follow_listen_hold`.
- A second attempt with long peer names failed with `EBAD_NAME`, so the final pass used shorter controlled peer names.

Inventory seed:

```bash
npm run controller:ensure-inventory -- --resident res:qa-trader --item 1511 --amount 2
```

Observed:

```json
{"ok":true,"resident":"res:qa-trader","itemId":1511,"requestedAmount":2,"previousAmount":0,"amount":2,"addedAmount":2}
```

Final proof:

```bash
npm run controller:trade-soak -- \
  --resident res:qa-trader \
  --trusted-peer res:codex-cqa4v \
  --unsafe-peer res:alice-cqa4v \
  --unsafe-repeats=3 \
  --duration-ms=180000 \
  --poll-ms=500 \
  --output-dir data/benchmarks/capability-qa-2026-05-31/cqa4-post-visible-trade-soak-1
```

## Artifact

`data/benchmarks/capability-qa-2026-05-31/cqa4-post-visible-trade-soak-1/named_trade_soak_20260531123430.json`

## Result

Passed, score `1`.

Key metrics:

```json
{
  "tradeRequests": 4,
  "trustedTradeRequests": 1,
  "unsafeTradeRequests": 3,
  "safeItemOffers": 1,
  "acceptStage1": 1,
  "acceptStage2": 1,
  "unsafeDeclines": 3,
  "tradeCompletedEvents": 1,
  "tradeCancelledEvents": 3,
  "safeInventoryBefore": 16,
  "safeInventoryAfter": 15,
  "safeInventoryDelta": -1,
  "postUnsafeOffersOrAccepts": 0
}
```

Ordinary `res:qa-trader` action log proof:

- `trade_request` to trusted `res:codex-cqa4v`
- `trade_offer_item`
- `trade_accept_stage_1`
- `trade_accept_stage_2`
- `trade_request` to unsafe `res:alice-cqa4v` repeated 3 times
- `trade_decline` with `trade_decline_untrusted_partner` repeated 3 times

Engine events include one `trade_completed` and three `trade_cancelled` events.

## Conclusion

Fresh post-restart proof confirms `res:qa-trader` can still close a safe named-resident trade and refuse repeated unsafe trade prompts after the visible-speech progress patch. This upgrades the post-`S-TRADER-TRADE-1` confidence from "trade instructions visible" to "controlled named-resident trade closure works on the current stack."

Remaining gaps:

- True human/player operator proof.
- Ordinary-life recurrence without a directed trade soak command.
- Broader economy loop where residents gather/allocate GP, trade NCRI-relevant items, and surface those offers to humans.
