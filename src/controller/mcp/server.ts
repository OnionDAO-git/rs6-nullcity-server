import { randomUUID } from 'crypto';
import * as fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ControllerHost } from '../controller-host';
import { z } from 'zod';
import { RoutineRunner, type RoutineCapableRuntime, type RunRoutineResponse } from '../routines/routine-runner';

export interface McpCallLogEntry {
    operator: string;
    resident: string;
    routine: string;
    paramsHash: string;
    status: string;
    ticksUsed: number;
    lastError?: string;
}

/**
 * Appends a structured log entry to `data/mcp-call-log.jsonl`.
 */
export async function logMcpCall(entry: McpCallLogEntry): Promise<void> {
    const dataDir = path.join(process.cwd(), 'data');
    try {
        await fs.promises.mkdir(dataDir, { recursive: true });
    } catch {
        // ignore if directory exists or fails
    }
    const logFilePath = path.join(dataDir, 'mcp-call-log.jsonl');
    const line =
        JSON.stringify({
            ts: new Date().toISOString(),
            ...entry,
        }) + '\n';
    await fs.promises.appendFile(logFilePath, line);
}

/**
 * Controller MCP Routine Facade Server wrapper.
 * Provides the boilerplate for the Model Context Protocol server.
 */
export class ControllerMcpServer {
    constructor(private readonly host: ControllerHost) {}

    /**
     * Creates a new McpServer instance and registers resources and tools.
     */
    public createServer(): McpServer {
        const server = new McpServer({
            name: 'oniondao-controller-mcp',
            version: '1.0.0',
        });

        // Register resident_api://current resource
        server.registerResource(
            'resident_api',
            'resident-api://current',
            {
                mimeType: 'application/json',
                description: 'Active resident registry and runtime states',
            },
            async () => {
                const residents = this.host.listResidents();
                return {
                    contents: [
                        {
                            uri: 'resident-api://current',
                            text: JSON.stringify(residents, null, 2),
                        },
                    ],
                };
            },
        );

        // Register run_routine tool
        server.tool(
            'run_routine',
            'Execute a whitelisted routine for a resident',
            {
                resident: z.string().describe('The name of the resident'),
                routine: z.string().describe('The routine whitelisted in the catalog (e.g. make_fire)'),
                params: z.any().optional().describe('Optional parameters for the routine'),
                maxTicks: z.number().optional().describe('Optional maximum ticks budget'),
            },
            async ({ resident, routine, params, maxTicks }) => {
                const residentRuntime = this.host.getRuntime(resident);
                if (!residentRuntime) {
                    const result = {
                        status: 'rejected' as const,
                        ticksUsed: 0,
                        effectEvidenceCount: 0,
                        lastError: 'resident_not_found' as const,
                    };
                    await logMcpCall({
                        operator: 'default-operator',
                        resident,
                        routine,
                        paramsHash: params ? JSON.stringify(params) : '{}',
                        status: result.status,
                        ticksUsed: result.ticksUsed,
                        lastError: result.lastError,
                    });
                    return {
                        content: [{ type: 'text', text: JSON.stringify(result) }],
                    };
                }

                const runtimes = new Map<string, RoutineCapableRuntime>();
                runtimes.set(resident, residentRuntime);

                const runner = new RoutineRunner({ runtimes });

                let response: RunRoutineResponse;
                try {
                    residentRuntime.activeRoutineId = routine;
                    response = await runner.run({
                        resident,
                        routine,
                        params,
                        maxTicks,
                    });
                } finally {
                    residentRuntime.activeRoutineId = undefined;
                }

                await logMcpCall({
                    operator: 'default-operator',
                    resident,
                    routine,
                    paramsHash: params ? JSON.stringify(params) : '{}',
                    status: response.status,
                    ticksUsed: response.ticksUsed,
                    lastError: response.lastError,
                });

                return {
                    content: [{ type: 'text', text: JSON.stringify(response) }],
                };
            },
        );

        return server;
    }

    /**
     * Connects and listens using stdio transport.
     * Enforces environment presence check for CONTROLLER_MCP_TOKENS.
     */
    public async connectStdio(): Promise<void> {
        const tokens = process.env.CONTROLLER_MCP_TOKENS;
        if (!tokens || tokens.trim() === '') {
            throw new Error('Unauthorized: CONTROLLER_MCP_TOKENS environment variable is not configured');
        }

        const transport = new StdioServerTransport();
        const server = this.createServer();
        await server.connect(transport);
    }

    /**
     * Handles an HTTP-based dashboard request using Streamable HTTPServer Transport.
     * Enforces bearer token authentication against CONTROLLER_MCP_TOKENS.
     */
    public async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
        // Enforce token validation
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
            response.writeHead(401, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'Unauthorized: missing or invalid Authorization header' }));
            return;
        }

        const token = authHeader.substring(7).trim();
        const configuredTokens = (process.env.CONTROLLER_MCP_TOKENS || '')
            .split(',')
            .map(t => t.trim())
            .filter(Boolean);

        if (!configuredTokens.includes(token)) {
            response.writeHead(401, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'Unauthorized: invalid token' }));
            return;
        }

        const _operator = process.env[`CONTROLLER_MCP_OPERATOR_FOR_${token}`] || 'default-operator';

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = this.createServer();
        await server.connect(transport);
        await transport.handleRequest(request, response);
    }
}
