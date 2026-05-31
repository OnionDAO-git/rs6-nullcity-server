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

    // S-DEMO-P0-1 (QA-20260530-018): the controller-side inventory ops
    // (`inspect_resident_gold`, `burn_resident_gold`) now opt into a
    // longer per-call timeout so transient tick-saturation on the
    // game-server doesn't surface as a phantom timeout for the AP-for-GP
    // demo flow.
    it('inspectResidentGold honors a larger inventoryRequestTimeoutMs override', async () => {
        // Default requestTimeoutMs (50ms) would reject any slow handler;
        // inventoryRequestTimeoutMs (300ms) must take precedence here.
        // Server replies after 150ms — outside default, inside inventory.
        server.once('connection', socket => {
            socket.on('message', raw => {
                const message = JSON.parse(raw.toString()) as { id?: string | number; kind?: string };
                if (message.kind === 'controller_hello') {
                    socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'ok', payload: { ok: true } }));
                    return;
                }
                if (message.kind === 'inspect_resident_gold') {
                    setTimeout(() => {
                        socket.send(
                            JSON.stringify({
                                v: 1,
                                id: message.id,
                                kind: 'resident_gold',
                                payload: { resident: 'res:slow', itemId: 995, amount: 42 },
                            }),
                        );
                    }, 150);
                }
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 50,
            inventoryRequestTimeoutMs: 300,
            reconnect: false,
        });

        await client.connect();
        await client.hello();
        const result = await client.inspectResidentGold('res:slow');
        client.close();

        expect(result).toEqual({ resident: 'res:slow', itemId: 995, amount: 42 });
    });

    // S-DEMO-P0-1: belt-and-suspenders — if the inventoryRequestTimeoutMs
    // is shorter than the actual response, we should still observe the
    // typed timeout error (i.e. the override path doesn't accidentally
    // remove timeouts entirely).
    it('burnResidentGold times out when the inventoryRequestTimeoutMs is exceeded', async () => {
        server.once('connection', socket => {
            socket.on('message', raw => {
                const message = JSON.parse(raw.toString()) as { id?: string | number; kind?: string };
                if (message.kind === 'controller_hello') {
                    socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'ok', payload: { ok: true } }));
                }
                // burn_resident_gold: never reply — confirm the override timeout still fires.
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 50,
            inventoryRequestTimeoutMs: 80,
            reconnect: false,
        });

        await client.connect();
        await client.hello();
        await expect(client.burnResidentGold('res:slow', 5)).rejects.toThrow('Gateway request timed out: burn_resident_gold');
        client.close();
    });

    it('can request an operator inventory ensure and read the ensured summary', async () => {
        server.once('connection', socket => {
            socket.on('message', raw => {
                const message = JSON.parse(raw.toString()) as { id?: string | number; kind?: string; payload?: Record<string, unknown> };
                if (message.kind === 'controller_hello') {
                    socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'ok', payload: { ok: true } }));
                    return;
                }
                if (message.kind === 'ensure_inventory_item') {
                    expect(message.payload).toEqual({ name: 'res:qa-survivor', item: 303, amount: 1 });
                    socket.send(
                        JSON.stringify({
                            v: 1,
                            id: message.id,
                            kind: 'resident_inventory_ensured',
                            payload: {
                                resident: 'res:qa-survivor',
                                itemId: 303,
                                requestedAmount: 1,
                                previousAmount: 0,
                                amount: 1,
                                addedAmount: 1,
                            },
                        }),
                    );
                }
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
        await expect(client.ensureInventoryItem('res:qa-survivor', 303, 1)).resolves.toEqual({
            resident: 'res:qa-survivor',
            itemId: 303,
            requestedAmount: 1,
            previousAmount: 0,
            amount: 1,
            addedAmount: 1,
        });
        client.close();
    });

    it('ensureInventoryItem honors a larger inventoryRequestTimeoutMs override', async () => {
        server.once('connection', socket => {
            socket.on('message', raw => {
                const message = JSON.parse(raw.toString()) as { id?: string | number; kind?: string };
                if (message.kind === 'controller_hello') {
                    socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'ok', payload: { ok: true } }));
                    return;
                }
                if (message.kind === 'ensure_inventory_item') {
                    setTimeout(() => {
                        socket.send(
                            JSON.stringify({
                                v: 1,
                                id: message.id,
                                kind: 'resident_inventory_ensured',
                                payload: {
                                    resident: 'res:slow',
                                    itemId: 303,
                                    requestedAmount: 1,
                                    previousAmount: 0,
                                    amount: 1,
                                    addedAmount: 1,
                                },
                            }),
                        );
                    }, 150);
                }
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 50,
            inventoryRequestTimeoutMs: 300,
            reconnect: false,
        });

        await client.connect();
        await client.hello();
        const result = await client.ensureInventoryItem('res:slow', 303, 1);
        client.close();

        expect(result).toEqual({
            resident: 'res:slow',
            itemId: 303,
            requestedAmount: 1,
            previousAmount: 0,
            amount: 1,
            addedAmount: 1,
        });
    });

    it('listResidents honors a larger listResidentsRequestTimeoutMs override', async () => {
        server.once('connection', socket => {
            socket.on('message', raw => {
                const message = JSON.parse(raw.toString()) as { id?: string | number; kind?: string };
                if (message.kind === 'controller_hello') {
                    socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'ok', payload: { ok: true } }));
                    return;
                }
                if (message.kind === 'list_residents') {
                    setTimeout(() => {
                        socket.send(JSON.stringify({ v: 1, id: message.id, kind: 'residents', payload: { residents: [] } }));
                    }, 150);
                }
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 50,
            listResidentsRequestTimeoutMs: 300,
            reconnect: false,
        });

        await client.connect();
        await client.hello();
        await expect(client.listResidents()).resolves.toEqual([]);
        client.close();
    });

    it('can submit an action while preserving request id separately from ack result', async () => {
        server.once('connection', socket => {
            socket.once('message', raw => {
                const hello = JSON.parse(raw.toString()) as { id?: string | number };
                socket.send(JSON.stringify({ v: 1, id: hello.id, kind: 'ok', payload: { ok: true } }));
                socket.once('message', submitRaw => {
                    const submit = JSON.parse(submitRaw.toString()) as { id?: string | number };
                    socket.send(
                        JSON.stringify({
                            v: 1,
                            id: submit.id,
                            kind: 'ok',
                            payload: {
                                ok: true,
                                result: { ok: true, status: 'queued', cause: 'queued', requestId: submit.id },
                            },
                        }),
                    );
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
            ackResult: { ok: true, status: 'queued', cause: 'queued', requestId: submitted.requestId },
        });
        await expect(actionResult).resolves.toEqual({
            requestId: submitted.requestId,
            result: { ok: true, cause: 'applied_on_tick' },
        });
    });

    it('submitAction honors a larger actionRequestTimeoutMs override', async () => {
        server.once('connection', socket => {
            socket.once('message', raw => {
                const hello = JSON.parse(raw.toString()) as { id?: string | number };
                socket.send(JSON.stringify({ v: 1, id: hello.id, kind: 'ok', payload: { ok: true } }));
                socket.once('message', submitRaw => {
                    const submit = JSON.parse(submitRaw.toString()) as { id?: string | number };
                    setTimeout(() => {
                        socket.send(JSON.stringify({ v: 1, id: submit.id, kind: 'ok', payload: { ok: true } }));
                    }, 150);
                });
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 50,
            actionRequestTimeoutMs: 300,
            reconnect: false,
        });

        await client.connect();
        await client.hello();
        await expect(client.submitActionWithRequestId('res:slow', { kind: 'noop' })).resolves.toEqual({
            requestId: expect.any(String),
            ackResult: { ok: true },
        });
        client.close();
    });

    it('limits concurrent submit_action requests to protect the game gateway', async () => {
        let releaseFirstSubmit: (() => void) | undefined;
        const submittedResidents: string[] = [];
        server.once('connection', socket => {
            socket.once('message', raw => {
                const hello = JSON.parse(raw.toString()) as { id?: string | number };
                socket.send(JSON.stringify({ v: 1, id: hello.id, kind: 'ok', payload: { ok: true } }));
                socket.on('message', submitRaw => {
                    const submit = JSON.parse(submitRaw.toString()) as {
                        id?: string | number;
                        kind?: string;
                        payload?: { name?: string };
                    };
                    if (submit.kind !== 'submit_action') {
                        return;
                    }
                    submittedResidents.push(String(submit.payload?.name || ''));
                    if (submittedResidents.length === 1) {
                        releaseFirstSubmit = () => socket.send(JSON.stringify({ v: 1, id: submit.id, kind: 'ok', payload: { ok: true } }));
                        return;
                    }
                    socket.send(JSON.stringify({ v: 1, id: submit.id, kind: 'ok', payload: { ok: true } }));
                });
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 500,
            maxConcurrentActions: 1,
            reconnect: false,
        });

        await client.connect();
        await client.hello();

        const first = client.submitActionWithRequestId('res:one', { kind: 'noop' });
        await waitFor(() => submittedResidents.length === 1);
        const second = client.submitActionWithRequestId('res:two', { kind: 'noop' });
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(submittedResidents).toEqual(['res:one']);

        releaseFirstSubmit?.();
        await first;
        await second;
        client.close();

        expect(submittedResidents).toEqual(['res:one', 'res:two']);
    });

    it('defaults to a small action lane pool so startup bursts do not starve residents', async () => {
        const submittedResidents: string[] = [];
        server.once('connection', socket => {
            socket.once('message', raw => {
                const hello = JSON.parse(raw.toString()) as { id?: string | number };
                socket.send(JSON.stringify({ v: 1, id: hello.id, kind: 'ok', payload: { ok: true } }));
                socket.on('message', submitRaw => {
                    const submit = JSON.parse(submitRaw.toString()) as { kind?: string; payload?: { name?: string } };
                    if (submit.kind === 'submit_action') {
                        submittedResidents.push(String(submit.payload?.name || ''));
                    }
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

        const submissions = ['res:one', 'res:two', 'res:three', 'res:four', 'res:five'].map(name =>
            client.submitActionWithRequestId(name, { kind: 'noop' }),
        );
        await waitFor(() => submittedResidents.length >= 4);

        expect(submittedResidents).toEqual(['res:one', 'res:two', 'res:three', 'res:four']);

        client.close();
        await Promise.allSettled(submissions);
    });

    it('expires queued submit_action requests instead of sending stale actions', async () => {
        const submittedResidents: string[] = [];
        server.once('connection', socket => {
            socket.once('message', raw => {
                const hello = JSON.parse(raw.toString()) as { id?: string | number };
                socket.send(JSON.stringify({ v: 1, id: hello.id, kind: 'ok', payload: { ok: true } }));
                socket.on('message', submitRaw => {
                    const submit = JSON.parse(submitRaw.toString()) as { kind?: string; payload?: { name?: string } };
                    if (submit.kind === 'submit_action') {
                        submittedResidents.push(String(submit.payload?.name || ''));
                    }
                });
            });
        });

        const client = new GatewayClient({
            url,
            controllerId: 'test-controller',
            requestTimeoutMs: 100,
            actionQueueTimeoutMs: 30,
            maxConcurrentActions: 1,
            reconnect: false,
        });

        await client.connect();
        await client.hello();

        const first = client.submitActionWithRequestId('res:one', { kind: 'noop' });
        await waitFor(() => submittedResidents.length === 1);
        const second = client.submitActionWithRequestId('res:two', { kind: 'noop' });

        await expect(second).rejects.toThrow('Gateway action queue timed out: submit_action');
        expect(submittedResidents).toEqual(['res:one']);

        client.close();
        await expect(first).rejects.toThrow(/Gateway request timed out: submit_action|Gateway client closed/);
    });
});

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('timed out waiting for predicate');
}
