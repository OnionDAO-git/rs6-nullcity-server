import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ControllerMcpServer, logMcpCall } from './server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { closeControllerMcpHttpServer, startControllerMcpHttpServer } from './http-server';

describe('ControllerMcpServer', () => {
    let mockHost: any;
    let serverInstance: ControllerMcpServer;
    let originalEnv: NodeJS.ProcessEnv;
    let connectSpy: jest.SpyInstance;
    let handleRequestSpy: jest.SpyInstance;

    beforeEach(() => {
        originalEnv = { ...process.env };
        mockHost = {
            listResidents: jest.fn().mockReturnValue([
                { name: 'res:agent', state: { attention: 100, task: 'idle' } },
                { name: 'res:pip', state: { attention: 50, task: 'woodcutting' } },
            ]),
        };
        serverInstance = new ControllerMcpServer(mockHost);

        // Spy on McpServer connect and StreamableHTTPServerTransport handleRequest to avoid real socket calls
        connectSpy = jest.spyOn(McpServer.prototype, 'connect').mockResolvedValue(undefined);
        handleRequestSpy = jest.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest').mockResolvedValue(undefined);
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    describe('resource registration', () => {
        it('registers the resident_api://current resource returning JSON-stringified active residents', async () => {
            const mcpServer = serverInstance.createServer();
            // Access _registeredResources object directly on McpServer
            const registeredResources = (mcpServer as any)._registeredResources;
            expect(registeredResources).toBeDefined();

            // Locate resource by URI key
            const resource = registeredResources['resident-api://current'];
            expect(resource).toBeDefined();
            expect(resource.name).toBe('resident_api');
            expect(resource.metadata?.mimeType).toBe('application/json');

            // Call the read callback
            const readResult = await resource.readCallback(new URL('resident-api://current'));
            expect(readResult.contents).toBeDefined();
            expect(readResult.contents.length).toBe(1);
            expect(readResult.contents[0].uri).toBe('resident-api://current');

            const parsed = JSON.parse(readResult.contents[0].text);
            expect(parsed).toEqual([
                { name: 'res:agent', state: { attention: 100, task: 'idle' } },
                { name: 'res:pip', state: { attention: 50, task: 'woodcutting' } },
            ]);
            expect(mockHost.listResidents).toHaveBeenCalled();
        });
    });

    describe('connectStdio (Stdio transport)', () => {
        it('throws an error when CONTROLLER_MCP_TOKENS is missing or empty', async () => {
            delete process.env.CONTROLLER_MCP_TOKENS;
            await expect(serverInstance.connectStdio()).rejects.toThrow(
                'Unauthorized: CONTROLLER_MCP_TOKENS environment variable is not configured',
            );

            process.env.CONTROLLER_MCP_TOKENS = ' ';
            await expect(serverInstance.connectStdio()).rejects.toThrow(
                'Unauthorized: CONTROLLER_MCP_TOKENS environment variable is not configured',
            );
        });

        it('succeeds and connects to Stdio transport when tokens are configured', async () => {
            process.env.CONTROLLER_MCP_TOKENS = 'token1,token2';
            await serverInstance.connectStdio();
            expect(connectSpy).toHaveBeenCalledWith(expect.any(StdioServerTransport));
        });
    });

    describe('handleHttp (HTTP transport)', () => {
        let mockRequest: any;
        let mockResponse: any;

        beforeEach(() => {
            mockRequest = {
                headers: {},
            };
            mockResponse = {
                writeHead: jest.fn(),
                end: jest.fn(),
            };
            process.env.CONTROLLER_MCP_TOKENS = 'valid-token-a,valid-token-b';
        });

        it('returns 401 when Authorization header is missing', async () => {
            await serverInstance.handleHttp(mockRequest, mockResponse);
            expect(mockResponse.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(mockResponse.end).toHaveBeenCalledWith(expect.stringContaining('Unauthorized: missing or invalid Authorization header'));
        });

        it('returns 401 when Authorization header does not use Bearer scheme', async () => {
            mockRequest.headers.authorization = 'Basic abc';
            await serverInstance.handleHttp(mockRequest, mockResponse);
            expect(mockResponse.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(mockResponse.end).toHaveBeenCalledWith(expect.stringContaining('Unauthorized: missing or invalid Authorization header'));
        });

        it('returns 401 when Bearer token is not in CONTROLLER_MCP_TOKENS list', async () => {
            mockRequest.headers.authorization = 'Bearer invalid-token';
            await serverInstance.handleHttp(mockRequest, mockResponse);
            expect(mockResponse.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(mockResponse.end).toHaveBeenCalledWith(expect.stringContaining('Unauthorized: invalid token'));
        });

        it('succeeds and calls handleRequest when Bearer token matches configured tokens', async () => {
            mockRequest.headers.authorization = 'Bearer valid-token-b';
            await serverInstance.handleHttp(mockRequest, mockResponse);
            expect(mockResponse.writeHead).not.toHaveBeenCalled();

            expect(connectSpy).toHaveBeenCalledWith(expect.any(StreamableHTTPServerTransport));
            expect(handleRequestSpy).toHaveBeenCalledWith(mockRequest, mockResponse);
        });
    });

    describe('run_routine tool', () => {
        const logFilePath = path.join(process.cwd(), 'data', 'mcp-call-log.jsonl');

        beforeEach(async () => {
            mockHost.getRuntime = jest.fn();
            try {
                await fs.promises.unlink(logFilePath);
            } catch {}
        });

        afterEach(async () => {
            try {
                await fs.promises.unlink(logFilePath);
            } catch {}
        });

        it('is registered under name run_routine with correct properties', () => {
            const mcpServer = serverInstance.createServer();
            const registeredTools = (mcpServer as any)._registeredTools;
            expect(registeredTools).toBeDefined();

            const tool = registeredTools.run_routine;
            expect(tool).toBeDefined();
            expect(tool.description).toBe('Execute a whitelisted routine for a resident');
            expect(tool.inputSchema).toBeDefined();
        });

        it('returns status=rejected when resident is not found', async () => {
            mockHost.getRuntime.mockReturnValue(undefined);
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_routine;

            const result = await tool.handler({
                resident: 'res:nobody',
                routine: 'make_fire',
            });

            expect(result.content).toBeDefined();
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('rejected');
            expect(parsed.lastError).toBe('resident_not_found');

            // Verify call log was appended
            expect(fs.existsSync(logFilePath)).toBe(true);
            const logContent = await fs.promises.readFile(logFilePath, 'utf8');
            const parsedLog = JSON.parse(logContent);
            expect(parsedLog.resident).toBe('res:nobody');
            expect(parsedLog.routine).toBe('make_fire');
            expect(parsedLog.status).toBe('rejected');
        });

        it('executes make_fire routine successfully when resident is registered', async () => {
            const mockRuntime: any = {
                tick: jest.fn().mockResolvedValue('completed'),
                activeRoutineId: undefined,
                _lastHints: [],
            };
            mockHost.getRuntime.mockReturnValue(mockRuntime);

            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_routine;

            const result = await tool.handler({
                resident: 'res:agent',
                routine: 'make_fire',
                maxTicks: 100,
            });

            expect(result.content).toBeDefined();
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('completed');
            expect(parsed.ticksUsed).toBe(1);

            // Verify activeRoutineId lifecycle
            expect(mockRuntime.tick).toHaveBeenCalled();
            expect(mockRuntime.activeRoutineId).toBeUndefined();

            // Verify call log
            expect(fs.existsSync(logFilePath)).toBe(true);
            const logContent = await fs.promises.readFile(logFilePath, 'utf8');
            const parsedLog = JSON.parse(logContent);
            expect(parsedLog.resident).toBe('res:agent');
            expect(parsedLog.routine).toBe('make_fire');
            expect(parsedLog.paramsHash).toMatch(/^sha256:/);
            expect(parsedLog.status).toBe('completed');
            expect(parsedLog.ticksUsed).toBe(1);
        });

        it('serves run_routine through the SDK Streamable HTTP transport with bearer auth', async () => {
            jest.restoreAllMocks();
            process.env.CONTROLLER_MCP_TOKENS = 'operator-token';
            process.env.CONTROLLER_MCP_OPERATOR_FOR_operator_token = 'operator-codex';

            const mockRuntime: any = {
                tick: jest.fn().mockResolvedValue('completed'),
                activeRoutineId: undefined,
                _lastHints: ['routine completed in smoke'],
            };
            mockHost.getRuntime.mockReturnValue(mockRuntime);

            const started = await startControllerMcpHttpServer(mockHost, { port: 0, path: '/controller/mcp' });
            const client = new Client({ name: 'jest-controller-mcp-client', version: '0.0.0' });

            try {
                await client.connect(
                    new StreamableHTTPClientTransport(new URL(started.url), {
                        requestInit: { headers: { Authorization: 'Bearer operator-token' } },
                    }),
                );

                const result = await client.callTool({
                    name: 'run_routine',
                    arguments: { resident: 'res:agent', routine: 'make_fire', maxTicks: 10 },
                });

                const content = result.content as Array<{ type: string; text?: string }>;
                const parsed = JSON.parse(content[0].text || '{}');
                expect(parsed).toEqual(
                    expect.objectContaining({
                        status: 'completed',
                        ticksUsed: 1,
                        effectEvidenceCount: 1,
                    }),
                );
                expect(parsed.trajectoryHints).toEqual(['routine completed in smoke']);

                const logContent = await fs.promises.readFile(logFilePath, 'utf8');
                const parsedLog = JSON.parse(logContent);
                expect(parsedLog.operator).toBe('operator-codex');
                expect(parsedLog.status).toBe('completed');
                expect(parsedLog.paramsHash).toMatch(/^sha256:/);
            } finally {
                await client.close();
                await closeControllerMcpHttpServer(started.server);
            }
        });

        it('returns 404 for non-MCP controller HTTP paths', async () => {
            jest.restoreAllMocks();
            process.env.CONTROLLER_MCP_TOKENS = 'operator-token';

            const started = await startControllerMcpHttpServer(mockHost, { port: 0, path: '/controller/mcp' });
            try {
                const address = started.server.address() as AddressInfo;
                const response = await httpGet(`http://127.0.0.1:${address.port}/not-mcp`);
                expect(response.status).toBe(404);
                expect(response.body).toContain('Not Found');
            } finally {
                await closeControllerMcpHttpServer(started.server);
            }
        });

        it('does not write a second response when transport handling fails after headers are sent', async () => {
            jest.restoreAllMocks();
            jest.spyOn(ControllerMcpServer.prototype, 'handleHttp').mockImplementation(async (_request, response) => {
                response.writeHead(202, { 'Content-Type': 'text/plain' });
                response.write('partial');
                throw new Error('transport failed after write');
            });

            const started = await startControllerMcpHttpServer(mockHost, { port: 0, path: '/controller/mcp' });
            try {
                const response = await httpGet(started.url);
                expect(response.status).toBe(202);
                expect(response.body).toBe('partial');
            } finally {
                await closeControllerMcpHttpServer(started.server);
            }
        });
    });

    describe('logMcpCall', () => {
        const logFilePath = path.join(process.cwd(), 'data', 'mcp-call-log.jsonl');

        beforeEach(async () => {
            try {
                await fs.promises.unlink(logFilePath);
            } catch {}
        });

        afterEach(async () => {
            try {
                await fs.promises.unlink(logFilePath);
            } catch {}
        });

        it('appends call logs to data/mcp-call-log.jsonl', async () => {
            const entry = {
                operator: 'operator-alice',
                resident: 'res:agent',
                routine: 'make_fire',
                paramsHash: 'sha256-abc',
                status: 'completed',
                ticksUsed: 12,
            };

            await logMcpCall(entry);

            expect(fs.existsSync(logFilePath)).toBe(true);
            const content = await fs.promises.readFile(logFilePath, 'utf8');
            const parsed = JSON.parse(content);
            expect(parsed.operator).toBe('operator-alice');
            expect(parsed.resident).toBe('res:agent');
            expect(parsed.status).toBe('completed');
            expect(parsed.ticksUsed).toBe(12);
            expect(parsed.ts).toBeDefined();
        });
    });
});

function httpGet(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
            });
            response.on('end', () => resolve({ status: response.statusCode || 0, body }));
        }).on('error', reject);
    });
}
