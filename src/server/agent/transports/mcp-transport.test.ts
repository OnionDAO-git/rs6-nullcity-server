import http from 'http';
import type { AddressInfo } from 'net';
import type { Resident } from '@engine/world/actor/resident/resident';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ResidentRegistry } from '../resident-registry';
import type { ResidentSession } from '../resident-session';
import { ResidentMcpFacade } from './mcp-transport';

describe('ResidentMcpFacade', () => {
    it('lists, creates, connects, and observes residents through registry/session dependencies', async () => {
        const resident = fakeResident();
        const session = fakeSession();
        const registry = fakeRegistry(resident);
        const facade = new ResidentMcpFacade(
            {
                registry,
                sessionFor: jest.fn(() => session),
            },
            { controllerId: 'mcp:test' },
        );

        expect(facade.listResidents()).toEqual([{ name: 'res:pip', online: false }]);
        expect(facade.createResident('res:newbie')).toEqual({ name: 'res:newbie', online: false });
        await expect(facade.connectResident('res:pip', 'idle')).resolves.toEqual({
            resident: { name: 'res:pip', online: true, controllerId: 'mcp:test' },
            perception: { tick: 7 },
        });
        expect(registry.connect).toHaveBeenCalledWith('res:pip', 'mcp:test', 'idle');
        expect(facade.observeResident('res:pip')).toEqual({
            resident: { name: 'res:pip', online: true, controllerId: 'mcp:test' },
            perception: { tick: 7 },
        });
    });

    it('submits validated AgentAction values and waits for action results', async () => {
        const resident = fakeResident();
        const session = fakeSession();
        const facade = new ResidentMcpFacade(
            {
                registry: fakeRegistry(resident),
                sessionFor: jest.fn(() => session),
            },
            { controllerId: 'mcp:test', actionTimeoutMs: 50 },
        );

        await expect(facade.submitAction('res:pip', { kind: 'noop' })).resolves.toEqual({ result: { ok: true } });
        expect(session.submitActionAndWait).toHaveBeenCalledWith({ kind: 'noop' }, expect.stringMatching(/^mcp:/), 50);
        await expect(facade.submitAction('res:pip', { kind: 'not_real' })).rejects.toThrow();
    });

    it('waits for matching resident events and gates delete behind allowDelete', async () => {
        const resident = fakeResident();
        const session = fakeSession();
        const registry = fakeRegistry(resident);
        const facade = new ResidentMcpFacade(
            {
                registry,
                sessionFor: jest.fn(() => session),
            },
            { eventTimeoutMs: 25 },
        );

        await expect(facade.waitForEvent('res:pip', ['chat'])).resolves.toEqual({ event: { kind: 'chat', text: 'hello' } });
        expect(session.waitForEvent).toHaveBeenCalledWith(['chat'], 25);
        expect(() => facade.deleteResident('res:pip')).toThrow('EDELETE_DISABLED');

        const deleteEnabled = new ResidentMcpFacade({ registry, sessionFor: jest.fn(() => session) }, { allowDelete: true });
        expect(deleteEnabled.deleteResident('res:pip')).toEqual({ ok: true, name: 'res:pip' });
        expect(registry.delete).toHaveBeenCalledWith('res:pip');
    });

    it('serves the tool facade over the SDK Streamable HTTP transport', async () => {
        const facade = new ResidentMcpFacade(
            {
                registry: fakeRegistry(fakeResident()),
                sessionFor: jest.fn(() => fakeSession()),
            },
            { path: '/agent/mcp', controllerId: 'mcp:test' },
        );
        const server = http.createServer((request, response) => {
            facade.handleHttp(request, response).catch(error => {
                response.writeHead(500);
                response.end(error?.message || 'MCP request failed');
            });
        });

        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address() as AddressInfo;
        const client = new Client({ name: 'jest-mcp-client', version: '0.0.0' });

        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/agent/mcp`)));

            const tools = await client.listTools();
            expect(tools.tools.map(tool => tool.name)).toEqual(
                expect.arrayContaining(['list_residents', 'connect_resident', 'submit_action', 'wait_for_event']),
            );

            const result = await client.callTool({
                name: 'list_residents',
                arguments: { filter: 'all' },
            });
            expect(result.structuredContent).toEqual({ residents: [{ name: 'res:pip', online: false }] });
        } finally {
            await client.close();
            await new Promise<void>((resolve, reject) => {
                server.close(error => (error ? reject(error) : resolve()));
            });
        }
    });
});

function fakeResident(): Resident {
    return {
        username: 'res:pip',
        residentId: 'resident:res:pip',
        perception: null,
        publishPerception: jest.fn(() => ({ tick: 7 })),
    } as unknown as Resident;
}

function fakeRegistry(resident: Resident): jest.Mocked<ResidentRegistry> {
    return {
        list: jest.fn(() => [{ name: 'res:pip', online: false }]),
        create: jest.fn(name => ({ name, online: false })),
        connect: jest.fn(async () => resident),
        get: jest.fn(() => resident),
        summary: jest.fn(() => ({ name: 'res:pip', online: true, controllerId: 'mcp:test' })),
        controllerFor: jest.fn(() => 'mcp:test'),
        disconnect: jest.fn(),
        delete: jest.fn(),
    } as unknown as jest.Mocked<ResidentRegistry>;
}

function fakeSession(): jest.Mocked<ResidentSession> {
    return {
        submitActionAndWait: jest.fn(async () => ({ ok: true })),
        waitForEvent: jest.fn(async () => ({ kind: 'chat', text: 'hello' })),
    } as unknown as jest.Mocked<ResidentSession>;
}
