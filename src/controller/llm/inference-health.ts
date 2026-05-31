import type { LlmEndpointConfig } from '../config';
import type { LlmResponse } from './llm-client';
import { stripThinkBlocks, salvageJsonCandidates } from './json-salvage';

export type InferenceHealthStatus =
    | 'ok'
    | 'not_configured'
    | 'nooped_completion'
    | 'empty_completion'
    | 'unexpected_completion'
    | 'cancelled'
    | 'health_timeout'
    | 'error';

export interface InferenceHealthResult {
    ok: boolean;
    status: InferenceHealthStatus;
    endpoint: string;
    model?: string;
    latencyMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
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
                costUsd: response.costUsd,
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
                costUsd: response.costUsd,
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
                costUsd: response.costUsd,
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
            costUsd: response.costUsd,
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

/**
 * S-INFER-2 (D4): the `<think>`-strip and JSON-object extraction now delegate to
 * the shared `json-salvage` util so there is ONE robust path across the brain
 * parser, the SPARK completion parser, and this probe. The health probe keeps
 * its OWN strict contract on top of that shared extraction:
 *   - after stripping think blocks, the recovered object must be the WHOLE
 *     trimmed text (no surrounding prose — a health probe must answer compactly);
 *   - the object must be EXACTLY the two probe keys with the expected values.
 * The balanced-brace scan replaces the old greedy first-{-to-last-} slice, but
 * the equality + schema gates preserve the historical reject behaviour.
 */
function isExpectedHealthResponse(text: string): boolean {
    const candidates = salvageJsonCandidates(text);
    if (candidates.length === 0) {
        return false;
    }
    const jsonText = candidates[candidates.length - 1];
    // Strict probe contract: the object must be the entire compact answer, with
    // no prose wrapped around it (the shared scan would otherwise recover an
    // object embedded in prose, which the probe must reject as unexpected).
    if (jsonText !== stripThinkBlocks(text).trim()) {
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
            response_format: responseFormatBody(request.config.responseFormat),
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
    const content = firstNonEmptyString(message.content, message.reasoning_content, message.reasoning);

    return {
        text: typeof content === 'string' ? content : '',
        model: typeof payload.model === 'string' ? payload.model : undefined,
        nooped: false,
        promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
        completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
        costUsd: readCostUsd(usage),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
    }
    return undefined;
}

function responseFormatBody(format: LlmEndpointConfig['responseFormat'] = 'json_schema'): unknown {
    if (format === 'text') {
        return { type: 'text' };
    }
    return {
        type: 'json_schema',
        json_schema: {
            name: 'controller_health_probe',
            strict: false,
            schema: { type: 'object' },
        },
    };
}

function readCostUsd(usage: Record<string, unknown>): number | undefined {
    if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
        return usage.cost;
    }
    const costDetails = isRecord(usage.cost_details) ? usage.cost_details : {};
    return typeof costDetails.upstream_inference_cost === 'number' && Number.isFinite(costDetails.upstream_inference_cost)
        ? costDetails.upstream_inference_cost
        : undefined;
}
