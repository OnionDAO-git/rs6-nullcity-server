import { admitInference, defaultInferenceBudget, type InferenceBudget } from '../llm/budgets';
import type { LlmClient, LlmResponse } from '../llm/llm-client';
import type { RuntimeState } from '../memory/runtime-state';
import type { SparkModuleTelemetry } from './module-telemetry';

export interface SparkModuleInferenceProfile {
    endpoint: string;
    temperature?: number;
    thinking?: boolean;
    priority?: number;
}

export interface SparkModuleInferenceRequest {
    prompt: string;
    temperature?: number;
    signal?: AbortSignal;
}

export interface SparkModuleInference {
    complete(profile: string, request: SparkModuleInferenceRequest): Promise<LlmResponse>;
    budget(): SparkModuleInferenceBudgetSnapshot;
}

export interface SparkModuleInferenceBudgetSnapshot {
    requestsThisTick: number;
    requestsThisMinute: number;
    requestsToday: number;
    noInferenceUntil?: string;
}

export interface SparkModuleInferenceOptions {
    state: RuntimeState;
    llm: LlmClient;
    telemetry: SparkModuleTelemetry;
    profiles: Record<string, SparkModuleInferenceProfile>;
    budget?: InferenceBudget;
}

export function createSparkModuleInference(options: SparkModuleInferenceOptions): SparkModuleInference {
    const budget = options.budget || defaultInferenceBudget();
    return {
        async complete(profileId, request) {
            const profile = options.profiles[profileId];
            if (!profile) {
                throw new Error(`Unknown SPARK inference profile ${profileId}`);
            }

            const decision = admitInference(options.state, budget);
            if (!decision.ok) {
                const cancelledBy = `budget_exhausted:${decision.window}`;
                options.telemetry.emit({
                    kind: 'warning',
                    message: `SPARK module inference budget exhausted for profile ${profileId}`,
                    data: {
                        profile: profileId,
                        window: decision.window,
                        retryAt: decision.retryAt?.toISOString(),
                    },
                });
                return { text: '{"actions":[]}', nooped: true, cancelledBy };
            }

            const response = await options.llm.complete({
                endpoint: profile.endpoint,
                prompt: request.prompt,
                thinking: profile.thinking,
                temperature: request.temperature ?? profile.temperature,
                priority: profile.priority,
                signal: request.signal,
            });

            options.telemetry.emit({
                kind: 'metric',
                message: `SPARK module inference completed for profile ${profileId}`,
                data: {
                    profile: profileId,
                    endpoint: profile.endpoint,
                    thinking: profile.thinking ?? false,
                    nooped: response.nooped,
                    promptTokens: response.promptTokens,
                    completionTokens: response.completionTokens,
                },
            });
            return response;
        },
        budget() {
            return {
                requestsThisTick: options.state.budgets.requestsThisTick || 0,
                requestsThisMinute: options.state.budgets.requestsThisMinute,
                requestsToday: options.state.budgets.requestsToday,
                noInferenceUntil: options.state.budgets.noInferenceUntil,
            };
        },
    };
}
