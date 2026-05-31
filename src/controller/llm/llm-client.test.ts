import { LlmClient, type LlmResponse } from './llm-client';

describe('LlmClient retry and endpoint pause', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-19T12:00:00.000Z'));
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('retries a retryable HTTP failure exactly once', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(new Response('{}', { status: 500, statusText: 'Server Error' }))
            .mockResolvedValueOnce(completionResponse('retry ok'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        const response = await client.complete({ endpoint: 'default', prompt: 'decide' });

        expect(response).toMatchObject({ text: 'retry ok', nooped: false });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('pauses an endpoint for 30 seconds after two retryable failures', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(new Response('{}', { status: 503, statusText: 'Unavailable' }))
            .mockResolvedValueOnce(new Response('{}', { status: 503, statusText: 'Unavailable' }))
            .mockResolvedValueOnce(completionResponse('after pause'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await expect(client.complete({ endpoint: 'default', prompt: 'decide' })).rejects.toThrow('LLM completion failed: 503 Unavailable');

        const paused = await client.complete({ endpoint: 'default', prompt: 'decide again' });
        expect(paused).toMatchObject({ text: JSON.stringify({ actions: [] }), nooped: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(30_001);
        const resumed = await client.complete({ endpoint: 'default', prompt: 'decide later' });
        expect(resumed).toMatchObject({ text: 'after pause', nooped: false });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('uses text fallback for non-retryable schema compatibility failures', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(new Response('{}', { status: 400, statusText: 'Bad Request' }))
            .mockResolvedValueOnce(completionResponse('fallback ok'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        const response = await client.complete({ endpoint: 'default', prompt: 'decide' });

        expect(response.text).toBe('fallback ok');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
        expect(fallbackBody.response_format).toEqual({ type: 'text' });
    });

    it('uses reasoning content when reasoning models leave message content empty', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    model: 'test-model',
                    choices: [
                        {
                            message: {
                                content: '',
                                reasoning_content: '{"actions":[{"kind":"noop"}]}',
                            },
                        },
                    ],
                    usage: { prompt_tokens: 3, completion_tokens: 5 },
                }),
                { status: 200 },
            ),
        );
        global.fetch = fetchMock;

        const client = clientFor('default');
        const response = await client.complete({ endpoint: 'default', prompt: 'decide' });

        expect(response).toMatchObject({
            text: '{"actions":[{"kind":"noop"}]}',
            nooped: false,
        });
    });

    it('surfaces a reasoning_content trace with the answer at its tail as response.text (S-INFER-2 D3 layout b)', async () => {
        // vLLM/Qwen layout (b): `content` is empty and the whole think trace +
        // final JSON answer live in `reasoning_content`. The client must surface
        // that string verbatim so the downstream salvage can recover the tail JSON.
        const reasoningTail = 'I weigh the options.\nFishing is best right now.\n{"goal":{"description":"fish at the river"}}';
        const fetchMock = jest.fn().mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    model: 'qwen-local',
                    choices: [{ message: { content: '', reasoning_content: reasoningTail } }],
                    usage: { prompt_tokens: 8, completion_tokens: 40 },
                }),
                { status: 200 },
            ),
        );
        global.fetch = fetchMock;

        const client = clientFor('default');
        const response = await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true });

        expect(response.text).toBe(reasoningTail);
        expect(response.nooped).toBe(false);
    });

    it('uses OpenRouter reasoning when providers return null content and no reasoning_content field', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    model: 'minimax/minimax-m2.7',
                    choices: [
                        {
                            message: {
                                content: null,
                                reasoning: '{"actions":[{"kind":"eat_item"}]}',
                            },
                        },
                    ],
                    usage: { prompt_tokens: 30, completion_tokens: 12, cost: 0.000042 },
                }),
                { status: 200 },
            ),
        );
        global.fetch = fetchMock;

        const client = clientFor('default');
        const response = await client.complete({ endpoint: 'default', prompt: 'decide' });

        expect(response).toMatchObject({
            text: '{"actions":[{"kind":"eat_item"}]}',
            model: 'minimax/minimax-m2.7',
            nooped: false,
            promptTokens: 30,
            completionTokens: 12,
            costUsd: 0.000042,
        });
    });

    it('honors endpoint responseFormat text for providers that produce bad schema completions', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('text mode ok'));
        global.fetch = fetchMock;

        const client = new LlmClient({
            default: {
                baseUrl: 'https://llm.test',
                model: 'test-model',
                timeoutMs: 1000,
                responseFormat: 'text',
            },
        });
        const response = await client.complete({ endpoint: 'default', prompt: 'decide' });

        expect(response.text).toBe('text mode ok');
        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.response_format).toEqual({ type: 'text' });
    });

    it('passes explicit thinking controls through to OpenAI-compatible providers', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('thoughtful'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.reasoning).toEqual({ enabled: true });
        expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    });

    it('sends an explicit per-request max_tokens ceiling sized for think + answer (S-INFER-2 D1)', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('roomy'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true, maxTokens: 1536 });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        // Send both the OpenAI-classic and the newer reasoning-model field so a
        // thinking model has room to emit reasoning AND the final JSON answer.
        expect(body.max_tokens).toBe(1536);
        expect(body.max_completion_tokens).toBe(1536);
    });

    it('falls back to the endpoint maxTokens default when the request omits one (S-INFER-2 D1)', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('roomy'));
        global.fetch = fetchMock;

        const client = new LlmClient({
            default: { baseUrl: 'https://llm.test', model: 'test-model', timeoutMs: 1000, maxTokens: 2048 },
        });
        await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.max_tokens).toBe(2048);
        expect(body.max_completion_tokens).toBe(2048);
    });

    it('omits max_tokens entirely when neither request nor endpoint sets one (S-INFER-2 D1)', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('ok'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await client.complete({ endpoint: 'default', prompt: 'decide' });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body).not.toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('max_completion_tokens');
    });

    it('prefers the per-request max_tokens over the endpoint default (S-INFER-2 D1)', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('ok'));
        global.fetch = fetchMock;

        const client = new LlmClient({
            default: { baseUrl: 'https://llm.test', model: 'test-model', timeoutMs: 1000, maxTokens: 2048 },
        });
        await client.complete({ endpoint: 'default', prompt: 'decide', maxTokens: 1024 });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.max_tokens).toBe(1024);
        expect(body.max_completion_tokens).toBe(1024);
    });

    it('caps an oversized request max_tokens at the endpoint compatibility ceiling', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('bounded'));
        global.fetch = fetchMock;

        const client = new LlmClient({
            default: { baseUrl: 'https://llm.test', model: 'test-model', timeoutMs: 1000, maxTokens: 512 },
        });
        await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true, maxTokens: 4096 });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.max_tokens).toBe(512);
        expect(body.max_completion_tokens).toBe(512);
    });

    it('lets an endpoint force thinking off for model servers that reject thinking-mode prompts', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('bounded'));
        global.fetch = fetchMock;

        const client = new LlmClient({
            default: {
                baseUrl: 'https://llm.test',
                model: 'test-model',
                timeoutMs: 1000,
                forceThinking: false,
                maxTokens: 512,
            },
        });
        await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true, maxTokens: 4096 });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.reasoning).toEqual({ enabled: false });
        expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(body.max_tokens).toBe(512);
        expect(body.max_completion_tokens).toBe(512);
    });

    it('lets an individual request override the endpoint model', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('custom'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await client.complete({ endpoint: 'default', model: 'resident-model', prompt: 'decide' });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.model).toBe('resident-model');
    });

    it('lets an individual request time out quickly without trying a second fallback call', async () => {
        jest.useRealTimers();
        const fetchMock = jest.fn(
            (_url: URL | RequestInfo, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason || new Error('aborted')), { once: true });
                }),
        );
        global.fetch = fetchMock;

        const client = clientFor('default');
        const response = await client.complete({ endpoint: 'default', prompt: 'decide quickly', timeoutMs: 5 });

        expect(response).toMatchObject({ text: JSON.stringify({ actions: [] }), nooped: true, cancelledBy: 'request_timeout' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('admits queued requests by priority when concurrency is exhausted', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstResponse = new Promise<Response>(resolve => {
            releaseFirst = () => resolve(completionResponse('first'));
        });
        const fetchMock = jest
            .fn()
            .mockReturnValueOnce(firstResponse)
            .mockResolvedValueOnce(completionResponse('high'))
            .mockResolvedValueOnce(completionResponse('low'));
        global.fetch = fetchMock;

        const client = new LlmClient(
            {
                default: {
                    baseUrl: 'https://llm.test',
                    model: 'test-model',
                    timeoutMs: 1000,
                },
            },
            1,
        );

        const first = client.complete({ endpoint: 'default', prompt: 'first', priority: 0 });
        const low = client.complete({ endpoint: 'default', prompt: 'low', priority: 1 });
        const high = client.complete({ endpoint: 'default', prompt: 'high', priority: 10 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        releaseFirst?.();

        await expect(first).resolves.toMatchObject({ text: 'first' });
        await expect(high).resolves.toMatchObject({ text: 'high' });
        await expect(low).resolves.toMatchObject({ text: 'low' });
    });

    it('settles aborted queued requests immediately instead of waiting for an inference slot', async () => {
        jest.useRealTimers();
        let releaseFirst: (() => void) | undefined;
        const firstResponse = new Promise<Response>(resolve => {
            releaseFirst = () => resolve(completionResponse('first'));
        });
        const fetchMock = jest.fn().mockReturnValueOnce(firstResponse);
        global.fetch = fetchMock;

        const client = new LlmClient(
            {
                default: {
                    baseUrl: 'https://llm.test',
                    model: 'test-model',
                    timeoutMs: 1000,
                },
            },
            1,
        );

        const first = client.complete({ endpoint: 'default', prompt: 'first' });
        const controller = new AbortController();
        const queued = client.complete({ endpoint: 'default', prompt: 'queued', signal: controller.signal });

        controller.abort('thinking_watchdog_timeout');
        const settledBeforeSlotFreed = await Promise.race([
            queued,
            new Promise<LlmResponse | 'pending'>(resolve => setImmediate(() => resolve('pending'))),
        ]);

        releaseFirst?.();
        await expect(first).resolves.toMatchObject({ text: 'first' });
        await expect(queued).resolves.toMatchObject({
            nooped: true,
            cancelledBy: 'thinking_watchdog_timeout',
        });

        expect(settledBeforeSlotFreed).toEqual(
            expect.objectContaining({
                nooped: true,
                cancelledBy: 'thinking_watchdog_timeout',
            }),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('times out queued requests against their per-request deadline before a slot opens', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstResponse = new Promise<Response>(resolve => {
            releaseFirst = () => resolve(completionResponse('first'));
        });
        const fetchMock = jest.fn().mockReturnValueOnce(firstResponse);
        global.fetch = fetchMock;

        const client = new LlmClient(
            {
                default: {
                    baseUrl: 'https://llm.test',
                    model: 'test-model',
                    timeoutMs: 1000,
                },
            },
            1,
        );

        const first = client.complete({ endpoint: 'default', prompt: 'first', timeoutMs: 1000 });
        const queued = client.complete({ endpoint: 'default', prompt: 'queued', timeoutMs: 5 });

        jest.advanceTimersByTime(6);

        await expect(queued).resolves.toMatchObject({
            text: JSON.stringify({ actions: [] }),
            nooped: true,
            cancelledBy: 'request_timeout',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        releaseFirst?.();
        await expect(first).resolves.toMatchObject({ text: 'first' });
    });
});

function clientFor(endpoint: string): LlmClient {
    return new LlmClient({
        [endpoint]: {
            baseUrl: 'https://llm.test',
            model: 'test-model',
            timeoutMs: 1000,
        },
    });
}

function completionResponse(content: string): Response {
    return new Response(
        JSON.stringify({
            model: 'test-model',
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 3, completion_tokens: 5 },
        }),
        { status: 200 },
    );
}
