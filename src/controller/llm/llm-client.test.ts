import { LlmClient } from './llm-client';

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

    it('passes explicit thinking controls through to OpenAI-compatible providers', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('thoughtful'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await client.complete({ endpoint: 'default', prompt: 'decide', thinking: true });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.reasoning).toEqual({ enabled: true });
        expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    });

    it('lets an individual request override the endpoint model', async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(completionResponse('custom'));
        global.fetch = fetchMock;

        const client = clientFor('default');
        await client.complete({ endpoint: 'default', model: 'resident-model', prompt: 'decide' });

        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.model).toBe('resident-model');
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
