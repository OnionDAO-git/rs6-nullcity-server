import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { type AgentAction, AgentActionSchema } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Resident } from '@engine/world/actor/resident/resident';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import type { DisconnectPolicy, ResidentFilter, ResidentSummary } from '../protocol/messages';
import type { InitialContainerItem } from '../resident-registry';
import type { ResidentRegistry } from '../resident-registry';
import type { ResidentSession } from '../resident-session';

export interface ResidentMcpFacadeOptions {
    controllerId?: string;
    path?: string;
    allowDelete?: boolean;
    actionTimeoutMs?: number;
    eventTimeoutMs?: number;
}

export interface ResidentMcpFacadeDependencies {
    registry: ResidentRegistry;
    sessionFor(resident: Resident): ResidentSession;
    closeSession?(name: string): void;
}

export interface ConnectResidentResult {
    resident: ResidentSummary;
    perception: Perception | null;
}

export class ResidentMcpFacade {
    private readonly controllerId: string;
    private readonly path: string;

    public constructor(
        private readonly deps: ResidentMcpFacadeDependencies,
        private readonly options: ResidentMcpFacadeOptions = {},
    ) {
        this.controllerId = options.controllerId || `mcp:${randomUUID()}`;
        this.path = options.path || '/agent/mcp';
    }

    public matches(url?: string): boolean {
        const pathname = (url || '').split('?')[0];
        return pathname === this.path;
    }

    public async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = this.createServer();
        await server.connect(transport);
        await transport.handleRequest(request, response);
    }

    public async connectStdio(): Promise<void> {
        await this.createServer().connect(new StdioServerTransport());
    }

    public listResidents(filter: ResidentFilter = 'all'): ResidentSummary[] {
        let residents = this.deps.registry.list();
        if (filter === 'online') {
            residents = residents.filter(resident => resident.online);
        } else if (filter === 'offline') {
            residents = residents.filter(resident => !resident.online);
        }
        return residents;
    }

    public createResident(
        name: string,
        spawnPosition?: { x: number; y: number; level?: number },
        initialInventory?: InitialContainerItem[],
        initialEquipment?: InitialContainerItem[],
    ): ResidentSummary {
        return this.deps.registry.create(name, spawnPosition, { initialInventory, initialEquipment });
    }

    public async connectResident(name: string, onDisconnect: DisconnectPolicy = 'idle'): Promise<ConnectResidentResult> {
        const resident = await this.deps.registry.connect(name, this.controllerId, onDisconnect);
        this.deps.sessionFor(resident);
        return {
            resident: this.deps.registry.summary(resident.username),
            perception: resident.perception || resident.publishPerception(),
        };
    }

    public observeResident(name: string): ConnectResidentResult {
        const resident = this.requireResident(name);
        this.deps.sessionFor(resident);
        return {
            resident: this.deps.registry.summary(resident.username),
            perception: resident.perception || resident.publishPerception(),
        };
    }

    public async submitAction(name: string, action: unknown, timeoutMs = this.options.actionTimeoutMs || 3000): Promise<unknown> {
        const resident = this.requireControlledResident(name);
        const parsedAction = AgentActionSchema.parse(action) as AgentAction;
        const result = await this.deps.sessionFor(resident).submitActionAndWait(parsedAction, `mcp:${randomUUID()}`, timeoutMs);
        return { result };
    }

    public async waitForEvent(name: string, kinds: string[] = [], timeoutMs = this.options.eventTimeoutMs || 30000): Promise<unknown> {
        const resident = this.requireResident(name);
        const event = await this.deps.sessionFor(resident).waitForEvent(kinds, timeoutMs);
        return { event };
    }

    public disconnectResident(name: string, cause = 'mcp_disconnect'): { ok: true; name: string; cause: string } {
        const normalizedName = name.toLowerCase();
        this.deps.registry.disconnect(normalizedName, cause);
        this.deps.closeSession?.(normalizedName);
        return { ok: true, name: normalizedName, cause };
    }

    public deleteResident(name: string): { ok: true; name: string } {
        if (!this.options.allowDelete) {
            throw new Error('EDELETE_DISABLED');
        }
        this.deps.registry.delete(name);
        return { ok: true, name: name.toLowerCase() };
    }

    private createServer(): McpServer {
        const server = new McpServer({
            name: 'nullcity-resident-gateway',
            version: '0.1.0',
        });

        server.registerTool(
            'list_residents',
            {
                title: 'List residents',
                description: 'List resident identities known to the Null City agent gateway.',
                inputSchema: {
                    filter: z.enum(['online', 'offline', 'all']).optional(),
                },
                annotations: { readOnlyHint: true, openWorldHint: false },
            },
            async ({ filter }) => toToolResult({ residents: this.listResidents(filter || 'all') }),
        );

        server.registerTool(
            'create_resident',
            {
                title: 'Create resident',
                description: 'Create a persistent resident identity. The name must use the res:<slug> namespace.',
                inputSchema: {
                    name: z.string().min(1),
                    spawnPosition: positionSchema.optional(),
                    initialInventory: z.array(initialContainerItemSchema).optional(),
                    initialEquipment: z.array(initialContainerItemSchema).optional(),
                },
            },
            async ({ name, spawnPosition, initialInventory, initialEquipment }) =>
                toToolResult({ resident: this.createResident(name, spawnPosition, initialInventory, initialEquipment) }),
        );

        server.registerTool(
            'connect_resident',
            {
                title: 'Connect resident',
                description: 'Bring a resident online and return its first perception.',
                inputSchema: {
                    name: z.string().min(1),
                    onDisconnect: z.enum(['logout', 'idle']).optional(),
                },
            },
            async ({ name, onDisconnect }) => toToolResult(await this.connectResident(name, onDisconnect || 'idle')),
        );

        server.registerTool(
            'observe_resident',
            {
                title: 'Observe resident',
                description: 'Return the latest perception for an online resident.',
                inputSchema: {
                    name: z.string().min(1),
                },
                annotations: { readOnlyHint: true, openWorldHint: false },
            },
            async ({ name }) => toToolResult(this.observeResident(name)),
        );

        server.registerTool(
            'submit_action',
            {
                title: 'Submit resident action',
                description: 'Submit one AgentAction for an online resident and wait for the resulting ActionResult.',
                inputSchema: {
                    name: z.string().min(1),
                    action: z.unknown(),
                    timeout_ms: z.number().int().positive().max(30000).optional(),
                },
            },
            async ({ name, action, timeout_ms }) => toToolResult(await this.submitAction(name, action, timeout_ms)),
        );

        server.registerTool(
            'wait_for_event',
            {
                title: 'Wait for resident event',
                description: 'Wait for the next resident perception event matching any supplied kind.',
                inputSchema: {
                    name: z.string().min(1),
                    kinds: z.array(z.string()).optional(),
                    timeout_ms: z.number().int().positive().max(120000).optional(),
                },
                annotations: { readOnlyHint: true, openWorldHint: false },
            },
            async ({ name, kinds, timeout_ms }) => toToolResult(await this.waitForEvent(name, kinds || [], timeout_ms)),
        );

        server.registerTool(
            'disconnect_resident',
            {
                title: 'Disconnect resident',
                description: 'Gracefully log out a resident controlled by this MCP facade.',
                inputSchema: {
                    name: z.string().min(1),
                    cause: z.string().optional(),
                },
            },
            async ({ name, cause }) => toToolResult(this.disconnectResident(name, cause || 'mcp_disconnect')),
        );

        server.registerTool(
            'delete_resident',
            {
                title: 'Delete resident',
                description: 'Delete a resident save when deletion is enabled in the gateway config.',
                inputSchema: {
                    name: z.string().min(1),
                },
            },
            async ({ name }) => toToolResult(this.deleteResident(name)),
        );

        return server;
    }

    private requireResident(name: string): Resident {
        const resident = this.deps.registry.get(name);
        if (!resident) {
            throw new Error('ENO_SUCH_RESIDENT');
        }
        return resident;
    }

    private requireControlledResident(name: string): Resident {
        const resident = this.requireResident(name);
        if (this.deps.registry.controllerFor(name) !== this.controllerId) {
            throw new Error('ECONTROL_REQUIRED');
        }
        return resident;
    }
}

const positionSchema = z.object({
    x: z.number().int(),
    y: z.number().int(),
    level: z.number().int().optional(),
});

const initialContainerItemSchema = z.union([
    z.number().int().positive(),
    z.string().min(1),
    z.object({ itemId: z.number().int().positive(), amount: z.number().int().positive().optional() }),
    z.null(),
]);

function toToolResult(value: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(value, jsonReplacer, 2) }],
        structuredContent: isRecord(value) ? value : { result: value },
    };
}

function jsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
