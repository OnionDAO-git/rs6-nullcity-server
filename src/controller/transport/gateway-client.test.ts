import { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import { GatewayClient } from './gateway-client';

describe('GatewayClient', () => {
    let server: WebSocketServer;
    let url: string;

    beforeEach(done => {
        server = new WebSocketServer({ port: 0 }, () => {
            const address = server.address() as AddressInfo;
            url = `ws://127.0.0.1:${address.port}`;
            done();
        });
    });

    afterEach(done => {
        server.close(() => done());
    });

    it('uses agent protocol frames for request and response correlation', async () => {
        const received = new Promise<unknown>(resolve => {
            server.once('connection', socket => {
                socket.once('message', raw => {
                    const message = JSON.parse(raw.toString()) as { id?: string | number };
                    resolve(message);
                    socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'ok', payload: { ok: true } }));
                });
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 500,
            reconnect: false,
        });

        await client.connect();
        await client.hello();
        client.close();

        expect(await received).toEqual({
            v: 1,
            id: expect.any(String),
            kind: 'controller_hello',
            payload: {
                controllerId: 'test-controller',
                version: '0.1.0',
                capabilities: ['residents.v1', 'noop-llm'],
            },
        });
    });
});
