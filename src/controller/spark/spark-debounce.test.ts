import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient } from '../llm/llm-client';
import { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Perception } from '../transport/message-codecs';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

// S-INFER-7: the Brain is a deliberate, infrequent planner. While a deliberation
// is in-flight (~40s qwopus), a NEW *non-survival* Brain trigger from the next
// tick/decision cycle must NOT supersede/abort the in-flight one — it must run to
// completion, and only the NEXT think may start after it finishes. Survival events
// (took_damage/death_seen/attention_empty, HookDefinition.interrupt:true) STILL
// abort via considerInterrupt. The Body still runs every tick (thinking-off path).
// Root cause: Mailbox.start() unconditionally aborts the prior in-flight request
// ('replaced_by:'), so any new decide() that reaches mailbox.start() supersedes the
// brain. Live residual: usable-brain-rate ~60%, cancelled=360 (~38%).
describe('Spark brain debounce — an in-flight deliberation is not superseded by a new non-survival trigger', () => {
    function makeSpark(extraHooks: Soul['frontmatter']['hooks'] = []): {
        spark: Spark;
        llm: { complete: jest.Mock };
        memoryDir: string;
        state: RuntimeState;
        startInflight: () => Promise<void>;
    } {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-debounce-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
            upsertIndexPatch: jest.fn(),
        } as unknown as MemoryStore;

        // A never-resolving completion parks the deliberation in-flight so we can
        // fire a second trigger while the first is still deciding.
        const llm = {
            complete: jest.fn(() => new Promise(() => {})),
        };

        const state = runtimeState();
        const spark = new Spark(soul({ hooks: extraHooks }), state, memory, llm as unknown as LlmClient);

        const startInflight = async () => {
            void spark.tick(idlePerception());
            // Yield so tick() reaches `await this.llm.complete(...)` and registers the
            // in-flight mailbox request before we fire the second trigger.
            await Promise.resolve();
            await Promise.resolve();
        };

        return { spark, llm, memoryDir, state, startInflight };
    }

    it('does NOT abort the in-flight Brain when a second non-survival trigger arrives (trade_request)', async () => {
        const { spark, llm, memoryDir, startInflight } = makeSpark();
        await startInflight();
        expect(llm.complete).toHaveBeenCalledTimes(1);

        const inflight = (spark as unknown as { mailbox: { current(): { controller: AbortController } | undefined } }).mailbox.current();
        expect(inflight).toBeDefined();
        const firstController = inflight!.controller;

        // A new decision cycle wants to start a Brain think (a non-survival
        // trade_request hook wins). It must SKIP, not supersede.
        const result = await spark.tick(tradeRequestPerception());

        // The in-flight deliberation must be preserved: not aborted, not replaced.
        expect(firstController.signal.aborted).toBe(false);
        // No second LLM completion was kicked off (no new mailbox.start).
        expect(llm.complete).toHaveBeenCalledTimes(1);
        // The in-flight request is still the current one.
        const stillInflight = (spark as unknown as { mailbox: { current(): unknown } }).mailbox.current();
        expect(stillInflight).toBe(inflight);
        // The debounced tick returns a non-aborting result.
        expect(result.cause).toBe('brain_inflight_debounced');
        expect(result.nooped).toBe(true);

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('STILL aborts the in-flight Brain when a survival trigger arrives (took_damage via considerInterrupt)', async () => {
        const { spark, memoryDir, startInflight } = makeSpark();
        await startInflight();

        const inflight = (spark as unknown as { mailbox: { current(): { controller: AbortController } | undefined } }).mailbox.current();
        const firstController = inflight!.controller;

        // Survival reflex path: considerInterrupt aborts the brain (life-saving).
        const aborted = spark.considerInterrupt(hitPerception());

        expect(aborted).toBe(true);
        expect(firstController.signal.aborted).toBe(true);

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('lets a new Brain think start normally once the in-flight one has finished', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-debounce-done-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
            upsertIndexPatch: jest.fn(),
        } as unknown as MemoryStore;
        // Resolve immediately so the first deliberation completes.
        const llm = {
            complete: jest.fn(() => Promise.resolve({ text: '{"say":"hello"}' })),
        };
        const state = runtimeState();
        const spark = new Spark(soul(), state, memory, llm as unknown as LlmClient);

        await spark.tick(idlePerception());
        expect(llm.complete).toHaveBeenCalledTimes(1);
        // No in-flight request after completion → the debounce guard cannot fire.
        expect((spark as unknown as { mailbox: { current(): unknown } }).mailbox.current()).toBeUndefined();

        // Advance past the idle_reflection cooldown (25 ticks) so the hook re-wins,
        // then a subsequent tick is free to start a fresh Brain think (NOT debounced).
        state.tick += 30;
        const second = await spark.tick(idlePerception());
        expect(llm.complete).toHaveBeenCalledTimes(2);
        expect(second.cause).not.toBe('brain_inflight_debounced');

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('watchdog still stops a parked in-flight Brain (no hang)', async () => {
        const { spark, memoryDir, startInflight } = makeSpark();
        await startInflight();

        const inflight = (spark as unknown as { mailbox: { current(): { controller: AbortController } | undefined } }).mailbox.current();
        const firstController = inflight!.controller;

        // The watchdog fallback aborts the in-flight brain on timeout.
        spark.watchdogFallback(idlePerception());

        expect(firstController.signal.aborted).toBe(true);

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

function hitPerception(): Perception {
    return {
        resident: { position: { x: 3235, y: 3233, level: 0 } },
        events: [{ kind: 'hit', damage: 4 }],
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
