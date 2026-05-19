import type { Player } from '@engine/world/actor/player/player';
import { TradeSession } from '@engine/world/actor/trade/trade-session';
import { ItemContainer } from '@engine/world/items/item-container';

jest.mock('@engine/config/config-handler', () => ({
    findItem: jest.fn((itemId: number) => ({
        gameId: itemId,
        key: `test:item_${itemId}`,
        stackable: false,
        tradable: true,
    })),
    widgets: {
        inventory: { widgetId: 149, containerId: 0 },
    },
}));

jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            itemStore: {
                getItem: jest.fn(() => ({ stackable: false })),
            },
        },
    },
}));

const makePlayer = (username: string, firstItemId: number, saveResults: boolean[]): Player => {
    const inventory = new ItemContainer(28);
    inventory.set(0, { itemId: firstItemId, amount: 1 }, false);

    return {
        username,
        inventory,
        position: { x: 0, y: 0, level: 0 },
        skills: {
            hitpoints: { level: 10 },
            getMaxLevel: jest.fn(() => 10),
        },
        outgoingPackets: {
            sendUpdateSingleWidgetItem: jest.fn(),
            sendUpdateAllWidgetItems: jest.fn(),
        },
        equals(other: Player) {
            return other === this;
        },
        giveItem(item: number | { itemId: number; amount: number }) {
            return inventory.add(typeof item === 'number' ? { itemId: item, amount: 1 } : item) !== null;
        },
        removeItem(slot: number) {
            inventory.remove(slot);
        },
        save: jest.fn(() => saveResults.shift() ?? true),
        sendMessage: jest.fn(),
    } as unknown as Player;
};

describe('TradeSession', () => {
    it('rolls back escrowed items when either participant fails to save on commit', () => {
        const a = makePlayer('alice', 1, [true, true]);
        const b = makePlayer('bob', 2, [false, false]);
        const onClose = jest.fn();
        const session = new TradeSession('trade-rollback', a, b, onClose);

        expect(session.addItem('a', 0, 1)).toEqual({ ok: true });
        expect(session.addItem('b', 0, 1)).toEqual({ ok: true });
        expect(a.inventory.items[0]).toBeNull();
        expect(b.inventory.items[0]).toBeNull();

        expect(session.requestStage('a', 'accepted_1')).toEqual({ ok: true });
        expect(session.requestStage('b', 'accepted_1')).toEqual({ ok: true });
        expect(session.requestStage('a', 'accepted_2')).toEqual({ ok: true });
        expect(session.requestStage('b', 'accepted_2')).toEqual({ ok: false, reason: 'save_failed' });

        expect(a.inventory.items[0]).toEqual({ itemId: 1, amount: 1 });
        expect(b.inventory.items[0]).toEqual({ itemId: 2, amount: 1 });
        expect(a.save).toHaveBeenCalledTimes(2);
        expect(b.save).toHaveBeenCalledTimes(2);
        expect(onClose).toHaveBeenCalledWith(session);
    });
});
