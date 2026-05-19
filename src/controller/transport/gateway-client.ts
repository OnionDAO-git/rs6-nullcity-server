import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Backoff } from '../util/backoff';
import {
    type ActionResult,
    type AgentAction,
    type ConnectResidentPayload,
    type CreateResidentPayload,
    type Perception,
    type PerceptionEvent,
    type ResidentFilter,
    type ResidentSummary,
    decodeMessage,
    encodeMessage,
    makeRequest,
    readError,
} from './message-codecs';

export interface GatewayClientOptions {
    url: string;
    authToken?: string;
    controllerId: string;
    version?: string;
    capabilities?: string[];
    requestTimeoutMs?: number;
    reconnect?: boolean;
}

export interface GatewayClientEvents {
    perception: [residentId: string, perception: Perception];
    event: [residentId: string, event: PerceptionEvent];
    actionResult: [residentId: string, requestId: string | undefined, result: ActionResult, cause: string | undefined];
    error: [error: Error];
    disconnect: [];
    ready: [];
}

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: NodeJS.Timeout;
};

export declare interface GatewayClient {
    on<U extends keyof GatewayClientEvents>(event: U, listener: (...args: GatewayClientEvents[U]) => void): this;
    emit<U extends keyof GatewayClientEvents>(event: U, ...args: GatewayClientEvents[U]): boolean;
}

export class GatewayClient extends EventEmitter {
    private socket?: WebSocket;
    private requestSeq = 0;
    private readonly pending = new Map<string, PendingRequest>();
    private readonly backoff = new Backoff();
    private closed = false;

    constructor(private readonly options: GatewayClientOptions) {
        super();
    }

    async connect(): Promise<void> {
        this.closed = false;
        await this.openSocket();
    }

    close(): void {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Gateway client closed'));
        }
        this.pending.clear();
        this.socket?.close();
        this.socket = undefined;
    }

    async hello(): Promise<void> {
        if (this.options.authToken) {
            await this.request('auth', { token: this.options.authToken });
        }

        await this.request('controller_hello', {
            controllerId: this.options.controllerId,
            version: this.options.version || '0.1.0',
            capabilities: this.options.capabilities || ['residents.v1', 'noop-llm'],
        });
    }

    listResidents(filter: ResidentFilter = 'all'): Promise<ResidentSummary[]> {
        return this.request('list_residents', { filter }).then(value => {
            const payload = readPayload(value);
            const residents = Array.isArray(payload.residents) ? payload.residents : [];
            return residents as ResidentSummary[];
        });
    }

    createResident(payload: CreateResidentPayload): Promise<ResidentSummary> {
        return this.request('create_resident', payload).then(value => readResident(value));
    }

    connectResident(payload: ConnectResidentPayload): Promise<ResidentSummary> {
        return this.request('connect_resident', payload).then(value => readResident(value));
    }

    attach(payload: ConnectResidentPayload): Promise<ResidentSummary> {
        return this.request('attach', payload).then(value => readResident(value));
    }

    submitAction(name: string, action: AgentAction): Promise<ActionResult> {
        return this.request('submit_action', { name, action }).then(value => {
            const payload = readPayload(value);
            return (payload.result || { ok: true, cause: payload.cause }) as ActionResult;
        });
    }

    detach(name: string): Promise<void> {
        return this.request('detach', { name }).then(() => undefined);
    }

    disconnectResident(name: string): Promise<void> {
        return this.request('disconnect_resident', { name }).then(() => undefined);
    }

    deleteResident(name: string): Promise<void> {
        return this.request('delete_resident', { name }).then(() => undefined);
    }

    private async openSocket(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(this.options.url);
            this.socket = socket;

            socket.once('open', () => {
                this.backoff.reset();
                this.emit('ready');
                resolve();
            });
            socket.once('error', reject);
            socket.on('message', raw => this.handleMessage(raw));
            socket.on('close', () => this.handleClose());
        });
    }

    private request(type: string, payload?: unknown): Promise<unknown> {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('Gateway socket is not open'));
        }

        const requestId = `controller-${Date.now()}-${++this.requestSeq}`;
        const timeout = setTimeout(() => {
            const pending = this.pending.get(requestId);
            if (!pending) {
                return;
            }
            this.pending.delete(requestId);
            pending.reject(new Error(`Gateway request timed out: ${type}`));
        }, this.options.requestTimeoutMs || 10000);

        const promise = new Promise<unknown>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject, timeout });
        });

        socket.send(encodeMessage(makeRequest(type, requestId, payload)));
        return promise;
    }

    private handleMessage(raw: WebSocket.RawData): void {
        try {
            const message = decodeMessage(raw as Buffer);
            const error = readError(message);
            if (error) {
                this.resolveError(error.request_id || message.request_id, error);
                return;
            }

            if (message.type === 'perception' && isRecord(message.payload)) {
                this.emit('perception', String(message.payload.resident_id), (message.payload.perception || {}) as Perception);
                return;
            }

            if (message.type === 'event' && isRecord(message.payload)) {
                this.emit('event', String(message.payload.resident_id), (message.payload.event || {}) as PerceptionEvent);
                return;
            }

            if (message.type === 'action_result' && isRecord(message.payload)) {
                this.emit(
                    'actionResult',
                    String(message.payload.resident_id),
                    typeof message.payload.request_id === 'string' ? message.payload.request_id : message.request_id,
                    (message.payload.result || { ok: true }) as ActionResult,
                    typeof message.payload.cause === 'string' ? message.payload.cause : undefined,
                );
            }

            if (message.request_id) {
                this.resolveRequest(message.request_id, message);
            }
        } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }

    private resolveRequest(requestId: string, value: unknown): void {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return;
        }
        this.pending.delete(requestId);
        clearTimeout(pending.timeout);
        pending.resolve(value);
    }

    private resolveError(requestId: string | undefined, error: { code: string; message: string; cause?: string }): void {
        const gatewayError = new Error(`${error.code}: ${error.message}${error.cause ? ` (${error.cause})` : ''}`);
        if (!requestId) {
            this.emit('error', gatewayError);
            return;
        }

        const pending = this.pending.get(requestId);
        if (!pending) {
            this.emit('error', gatewayError);
            return;
        }

        this.pending.delete(requestId);
        clearTimeout(pending.timeout);
        pending.reject(gatewayError);
    }

    private handleClose(): void {
        this.socket = undefined;
        for (const [requestId, pending] of this.pending) {
            this.pending.delete(requestId);
            clearTimeout(pending.timeout);
            pending.reject(new Error('Gateway socket closed'));
        }

        this.emit('disconnect');
        if (this.closed || this.options.reconnect === false) {
            return;
        }

        const delay = this.backoff.nextDelayMs();
        setTimeout(() => this.openSocket().catch(error => this.emit('error', error)), delay);
    }
}

function readResident(value: unknown): ResidentSummary {
    const payload = readPayload(value);
    return (payload.resident || payload) as ResidentSummary;
}

function readPayload(value: unknown): Record<string, unknown> {
    return isRecord(value) && isRecord(value.payload) ? value.payload : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
