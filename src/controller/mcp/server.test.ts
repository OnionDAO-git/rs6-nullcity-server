import * as fs from 'fs';
import * as path from 'path';
import { ControllerMcpServer, logMcpCall } from './server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

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
