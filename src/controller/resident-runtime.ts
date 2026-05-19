import type { LlmClient } from './llm/llm-client';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { MemoryRouter } from './memory/memory-router';
import type { MemoryStore } from './memory/memory-store';
import { type RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import { PerceptionCompressor } from './perception/perception-compressor';
import { PerceptionHistory } from './perception/perception-history';
import type { Soul } from './soul/soul-schema';
import { initialAttention } from './spark/attention';
import { Spark } from './spark/spark';
import type { GatewayClient } from './transport/gateway-client';
import type { Perception, PerceptionEvent } from './transport/message-codecs';

export interface ResidentRuntimeOptions {
    soul: Soul;
    gateway: GatewayClient;
    memory: MemoryStore;
    stateStore: RuntimeStateStore;
    llm: LlmClient;
    actionLog: ActionLog;
    inferenceLog: InferenceLog;
}

export class ResidentRuntime {
    readonly name: string;
    private readonly state: RuntimeState;
    private readonly spark: Spark;
    private readonly history = new PerceptionHistory();
    private readonly memoryRouter = new MemoryRouter();
    private readonly compressor = new PerceptionCompressor();
    private deciding = false;

    constructor(private readonly options: ResidentRuntimeOptions) {
        this.name = options.soul.frontmatter.name;
        this.state = options.stateStore.load(
            this.name,
            initialAttention(options.soul.frontmatter.attentionProfile),
            options.soul.frontmatter.legacy?.kind || options.soul.frontmatter.archetype,
        );
        this.spark = new Spark(options.soul, this.state, options.memory, options.llm);
    }

    async onPerception(perception: Perception): Promise<void> {
        this.history.push(perception);
        const compressed = this.compressor.compress(perception);
        if (this.deciding) {
            if (this.spark.considerInterrupt(perception)) {
                this.options.inferenceLog.append(this.name, {
                    tick: this.state.tick,
                    cause: 'urgent_interrupt',
                    perception_tokens: compressed.text.length,
                });
            }
            return;
        }

        this.deciding = true;
        try {
            const result = await this.spark.tick({ ...perception, compressed: compressed.text });
            for (const event of result.syntheticEvents || []) {
                this.history.push(event);
            }
            this.options.inferenceLog.append(this.name, {
                tick: this.state.tick,
                envelope_tokens: result.envelopeTokens || 0,
                actions_emitted: result.actions.length,
                synthetic_events: result.syntheticEvents?.length || 0,
                parse_ok: true,
                cause: result.cause,
                nooped: result.nooped,
            });

            for (const action of result.actions) {
                const actionResult = await this.options.gateway.submitAction(this.name, action);
                this.options.actionLog.append(this.name, {
                    tick: this.state.tick,
                    action,
                    result: actionResult,
                    attention_after: this.state.attention,
                });
            }
        } finally {
            this.options.stateStore.save(this.state);
            this.deciding = false;
        }
    }

    onEvent(event: PerceptionEvent): void {
        this.history.push(event);
        const routed = this.memoryRouter.routeEvent(this.name, event);
        if (routed) {
            this.options.memory.write(this.name, routed.path, routed.content);
        }
    }

    stop(cause = 'runtime_stopped'): void {
        this.spark.abortInflight(cause);
        this.options.stateStore.save(this.state);
    }
}
