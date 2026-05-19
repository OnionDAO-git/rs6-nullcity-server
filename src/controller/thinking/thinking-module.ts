import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { Spark, type SparkTickResult } from '../spark/spark';

export type ThoughtResult = SparkTickResult;

export interface ThinkingModule {
    think(perception: Perception): Promise<ThoughtResult>;
    considerInterrupt(perception: Perception): boolean;
    stop(cause: string): void;
}

export interface SparkThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
}

export class SparkThinkingModule implements ThinkingModule {
    private readonly spark: Spark;

    constructor(options: SparkThinkingModuleOptions) {
        this.spark = new Spark(options.soul, options.state, options.memory, options.llm);
    }

    think(perception: Perception): Promise<ThoughtResult> {
        return this.spark.tick(perception);
    }

    considerInterrupt(perception: Perception): boolean {
        return this.spark.considerInterrupt(perception);
    }

    stop(cause: string): void {
        this.spark.abortInflight(cause);
    }
}
