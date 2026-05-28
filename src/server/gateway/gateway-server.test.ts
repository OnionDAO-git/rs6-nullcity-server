import { EventEmitter } from 'node:events';
import { createConnection } from 'net';

import { ByteBuffer } from '@runejs/common';

import { GatewayServer, upstreamTarget } from './gateway-server';

jest.mock('net', () => ({
    createConnection: jest.fn(),
}));

jest.mock('@engine/net/isaac', () => ({
    Isaac: jest.fn(),
}));

jest.mock('@engine/world', () => ({
    activeWorld: {
        playerOnline: jest.fn(),
    },
}));

jest.mock('@engine/world/actor/player/player', () => ({
    Player: jest.fn(),
}));

jest.mock('@server/game/game-server-connection', () => ({
    GameServerConnection: jest.fn(),
}));

describe('GatewayServer upstream connections', () => {
    beforeEach(() => {
        jest.mocked(createConnection).mockReset();
    });

    it('uses loopback when a configured upstream host is a bind-all address', () => {
        expect(upstreamTarget('update', '0.0.0.0', 43592)).toEqual({ host: '127.0.0.1', port: 43592 });
        expect(upstreamTarget('login', '::', 43591)).toEqual({ host: '127.0.0.1', port: 43591 });
        expect(upstreamTarget('login', '[::]', 43591)).toEqual({ host: '127.0.0.1', port: 43591 });
        expect(upstreamTarget('update', 'game.internal', 43592)).toEqual({ host: 'game.internal', port: 43592 });
    });

    it('closes the client when the update server upstream fails', () => {
        const clientSocket = mockSocket();
        const updateServerSocket = mockSocket();
        jest.mocked(createConnection).mockReturnValue(updateServerSocket);

        const gateway = new GatewayServer(clientSocket);
        const handshake = new ByteBuffer(2);
        handshake[0] = 15;
        handshake[1] = 0;

        expect(gateway.initialHandshake(handshake)).toBe(true);
        expect(createConnection).toHaveBeenCalledWith({ host: '127.0.0.1', port: 43592 });

        updateServerSocket.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:43592'));

        expect(clientSocket.destroy).toHaveBeenCalledTimes(1);
    });

    it('closes both sides when the update server upstream times out', () => {
        const clientSocket = mockSocket();
        const updateServerSocket = mockSocket();
        jest.mocked(createConnection).mockReturnValue(updateServerSocket);

        const gateway = new GatewayServer(clientSocket);
        const handshake = new ByteBuffer(2);
        handshake[0] = 15;
        handshake[1] = 0;

        expect(gateway.initialHandshake(handshake)).toBe(true);

        updateServerSocket.emit('timeout');

        expect(updateServerSocket.destroy).toHaveBeenCalledTimes(1);
        expect(clientSocket.destroy).toHaveBeenCalledTimes(1);
    });
});

function mockSocket(): any {
    const socket = new EventEmitter() as any;
    socket.destroy = jest.fn();
    socket.setKeepAlive = jest.fn();
    socket.setNoDelay = jest.fn();
    socket.setTimeout = jest.fn();
    socket.write = jest.fn();
    socket.destroyed = false;
    socket.writable = true;
    return socket;
}
