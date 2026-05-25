import type { LlmEndpointConfig } from '../config';
import type { LlmClient } from './llm-client';

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
    llm: Pick<LlmClient, 'complete'>;
    endpoints: Record<string, LlmEndpointConfig>;
    endpoint?: string;
    timeoutMs?: number;
    now?: () => number;
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
        const response = await options.llm.complete({
            endpoint,
            model,
            prompt: HEALTH_PROBE_PROMPT,
            temperature: 0,
            thinking: false,
            priority: 100,
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
    if (!jsonText) {
        return false;
    }
    try {
        const parsed = JSON.parse(jsonText) as unknown;
        return (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            (parsed as Record<string, unknown>).health === 'ok' &&
            (parsed as Record<string, unknown>).probe === 'nullcity-inference-health'
        );
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
