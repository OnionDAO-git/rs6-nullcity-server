import type { LlmClient } from './llm/llm-client';
import { type ResidentBody, createGatewayBody } from './body';
import { ActionLog } from './logging/action-log';
import { InferenceLog } from './logging/inference-log';
import { MemoryRouter } from './memory/memory-router';
import type { MemoryStore } from './memory/memory-store';
import { type RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import { NervousSystem } from './nervous-system';
import { PerceptionCompressor } from './perception/perception-compressor';
import { PerceptionHistory } from './perception/perception-history';
import type { Soul } from './soul/soul-schema';
import { initialAttention } from './spark/attention';
import { type ThinkingModule, createThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';
import type { Perception, PerceptionEvent } from './transport/message-codecs';

const MAX_PENDING_EVENTS = 50;

export interface ResidentRuntimeOptions {
    soul: Soul;
    gateway: GatewayClient;
    memory: MemoryStore;
    stateStore: RuntimeStateStore;
    llm: LlmClient;
    actionLog: ActionLog;
    inferenceLog: InferenceLog;
    thinking?: ThinkingModule;
    body?: ResidentBody;
}

export class ResidentRuntime {
    readonly name: string;
    private readonly state: RuntimeState;
    private readonly thinking: ThinkingModule;
    private readonly nervousSystem: NervousSystem;
    private readonly body: ResidentBody;
    private readonly history = new PerceptionHistory();
    private readonly memoryRouter = new MemoryRouter();
    private readonly compressor = new PerceptionCompressor();
    private readonly pendingEvents: PerceptionEvent[] = [];
    private deciding = false;

    constructor(private readonly options: ResidentRuntimeOptions) {
        this.name = options.soul.frontmatter.name;
        this.state = options.stateStore.load(
            this.name,
            initialAttention(options.soul.frontmatter.attentionProfile),
            options.soul.frontmatter.legacy?.kind || options.soul.frontmatter.archetype,
        );
        this.thinking =
            options.thinking ||
            createThinkingModule({
                soul: options.soul,
                state: this.state,
                memory: options.memory,
                llm: options.llm,
            });
        this.nervousSystem = new NervousSystem({ soul: options.soul, state: this.state, memory: options.memory });
        this.body = options.body || createGatewayBody(this.name, options.gateway, options.actionLog);
    }

    async onPerception(perception: Perception): Promise<void> {
        this.history.push(perception);
        this.body.observePerception(perception);
        const reaction = this.nervousSystem.react(perception);
        if (reaction) {
            if (this.deciding && reaction.interruptThinking) {
                this.thinking.stop(`nervous:${reaction.rule.id}`);
            }
            await this.body.submit(reaction.action, {
                tick: this.state.tick,
                attention_after: this.state.attention,
                source: 'nervous-system',
                ruleId: reaction.rule.id,
            });
            this.options.stateStore.save(this.state);
            if (reaction.suppressThinking) {
                return;
            }
        }

        if (this.deciding) {
            const compressed = this.compressor.compress(perception);
            if (this.thinking.considerInterrupt(perception)) {
                this.options.inferenceLog.append(this.name, {
                    tick: this.state.tick,
                    cause: 'urgent_interrupt',
                    perception_tokens: compressed.text.length,
                });
            }
            return;
        }

        const decisionPerception = this.withPendingEvents(perception);
        const compressed = this.compressor.compress(decisionPerception);
        this.deciding = true;
        try {
            const result = await this.thinking.think({ ...decisionPerception, compressed: compressed.text });
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
                await this.body.submit(action, {
                    tick: this.state.tick,
                    attention_after: this.state.attention,
                    source: 'thinking',
                });
            }
        } finally {
            this.options.stateStore.save(this.state);
            this.deciding = false;
        }
    }

    onEvent(event: PerceptionEvent): void {
        this.history.push(event);
        this.body.observeEvent(event);
        this.pendingEvents.push(event);
        if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
            this.pendingEvents.splice(0, this.pendingEvents.length - MAX_PENDING_EVENTS);
        }
        const routed = this.memoryRouter.routeEvent(this.name, event);
        if (routed) {
            this.options.memory.write(this.name, routed.path, routed.content);
        }
    }

    private withPendingEvents(perception: Perception): Perception {
        if (this.pendingEvents.length === 0) {
            return perception;
        }

        const pending = this.pendingEvents.splice(0);
        const events = Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
        return { ...perception, events: [...events, ...pending] };
    }

    stop(cause = 'runtime_stopped'): void {
        this.thinking.stop(cause);
        this.options.stateStore.save(this.state);
    }
}
