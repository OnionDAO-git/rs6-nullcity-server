import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient } from '../llm/llm-client';
import { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Perception } from '../transport/message-codecs';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

// S-INFER-6: the Brain (in-flight SPARK deliberation) is a deliberate planner that
// should run to completion. Only SURVIVAL hooks (took_damage / death_seen /
// attention_empty, all HookDefinition.interrupt:true) may abort it. Non-survival
// hooks (addressed_by_chat / trade_request / new_actor_or_chunk / idle_reflection,
// interrupt:false-or-unset) must NOT abort the in-flight Brain — the Body/Nervous
// path handles them in real time. Root cause from live data: 525/777 (68%) brain
// decisions were thinking_cancelled:interrupted_by:trade_request|addressed_by_chat.
describe('Spark.considerInterrupt — only survival aborts the in-flight Brain', () => {
    function makeSpark(extraHooks: Soul['frontmatter']['hooks'] = []): {
        spark: Spark;
        llm: { complete: jest.Mock };
        memoryDir: string;
        startInflight: () => Promise<void>;
    } {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-interrupt-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
            upsertIndexPatch: jest.fn(),
        } as unknown as MemoryStore;

        // A never-resolving completion keeps the mailbox request in-flight so we can
        // probe considerInterrupt mid-deliberation.
        const llm = {
            complete: jest.fn(() => new Promise(() => {})),
        };

        const state = runtimeState();
        const spark = new Spark(soul({ hooks: extraHooks }), state, memory, llm as unknown as LlmClient);

        // Kick off a brain deliberation that parks in-flight (idle_reflection wins).
        const startInflight = async () => {
            void spark.tick(idlePerception());
            // Yield so tick() reaches `await this.llm.complete(...)` and registers the
            // in-flight mailbox request before we probe considerInterrupt.
            await Promise.resolve();
            await Promise.resolve();
        };

        return { spark, llm, memoryDir, startInflight };
    }

    it('preserves the in-flight Brain when a trade_request wins (non-survival)', async () => {
        const { spark, llm, memoryDir, startInflight } = makeSpark();
        await startInflight();
        expect(llm.complete).toHaveBeenCalledTimes(1);

        const aborted = spark.considerInterrupt(tradeRequestPerception());

        expect(aborted).toBe(false);
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('preserves the in-flight Brain when addressed_by_chat wins (non-survival)', async () => {
        const { spark, memoryDir, startInflight } = makeSpark();
        await startInflight();

        const aborted = spark.considerInterrupt(chatPerception());

        expect(aborted).toBe(false);
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('STILL aborts the in-flight Brain when took_damage wins (survival)', async () => {
        const { spark, memoryDir, startInflight } = makeSpark();
        await startInflight();

        const aborted = spark.considerInterrupt(hitPerception());

        expect(aborted).toBe(true);
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('STILL aborts the in-flight Brain when death_seen wins (survival)', async () => {
        const { spark, memoryDir, startInflight } = makeSpark();
        await startInflight();

        const aborted = spark.considerInterrupt(deathPerception());

        expect(aborted).toBe(true);
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('STILL aborts the in-flight Brain when attention_empty wins (survival)', async () => {
        const { spark, memoryDir, startInflight } = makeSpark();
        await startInflight();
        // Drain attention so the attention_empty (attention_lte:0) survival hook fires.
        (spark as unknown as { state: RuntimeState }).state.attention = 0;

        const aborted = spark.considerInterrupt(idlePerception());

        expect(aborted).toBe(true);
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('does nothing when there is no in-flight Brain (behavior unchanged)', async () => {
        const { spark, memoryDir } = makeSpark();

        // No tick() started → mailbox is empty → even a survival hook is a no-op here.
        const aborted = spark.considerInterrupt(hitPerception());

        expect(aborted).toBe(false);
        fs.rmSync(memoryDir, { recursive: true, force: true });
    });
});

function idlePerception(): Perception {
    return { resident: { position: { x: 3235, y: 3233, level: 0 } } } as unknown as Perception;
}

function tradeRequestPerception(): Perception {
    return {
        resident: { position: { x: 3235, y: 3233, level: 0 } },
        events: [{ kind: 'trade_request', from: 'res:other' }],
    } as unknown as Perception;
}

function chatPerception(): Perception {
    return {
        resident: { position: { x: 3235, y: 3233, level: 0 } },
        events: [{ kind: 'chat', text: 'hello there' }],
    } as unknown as Perception;
}

function hitPerception(): Perception {
    return {
        resident: { position: { x: 3235, y: 3233, level: 0 } },
        events: [{ kind: 'hit', damage: 4 }],
    } as unknown as Perception;
}

function deathPerception(): Perception {
    return {
        resident: { position: { x: 3235, y: 3233, level: 0 } },
        events: [{ kind: 'died', actor: 'res:other' }],
    } as unknown as Perception;
}

function runtimeState(): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick: 0,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: now,
            dayStartedAt: now,
            requestsThisMinute: 0,
            requestsToday: 0,
        },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function soul(extra: Partial<Soul['frontmatter']> = {}): Soul {
    return {
        sourcePath: 'test.md',
        body: '',
        frontmatter: {
            name: 'res:test',
            archetype: 'mentor',
            hooks: [],
            attentionProfile: { decayCurve: 'standard', startingAttention: 100 },
            ...extra,
        },
    };
}
