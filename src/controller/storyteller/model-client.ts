import { LlmClient } from '../llm/llm-client';
import type { LlmEndpointConfig } from '../config';
import type { CityEventDigest, StorytellerDispatch, StorytellerConfig } from './types';
import { DEFAULT_STORYTELLER_CONFIG } from './types';
import { buildStorytellerPrompt } from './prompt-builder';
import { verifyDispatch, applyVerifierResult } from './verifier';

// ---------------------------------------------------------------------------
// StorytellerModelClient — S7b
//
// Calls an LLM (via LlmClient + named model profile) to generate a
// StorytellerDispatch from a CityEventDigest. Applies the verifier before
// returning. Records latency, token counts, and estimated cost.
//
// IMPORTANT: Do not call this client from unattended cron loops unless a
// named model profile, cost cap, and artifact path exist.
// ---------------------------------------------------------------------------

export interface ModelRunOptions {
    /** Which endpoint key to use from the endpoints map. Defaults to config.modelProfile. */
    modelProfile?: string;
    signal?: AbortSignal;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeString(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

function safeStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((item): item is string => typeof item === 'string');
}

function estimateCost(
    inputTokens: number | null,
    outputTokens: number | null,
    reportedCostUsd: number | undefined,
    endpoint: LlmEndpointConfig | undefined,
): number | null {
    if (reportedCostUsd !== undefined && Number.isFinite(reportedCostUsd)) return reportedCostUsd;
    if (inputTokens === null || outputTokens === null || !endpoint?.cost) return null;
    const promptCost = inputTokens * (endpoint.cost.promptTokenUsd ?? 0);
    const completionCost = outputTokens * (endpoint.cost.completionTokenUsd ?? 0);
    return promptCost + completionCost;
}

export class StorytellerModelClient {
    constructor(private readonly endpoints: Record<string, LlmEndpointConfig>) {}

    async run(
        digest: CityEventDigest,
        config: StorytellerConfig = DEFAULT_STORYTELLER_CONFIG,
        options?: ModelRunOptions,
    ): Promise<StorytellerDispatch> {
        const profileId = options?.modelProfile ?? config.modelProfile ?? 'default';
        const llmClient = new LlmClient(this.endpoints);
        const prompt = buildStorytellerPrompt(digest, config);

        const startMs = Date.now();
        const llmResponse = await llmClient.complete({
            endpoint: profileId,
            prompt,
            signal: options?.signal,
            timeoutMs: 60_000,
        });
        const latencyMs = Date.now() - startMs;

        const generatedAt = new Date().toISOString();
        const dispatchId = `dispatch-${digest.digestId}-${Date.now()}`;

        const inputTokens = llmResponse.promptTokens ?? null;
        const outputTokens = llmResponse.completionTokens ?? null;
        const endpoint = this.endpoints[profileId] ?? this.endpoints['default'];
        const estimatedCostUsd = estimateCost(inputTokens, outputTokens, llmResponse.costUsd, endpoint);

        let parsed: Record<string, unknown> = {};
        const reviewReasons: string[] = [];

        if (llmResponse.nooped) {
            reviewReasons.push(`model call was nooped (${llmResponse.cancelledBy ?? 'unknown'})`);
        } else {
            try {
                const raw = JSON.parse(llmResponse.text);
                if (isRecord(raw)) {
                    parsed = raw;
                } else {
                    reviewReasons.push(`model returned non-JSON object: ${llmResponse.text.slice(0, 100)}`);
                }
            } catch {
                reviewReasons.push(`model returned non-JSON: ${llmResponse.text.slice(0, 100)}`);
            }
        }

        const publicTitle = safeString(parsed['publicTitle']) || '(no title generated)';
        const publicBody = safeString(parsed['publicBody']) || '(no body generated)';
        const publicBullets = safeStringArray(parsed['publicBullets']);
        const operatorSummary = safeString(parsed['operatorSummary']) || '(no summary)';
        const operatorWarnings = safeStringArray(parsed['operatorWarnings']);
        const eventRefsUsed = safeStringArray(parsed['eventRefsUsed']);

        let dispatch: StorytellerDispatch = {
            schemaVersion: 1,
            dispatchId,
            digestId: digest.digestId,
            generatedAt,
            modelProfile: profileId,
            latencyMs,
            estimatedCostUsd,
            inputTokens,
            outputTokens,
            publicTitle,
            publicBody,
            publicBullets,
            operatorSummary,
            operatorWarnings,
            eventRefsUsed,
            needsReview: reviewReasons.length > 0,
            reviewReasons: reviewReasons.length > 0 ? reviewReasons : undefined,
        };

        const verifierResult = verifyDispatch(dispatch, digest);
        dispatch = applyVerifierResult(dispatch, verifierResult);

        return dispatch;
    }
}
