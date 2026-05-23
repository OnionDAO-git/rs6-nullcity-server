import { createHash } from 'crypto';
import * as fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SUPPORTED_WORKFLOWS } from '../thinking/runebench-playbook';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ControllerHost } from '../controller-host';
import { z } from 'zod';
import { RoutineRunner, type RoutineCapableRuntime, type RoutineId, type RunRoutineResponse } from '../routines/routine-runner';

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

interface WorkflowCardRoutineMapping {
    routine: RoutineId;
    defaultParams?: Record<string, unknown>;
}

const WORKFLOW_CARD_TO_ROUTINE: Record<string, WorkflowCardRoutineMapping> = {
    'make-fire': { routine: 'make_fire' },
    'train-woodcutting': { routine: 'chop_tree' },
    'safe-combat': { routine: 'safe_combat' },
    'train-prayer': { routine: 'bury_bones' },
    'follow-codex': { routine: 'follow_player', defaultParams: { player: 'Codex', distance: 3 } },
};

async function readLastLines(filePath: string | undefined, limit = 100): Promise<unknown[]> {
    if (!filePath || !fs.existsSync(filePath)) {
        return [];
    }
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const lines = content
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean);
        const lastLines = lines.slice(-limit);
        return lastLines.map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return line;
            }
        });
    } catch {
        return [];
    }
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
    public createServer(operator = 'default-operator'): McpServer {
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

        // Register workflow_cards://current resource
        server.registerResource(
            'workflow_cards',
            'workflow-cards://current',
            {
                mimeType: 'application/json',
                description: 'The full WorkflowCard catalog with MCP runnable metadata',
            },
            async () => {
                return {
                    contents: [
                        {
                            uri: 'workflow-cards://current',
                            text: JSON.stringify(workflowCardsForMcp(), null, 2),
                        },
                    ],
                };
            },
        );

        // Register resident-progress://{residentName} template resource
        server.registerResource(
            'observe_resident_progress',
            new ResourceTemplate('resident-progress://{residentName}', {
                list: async () => {
                    const residents = this.host.listResidents();
                    return {
                        resources: residents.map(r => ({
                            uri: `resident-progress://${encodeURIComponent(r.name)}`,
                            name: `${r.name} progress`,
                            mimeType: 'application/json',
                        })),
                    };
                },
            }),
            {
                mimeType: 'application/json',
                description: 'Latest progress logs for a resident',
            },
            async (uri, variables) => {
                const residentName = residentNameFromTemplateVariable(variables.residentName);
                const runtime = this.host.getRuntime(residentName);
                const evidence = runtime?.getEvidence();
                const session = evidence?.store.currentSession();
                const progressLines = await readLastLines(session?.progressPath, 100);
                return {
                    contents: [
                        {
                            uri: uri.toString(),
                            text: JSON.stringify(progressLines, null, 2),
                        },
                    ],
                };
            },
        );

        // Register resident-trajectory://{residentName} template resource
        server.registerResource(
            'observe_resident_trajectory',
            new ResourceTemplate('resident-trajectory://{residentName}', {
                list: async () => {
                    const residents = this.host.listResidents();
                    return {
                        resources: residents.map(r => ({
                            uri: `resident-trajectory://${encodeURIComponent(r.name)}`,
                            name: `${r.name} trajectory`,
                            mimeType: 'application/json',
                        })),
                    };
                },
            }),
            {
                mimeType: 'application/json',
                description: 'Latest trajectory lines for a resident',
            },
            async (uri, variables) => {
                const residentName = residentNameFromTemplateVariable(variables.residentName);
                const runtime = this.host.getRuntime(residentName);
                const evidence = runtime?.getEvidence();
                const session = evidence?.store.currentSession();
                const trajectoryLines = await readLastLines(session?.trajectoryPath, 100);
                return {
                    contents: [
                        {
                            uri: uri.toString(),
                            text: JSON.stringify(trajectoryLines, null, 2),
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
                        operator,
                        resident,
                        routine,
                        paramsHash: hashParams(params),
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
                    operator,
                    resident,
                    routine,
                    paramsHash: hashParams(params),
                    status: response.status,
                    ticksUsed: response.ticksUsed,
                    lastError: response.lastError,
                });

                return {
                    content: [{ type: 'text', text: JSON.stringify(response) }],
                };
            },
        );

        // Register run_workflow_card tool
        server.tool(
            'run_workflow_card',
            'Execute a whitelisted workflow card for a resident',
            {
                resident: z.string().describe('The name of the resident'),
                cardId: z.string().describe('The workflow card ID'),
                params: z.any().optional().describe('Optional parameters for the workflow card'),
                maxTicks: z.number().optional().describe('Optional maximum ticks budget'),
            },
            async ({ resident, cardId, params, maxTicks }) => {
                const mapping = WORKFLOW_CARD_TO_ROUTINE[cardId];
                if (!mapping) {
                    const result = {
                        status: 'rejected' as const,
                        ticksUsed: 0,
                        effectEvidenceCount: 0,
                        lastError: 'routine_not_whitelisted' as const,
                    };
                    await logMcpCall({
                        operator,
                        resident,
                        routine: cardId,
                        paramsHash: hashParams(params),
                        status: result.status,
                        ticksUsed: result.ticksUsed,
                        lastError: result.lastError,
                    });
                    return {
                        content: [{ type: 'text', text: JSON.stringify(result) }],
                    };
                }

                const effectiveParams = paramsForWorkflowCard(mapping, params);
                const residentRuntime = this.host.getRuntime(resident);
                if (!residentRuntime) {
                    const result = {
                        status: 'rejected' as const,
                        ticksUsed: 0,
                        effectEvidenceCount: 0,
                        lastError: 'resident_not_found' as const,
                    };
                    await logMcpCall({
                        operator,
                        resident,
                        routine: cardId,
                        paramsHash: hashParams(effectiveParams),
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
                    residentRuntime.activeRoutineId = mapping.routine;
                    response = await runner.run({
                        resident,
                        routine: mapping.routine,
                        params: effectiveParams,
                        maxTicks,
                    });
                } finally {
                    residentRuntime.activeRoutineId = undefined;
                }

                await logMcpCall({
                    operator,
                    resident,
                    routine: cardId,
                    paramsHash: hashParams(effectiveParams),
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

        const operator =
            process.env[`CONTROLLER_MCP_OPERATOR_FOR_${token}`] ||
            process.env[`CONTROLLER_MCP_OPERATOR_FOR_${operatorTokenEnvSuffix(token)}`] ||
            'default-operator';

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = this.createServer(operator);
        await server.connect(transport);
        await transport.handleRequest(request, response);
    }
}

function hashParams(params: unknown): string {
    const raw = JSON.stringify(params ?? {});
    return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

function workflowCardsForMcp(): unknown[] {
    return SUPPORTED_WORKFLOWS.map(card => {
        const mapping = WORKFLOW_CARD_TO_ROUTINE[card.id];
        if (!mapping) {
            return {
                ...card,
                mcp: {
                    runnable: false,
                    unsupportedReason: 'routine_not_whitelisted',
                },
            };
        }
        return {
            ...card,
            mcp: {
                runnable: true,
                routine: mapping.routine,
                defaultParams: mapping.defaultParams,
            },
        };
    });
}

function paramsForWorkflowCard(mapping: WorkflowCardRoutineMapping, params: unknown): unknown {
    if (!mapping.defaultParams) {
        return params;
    }
    if (params && typeof params === 'object' && !Array.isArray(params)) {
        return { ...mapping.defaultParams, ...(params as Record<string, unknown>) };
    }
    return mapping.defaultParams;
}

function residentNameFromTemplateVariable(value: string | string[] | undefined): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) {
        return '';
    }
    return decodeURIComponent(raw);
}

function operatorTokenEnvSuffix(token: string): string {
    return token.replace(/[^A-Za-z0-9_]/g, '_');
}
