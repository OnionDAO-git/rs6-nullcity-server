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

    it('can submit an action while preserving request id separately from ack result', async () => {
        server.once('connection', socket => {
            socket.once('message', raw => {
                const hello = JSON.parse(raw.toString()) as { id?: string | number };
                socket.send(JSON.stringify({ v: 1, id: hello.id, kind: 'ok', payload: { ok: true } }));
                socket.once('message', submitRaw => {
                    const submit = JSON.parse(submitRaw.toString()) as { id?: string | number };
                    socket.send(JSON.stringify({ v: 1, id: submit.id, kind: 'ok', payload: { ok: true } }));
                    socket.send(
                        JSON.stringify({
                            v: 1,
                            kind: 'action_result',
                            payload: {
                                resident_id: 'resident:res:test',
                                request_id: submit.id,
                                result: { ok: true, cause: 'applied_on_tick' },
                            },
                        }),
                    );
                });
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 500,
            reconnect: false,
        });
        const actionResult = new Promise(resolve => {
            client.on('actionResult', (_resident, requestId, result) => resolve({ requestId, result }));
        });

        await client.connect();
        await client.hello();
        const submitted = await client.submitActionWithRequestId('res:test', { kind: 'noop' });
        client.close();

        expect(submitted).toEqual({
            requestId: expect.any(String),
            ackResult: { ok: true },
        });
        await expect(actionResult).resolves.toEqual({
            requestId: submitted.requestId,
            result: { ok: true, cause: 'applied_on_tick' },
        });
    });
});
