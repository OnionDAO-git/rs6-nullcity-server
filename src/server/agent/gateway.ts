import http from 'http';
import { activeWorld } from '@engine/world';
import type { Player } from '@engine/world/actor/player/player';
import type { Resident } from '@engine/world/actor/resident/resident';
import { PerceptionBuilder } from '@engine/world/actor/resident/perception/perception-builder';
import { isResident } from '@engine/world/actor/util';
import { logger } from '@runejs/common';
import type { AgentGatewayConfig } from './config';
import { defaultAgentGatewayConfig } from './config';
import { ActionLog } from './protocol/action-log';
import { type ClientMessage, type ObservableSubjectSummary, type SpectatorMode, type SpectatorSubject, frame, parseClientMessage } from './protocol/messages';
import { ResidentRegistry } from './resident-registry';
import { type ResidentObserver, ResidentSession } from './resident-session';
import { ResidentMcpFacade } from './transports/mcp-transport';

type WebSocketLike = {
    on(event: string, handler: (...args: any[]) => void): void;
    send(data: string): void;
    close(): void;
    readyState?: number;
};

interface SpectatorSessionState {
    id: string;
    subject: SpectatorSubject;
    mode: SpectatorMode;
    send(message: object): void;
    subscription: { unsubscribe(): void };
    lastRegionId?: number;
}

export class AgentGateway {
    private readonly config: AgentGatewayConfig;
    private readonly registry = new ResidentRegistry();
    private readonly sessions = new Map<string, ResidentSession>();
    private readonly spectatorSessions = new Map<string, SpectatorSessionState>();
    private readonly actionLog = new ActionLog();
    private readonly spectatorPerception = new PerceptionBuilder();
    private readonly mcpFacade?: ResidentMcpFacade;
    private server: http.Server | null = null;
    private wsServer: any = null;

    public constructor(config?: Partial<AgentGatewayConfig>) {
        this.config = { ...defaultAgentGatewayConfig, ...config };
        if (this.config.mcp?.enabled) {
            this.mcpFacade = new ResidentMcpFacade(
                {
                    registry: this.registry,
                    sessionFor: resident => this.sessionFor(resident),
                    closeSession: name => this.closeSession(name),
                },
                {
                    controllerId: 'mcp:agent-gateway',
                    path: this.config.mcp.path,
                    allowDelete: this.config.allowDelete,
                    actionTimeoutMs: this.config.mcp.actionTimeoutMs,
                    eventTimeoutMs: this.config.mcp.eventTimeoutMs,
                },
            );
        }
    }

    public async start(): Promise<void> {
        const wsModule = await import('ws');
        const WebSocketServer = (wsModule as any).WebSocketServer || (wsModule as any).Server;

        const server = http.createServer((request, response) => {
            this.handleHttp(request, response).catch(error => {
                logger.error(`AgentGateway HTTP request failed: ${error?.stack || error}`);
                if (!response.headersSent) {
                    response.writeHead(500);
                }
                response.end();
            });
        });
        this.server = server;
        this.wsServer = new WebSocketServer({ server });
        this.wsServer.on('connection', (socket: WebSocketLike, request: http.IncomingMessage) => this.handleConnection(socket, request));

        await new Promise<void>(resolve => server.listen(this.config.port, this.config.host, resolve));
        logger.info(`AgentGateway listening on ${this.config.host}:${this.config.port}.`);
    }

    public stop(): void {
        for (const sessionId of [...this.spectatorSessions.keys()]) {
            this.closeSpectatorSession(sessionId, 'gateway_stop', false);
        }
        this.wsServer?.close();
        this.server?.close();
    }

    private handleConnection(socket: WebSocketLike, request: http.IncomingMessage): void {
        if (!this.authorized(request)) {
            socket.close();
            return;
        }

        const clientId = `client:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        let controllerId = clientId;
        const clientSpectatorSessions = new Set<string>();

        const send = (message: object) => {
            socket.send(JSON.stringify(message));
        };

        const observer: ResidentObserver = {
            id: clientId,
            sendPerception: (resident, perception) => send(frame('perception', { resident_id: resident.residentId, perception })),
            sendEvents: (resident, events) => {
                for (const event of events) {
                    send(frame('event', { resident_id: resident.residentId, event }));
                }
            },
            sendActionResults: (resident, results) => {
                for (const result of results) {
                    send(frame('action_result', { resident_id: resident.residentId, result }));
                }
            },
        };

        socket.on('message', async raw => {
            let message: ClientMessage;
            try {
                message = parseClientMessage(raw);
            } catch (error) {
                send(frame('error', { code: 'EBAD_FRAME', message: error?.message || 'Bad frame' }));
                return;
            }

            try {
                if (message.kind === 'controller_hello') {
                    controllerId = message.payload.controllerId || controllerId;
                    send(frame('ok', { ok: true }, message.id));
                    return;
                }

                await this.handleMessage(message, controllerId, observer, send, clientSpectatorSessions);
            } catch (error) {
                send(
                    frame(
                        'error',
                        {
                            request_id: message.id,
                            code: error?.message || 'EAGENT',
                            message: error?.message || 'Agent gateway error',
                            cause: error?.cause,
                        },
                        message.id,
                    ),
                );
            }
        });

        socket.on('close', () => {
            for (const sessionId of clientSpectatorSessions) {
                if (this.spectatorSessions.has(sessionId)) {
                    this.closeSpectatorSession(sessionId, 'client_disconnect', false);
                }
            }
            for (const session of this.sessions.values()) {
                session.detach(clientId);
            }
            for (const name of this.registry.releaseController(controllerId)) {
                const session = this.sessions.get(name);
                session?.close();
                this.sessions.delete(name);
            }
        });
    }

    private async handleMessage(
        message: ClientMessage,
        controllerId: string,
        observer: ResidentObserver,
        send: (message: object) => void,
        clientSpectatorSessions: Set<string>,
    ): Promise<void> {
        switch (message.kind) {
            case 'auth':
                send(frame('ok', { ok: true }, message.id));
                return;
            case 'list_residents': {
                let residents = this.registry.list();
                if (message.payload.filter === 'online') {
                    residents = residents.filter(resident => resident.online);
                } else if (message.payload.filter === 'offline') {
                    residents = residents.filter(resident => !resident.online);
                }
                send(frame('resident_list', { residents }, message.id));
                return;
            }
            case 'list_observable_subjects': {
                send(frame('observable_subject_list', { subjects: this.listObservableSubjects(message.payload) }, message.id));
                return;
            }
            case 'observe_subject': {
                const sessionId = this.openSpectatorSession(message.payload.subject, message.payload.mode || 'follow', send, message.id);
                clientSpectatorSessions.add(sessionId);
                return;
            }
            case 'unobserve_subject': {
                if (!clientSpectatorSessions.has(message.payload.sessionId)) {
                    throw new Error('ENO_SUCH_SESSION');
                }
                this.closeSpectatorSession(message.payload.sessionId, 'client_unobserve');
                clientSpectatorSessions.delete(message.payload.sessionId);
                send(frame('ok', { ok: true }, message.id));
                return;
            }
            case 'create_resident': {
                const resident = this.registry.create(message.payload.name, message.payload.spawnPosition, {
                    initialInventory: message.payload.initialInventory,
                    initialEquipment: message.payload.initialEquipment,
                });
                send(frame('resident_created', { resident }, message.id));
                return;
            }
            case 'connect_resident': {
                const resident = await this.registry.connect(message.payload.name, controllerId, message.payload.onDisconnect);
                const session = this.sessionFor(resident);
                if (message.payload.observe !== false) {
                    session.attach(observer);
                }
                const perception = resident.perception || resident.publishPerception();
                send(frame('resident_connected', { resident: this.registry.summary(resident.username), perception }, message.id));
                return;
            }
            case 'attach': {
                const resident = this.registry.get(message.payload.name);
                if (!resident) {
                    throw new Error('ENO_SUCH_RESIDENT');
                }
                this.sessionFor(resident).attach(observer);
                send(frame('ok', { ok: true }, message.id));
                return;
            }
            case 'submit_action': {
                const resident = this.registry.get(message.payload.name);
                if (!resident) {
                    throw new Error('ENO_SUCH_RESIDENT');
                }
                if (this.registry.controllerFor(message.payload.name) !== controllerId) {
                    throw new Error('ECONTROL_REQUIRED');
                }
                this.sessionFor(resident).submitAction(message.payload.action, message.id);
                send(frame('ok', { ok: true }, message.id));
                return;
            }
            case 'detach': {
                const resident = this.registry.get(message.payload.name);
                if (resident) {
                    this.sessionFor(resident).detach(observer.id);
                }
                send(frame('ok', { ok: true }, message.id));
                return;
            }
            case 'disconnect_resident': {
                const name = message.payload.name.toLowerCase();
                this.registry.disconnect(name, message.payload.cause);
                this.sessions.get(name)?.close();
                this.sessions.delete(name);
                send(frame('resident_disconnected', { name, cause: message.payload.cause }, message.id));
                return;
            }
            case 'delete_resident': {
                if (!this.config.allowDelete) {
                    throw new Error('EDELETE_DISABLED');
                }
                this.registry.delete(message.payload.name);
                send(frame('ok', { ok: true }, message.id));
                return;
            }
            default:
                throw new Error('EUNKNOWN_MESSAGE');
        }
    }

    private listObservableSubjects(options: { includeResidents?: boolean; includePlayers?: boolean }): ObservableSubjectSummary[] {
        const includeResidents = options.includeResidents !== false;
        const includePlayers = options.includePlayers !== false;
        const subjects = new Map<string, ObservableSubjectSummary>();

        if (includeResidents) {
            for (const resident of this.registry.list().filter(resident => resident.online)) {
                subjects.set(`resident:${resident.name}`, {
                    subject: { kind: 'resident', name: resident.name },
                    online: true,
                });
            }
        }

        for (const player of activeWorld?.playerList || []) {
            if (!player?.isActive) {
                continue;
            }

            if (includeResidents && isResident(player)) {
                subjects.set(`resident:${player.username.toLowerCase()}`, {
                    subject: { kind: 'resident', name: player.username },
                    online: true,
                    position: this.positionSummary(player),
                });
            } else if (includePlayers && !isResident(player)) {
                subjects.set(`player:${player.username.toLowerCase()}`, {
                    subject: { kind: 'player', username: player.username },
                    online: true,
                    position: this.positionSummary(player),
                });
            }
        }

        return [...subjects.values()].sort((a, b) => this.subjectKey(a.subject).localeCompare(this.subjectKey(b.subject)));
    }

    private openSpectatorSession(
        subject: SpectatorSubject,
        mode: SpectatorMode,
        send: (message: object) => void,
        requestId?: string | number,
    ): string {
        const player = this.resolveSpectatorSubject(subject);
        if (!player) {
            throw new Error('ENO_SUCH_SUBJECT');
        }

        const sessionId = `spectator:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        const session: SpectatorSessionState = {
            id: sessionId,
            subject,
            mode,
            send,
            lastRegionId: this.regionIdFor(player),
            subscription: activeWorld.tickComplete.subscribe(() => this.publishSpectatorSession(sessionId)),
        };
        this.spectatorSessions.set(sessionId, session);

        const perception = this.spectatorPerception.buildForPlayer(player);
        send(
            frame(
                'spectator_connected',
                {
                    sessionId,
                    subject,
                    initialState: {
                        mode,
                        regionId: session.lastRegionId,
                        position: this.positionSummary(player),
                        perception,
                    },
                },
                requestId,
            ),
        );
        return sessionId;
    }

    private publishSpectatorSession(sessionId: string): void {
        const session = this.spectatorSessions.get(sessionId);
        if (!session) {
            return;
        }

        const player = this.resolveSpectatorSubject(session.subject);
        if (!player) {
            this.closeSpectatorSession(sessionId, 'subject_unavailable');
            return;
        }

        const regionId = this.regionIdFor(player);
        const perception = this.spectatorPerception.buildForPlayer(player);
        if (regionId !== undefined && regionId !== session.lastRegionId) {
            session.lastRegionId = regionId;
            session.send(
                frame('spectator_rebuild', {
                    sessionId,
                    payload: {
                        subject: session.subject,
                        mode: session.mode,
                        regionId,
                        position: this.positionSummary(player),
                        perception,
                    },
                }),
            );
        }
        session.send(frame('spectator_perception', { sessionId, perception }));
    }

    private closeSpectatorSession(sessionId: string, cause?: string, notify = true): void {
        const session = this.spectatorSessions.get(sessionId);
        if (!session) {
            throw new Error('ENO_SUCH_SESSION');
        }

        session.subscription.unsubscribe();
        this.spectatorSessions.delete(sessionId);
        if (notify) {
            session.send(frame('spectator_disconnected', { sessionId, cause }));
        }
    }

    private resolveSpectatorSubject(subject: SpectatorSubject): Player | null {
        if (subject.kind === 'resident') {
            const resident = this.registry.get(subject.name) || activeWorld?.findActivePlayerByUsername(subject.name);
            return resident && isResident(resident) && resident.isActive ? resident : null;
        }

        const player = activeWorld?.findActivePlayerByUsername(subject.username);
        return player && !isResident(player) && player.isActive ? player : null;
    }

    private regionIdFor(player: Player): number | undefined {
        return activeWorld?.chunkManager.getRegionIdForWorldPosition(player.position);
    }

    private positionSummary(player: Player): { x: number; y: number; level: number } {
        return { x: player.position.x, y: player.position.y, level: player.position.level };
    }

    private subjectKey(subject: SpectatorSubject): string {
        return subject.kind === 'resident' ? `resident:${subject.name}` : `player:${subject.username}`;
    }

    private sessionFor(resident: Resident): ResidentSession {
        const key = resident.username.toLowerCase();
        let session = this.sessions.get(key);
        if (session?.isClosed) {
            this.sessions.delete(key);
            session = undefined;
        }
        if (!session) {
            session = new ResidentSession(resident, this.actionLog, {
                autosaveTicks: this.config.autosaveTicks,
                logFullPerceptions: this.config.logFullPerceptions,
            });
            this.sessions.set(key, session);
        }
        return session;
    }

    private closeSession(name: string): void {
        const key = name.toLowerCase();
        this.sessions.get(key)?.close();
        this.sessions.delete(key);
    }

    private async handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        if (!this.authorized(request)) {
            response.writeHead(401);
            response.end();
            return;
        }

        if (this.mcpFacade?.matches(request.url)) {
            await this.mcpFacade.handleHttp(request, response);
            return;
        }

        const match = request.url?.match(/^\/agent\/sse\/(.+)$/);
        if (!match) {
            response.writeHead(404);
            response.end();
            return;
        }

        const name = decodeURIComponent(match[1]).toLowerCase();
        const resident = this.registry.get(name);
        if (!resident) {
            response.writeHead(404);
            response.end();
            return;
        }

        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        const observer: ResidentObserver = {
            id: `sse:${Date.now()}:${Math.random().toString(16).slice(2)}`,
            sendPerception: (_resident, perception) => {
                response.write(`event: perception\ndata: ${JSON.stringify(perception)}\n\n`);
            },
            sendEvents: (_resident, events) => {
                for (const event of events) {
                    response.write(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
                }
            },
        };
        this.sessionFor(resident).attach(observer);
        request.on('close', () => this.sessionFor(resident).detach(observer.id));
    }

    private authorized(request: http.IncomingMessage): boolean {
        if (!this.config.authToken) {
            const address = request.socket.remoteAddress || '';
            return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
        }

        return request.headers.authorization === `Bearer ${this.config.authToken}`;
    }
}
