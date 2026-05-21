import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { NervousReaction } from '../nervous-system/rules';
import type { Soul } from '../soul/soul-schema';
import type { ThinkingModule } from '../thinking/thinking-module';
import type { Perception } from '../transport/message-codecs';
import { validateSparkModuleConfig, type SparkModuleConfigPolicy, type SparkModuleConfigSchema } from './module-config';
import type { SparkModuleTelemetry } from './module-telemetry';

export type SparkModuleCapability =
    | 'thinking'
    | 'hooks'
    | 'nervous-rules'
    | 'candidates'
    | 'prompt-sections'
    | 'attempt-observer'
    | 'benchmarks';

export interface SparkModuleManifest {
    id: string;
    version: string;
    displayName: string;
    owner?: string;
    description?: string;
    capabilities: SparkModuleCapability[];
    minControllerVersion?: string;
    risk?: 'core' | 'reviewed' | 'experimental';
}

export interface SparkModuleIdentity {
    id: string;
    version: string;
}

export interface SparkNervousReaction extends NervousReaction {
    sparkModule?: SparkModuleIdentity;
}

export interface SoulSparkModuleSelection {
    id: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
}

export interface TrustedSparkModuleContext {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    config: Record<string, unknown>;
    telemetry: SparkModuleTelemetry;
}

export interface SparkNervousSystem {
    react(perception: Perception): SparkNervousReaction | undefined;
}

export interface SparkModule {
    manifest: SparkModuleManifest;
    configSchema?: SparkModuleConfigSchema;
    configPolicy?: SparkModuleConfigPolicy;
    createThinkingModule?(context: TrustedSparkModuleContext): ThinkingModule | undefined;
    createNervousSystem?(context: TrustedSparkModuleContext): SparkNervousSystem | undefined;
    stop?(cause: string): void;
}

export interface ResolvedSparkModule {
    module: SparkModule;
    config: Record<string, unknown>;
}

export function resolveSparkModules(selections: SoulSparkModuleSelection[] | undefined, available: SparkModule[]): ResolvedSparkModule[] {
    if (!selections?.length) {
        validateUniqueRegistry(available);
        return [];
    }

    validateUniqueSelections(selections);
    const byId = moduleRegistry(available);
    return selections
        .filter(selection => selection.enabled !== false)
        .map(selection => {
            const module = byId.get(selection.id);
            if (!module) {
                throw new Error(`Unknown SPARK module ${selection.id}`);
            }
            return {
                module,
                config: validateSparkModuleConfig(selection.config, {
                    schema: module.configSchema,
                    policy: module.configPolicy,
                }),
            };
        });
}

export function sparkModuleIdentity(manifest: SparkModuleManifest): SparkModuleIdentity {
    return { id: manifest.id, version: manifest.version };
}

function moduleRegistry(available: SparkModule[]): Map<string, SparkModule> {
    validateUniqueRegistry(available);
    return new Map(available.map(module => [module.manifest.id, module]));
}

function validateUniqueRegistry(available: SparkModule[]): void {
    const seen = new Set<string>();
    for (const module of available) {
        if (seen.has(module.manifest.id)) {
            throw new Error(`Duplicate SPARK module ${module.manifest.id}`);
        }
        if (module.manifest.risk === 'experimental') {
            throw new Error(`SPARK module ${module.manifest.id} is experimental and cannot be selected by SOUL`);
        }
        validateDeclaredCapabilities(module);
        seen.add(module.manifest.id);
    }
}

function validateDeclaredCapabilities(module: SparkModule): void {
    const requirements: Array<{
        capability: SparkModuleCapability;
        exposedName: string;
        isExposed: (candidate: SparkModule) => boolean;
    }> = [
        { capability: 'thinking', exposedName: 'thinking', isExposed: candidate => Boolean(candidate.createThinkingModule) },
        { capability: 'nervous-rules', exposedName: 'nervous rules', isExposed: candidate => Boolean(candidate.createNervousSystem) },
        { capability: 'hooks', exposedName: 'hooks', isExposed: candidate => hasFunction(candidate, 'hooks') },
        { capability: 'candidates', exposedName: 'candidates', isExposed: candidate => hasFunction(candidate, 'candidates') },
        { capability: 'prompt-sections', exposedName: 'prompt-sections', isExposed: candidate => hasFunction(candidate, 'promptSections') },
        {
            capability: 'attempt-observer',
            exposedName: 'attempt-observer',
            isExposed: candidate => hasFunction(candidate, 'observeAttempt'),
        },
        { capability: 'benchmarks', exposedName: 'benchmarks', isExposed: candidate => hasFunction(candidate, 'benchmarks') },
    ];

    for (const requirement of requirements) {
        if (requirement.isExposed(module) && !module.manifest.capabilities.includes(requirement.capability)) {
            throw new Error(
                `SPARK module ${module.manifest.id} exposes ${requirement.exposedName} without declaring the ${requirement.capability} capability`,
            );
        }
    }
}

function hasFunction(module: SparkModule, key: string): boolean {
    return typeof (module as unknown as Record<string, unknown>)[key] === 'function';
}

function validateUniqueSelections(selections: SoulSparkModuleSelection[]): void {
    const seen = new Set<string>();
    for (const selection of selections) {
        if (seen.has(selection.id)) {
            throw new Error(`Duplicate SPARK module selection ${selection.id}`);
        }
        seen.add(selection.id);
    }
}
