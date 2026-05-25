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

    describe('Plan RB-MCP-ε workflow_cards resource', () => {
        it('registers the workflow_cards://current resource with MCP run metadata', async () => {
            const mcpServer = serverInstance.createServer();
            const registeredResources = (mcpServer as any)._registeredResources;
            expect(registeredResources).toBeDefined();

            const resource = registeredResources['workflow-cards://current'];
            expect(resource).toBeDefined();
            expect(resource.name).toBe('workflow_cards');
            expect(resource.metadata?.mimeType).toBe('application/json');

            const readResult = await resource.readCallback(new URL('workflow-cards://current'));
            expect(readResult.contents).toBeDefined();
            expect(readResult.contents.length).toBe(1);

            const parsed = JSON.parse(readResult.contents[0].text);
            expect(parsed).toBeInstanceOf(Array);
            expect(parsed.find((card: any) => card.id === 'make-fire')).toEqual(
                expect.objectContaining({
                    title: 'Make fire',
                    mcp: { runnable: true, routine: 'make_fire' },
                }),
            );
            expect(parsed.find((card: any) => card.id === 'follow-codex')).toEqual(
                expect.objectContaining({
                    mcp: { runnable: true, routine: 'follow_player', defaultParams: { player: 'Codex', distance: 3 } },
                }),
            );
            expect(parsed.find((card: any) => card.id === 'explore-locally')).toEqual(
                expect.objectContaining({
                    mcp: { runnable: false, unsupportedReason: 'routine_not_whitelisted' },
                }),
            );
        });
    });

    describe('Plan RB-MCP-ε observe_resident_progress and observe_resident_trajectory resources', () => {
        const fakeProgressPath = path.join(process.cwd(), 'data', 'fake-progress.jsonl');
        const fakeTrajectoryPath = path.join(process.cwd(), 'data', 'fake-trajectory.jsonl');

        beforeEach(async () => {
            try {
                await fs.promises.unlink(fakeProgressPath);
            } catch {}
            try {
                await fs.promises.unlink(fakeTrajectoryPath);
            } catch {}
        });

        afterEach(async () => {
            try {
                await fs.promises.unlink(fakeProgressPath);
            } catch {}
            try {
                await fs.promises.unlink(fakeTrajectoryPath);
            } catch {}
        });

        it('registers templates and reads tailed active progress/trajectory lines', async () => {
            // Write dummy progress and trajectory lines
            await fs.promises.writeFile(fakeProgressPath, JSON.stringify({ tick: 1, meaningful: true, reasons: ['level_up'] }) + '\n');
            await fs.promises.writeFile(fakeTrajectoryPath, JSON.stringify({ tick: 1, action: { kind: 'move_to' } }) + '\n');

            const mockEvidence = {
                store: {
                    currentSession: jest.fn().mockReturnValue({
                        progressPath: fakeProgressPath,
                        trajectoryPath: fakeTrajectoryPath,
                    }),
                },
            };
            const mockRuntime = {
                getEvidence: jest.fn().mockReturnValue(mockEvidence),
            };
            mockHost.getRuntime = jest.fn().mockReturnValue(mockRuntime);

            const mcpServer = serverInstance.createServer();
            const registeredResourceTemplates = (mcpServer as any)._registeredResourceTemplates;
            expect(registeredResourceTemplates).toBeDefined();

            // Progress template resource
            const progressTemplate = registeredResourceTemplates.observe_resident_progress;
            expect(progressTemplate).toBeDefined();
            expect(progressTemplate.resourceTemplate.uriTemplate.toString()).toBe('resident-progress://{residentName}');
            const progressList = await (progressTemplate.resourceTemplate as any)._callbacks.list();
            expect(progressList.resources[0].uri).toBe('resident-progress://res%3Aagent');

            const progressResult = await progressTemplate.readCallback(new URL('resident-progress://res%3Aagent'), {
                residentName: 'res%3Aagent',
            });
            expect(progressResult.contents).toBeDefined();
            const progressData = JSON.parse(progressResult.contents[0].text);
            expect(progressData.length).toBe(1);
            expect(progressData[0].reasons).toEqual(['level_up']);
            expect(mockHost.getRuntime).toHaveBeenCalledWith('res:agent');

            // Trajectory template resource
            const trajectoryTemplate = registeredResourceTemplates.observe_resident_trajectory;
            expect(trajectoryTemplate).toBeDefined();
            expect(trajectoryTemplate.resourceTemplate.uriTemplate.toString()).toBe('resident-trajectory://{residentName}');
            const trajectoryList = await (trajectoryTemplate.resourceTemplate as any)._callbacks.list();
            expect(trajectoryList.resources[0].uri).toBe('resident-trajectory://res%3Aagent');

            const trajectoryResult = await trajectoryTemplate.readCallback(new URL('resident-trajectory://res%3Aagent'), {
                residentName: 'res%3Aagent',
            });
            expect(trajectoryResult.contents).toBeDefined();
            const trajectoryData = JSON.parse(trajectoryResult.contents[0].text);
            expect(trajectoryData.length).toBe(1);
            expect(trajectoryData[0].action.kind).toBe('move_to');
        });

        it('returns empty array when no active session exists', async () => {
            const mockRuntime = {
                getEvidence: jest.fn().mockReturnValue(undefined),
            };
            mockHost.getRuntime = jest.fn().mockReturnValue(mockRuntime);

            const mcpServer = serverInstance.createServer();
            const progressTemplate = (mcpServer as any)._registeredResourceTemplates.observe_resident_progress;

            const progressResult = await progressTemplate.readCallback(new URL('resident-progress://res-agent'), {
                residentName: 'res:agent',
            });
            const progressData = JSON.parse(progressResult.contents[0].text);
            expect(progressData).toEqual([]);
        });

        it('serves workflow and resident observer resources through the SDK Streamable HTTP transport', async () => {
            jest.restoreAllMocks();
            process.env.CONTROLLER_MCP_TOKENS = 'operator-token';
            await fs.promises.writeFile(fakeProgressPath, JSON.stringify({ tick: 2, meaningful: true, reasons: ['near_player'] }) + '\n');
            await fs.promises.writeFile(fakeTrajectoryPath, JSON.stringify({ tick: 2, action: { kind: 'move_to' } }) + '\n');

            const mockEvidence = {
                store: {
                    currentSession: jest.fn().mockReturnValue({
                        progressPath: fakeProgressPath,
                        trajectoryPath: fakeTrajectoryPath,
                    }),
                },
            };
            const mockRuntime = {
                getEvidence: jest.fn().mockReturnValue(mockEvidence),
            };
            mockHost.getRuntime = jest.fn().mockReturnValue(mockRuntime);

            const started = await startControllerMcpHttpServer(mockHost, { port: 0, path: '/controller/mcp' });
            const client = new Client({ name: 'jest-controller-resource-client', version: '0.0.0' });

            try {
                await client.connect(
                    new StreamableHTTPClientTransport(new URL(started.url), {
                        requestInit: { headers: { Authorization: 'Bearer operator-token' } },
                    }),
                );

                const cardsResult = await client.readResource({ uri: 'workflow-cards://current' });
                const cards = JSON.parse(resourceText(cardsResult.contents[0]));
                expect(cards.find((card: any) => card.id === 'follow-codex').mcp).toEqual({
                    runnable: true,
                    routine: 'follow_player',
                    defaultParams: { player: 'Codex', distance: 3 },
                });

                const progressResult = await client.readResource({ uri: 'resident-progress://res%3Aagent' });
                const progress = JSON.parse(resourceText(progressResult.contents[0]));
                expect(progress).toEqual([expect.objectContaining({ tick: 2, reasons: ['near_player'] })]);

                const trajectoryResult = await client.readResource({ uri: 'resident-trajectory://res%3Aagent' });
                const trajectory = JSON.parse(resourceText(trajectoryResult.contents[0]));
                expect(trajectory).toEqual([expect.objectContaining({ tick: 2, action: { kind: 'move_to' } })]);
                expect(mockHost.getRuntime).toHaveBeenCalledWith('res:agent');
            } finally {
                await client.close();
                await closeControllerMcpHttpServer(started.server);
            }
        });
    });

    describe('patron_ask tool', () => {
        beforeEach(() => {
            mockHost.patronGateway = {
                askResident: jest.fn().mockResolvedValue({ ok: true, eventId: 'ask-james-res:pip-123' }),
            };
            mockHost.enqueuePerceptionEvent = jest.fn().mockReturnValue(true);
        });

        it('is registered under name patron_ask with correct properties', () => {
            const mcpServer = serverInstance.createServer();
            const registeredTools = (mcpServer as any)._registeredTools;

            const tool = registeredTools.patron_ask;
            expect(tool).toBeDefined();
            expect(tool.description).toContain('Ask a running resident');
            expect(tool.inputSchema).toBeDefined();
        });

        it('records the ask and enqueues a synthetic chat event on the running resident', async () => {
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.patron_ask;

            const result = await tool.handler({
                human: 'hd035-smoke',
                resident: 'pip',
                text: 'Can you answer me right now?',
            });

            expect(mockHost.patronGateway.askResident).toHaveBeenCalledWith('hd035-smoke', 'res:pip', 'Can you answer me right now?');
            expect(mockHost.enqueuePerceptionEvent).toHaveBeenCalledWith(
                'res:pip',
                expect.objectContaining({
                    kind: 'chat',
                    text: 'Can you answer me right now?',
                    to: 'public',
                    source: 'patron:ask',
                    from: expect.objectContaining({
                        id: 'player:hd035-smoke',
                        kind: 'player',
                        name: 'hd035-smoke',
                        position: { x: 0, y: 0, level: 0 },
                    }),
                }),
            );
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed).toEqual(
                expect.objectContaining({
                    ok: true,
                    eventId: 'ask-james-res:pip-123',
                    enqueued: true,
                }),
            );
        });

        it('does not enqueue when PatronGateway rejects the ask', async () => {
            mockHost.patronGateway.askResident.mockResolvedValueOnce({
                ok: false,
                eventId: '',
                error: 'resident_not_found',
            });
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.patron_ask;

            const result = await tool.handler({
                human: 'hd035-smoke',
                resident: 'missing',
                text: 'Anyone home?',
            });

            expect(mockHost.enqueuePerceptionEvent).not.toHaveBeenCalled();
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed).toEqual({
                ok: false,
                eventId: '',
                enqueued: false,
                error: 'resident_not_found',
            });
        });

        it('reports enqueue failure when the runtime disappears after recording the ask', async () => {
            mockHost.enqueuePerceptionEvent.mockReturnValueOnce(false);
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.patron_ask;

            const result = await tool.handler({
                human: 'hd035-smoke',
                resident: 'res:pip',
                text: 'Did this reach you?',
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed).toEqual({
                ok: false,
                eventId: 'ask-james-res:pip-123',
                enqueued: false,
                error: 'resident_not_found',
            });
        });

        it('serves patron_ask through the SDK Streamable HTTP transport with bearer auth', async () => {
            jest.restoreAllMocks();
            process.env.CONTROLLER_MCP_TOKENS = 'operator-token';
            process.env.CONTROLLER_MCP_OPERATOR_FOR_operator_token = 'operator-codex';

            const started = await startControllerMcpHttpServer(mockHost, { port: 0, path: '/controller/mcp' });
            const client = new Client({ name: 'jest-controller-patron-client', version: '0.0.0' });

            try {
                await client.connect(
                    new StreamableHTTPClientTransport(new URL(started.url), {
                        requestInit: { headers: { Authorization: 'Bearer operator-token' } },
                    }),
                );

                const result = await client.callTool({
                    name: 'patron_ask',
                    arguments: {
                        human: 'hd035-sdk',
                        resident: 'agent',
                        text: 'Can you hear me through the SDK?',
                    },
                });

                const content = result.content as Array<{ type: string; text?: string }>;
                const parsed = JSON.parse(content[0].text || '{}');
                expect(parsed).toEqual({
                    ok: true,
                    eventId: 'ask-james-res:pip-123',
                    enqueued: true,
                });
                expect(mockHost.patronGateway.askResident).toHaveBeenCalledWith(
                    'hd035-sdk',
                    'res:agent',
                    'Can you hear me through the SDK?',
                );
                expect(mockHost.enqueuePerceptionEvent).toHaveBeenCalledWith(
                    'res:agent',
                    expect.objectContaining({
                        kind: 'chat',
                        text: 'Can you hear me through the SDK?',
                        source: 'patron:ask',
                        from: expect.objectContaining({
                            id: 'player:hd035-sdk',
                            name: 'hd035-sdk',
                            kind: 'player',
                        }),
                    }),
                );
            } finally {
                await client.close();
                await closeControllerMcpHttpServer(started.server);
            }
        });
    });

    describe('patron_offer tool', () => {
        beforeEach(() => {
            mockHost.patronGateway = {
                offerTo: jest.fn().mockResolvedValue({
                    ok: true,
                    eventId: 'mercy-hd-live-res:pip-123',
                    standingDelta: {
                        factionId: 'embassy',
                        before: 0,
                        after: 10,
                        tierCrossed: 'acquaintance',
                        tiersCrossed: ['acquaintance'],
                    },
                }),
            };
            mockHost.persistPatronLedgers = jest.fn();
            mockHost.refreshPatronLedgersFromDisk = jest.fn();
        });

        it('is registered under name patron_offer with correct properties', () => {
            const mcpServer = serverInstance.createServer();
            const registeredTools = (mcpServer as any)._registeredTools;

            const tool = registeredTools.patron_offer;
            expect(tool).toBeDefined();
            expect(tool.description).toContain('Offer Shards');
            expect(tool.inputSchema).toBeDefined();
        });

        it('applies the offer through the live PatronGateway', async () => {
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.patron_offer;

            const result = await tool.handler({
                human: 'hd-live',
                resident: 'pip',
                amount: 10,
            });

            expect(mockHost.patronGateway.offerTo).toHaveBeenCalledWith({
                humanId: 'hd-live',
                residentName: 'res:pip',
                amount: 10,
                interactionContext: 'mcp_offer',
            });
            expect(mockHost.refreshPatronLedgersFromDisk).toHaveBeenCalledTimes(1);
            expect(mockHost.persistPatronLedgers).toHaveBeenCalledTimes(1);
            const parsed = JSON.parse(result.content[0].text);
            expect(parsed).toEqual({
                ok: true,
                eventId: 'mercy-hd-live-res:pip-123',
                standingDelta: {
                    factionId: 'embassy',
                    before: 0,
                    after: 10,
                    tierCrossed: 'acquaintance',
                    tiersCrossed: ['acquaintance'],
                },
            });
        });

        it('reports gateway errors without inventing a live update', async () => {
            mockHost.patronGateway.offerTo.mockResolvedValueOnce({
                ok: false,
                eventId: '',
                error: 'resident_not_found',
            });
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.patron_offer;

            const result = await tool.handler({
                human: 'hd-live',
                resident: 'missing',
                amount: 10,
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(mockHost.refreshPatronLedgersFromDisk).toHaveBeenCalledTimes(1);
            expect(mockHost.persistPatronLedgers).not.toHaveBeenCalled();
            expect(parsed).toEqual({
                ok: false,
                eventId: '',
                error: 'resident_not_found',
            });
        });
    });

    describe('Plan RB-MCP-ε run_workflow_card tool', () => {
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

        it('is registered under name run_workflow_card with correct properties', () => {
            const mcpServer = serverInstance.createServer();
            const registeredTools = (mcpServer as any)._registeredTools;
            expect(registeredTools.run_workflow_card).toBeDefined();
            expect(registeredTools.run_workflow_card.description).toBe('Execute a whitelisted workflow card for a resident');
        });

        it('rejects with resident_not_found if resident is missing', async () => {
            mockHost.getRuntime.mockReturnValue(undefined);
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_workflow_card;

            const result = await tool.handler({
                resident: 'res:nobody',
                cardId: 'make-fire',
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('rejected');
            expect(parsed.lastError).toBe('resident_not_found');
        });

        it('rejects with routine_not_whitelisted if cardId is not mapped or supported', async () => {
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_workflow_card;

            const result = await tool.handler({
                resident: 'res:agent',
                cardId: 'unsupported-card',
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('rejected');
            expect(parsed.lastError).toBe('routine_not_whitelisted');
        });

        it('rejects with routine_not_whitelisted if cardId is supported but does not have a mapped routine', async () => {
            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_workflow_card;

            const result = await tool.handler({
                resident: 'res:agent',
                cardId: 'explore-locally',
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('rejected');
            expect(parsed.lastError).toBe('routine_not_whitelisted');
        });

        it('executes mapped workflow card successfully when resident is registered', async () => {
            const mockRuntime: any = {
                tick: jest.fn().mockResolvedValue('completed'),
                activeRoutineId: undefined,
                _lastHints: [],
            };
            mockHost.getRuntime.mockReturnValue(mockRuntime);

            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_workflow_card;

            const result = await tool.handler({
                resident: 'res:agent',
                cardId: 'make-fire',
                maxTicks: 100,
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('completed');
            expect(parsed.ticksUsed).toBe(1);

            // Verify activeRoutineId lifecycle and mapping
            expect(mockRuntime.tick).toHaveBeenCalled();
            expect(mockRuntime.activeRoutineId).toBeUndefined();
        });

        it('uses default params for workflow cards backed by parameterized routines', async () => {
            const mockRuntime: any = {
                tick: jest.fn().mockResolvedValue('completed'),
                activeRoutineId: undefined,
                _lastHints: [],
            };
            mockHost.getRuntime.mockReturnValue(mockRuntime);

            const mcpServer = serverInstance.createServer();
            const tool = (mcpServer as any)._registeredTools.run_workflow_card;

            const result = await tool.handler({
                resident: 'res:agent',
                cardId: 'follow-codex',
                maxTicks: 10,
            });

            const parsed = JSON.parse(result.content[0].text);
            expect(parsed.status).toBe('completed');
            expect(mockRuntime.tick).toHaveBeenCalledWith(
                expect.objectContaining({
                    routineId: 'follow_player',
                    params: { player: 'Codex', distance: 3 },
                }),
            );
            expect(mockRuntime.activeRoutineId).toBeUndefined();
        });

        it('serves run_workflow_card through the SDK Streamable HTTP transport', async () => {
            jest.restoreAllMocks();
            process.env.CONTROLLER_MCP_TOKENS = 'operator-token';
            process.env.CONTROLLER_MCP_OPERATOR_FOR_operator_token = 'operator-codex';

            const mockRuntime: any = {
                tick: jest.fn().mockResolvedValue('completed'),
                activeRoutineId: undefined,
                _lastHints: ['follow_card_completed'],
            };
            mockHost.getRuntime.mockReturnValue(mockRuntime);

            const started = await startControllerMcpHttpServer(mockHost, { port: 0, path: '/controller/mcp' });
            const client = new Client({ name: 'jest-controller-workflow-card-client', version: '0.0.0' });

            try {
                await client.connect(
                    new StreamableHTTPClientTransport(new URL(started.url), {
                        requestInit: { headers: { Authorization: 'Bearer operator-token' } },
                    }),
                );

                const result = await client.callTool({
                    name: 'run_workflow_card',
                    arguments: { resident: 'res:agent', cardId: 'follow-codex', maxTicks: 10 },
                });

                const content = result.content as Array<{ type: string; text?: string }>;
                const parsed = JSON.parse(content[0].text || '{}');
                expect(parsed).toEqual(
                    expect.objectContaining({
                        status: 'completed',
                        ticksUsed: 1,
                        effectEvidenceCount: 1,
                        trajectoryHints: ['follow_card_completed'],
                    }),
                );
                expect(mockRuntime.tick).toHaveBeenCalledWith(
                    expect.objectContaining({
                        routineId: 'follow_player',
                        params: { player: 'Codex', distance: 3 },
                    }),
                );

                const logContent = await fs.promises.readFile(logFilePath, 'utf8');
                const parsedLog = JSON.parse(logContent);
                expect(parsedLog.operator).toBe('operator-codex');
                expect(parsedLog.routine).toBe('follow-codex');
                expect(parsedLog.paramsHash).toMatch(/^sha256:/);
                expect(parsedLog.paramsHash).not.toBe('sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
                expect(parsedLog.status).toBe('completed');
            } finally {
                await client.close();
                await closeControllerMcpHttpServer(started.server);
            }
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

function resourceText(content: { text?: string; blob?: string }): string {
    if (typeof content.text === 'string') {
        return content.text;
    }
    throw new Error('Expected text resource content');
}
