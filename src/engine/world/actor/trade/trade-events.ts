import { findItem } from '@engine/config/config-handler';
import type { Player } from '@engine/world/actor/player/player';
import type { ActorRef, ItemRef } from '@engine/world/actor/resident/action/agent-action';
import type { Resident } from '@engine/world/actor/resident/resident';
import { isResident } from '@engine/world/actor/util';
import type { Item } from '@engine/world/items/item';

export type TradeStage = 'editing' | 'accepted_1' | 'accepted_2';

export interface TradeOfferItem extends ItemRef {
    inventorySlot: number;
}

export interface TradePerceptionState {
    sessionId: string;
    partner: ActorRef;
    ours: ReadonlyArray<ItemRef>;
    theirs: ReadonlyArray<ItemRef>;
    ourStage: TradeStage;
    theirStage: TradeStage;
}

export type TradeEvent =
    | { kind: 'trade_requested'; from: ActorRef }
    | { kind: 'trade_opened'; partner: ActorRef; sessionId: string }
    | {
          kind: 'trade_offer_updated';
          ours: ItemRef[];
          theirs: ItemRef[];
          ourStage: TradeStage;
          theirStage: TradeStage;
      }
    | { kind: 'trade_completed'; received: ItemRef[]; given: ItemRef[] }
    | { kind: 'trade_cancelled'; reason: string };

export type TradeResult = { ok: true; reason?: string } | { ok: false; reason: string };

export const itemRef = (item: Item): ItemRef => ({
    itemId: item.itemId,
    key: findItem(item.itemId)?.key,
    amount: item.amount,
});

export const playerActorRef = (player: Player): ActorRef => ({
    id: isResident(player) ? (player as Resident).residentId : `player:${player.username.toLowerCase()}`,
    kind: isResident(player) ? 'resident' : 'player',
    name: player.username,
    position: { x: player.position.x, y: player.position.y, level: player.position.level },
    hpFraction: player.skills.hitpoints.level / Math.max(1, player.skills.getMaxLevel('hitpoints')),
});

export const emitTradeEvent = (player: Player, event: TradeEvent): void => {
    if (isResident(player)) {
        player.emitPerceptionEvent(event);
        return;
    }

    switch (event.kind) {
        case 'trade_requested':
            player.sendMessage(`${event.from.name || 'Someone'} wishes to trade with you.`);
            break;
        case 'trade_opened':
            player.sendMessage(`Trading with ${event.partner.name || 'player'}.`);
            break;
        case 'trade_offer_updated':
            player.sendMessage(`Trade offer updated.`);
            break;
        case 'trade_completed':
            player.sendMessage(`Trade completed.`);
            break;
        case 'trade_cancelled':
            player.sendMessage(`Trade declined: ${event.reason}.`);
            break;
    }
};
