import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { LibraryUpdater } from '../evidence';
import type { PlanStore } from '../intelligence/plan-store';
import { NervousSystem } from '../nervous-system';
import type { Soul } from '../soul/soul-schema';
import { createThinkingModuleSelection, type ThinkingModule } from '../thinking';
import type { AttentionDecayScheduleConfig, AttentionEconomyConfig } from './attention';
import { createSparkModuleTelemetry, type SparkModuleTelemetry, type SparkModuleTelemetryLogEntry } from './module-telemetry';
import { PatronRegistry } from '../patron/patron-registry';
import {
    resolveSparkModules,
    sparkModuleIdentity,
    type ResolvedSparkModule,
    type SparkModule,
    type SparkModuleIdentity,
    type SparkNervousSystem,
} from './modules';

export interface SparkRuntimeFacetOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    planStore?: PlanStore;
    libraryUpdater?: LibraryUpdater;
    sparkModules?: SparkModule[];
    moduleTelemetry?: (entry: SparkModuleTelemetryLogEntry) => void;
    patronRegistry?: PatronRegistry;
    /** Forwarded to {@link NervousSystem} options (LB-H2R-4p77). */
    dispatchAttentionPlea?: () => void;
    /** Survivable-weekend decay schedule, forwarded to the Spark thinking module. */
    attentionDecaySchedule?: AttentionDecayScheduleConfig;
    /**
     * Attention-economy knobs (capacity + plea-threshold fraction), forwarded
     * to the {@link NervousSystem} so the no-floor attention plea fires
     * capacity-aware (real-mortality lead time).
     */
    economy?: AttentionEconomyConfig;
    /** Injectable wall clock (epoch ms), forwarded to the Spark thinking module. */
    now?: () => number;
}

export interface SparkRuntimeFacets {
    thinking: ThinkingModule;
    thinkingSparkModule?: SparkModuleIdentity;
    thinkingSourceModule?: SparkModule;
    nervousSystem: SparkNervousSystem;
    nervousSparkModule?: SparkModuleIdentity;
    nervousSourceModule?: SparkModule;
}

export function createSparkRuntimeFacets(options: SparkRuntimeFacetOptions): SparkRuntimeFacets {
    const selectedModules = resolveSparkModules(options.soul.frontmatter.modules, options.sparkModules || []);
    const moduleTelemetry = createModuleTelemetryFactory(options);
    const thinkingSelection = createThinkingModuleSelection({ ...options, resolvedSparkModules: selectedModules, moduleTelemetry });
    const nervousSelection = createNervousSelection(options, selectedModules);
    return {
        thinking: thinkingSelection.thinking,
        thinkingSparkModule: thinkingSelection.sparkModule,
        thinkingSourceModule: thinkingSelection.sourceModule,
        nervousSystem: nervousSelection.nervousSystem,
        nervousSparkModule: nervousSelection.sparkModule,
        nervousSourceModule: nervousSelection.sourceModule,
    };
}

function createNervousSelection(
    options: SparkRuntimeFacetOptions,
    selectedModules: ResolvedSparkModule[],
): {
    nervousSystem: SparkNervousSystem;
    sparkModule?: SparkModuleIdentity;
    sourceModule?: SparkModule;
} {
    const coreNervousSystem = new NervousSystem({
        soul: options.soul,
        state: options.state,
        memory: options.memory,
        patronRegistry: options.patronRegistry,
        dispatchAttentionPlea: options.dispatchAttentionPlea,
        economy: options.economy,
    });
    for (const selected of selectedModules) {
        const nervousSystem = selected.module.createNervousSystem?.({
            soul: options.soul,
            state: options.state,
            memory: options.memory,
            llm: options.llm,
            config: selected.config,
            telemetry: createModuleTelemetryFactory(options)(sparkModuleIdentity(selected.module.manifest)),
            economy: options.economy,
        });
        if (nervousSystem) {
            const identity = sparkModuleIdentity(selected.module.manifest);
            return {
                nervousSystem: new KernelFirstSparkNervousSystem(coreNervousSystem, nervousSystem, identity),
                sparkModule: identity,
                sourceModule: selected.module,
            };
        }
    }

    return { nervousSystem: coreNervousSystem };
}

function createModuleTelemetryFactory(options: SparkRuntimeFacetOptions): (module: SparkModuleIdentity) => SparkModuleTelemetry {
    return module =>
        createSparkModuleTelemetry({
            resident: options.soul.frontmatter.name,
            module,
            append: options.moduleTelemetry,
        });
}

class KernelFirstSparkNervousSystem implements SparkNervousSystem {
    constructor(
        private readonly core: SparkNervousSystem,
        private readonly moduleSystem: SparkNervousSystem,
        private readonly moduleIdentity: SparkModuleIdentity,
    ) {}

    react(perception: Parameters<SparkNervousSystem['react']>[0]): ReturnType<SparkNervousSystem['react']> {
        const coreReaction = this.core.react(perception);
        if (coreReaction) {
            return coreReaction;
        }

        const moduleReaction = this.moduleSystem.react(perception);
        if (!moduleReaction) {
            return undefined;
        }

        return { ...moduleReaction, sparkModule: this.moduleIdentity };
    }
}
