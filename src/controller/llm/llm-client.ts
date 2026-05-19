import type { LlmEndpointConfig } from '../config';

export interface LlmRequest {
    endpoint: string;
    prompt: string;
    temperature?: number;
    signal?: AbortSignal;
    priority?: number;
}

export interface LlmResponse {
    text: string;
    model?: string;
    nooped: boolean;
    cancelledBy?: string;
    promptTokens?: number;
    completionTokens?: number;
}

const ENDPOINT_PAUSE_MS = 30_000;
const MAX_RETRYABLE_FAILURES_BEFORE_PAUSE = 2;
const MAX_RETRY_ATTEMPTS = 1;

export class LlmClient {
    private active = 0;
    private sequence = 0;
    private readonly queue: QueuedRequest[] = [];
    private readonly endpointState = new Map<string, EndpointState>();

    constructor(
        private readonly endpoints: Record<string, LlmEndpointConfig>,
        private readonly maxConcurrent = Number.POSITIVE_INFINITY,
    ) {}

    async complete(request: LlmRequest): Promise<LlmResponse> {
        return this.enqueue(request, () => this.completeNow(request));
    }

    private async completeNow(request: LlmRequest): Promise<LlmResponse> {
        if (request.signal?.aborted) {
            return { text: '', nooped: true, cancelledBy: String(request.signal.reason || 'aborted') };
        }

        const endpointKey = this.endpoints[request.endpoint] ? request.endpoint : 'default';
        const endpoint = this.endpoints[endpointKey];
        if (!endpoint?.baseUrl || !endpoint.model) {
            return { text: JSON.stringify({ actions: [] }), model: endpoint?.model, nooped: true };
        }
        if (this.isPaused(endpointKey)) {
            return { text: JSON.stringify({ actions: [] }), model: endpoint.model, nooped: true };
        }

        const body = {
            model: endpoint.model,
            messages: [{ role: 'user', content: request.prompt }],
            temperature: request.temperature ?? 0.2,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'controller_completion',
                    strict: false,
                    schema: { type: 'object' },
                },
            },
        };

        try {
            return await this.postCompletionWithRetry(endpointKey, endpoint, body, request.signal);
        } catch (error) {
            if (request.signal?.aborted) {
                return { text: '', model: endpoint.model, nooped: true, cancelledBy: String(request.signal.reason || 'aborted') };
            }
            if (isRetryableError(error)) {
                throw error;
            }

            const fallbackBody = { ...body, response_format: { type: 'json_object' } };
            return this.postCompletionWithRetry(endpointKey, endpoint, fallbackBody, request.signal);
        }
    }

    private enqueue<T>(request: LlmRequest, run: () => Promise<T>): Promise<T> {
        if (this.maxConcurrent <= 0 || this.active < this.maxConcurrent) {
            return this.runQueued(run);
        }

        return new Promise<T>((resolve, reject) => {
            const queued: QueuedRequest<T> = {
                priority: request.priority || 0,
                sequence: ++this.sequence,
                run,
                resolve,
                reject,
            };
            this.queue.push(queued);
            this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        });
    }

    private async runQueued<T>(run: () => Promise<T>): Promise<T> {
        this.active += 1;
        try {
            return await run();
        } finally {
            this.active -= 1;
            this.drainQueue();
        }
    }

    private drainQueue(): void {
        while (this.queue.length > 0 && this.active < this.maxConcurrent) {
            const next = this.queue.shift()!;
            this.runQueued(next.run).then(next.resolve, next.reject);
        }
    }

    private isPaused(endpointKey: string): boolean {
        const state = this.endpointState.get(endpointKey);
        if (!state?.pausedUntil) {
            return false;
        }
        if (state.pausedUntil.getTime() > Date.now()) {
            return true;
        }
        this.endpointState.set(endpointKey, { ...state, pausedUntil: undefined, retryableFailures: 0 });
        return false;
    }

    private async postCompletionWithRetry(
        endpointKey: string,
        endpoint: LlmEndpointConfig,
        body: unknown,
        signal?: AbortSignal,
    ): Promise<LlmResponse> {
        let attempt = 0;
        while (true) {
            try {
                const response = await this.postCompletion(endpoint, body, signal);
                this.clearRetryableFailures(endpointKey);
                return response;
            } catch (error) {
                if (signal?.aborted || !isRetryableError(error)) {
                    throw error;
                }
                this.recordRetryableFailure(endpointKey);
                if (attempt >= MAX_RETRY_ATTEMPTS) {
                    throw error;
                }
                attempt += 1;
            }
        }
    }

    private clearRetryableFailures(endpointKey: string): void {
        const state = this.endpointState.get(endpointKey);
        if (state?.retryableFailures) {
            this.endpointState.set(endpointKey, { ...state, retryableFailures: 0 });
        }
    }

    private recordRetryableFailure(endpointKey: string): void {
        const state = this.endpointState.get(endpointKey) || { retryableFailures: 0 };
        const retryableFailures = state.retryableFailures + 1;
        this.endpointState.set(endpointKey, {
            retryableFailures,
            pausedUntil:
                retryableFailures >= MAX_RETRYABLE_FAILURES_BEFORE_PAUSE ? new Date(Date.now() + ENDPOINT_PAUSE_MS) : state.pausedUntil,
        });
    }

    private async postCompletion(endpoint: LlmEndpointConfig, body: unknown, signal?: AbortSignal): Promise<LlmResponse> {
        const response = await fetch(`${endpoint.baseUrl?.replace(/\/$/, '')}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: signal
                ? AbortSignal.any([signal, AbortSignal.timeout(endpoint.timeoutMs || 30000)])
                : AbortSignal.timeout(endpoint.timeoutMs || 30000),
        });
        if (!response.ok) {
            throw new LlmHttpError(response.status, response.statusText);
        }

        const json = (await response.json()) as unknown;
        const payload = isRecord(json) ? json : {};
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const first = isRecord(choices[0]) ? choices[0] : {};
        const message = isRecord(first.message) ? first.message : {};
        const usage = isRecord(payload.usage) ? payload.usage : {};
        return {
            text: typeof message.content === 'string' ? message.content : '',
            model: typeof payload.model === 'string' ? payload.model : undefined,
            nooped: false,
            promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
            completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
        };
    }
}

class LlmHttpError extends Error {
    constructor(
        readonly status: number,
        statusText: string,
    ) {
        super(`LLM completion failed: ${status} ${statusText}`);
    }
}

function isRetryableError(error: unknown): error is LlmHttpError {
    return error instanceof LlmHttpError && (error.status === 429 || error.status >= 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface QueuedRequest<T = unknown> {
    priority: number;
    sequence: number;
    run: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
}

interface EndpointState {
    retryableFailures: number;
    pausedUntil?: Date;
}
