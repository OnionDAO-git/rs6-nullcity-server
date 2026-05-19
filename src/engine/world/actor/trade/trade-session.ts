import { findItem, widgets } from '@engine/config/config-handler';
import type { Player } from '@engine/world/actor/player/player';
import type { Item } from '@engine/world/items/item';
import { ItemContainer } from '@engine/world/items/item-container';
import { logger } from '@runejs/common';
import { TRADE_MAX_ITEM_AMOUNT, TRADE_MAX_OFFER_SLOTS } from './trade-config';
import {
    type TradeOfferItem,
    type TradePerceptionState,
    type TradeResult,
    type TradeStage,
    emitTradeEvent,
    itemRef,
    playerActorRef,
} from './trade-events';

export class TradeSession {
    public stageA: TradeStage = 'editing';
    public stageB: TradeStage = 'editing';

    private readonly offerA: TradeOfferItem[] = [];
    private readonly offerB: TradeOfferItem[] = [];
    private closed = false;

    public constructor(
        public readonly id: string,
        public readonly a: Player,
        public readonly b: Player,
        private readonly onClose: (session: TradeSession) => void,
    ) {
        emitTradeEvent(this.a, { kind: 'trade_opened', partner: playerActorRef(this.b), sessionId: this.id });
        emitTradeEvent(this.b, { kind: 'trade_opened', partner: playerActorRef(this.a), sessionId: this.id });
        this.emitOfferUpdate();
    }

    public addItem(side: 'a' | 'b', inventorySlot: number, amount: number): TradeResult {
        if (this.closed) {
            return { ok: false, reason: 'trade_closed' };
        }

        const player = this.player(side);
        const offer = this.offer(side);
        if (offer.length >= TRADE_MAX_OFFER_SLOTS) {
            return { ok: false, reason: 'offer_full' };
        }
        if (!Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot >= player.inventory.size) {
            return { ok: false, reason: 'invalid_inventory_slot' };
        }
        if (!Number.isInteger(amount) || amount <= 0 || amount > TRADE_MAX_ITEM_AMOUNT) {
            return { ok: false, reason: 'invalid_amount' };
        }

        const item = player.inventory.items[inventorySlot];
        if (!item) {
            return { ok: false, reason: 'empty_inventory_slot' };
        }
        if (amount > item.amount) {
            return { ok: false, reason: 'insufficient_amount' };
        }

        const details = findItem(item.itemId);
        if (!details) {
            return { ok: false, reason: 'item_config_not_found' };
        }
        if (details.tradable === false) {
            return { ok: false, reason: 'item_untradeable' };
        }

        const moved: Item = { itemId: item.itemId, amount };
        if (amount === item.amount) {
            player.removeItem(inventorySlot);
        } else {
            player.inventory.set(inventorySlot, { itemId: item.itemId, amount: item.amount - amount });
            player.outgoingPackets.sendUpdateSingleWidgetItem(widgets.inventory, inventorySlot, player.inventory.items[inventorySlot]);
        }

        offer.push({ ...itemRef(moved), inventorySlot });
        this.resetStages();
        this.emitOfferUpdate();
        return { ok: true };
    }

    public removeItem(side: 'a' | 'b', offerSlot: number, amount: number): TradeResult {
        if (this.closed) {
            return { ok: false, reason: 'trade_closed' };
        }
        const offer = this.offer(side);
        const player = this.player(side);

        if (!Number.isInteger(offerSlot) || offerSlot < 0 || offerSlot >= offer.length) {
            return { ok: false, reason: 'invalid_offer_slot' };
        }
        if (!Number.isInteger(amount) || amount <= 0) {
            return { ok: false, reason: 'invalid_amount' };
        }

        const offered = offer[offerSlot];
        if (!offered || amount > offered.amount) {
            return { ok: false, reason: 'insufficient_amount' };
        }

        const returned: Item = { itemId: offered.itemId, amount };
        if (!player.inventory.canFit(returned)) {
            return { ok: false, reason: 'no_inventory_space' };
        }

        player.giveItem(returned);
        if (amount === offered.amount) {
            offer.splice(offerSlot, 1);
        } else {
            offered.amount -= amount;
        }

        this.resetStages();
        this.emitOfferUpdate();
        return { ok: true };
    }

    public requestStage(side: 'a' | 'b', stage: TradeStage): TradeResult {
        if (this.closed) {
            return { ok: false, reason: 'trade_closed' };
        }

        const current = this.stage(side);
        if (stage === 'accepted_2' && current !== 'accepted_1') {
            return { ok: false, reason: 'stage_1_not_accepted' };
        }

        this.setStage(side, stage);
        this.emitOfferUpdate();

        if (this.stageA === 'accepted_2' && this.stageB === 'accepted_2') {
            return this.tryCommit();
        }

        return { ok: true };
    }

    public decline(side: 'a' | 'b', reason = 'declined'): TradeResult {
        if (this.closed) {
            return { ok: false, reason: 'trade_closed' };
        }

        const otherReason = reason === 'death' ? 'partner_died' : reason === 'logout' ? 'partner_logged_out' : reason;
        emitTradeEvent(this.player(side), { kind: 'trade_cancelled', reason });
        emitTradeEvent(this.otherPlayer(side), { kind: 'trade_cancelled', reason: otherReason });
        this.returnOffers();
        this.close();
        return { ok: true };
    }

    public sideFor(player: Player): 'a' | 'b' | null {
        if (player.equals(this.a)) {
            return 'a';
        }
        if (player.equals(this.b)) {
            return 'b';
        }
        return null;
    }

    public perceptionFor(player: Player): TradePerceptionState | null {
        const side = this.sideFor(player);
        if (!side) {
            return null;
        }

        return {
            sessionId: this.id,
            partner: playerActorRef(this.otherPlayer(side)),
            ours: this.offer(side).map(({ inventorySlot: _inventorySlot, ...item }) => item),
            theirs: this.otherOffer(side).map(({ inventorySlot: _inventorySlot, ...item }) => item),
            ourStage: this.stage(side),
            theirStage: this.otherStage(side),
        };
    }

    private tryCommit(): TradeResult {
        if (!this.canReceive(this.a, this.offerB) || !this.canReceive(this.b, this.offerA)) {
            emitTradeEvent(this.a, { kind: 'trade_cancelled', reason: 'no_inventory_space' });
            emitTradeEvent(this.b, { kind: 'trade_cancelled', reason: 'no_inventory_space' });
            this.returnOffers();
            this.close();
            return { ok: false, reason: 'no_inventory_space' };
        }

        const preCommitA = this.cloneInventory(this.a);
        const preCommitB = this.cloneInventory(this.b);

        for (const item of this.offerB) {
            this.a.giveItem({ itemId: item.itemId, amount: item.amount });
        }
        for (const item of this.offerA) {
            this.b.giveItem({ itemId: item.itemId, amount: item.amount });
        }

        const savedA = this.a.save();
        const savedB = this.b.save();
        if (!savedA || !savedB) {
            logger.error(`Rolling back failed trade commit ${this.id} between ${this.a.username} and ${this.b.username}.`);
            this.restoreInventory(this.a, preCommitA);
            this.restoreInventory(this.b, preCommitB);
            this.returnOffers();
            this.a.save();
            this.b.save();
            emitTradeEvent(this.a, { kind: 'trade_cancelled', reason: 'save_failed' });
            emitTradeEvent(this.b, { kind: 'trade_cancelled', reason: 'save_failed' });
            this.close();
            return { ok: false, reason: 'save_failed' };
        }

        emitTradeEvent(this.a, {
            kind: 'trade_completed',
            received: this.offerB.map(({ inventorySlot: _inventorySlot, ...item }) => item),
            given: this.offerA.map(({ inventorySlot: _inventorySlot, ...item }) => item),
        });
        emitTradeEvent(this.b, {
            kind: 'trade_completed',
            received: this.offerA.map(({ inventorySlot: _inventorySlot, ...item }) => item),
            given: this.offerB.map(({ inventorySlot: _inventorySlot, ...item }) => item),
        });

        this.close();
        return { ok: true };
    }

    private cloneInventory(player: Player): Array<Item | null> {
        return player.inventory.items.map(item => (item ? { ...item } : null));
    }

    private restoreInventory(player: Player, items: Array<Item | null>): void {
        player.inventory.setAll(items.map(item => (item ? { ...item } : null)));
        player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
    }

    private canReceive(player: Player, incoming: ReadonlyArray<TradeOfferItem>): boolean {
        const simulated = new ItemContainer(player.inventory.size);
        simulated.setAll(
            player.inventory.items.map(item => (item ? { ...item } : null)),
            false,
        );
        for (const item of incoming) {
            const next = { itemId: item.itemId, amount: item.amount };
            if (!simulated.canFit(next)) {
                return false;
            }
            if (!simulated.add(next, false)) {
                return false;
            }
        }
        return true;
    }

    private returnOffers(): void {
        for (const item of this.offerA.splice(0, this.offerA.length)) {
            this.a.giveItem({ itemId: item.itemId, amount: item.amount });
        }
        for (const item of this.offerB.splice(0, this.offerB.length)) {
            this.b.giveItem({ itemId: item.itemId, amount: item.amount });
        }
    }

    private emitOfferUpdate(): void {
        emitTradeEvent(this.a, {
            kind: 'trade_offer_updated',
            ours: this.offerA.map(({ inventorySlot: _inventorySlot, ...item }) => item),
            theirs: this.offerB.map(({ inventorySlot: _inventorySlot, ...item }) => item),
            ourStage: this.stageA,
            theirStage: this.stageB,
        });
        emitTradeEvent(this.b, {
            kind: 'trade_offer_updated',
            ours: this.offerB.map(({ inventorySlot: _inventorySlot, ...item }) => item),
            theirs: this.offerA.map(({ inventorySlot: _inventorySlot, ...item }) => item),
            ourStage: this.stageB,
            theirStage: this.stageA,
        });
    }

    private resetStages(): void {
        this.stageA = 'editing';
        this.stageB = 'editing';
    }

    private close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.onClose(this);
    }

    private player(side: 'a' | 'b'): Player {
        return side === 'a' ? this.a : this.b;
    }

    private otherPlayer(side: 'a' | 'b'): Player {
        return side === 'a' ? this.b : this.a;
    }

    private offer(side: 'a' | 'b'): TradeOfferItem[] {
        return side === 'a' ? this.offerA : this.offerB;
    }

    private otherOffer(side: 'a' | 'b'): TradeOfferItem[] {
        return side === 'a' ? this.offerB : this.offerA;
    }

    private stage(side: 'a' | 'b'): TradeStage {
        return side === 'a' ? this.stageA : this.stageB;
    }

    private otherStage(side: 'a' | 'b'): TradeStage {
        return side === 'a' ? this.stageB : this.stageA;
    }

    private setStage(side: 'a' | 'b', stage: TradeStage): void {
        if (side === 'a') {
            this.stageA = stage;
        } else {
            this.stageB = stage;
        }
    }
}
