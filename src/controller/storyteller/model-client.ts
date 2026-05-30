import { LlmClient } from '../llm/llm-client';
import type { LlmEndpointConfig } from '../config';
import type { CityEventDigest, DigestEvent, StorytellerDispatch, StorytellerConfig } from './types';
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

function sanitizePublicText(text: string): string {
    return text
        .replace(/(?:^|\s)@[A-Za-z]\w{1,30}\b/g, ' [redacted]')
        .replace(/\b\d{17,19}\b/g, '[redacted]')
        .replace(/\bpatron:[A-Za-z0-9:_-]+\b/g, 'a patron')
        .replace(/\bhuman:[A-Za-z0-9:_@.-]+\b/g, 'a human')
        .replace(/\s+/g, ' ')
        .trim();
}

function capWords(text: string, maxWords: number): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return text.trim();
    return `${words.slice(0, maxWords).join(' ')}...`;
}

function headlineForDigest(digest: CityEventDigest, events: DigestEvent[]): string {
    if (events.some(event => event.kind === 'ap_for_gp_exchange')) return 'Null City Dispatch: AP and GP changed hands';
    if (events.some(event => event.kind === 'ncri_created' || event.kind === 'ncri_redeemed'))
        return 'Null City Dispatch: NCRI activity recorded';
    if (events.some(event => event.kind === 'gp_earned' || event.kind === 'gp_observed')) return 'Null City Dispatch: GP movement recorded';
    if (events.some(event => event.kind === 'goal_completed')) return 'Null City Dispatch: a goal moved into the Library';
    if (digest.systemHealth.lowApResidents > 0) return 'Null City Dispatch: attention pressure is rising';
    return 'Null City Dispatch: quiet window recorded';
}

function isZeroGpObservation(event: DigestEvent): boolean {
    if (event.kind !== 'gp_observed') return false;
    const amount = event.evidence?.['amount'];
    if (amount === 0) return true;
    return /\bobserved\s+0\s+GP\b/i.test(event.note);
}

function uniqueEvents(events: DigestEvent[]): DigestEvent[] {
    const seen = new Set<string>();
    const unique: DigestEvent[] = [];
    for (const event of events) {
        if (seen.has(event.ref)) continue;
        seen.add(event.ref);
        unique.push(event);
    }
    return unique;
}

function fallbackEvents(digest: CityEventDigest, limit: number): DigestEvent[] {
    const meaningful = uniqueEvents([
        ...digest.exchangeEvents,
        ...digest.ncriEvents,
        ...digest.gpEvents.filter(event => !isZeroGpObservation(event)),
        ...digest.apEvents,
        ...digest.goalEvents,
        ...digest.stuckEvents,
        ...digest.miscEvents,
    ]);
    const source = meaningful.length > 0 ? meaningful : digest.topEvents;
    return source.slice(0, limit);
}

function buildNoModelFallback(
    digest: CityEventDigest,
    config: StorytellerConfig,
): Pick<StorytellerDispatch, 'publicTitle' | 'publicBody' | 'publicBullets' | 'operatorSummary' | 'operatorWarnings' | 'eventRefsUsed'> {
    const events = fallbackEvents(digest, Math.max(1, Math.min(5, config.maxResidentMentions)));
    const health = digest.systemHealth;
    const fadedClause = health.fadedResidents > 0 ? `, ${health.fadedResidents} faded` : '';
    const healthLine = `${health.activeResidents}/${health.totalResidents} residents active, ${health.lowApResidents} low on attention${fadedClause}.`;
    const eventSentences = events.slice(0, 3).map(event => `${event.residentName}: ${event.note}`);
    const publicBody =
        eventSentences.length > 0
            ? `${healthLine} ${eventSentences.join(' ')}`
            : `${healthLine} No major public event refs were selected for this window.`;

    return {
        publicTitle: sanitizePublicText(headlineForDigest(digest, events)),
        publicBody: capWords(sanitizePublicText(publicBody), config.maxPublicBodyWords),
        publicBullets: events.map(event => sanitizePublicText(event.note)).filter(Boolean),
        operatorSummary: `Fallback dispatch from ${events.length} digest event(s); no model endpoint was configured.`,
        operatorWarnings: [
            'No Storyteller model endpoint configured; public copy is deterministic digest fallback and needs operator review.',
        ],
        eventRefsUsed: events.map(event => event.ref),
    };
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
            parsed = buildNoModelFallback(digest, config);
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
