# Trading — Agent Skill Reference

Agent-facing knowledge for resident-to-player and resident-to-resident trades in the 2006 RuneJS world (revision 435). For controller implementation, see `src/controller/actions/trading.ts` and the G4 section of `docs/superpowers/specs/2026-05-22-smarter-behavior-design.md`. For engine wire-format details, see `src/engine/world/actor/trade/`.

Trading is the resident's first **transactional human-interaction surface**. Every trade is a small decision: who is the other party, what is being moved, and is it worth doing. The resident decides. Even when a trusted human asks for an item, the resident may refuse — patrons do not control residents.

## What Trading Is

1. In-world, players right-click another visible player → `trade-with` → both sides see the **trade window**.
2. Each side adds items from their own inventory to their **offer slot**.
3. Both sides press the first `accept` (stage 1). The window then shows confirmed contents.
4. Both sides press the second `accept` (stage 2). Items move. The window closes.
5. At any point either side may **decline** — items return to their respective inventories.

For residents, the same flow is reachable through four typed `AgentAction` verbs:

- `trade_request` — open a trade window with a target.
- `trade_offer_item` — add an item from inventory to your offer.
- `trade_accept` — confirm the current offer (the kernel handles the two-stage protocol).
- `trade_decline` — back out and close the window.

## Initiate A Trade

1. Confirm the target is visible in the perception and within **2 tiles** (the engine's `TRADE_REQUEST_RANGE` is 1; the controller allows 2 so a one-tile walk-in works).
2. Confirm the resident is **not in combat**, HP fraction ≥ 0.2, and not mid-trade already.
3. Emit `trade_request` addressed by `residentId` (preferred for residents) or `playerHandle` (for humans). Example: `{ kind: 'trade_request', target: { playerHandle: 'codex' }, cause: 'direct_chat_trade' }`.
4. The engine emits a `trade_requested` event to the target. If they reciprocate, a `trade_opened` event arrives with a session id. The resident's `tradeState` transitions: `idle` → `awaiting_response` → `in_progress`.
5. If the target does not respond within ~30 ticks, narrate `say: "No answer — moving on."` and emit `trade_decline` with `reason: 'no_target'`.

## Offer An Item

1. Pick an item the resident actually owns and is willing to part with. Run `canOfferItem(inventory, itemId, quantity, slot?)` first — it returns `{ok: false, reason: '…'}` for `item_not_in_inventory`, `insufficient_quantity`, `slot_item_mismatch`, `slot_empty`, or `invalid_quantity`.
2. Emit `trade_offer_item`: `{ kind: 'trade_offer_item', itemId, quantity, slot?, cause? }`. Slot is optional — when omitted, the engine resolves the first matching slot.
3. Default surplus heuristic: logs (≥5), bones, cooked food. Never offer: tinderboxes (only one carried), small fishing nets, weapons in use.
4. After the offer lands, a `trade_offer_updated` event echoes the new offer state. Compare what the partner has offered using `estimateItemValue`.

## Accept Or Decline

1. **Value check** (trusted peers only). Estimate the partner's offered value with `estimateItemValue` against `DEFAULT_ITEM_VALUE_TABLE`. Acceptance rule: their value ≥ 50% of your offer's value.
2. If fair: `trade_accept` with `cause: 'fair_value_accept'`. The kernel issues the two-stage protocol and waits for the `trade_completed` event.
3. If unfair: `trade_decline` with `reason: 'unfair'` and a narration like `say: "That's not a fair trade — I'd need more."`.
4. Untrusted or stranger: `trade_decline` with `reason: 'cancelled'` and `say: "I don't know you well enough yet."`.
5. After completion (`trade_completed`) or cancellation, the resident's `tradeState` returns to `idle` (via the `reset` transition).

## Trust Tiers

Residents recognize three tiers when deciding whether to even engage:

| Tier | How earned | Behavior |
|---|---|---|
| **Trusted handle** | Listed in `soul.trustedHandles` (canonical: Codex, the maintainer's named patron). | Accept trade requests; engage proactively when surplus + presence conditions met. |
| **Earned standing** | Standing score above `TRADE_STRANGER_STANDING_THRESHOLD` (default 25) accumulated through positive interactions (chat acknowledgments, prior successful trades). | Accept reactive trade requests; do NOT initiate proactively without a direct ask. |
| **Stranger** | Anyone else (standing unknown or below threshold). | Decline with `reason: 'cancelled'`, narrate `say: "I don't know you well enough yet."`. |

NPC actors are never tradable. Always-refuse: NPCs (`reason: npc_not_tradable`), in-combat (`in_combat`), currency-shaped offers (`currency_offers_refused`), offers above `TRADE_MAX_OFFER_VALUE` (`offer_value_exceeds_cap`).

## Currency-Shaped Items (Refuse-On-Sight)

Refuse offers that look like a fungible store of value the resident shouldn't be ferrying around for a human:

- itemId `995` (RuneScape canonical `coins` / gp).
- Any item key matching `/\b(coins?|gp|shards?|blood_?money|tokens?)\b/i`. This includes Null City Shards.

This is the **anti-laundering invariant**: trades move *things the resident makes or finds*, not abstract value. If a patron wants to give the resident money, they can drop it; the resident is not a payment relay.

## Failure Modes And Recovery

| Symptom | Recovery |
|---|---|
| Target not visible at trade_request time | Don't emit. `canRequestTrade` returns `target_not_visible`. Narrate `say: "I don't see you nearby."`. |
| Target moved out of range after request | Decline with `reason: 'cancelled'`. Optionally walk one tile toward last-known position. |
| Target inventory full at completion | Engine emits `trade_cancelled` with reason. Resident transitions to `cancelled`; narrate `say: "Your inventory is full."`. |
| Resident's offered item disappears (dropped, eaten) | `canOfferItem` returns `item_not_in_inventory` on retry. Decline with `reason: 'cancelled'`. |
| Partner repeatedly modifies offer without accepting | After ~50 ticks in `in_progress` without an accept event, decline with `reason: 'partner_silent_too_long'` (free-form reason allowed). |
| Trade engine returns `target_too_far` | Walk to within 1 tile, then re-request. The kernel's `tradeStateTransition('idle', 'request_sent')` is the only path forward. |

## Success Signals

- Trade window opens (perception event `trade_opened` with a sessionId).
- Offer mirror visible: `trade_offer_updated` shows your `ours` and partner's `theirs`.
- Both `accept` stages clear (`ourStage: 'accepted_2'`, `theirStage: 'accepted_2'`).
- `trade_completed` event lists `received` and `given` items.
- Inventory delta: offered items disappear from your inventory; received items appear.
- Resident's `tradeState` returns to `idle` cleanly via the `reset` transition.

## Proactive Trade Offers (Trusted Patrons Only)

Per G4 spec, the resident may initiate a trade with a trusted patron when:

- Patron is visible within `TRADE_OFFER_RADIUS` (default 6).
- Patron has been in earshot for ≥30 ticks.
- Resident has ≥5 logs, OR ≥3 cooked fish, OR 2+ tinderboxes.
- No active combat, HP > 50%, no help-request pending.
- No proactive offer to this peer in the last 600 ticks (cooldown).

On all conditions met: `say: "I've got spare logs — want some?"` (phrasebook), then on the next tick `trade_request`. Decline-on-silence handles the "nothing happens" path.

## When To Speak

Use voice to make trades legible to observers:

- On `trade_request`: `say: "Trading with ${name}."` (status_cooldown gated).
- On `trade_accept`: `say: "Done. Thanks."`.
- On `trade_decline`: phrasebook reason — `"Not this time."`, `"That's not a fair trade — I'd need more."`, `"I don't know you well enough yet."`.
- On stale trade (50+ ticks active): `say: "Trading with Foo. I offered logs, waiting on them."` (capped at one narration per `TRADE_STATUS_COOLDOWN` = 20 ticks).

Voice phrasing should match `soul.voice.register` — terse for laconic souls, warmer for hospitable ones. The phrasebook is the inference-free fallback.

---

## Cross-references

- **Combat**: trades are blocked while in combat. See `skills/combat.md` § Run When Outmatched for the survival-over-trade rule.
- **Items value table**: `src/controller/actions/trading.ts` `DEFAULT_ITEM_VALUE_TABLE`. Extend through PRs.
- **Patron loop (J spec)**: `docs/superpowers/specs/2026-05-22-patron-loop-design.md` § J5/J8 — patron-initiated request events that trigger `tradeReaction`.
- **Cross-resident lore (L spec)**: `docs/superpowers/specs/2026-05-22-cross-resident-lore-design.md` — the `gift` verb is the **resident-to-resident** sibling of `trade_request`; gifts skip the accept/decline negotiation and are one-shot.
- **G4 spec**: `docs/superpowers/specs/2026-05-22-smarter-behavior-design.md` § G4.
- **Controller kernel**: `src/controller/actions/trading.ts` (typed verbs + preconditions + safety predicate).
- **Engine wire format**: `src/engine/world/actor/resident/action/agent-action.ts` and `src/engine/world/actor/trade/trade-engine.ts`.
