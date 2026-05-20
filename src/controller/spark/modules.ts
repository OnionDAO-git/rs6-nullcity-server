import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { ThinkingModule } from '../thinking/thinking-module';

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
}

export interface SparkModule {
    manifest: SparkModuleManifest;
    createThinkingModule?(context: TrustedSparkModuleContext): ThinkingModule | undefined;
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
            return { module, config: selection.config || {} };
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
        if (module.createThinkingModule && !module.manifest.capabilities.includes('thinking')) {
            throw new Error(`SPARK module ${module.manifest.id} exposes thinking without declaring the thinking capability`);
        }
        seen.add(module.manifest.id);
    }
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
