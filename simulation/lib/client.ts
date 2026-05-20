import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { ActionResult, AgentAction, NormalizedFrame, Perception, PerceptionEvent, ResidentSummary } from './types';

export interface SimulationGatewayClientOptions {
    url: string;
    authToken?: string;
    controllerId: string;
    requestTimeoutMs: number;
}

export interface SimulationGatewayEvents {
    perception: [residentId: string, perception: Perception];
    event: [residentId: string, event: PerceptionEvent];
    actionResult: [residentId: string, result: ActionResult, requestId: string | undefined];
    serverError: [error: Error, frame: NormalizedFrame];
    message: [frame: NormalizedFrame];
    disconnect: [];
}

type PendingRequest = {
    resolve: (frame: NormalizedFrame) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
};

export declare interface SimulationGatewayClient {
    on<U extends keyof SimulationGatewayEvents>(event: U, listener: (...args: SimulationGatewayEvents[U]) => void): this;
    emit<U extends keyof SimulationGatewayEvents>(event: U, ...args: SimulationGatewayEvents[U]): boolean;
}

export class SimulationGatewayClient extends EventEmitter {
    private socket?: WebSocket;
    private requestSeq = 0;
    private readonly pending = new Map<string, PendingRequest>();

    constructor(private readonly options: SimulationGatewayClientOptions) {
        super();
    }

    async connect(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const headers = this.options.authToken ? { Authorization: `Bearer ${this.options.authToken}` } : undefined;
            const socket = new WebSocket(this.options.url, { headers });
            this.socket = socket;
            socket.once('open', resolve);
            socket.once('error', reject);
            socket.on('message', raw => this.handleMessage(raw));
            socket.on('close', () => this.handleClose());
        });
    }

    async hello(): Promise<void> {
        if (this.options.authToken) {
            await this.request('auth', { token: this.options.authToken });
        }
        await this.request('controller_hello', {
            controllerId: this.options.controllerId,
            version: 'simulation.v1',
            capabilities: ['residents.v1', 'simulation.v1'],
        });
    }

    listResidents(filter: 'all' | 'online' | 'offline' = 'all'): Promise<ResidentSummary[]> {
        return this.request('list_residents', { filter }).then(frame => readArray(frame.payload.residents) as ResidentSummary[]);
    }

    createResident(name: string, spawnPosition?: unknown): Promise<ResidentSummary> {
        return this.request('create_resident', { name, spawnPosition }).then(frame => frame.payload.resident as ResidentSummary);
    }

    connectResident(name: string): Promise<{ resident: ResidentSummary; perception?: Perception }> {
        return this.request('connect_resident', { name, observe: true, control: true, onDisconnect: 'idle' }).then(frame => ({
            resident: frame.payload.resident as ResidentSummary,
            perception: frame.payload.perception as Perception | undefined,
        }));
    }

    submitAction(name: string, action: AgentAction): Promise<string> {
        return this.request('submit_action', { name, action }).then(frame => String(frame.id));
    }

    disconnectResident(name: string, cause = 'simulation_stop'): Promise<void> {
        return this.request('disconnect_resident', { name, cause }).then(() => undefined);
    }

    close(): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('gateway_closed'));
        }
        this.pending.clear();
        this.socket?.close();
        this.socket = undefined;
    }

    private request(kind: string, payload?: unknown): Promise<NormalizedFrame> {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('gateway_socket_not_open'));
        }

        const id = `sim-${Date.now()}-${++this.requestSeq}`;
        const timeout = setTimeout(() => {
            const pending = this.pending.get(id);
            if (!pending) {
                return;
            }
            this.pending.delete(id);
            pending.reject(new Error(`gateway_request_timeout:${kind}`));
        }, this.options.requestTimeoutMs);

        const promise = new Promise<NormalizedFrame>((resolve, reject) => {
            this.pending.set(id, { resolve, reject, timeout });
        });

        socket.send(JSON.stringify({ v: 1, id, kind, payload: payload || {} }));
        return promise;
    }

    private handleMessage(raw: WebSocket.RawData): void {
        let frame: NormalizedFrame;
        try {
            frame = normalizeFrame(raw);
        } catch (error) {
            this.emit('serverError', error instanceof Error ? error : new Error(String(error)), {
                kind: 'decode_error',
                payload: {},
            });
            return;
        }

        if (frame.kind === 'error') {
            const message = typeof frame.payload.message === 'string' ? frame.payload.message : 'Gateway error';
            const code = typeof frame.payload.code === 'string' ? frame.payload.code : 'EAGENT';
            const requestId = frame.id || frame.payload.request_id;
            const error = new Error(`${code}: ${message}`);
            if (requestId) {
                this.rejectRequest(String(requestId), error);
            } else {
                this.emit('serverError', error, frame);
            }
            return;
        }

        if (frame.id) {
            this.resolveRequest(String(frame.id), frame);
        }

        if (frame.kind === 'perception') {
            this.emit('perception', String(frame.payload.resident_id), frame.payload.perception as Perception);
        } else if (frame.kind === 'event') {
            this.emit('event', String(frame.payload.resident_id), frame.payload.event as PerceptionEvent);
        } else if (frame.kind === 'action_result') {
            const requestId =
                typeof frame.payload.request_id === 'string' || typeof frame.payload.request_id === 'number'
                    ? String(frame.payload.request_id)
                    : undefined;
            this.emit('actionResult', String(frame.payload.resident_id), frame.payload.result as ActionResult, requestId);
        }

        this.emit('message', frame);
    }

    private resolveRequest(id: string, frame: NormalizedFrame): void {
        const pending = this.pending.get(id);
        if (!pending) {
            return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        pending.resolve(frame);
    }

    private rejectRequest(id: string, error: Error): void {
        const pending = this.pending.get(id);
        if (!pending) {
            this.emit('serverError', error, { id, kind: 'error', payload: { message: error.message } });
            return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error);
    }

    private handleClose(): void {
        for (const [id, pending] of this.pending) {
            this.pending.delete(id);
            clearTimeout(pending.timeout);
            pending.reject(new Error('gateway_socket_closed'));
        }
        this.emit('disconnect');
    }
}

function normalizeFrame(raw: WebSocket.RawData): NormalizedFrame {
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const kind = parsed.kind || parsed.type;
    if (typeof kind !== 'string') {
        throw new Error('Gateway frame missing kind');
    }
    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    return {
        id: typeof parsed.id === 'string' || typeof parsed.id === 'number' ? parsed.id : (parsed.request_id as string | undefined),
        kind,
        payload,
    };
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
