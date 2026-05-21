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

describe('OutboundPacketHandler map rebuild packets', () => {
    it('expands REBUILD_NORMAL xtea keys when loadedZoneScale is greater than 1', () => {
        const position = new Position(3222, 3219, 0);
        const handler = new OutboundPacketHandler({ position } as any);
        const frame = handler.captureCurrentMapChunkFrame();

        expect(frame.opcode).toBe(166);
        expect(frame.payloadLength).toBe(9 + 49 * 16);
    });
});
