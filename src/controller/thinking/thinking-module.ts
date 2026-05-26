import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import type { GameSkillContext } from '../knowledge/game-skill-context';
import { PatronRegistry } from '../patron/patron-registry';
import {
    resolveSparkModules,
    sparkModuleIdentity,
    type ResolvedSparkModule,
    type SparkModule,
    type SparkModuleIdentity,
} from '../spark/modules';
import { noopSparkModuleTelemetry, type SparkModuleTelemetry } from '../spark/module-telemetry';
import { Spark, type SparkTickResult } from '../spark/spark';
import { BasicAgentThinkingModule } from './basic-agent-thinking-module';
import { HybridAgentThinkingModule } from './hybrid-agent-thinking-module';

export type ThoughtResult = SparkTickResult;

export interface ThinkingModule {
    think(perception: Perception, gameSkill?: GameSkillContext): Promise<ThoughtResult>;
    considerInterrupt(perception: Perception): boolean;
    stop(cause: string): void;
    onWatchdogTimeout?(perception: Perception, gameSkill?: GameSkillContext): ThoughtResult | undefined;
}

export interface SparkThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    sparkModules?: SparkModule[];
    resolvedSparkModules?: ResolvedSparkModule[];
    moduleTelemetry?: (module: SparkModuleIdentity) => SparkModuleTelemetry;
    patronRegistry?: PatronRegistry;
}

export interface ThinkingModuleSelection {
    thinking: ThinkingModule;
    sparkModule?: SparkModuleIdentity;
    sourceModule?: SparkModule;
}

export function createThinkingModule(options: SparkThinkingModuleOptions): ThinkingModule {
    return createThinkingModuleSelection(options).thinking;
}

export function createThinkingModuleSelection(options: SparkThinkingModuleOptions): ThinkingModuleSelection {
    const hasExplicitModuleStack = options.soul.frontmatter.modules !== undefined;
    const selectedModules =
        options.resolvedSparkModules ?? resolveSparkModules(options.soul.frontmatter.modules, options.sparkModules || []);
    for (const selected of selectedModules) {
        const moduleIdentity = sparkModuleIdentity(selected.module.manifest);
        const thinking = selected.module.createThinkingModule?.({
            soul: options.soul,
            state: options.state,
            memory: options.memory,
            llm: options.llm,
            config: selected.config,
            telemetry: options.moduleTelemetry?.(moduleIdentity) || noopSparkModuleTelemetry,
        });
        if (thinking) {
            return {
                thinking,
                sparkModule: moduleIdentity,
                sourceModule: selected.module,
            };
        }
    }

    if (hasExplicitModuleStack) {
        throw new Error('Selected SPARK module stack does not provide a thinking module');
    }

    if (options.soul.frontmatter.behavior?.kind === 'basic-agent') {
        return { thinking: new BasicAgentThinkingModule({ soul: options.soul, state: options.state }) };
    }
    if (options.soul.frontmatter.behavior?.kind === 'hybrid-agent') {
        return { thinking: new HybridAgentThinkingModule(options) };
    }

    return { thinking: new SparkThinkingModule(options) };
}

export class SparkThinkingModule implements ThinkingModule {
    private readonly spark: Spark;

    constructor(options: SparkThinkingModuleOptions) {
        this.spark = new Spark(options.soul, options.state, options.memory, options.llm);
    }

    think(perception: Perception, _gameSkill?: GameSkillContext): Promise<ThoughtResult> {
        return this.spark.tick(perception);
    }

    considerInterrupt(perception: Perception): boolean {
        return this.spark.considerInterrupt(perception);
    }

    stop(cause: string): void {
        this.spark.abortInflight(cause);
    }

    onWatchdogTimeout(perception: Perception): ThoughtResult | undefined {
        return this.spark.watchdogFallback(perception);
    }
}
