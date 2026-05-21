import type { RuntimeState } from '../memory/runtime-state';
import type { Soul, SoulArchetype } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import type { SparkModuleInference } from './module-inference';
import type { SparkModuleMemory } from './module-memory';
import type { SparkModuleTelemetry } from './module-telemetry';
import type { SparkModuleIdentity } from './modules';

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? ReadonlyArray<DeepReadonly<Item>>
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

export interface SparkModuleStateFacade {
    snapshot(): DeepReadonly<RuntimeState>;
}

export interface SparkModulePerceptionFacade {
    snapshot(): DeepReadonly<Perception>;
}

export interface SoulPublicView {
    name: string;
    display?: string;
    archetype: SoulArchetype;
    voice?: DeepReadonly<{ register?: string; quirks?: string[] }>;
    fears?: readonly string[];
    loves?: readonly string[];
    body: string;
}

export interface SafeSparkModuleContext {
    module: DeepReadonly<SparkModuleIdentity>;
    config: DeepReadonly<Record<string, unknown>>;
    soul?: DeepReadonly<SoulPublicView>;
    state: SparkModuleStateFacade;
    perception?: SparkModulePerceptionFacade;
    memory?: SparkModuleMemory;
    inference?: SparkModuleInference;
    telemetry: SparkModuleTelemetry;
}

export interface SafeSparkModuleContextOptions {
    module: SparkModuleIdentity;
    config?: Record<string, unknown>;
    soul?: Soul;
    state: RuntimeState;
    perception?: Perception;
    memory?: SparkModuleMemory;
    inference?: SparkModuleInference;
    telemetry: SparkModuleTelemetry;
}

export function createSparkModuleStateFacade(state: RuntimeState): SparkModuleStateFacade {
    return {
        snapshot: () => immutableSnapshot(state),
    };
}

export function createSparkModulePerceptionFacade(perception: Perception): SparkModulePerceptionFacade {
    return {
        snapshot: () => immutableSnapshot(perception),
    };
}

export function createSafeSparkModuleContext(options: SafeSparkModuleContextOptions): SafeSparkModuleContext {
    return {
        module: immutableSnapshot(options.module),
        config: immutableSnapshot(options.config || {}),
        soul: options.soul ? createSoulPublicView(options.soul) : undefined,
        state: createSparkModuleStateFacade(options.state),
        perception: options.perception ? createSparkModulePerceptionFacade(options.perception) : undefined,
        memory: options.memory,
        inference: options.inference,
        telemetry: options.telemetry,
    };
}

export function createSoulPublicView(soul: Soul): DeepReadonly<SoulPublicView> {
    return immutableSnapshot({
        name: soul.frontmatter.name,
        display: soul.frontmatter.display,
        archetype: soul.frontmatter.archetype,
        voice: soul.frontmatter.voice,
        fears: soul.frontmatter.fears,
        loves: soul.frontmatter.loves,
        body: soul.body,
    });
}

function immutableSnapshot<T>(value: T): DeepReadonly<T> {
    return deepFreeze(cloneValue(value)) as DeepReadonly<T>;
}

function cloneValue<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return cloneJsonLike(value) as T;
}

function cloneJsonLike(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(cloneJsonLike);
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonLike(child)]));
    }
    return value;
}

function deepFreeze<T>(value: T): T {
    if (isRecord(value) || Array.isArray(value)) {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
