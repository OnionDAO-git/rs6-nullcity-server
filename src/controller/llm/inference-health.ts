import type { LlmEndpointConfig } from '../config';
import type { LlmResponse } from './llm-client';

export type InferenceHealthStatus =
    | 'ok'
    | 'not_configured'
    | 'nooped_completion'
    | 'empty_completion'
    | 'unexpected_completion'
    | 'cancelled'
    | 'error';

export interface InferenceHealthResult {
    ok: boolean;
    status: InferenceHealthStatus;
    endpoint: string;
    model?: string;
    latencyMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    error?: string;
    textPreview?: string;
}

export interface InferenceHealthProbeOptions {
    endpoints: Record<string, LlmEndpointConfig>;
    endpoint?: string;
    timeoutMs?: number;
    now?: () => number;
    complete?: (request: InferenceHealthCompletionRequest) => Promise<LlmResponse>;
}

export interface InferenceHealthCompletionRequest {
    endpoint: string;
    config: LlmEndpointConfig;
    model: string;
    prompt: string;
    temperature: number;
    thinking: boolean;
    signal: AbortSignal;
}

const HEALTH_PROBE_PROMPT = [
    'You are the Null City controller inference health probe.',
    'Return only compact JSON exactly like {"health":"ok","probe":"nullcity-inference-health"}.',
    'No markdown, no explanation, no extra keys.',
].join('\n');

export async function runInferenceHealthProbe(options: InferenceHealthProbeOptions): Promise<InferenceHealthResult> {
    const requestedEndpoint = options.endpoint || 'default';
    const endpoint = options.endpoints[requestedEndpoint] ? requestedEndpoint : 'default';
    const config = options.endpoints[endpoint];
    const model = config?.model;

    if (!config?.baseUrl || !model) {
        return { ok: false, status: 'not_configured', endpoint, model };
    }

    const now = options.now || Date.now;
    const startedAt = now();
    const signal = AbortSignal.timeout(options.timeoutMs ?? config.timeoutMs ?? 30000);

    try {
        const complete = options.complete || postHealthCompletion;
        const response = await complete({
            endpoint,
            config,
            model,
            prompt: HEALTH_PROBE_PROMPT,
            temperature: 0,
            thinking: false,
            signal,
        });
        const latencyMs = Math.max(0, now() - startedAt);

        if (response.cancelledBy) {
            return {
                ok: false,
                status: 'cancelled',
                endpoint,
                model: response.model || model,
                latencyMs,
                error: response.cancelledBy,
            };
        }

        const usableText = stripThinkBlocks(response.text).trim();
        if (response.nooped) {
            return {
                ok: false,
                status: 'nooped_completion',
                endpoint,
                model: response.model || model,
                latencyMs,
                promptTokens: response.promptTokens,
                completionTokens: response.completionTokens,
                textPreview: preview(usableText),
            };
        }
        if (!usableText) {
            return {
                ok: false,
                status: 'empty_completion',
                endpoint,
                model: response.model || model,
                latencyMs,
                promptTokens: response.promptTokens,
                completionTokens: response.completionTokens,
            };
        }

        if (!isExpectedHealthResponse(usableText)) {
            return {
                ok: false,
                status: 'unexpected_completion',
                endpoint,
                model: response.model || model,
                latencyMs,
                promptTokens: response.promptTokens,
                completionTokens: response.completionTokens,
                textPreview: preview(usableText),
            };
        }

        return {
            ok: true,
            status: 'ok',
            endpoint,
            model: response.model || model,
            latencyMs,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
        };
    } catch (error) {
        return {
            ok: false,
            status: 'error',
            endpoint,
            model,
            latencyMs: Math.max(0, now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function stripThinkBlocks(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

function isExpectedHealthResponse(text: string): boolean {
    const jsonText = extractJsonObject(text);
    if (!jsonText || jsonText !== text.trim()) {
        return false;
    }
    try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return false;
        }
        const record = parsed as Record<string, unknown>;
        return Object.keys(record).length === 2 && record.health === 'ok' && record.probe === 'nullcity-inference-health';
    } catch {
        return false;
    }
}

function extractJsonObject(text: string): string | undefined {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return undefined;
    }
    return text.slice(start, end + 1);
}

function preview(text: string): string {
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

async function postHealthCompletion(request: InferenceHealthCompletionRequest): Promise<LlmResponse> {
    const response = await fetch(`${request.config.baseUrl?.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(request.config.apiKey ? { authorization: `Bearer ${request.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: request.model,
            messages: [{ role: 'user', content: request.prompt }],
            temperature: request.temperature,
            reasoning: { enabled: request.thinking },
            chat_template_kwargs: { enable_thinking: request.thinking },
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'controller_health_probe',
                    strict: false,
                    schema: { type: 'object' },
                },
            },
        }),
        signal: request.signal,
    });
    if (!response.ok) {
        throw new Error(`LLM health probe failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as unknown;
    const payload = isRecord(json) ? json : {};
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : {};
    const message = isRecord(first.message) ? first.message : {};
    const usage = isRecord(payload.usage) ? payload.usage : {};
    const content = typeof message.content === 'string' && message.content.trim().length > 0 ? message.content : message.reasoning_content;

    return {
        text: typeof content === 'string' ? content : '',
        model: typeof payload.model === 'string' ? payload.model : undefined,
        nooped: false,
        promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
        completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
