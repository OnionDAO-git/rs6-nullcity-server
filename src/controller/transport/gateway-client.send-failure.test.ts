import WebSocket from 'ws';
import { GatewayClient } from './gateway-client';

describe('GatewayClient send failure handling', () => {
    it('releases pending requests and action slots when socket.send throws synchronously', async () => {
        const sendError = new Error('synthetic send failure');
        const client = new GatewayClient({
            url: 'ws://127.0.0.1:1',
            controllerId: 'test-controller',
            requestTimeoutMs: 250,
            actionQueueTimeoutMs: 30,
            maxConcurrentActions: 1,
            reconnect: false,
        });

        (client as unknown as { socket: { readyState: number; send: () => never; close: () => void } }).socket = {
            readyState: WebSocket.OPEN,
            send: () => {
                throw sendError;
            },
            close: () => undefined,
        };

        await expect(client.submitActionWithRequestId('res:one', { kind: 'noop' })).rejects.toThrow('synthetic send failure');
        expect((client as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
        expect((client as unknown as { activeActionSlots: number }).activeActionSlots).toBe(0);

        await expect(client.submitActionWithRequestId('res:two', { kind: 'noop' })).rejects.toThrow('synthetic send failure');
        expect((client as unknown as { activeActionSlots: number }).activeActionSlots).toBe(0);

        client.close();
    });
});
