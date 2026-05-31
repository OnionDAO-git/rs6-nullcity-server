jest.mock('@engine/config/config-handler', () => ({
    xteaRegions: {},
}));

jest.mock('@server/game/game-server', () => ({
    serverConfig: {
        encryptionEnabled: false,
        loadedZoneScale: 4,
    },
}));

jest.mock('@engine/world', () => ({
    activeWorld: {},
}));

import { OutboundPacketHandler } from './outbound-packet-handler';
import { Position } from '@engine/world/position';
import { EventEmitter } from 'events';

describe('OutboundPacketHandler map rebuild packets', () => {
    function handlerAt(position: Position): OutboundPacketHandler {
        return new OutboundPacketHandler({
            position,
            lastMapRegionUpdatePosition: position,
            socket: { destroyed: false, write: jest.fn() },
            outCipher: null,
            playerEvents: new EventEmitter(),
        } as any);
    }

    it('expands REBUILD_NORMAL xtea keys when loadedZoneScale is greater than 1', () => {
        const position = new Position(3222, 3219, 0);
        const handler = new OutboundPacketHandler({ position } as any);
        const frame = handler.captureCurrentMapChunkFrame();

        expect(frame.opcode).toBe(166);
        expect(frame.payloadLength).toBe(9 + 49 * 16);
    });

    it('ignores far world item packets outside the loaded map area', () => {
        const position = new Position(3214, 3204, 0);
        const handler = handlerAt(position);

        expect(() => handler.setWorldItem({ itemId: 1944, amount: 1 } as any, new Position(3231, 3301, 0))).not.toThrow();
        expect(handler.getSpectatorPacketHistory()).toHaveLength(0);
    });

    it('ignores all far reference packets outside the loaded map area', () => {
        const position = new Position(3214, 3204, 0);
        const farPosition = new Position(3231, 3301, 0);
        const worldItem = { itemId: 1944, amount: 1 } as any;
        const locationObject = { objectId: 123, type: 10, orientation: 0 } as any;
        const handler = handlerAt(position);

        expect(() => handler.removeWorldItem(worldItem, farPosition)).not.toThrow();
        expect(() => handler.setLocationObject(locationObject, farPosition)).not.toThrow();
        expect(() => handler.removeLocationObject(locationObject, farPosition)).not.toThrow();
        expect(() => handler.updateReferencePosition(farPosition)).not.toThrow();
        expect(handler.getSpectatorPacketHistory()).toHaveLength(0);
    });

    it('allows reference offsets on packet boundaries', () => {
        const position = new Position(3214, 3204, 0);
        const handler = handlerAt(position);

        expect(() => handler.setWorldItem({ itemId: 1944, amount: 1 } as any, new Position(3016, 3008, 0))).not.toThrow();
        expect(() => handler.setWorldItem({ itemId: 1944, amount: 1 } as any, new Position(3271, 3263, 0))).not.toThrow();
        expect(handler.getSpectatorPacketHistory().length).toBeGreaterThan(0);
    });

    it('bounds spectator packet replay by bytes instead of retaining every large frame', () => {
        const position = new Position(3214, 3204, 0);
        const handler = handlerAt(position);
        const largeWidgetText = 'x'.repeat(4_000);

        for (let i = 0; i < 300; i += 1) {
            handler.updateWidgetString(1, i, largeWidgetText);
        }

        const history = handler.getSpectatorPacketHistory();
        const retainedBytes = history.reduce((total, frame) => total + frame.payloadBase64.length + frame.frameBase64.length, 0);

        expect(history.length).toBeLessThan(300);
        expect(retainedBytes).toBeLessThanOrEqual(1_500_000);
    });
});
