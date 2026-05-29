import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import {
    AP_DECAY_ASK_5M_TASK_ID,
    AP_DECAY_ASK_5M_TASK_VERSION,
    makeApDecayAsk5mBenchmarkTask,
    verifyApDecayAsk5m,
} from './ap-decay-ask-5m';

describe('ap-decay-ask-5m benchmark task', () => {
    describe('verifyApDecayAsk5m', () => {
        it('passes when low AP behavior asks for attention and then fades with attention exhaustion', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 50_000,
                actions: [
                    attempt({ kind: 'say', text: 'My attention grows thin.', cause: 'nervous:request-attention' }, 'success', 10),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 0),
                ],
                perceptions: [],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome).toMatchObject({
                status: 'passed',
                score: 1,
                metrics: {
                    startingAp: 10,
                    finalAp: 0,
                    apDecayObserved: 1,
                    lowApAskActions: 1,
                    attentionExhaustedLogouts: 1,
                    fadeEvents: 1,
                    minObservedAttention: 0,
                    sawAttentionDropToZero: 1,
                },
            });
        });

        it('passes when explicit AP bounds prove decay and a fade event is observed', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [attempt({ kind: 'request_attention', cause: 'low_ap' })],
                perceptions: [],
                events: [{ kind: 'resident_faded' }],
                startingAp: 10,
                finalAp: 0,
            });

            expect(outcome).toMatchObject({
                status: 'passed',
                score: 1,
                metrics: {
                    apDecayObserved: 1,
                    lowApAskActions: 1,
                    fadeEvents: 1,
                },
            });
        });

        it('fails when AP did not decay', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [lowApAsk('I need attention')],
                perceptions: [perception({ attention: 5000 }), perception({ attention: 5000 })],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.score).toBe(0);
            expect(outcome.failureReason).toContain('AP did not decay');
        });

        it('fails when no low-AP ask is observed', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 50_000,
                actions: [attempt({ kind: 'logout', cause: 'attention_exhausted' })],
                perceptions: [perception({ attention: 8 }), perception({ attention: 0 })],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.failureReason).toContain('No low-AP ask');
            expect(outcome.metrics).toMatchObject({ lowApAskActions: 0, attentionExhaustedLogouts: 1 });
        });

        it('fails with partial score when AP decayed but no fade proof was captured', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [lowApAsk('running low on attention')],
                perceptions: [perception({ attention: 12 }), perception({ attention: 1 })],
                events: [],
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.score).toBe(0.65);
            expect(outcome.failureReason).toContain('no attention_exhausted fade/logout proof');
        });

        it('counts multiple low-AP ask forms', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 120_000,
                actions: [
                    lowApAsk('running low on attention'),
                    lowApAsk('support me please'),
                    attempt({ kind: 'request_attention', cause: 'need ap' }),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }),
                ],
                perceptions: [perception({ attention: 200 }), perception({ attention: 0 })],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome.metrics).toMatchObject({ lowApAskActions: 3 });
        });
    });

    describe('makeApDecayAsk5mBenchmarkTask', () => {
        it('declares the expected task id/version and autonomous mode support', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);

            expect(task.id).toBe(AP_DECAY_ASK_5M_TASK_ID);
            expect(task.version).toBe(AP_DECAY_ASK_5M_TASK_VERSION);
            expect(task.timeoutMs).toBe(5 * 60 * 1000);
            expect(task.runAutonomous).toBeDefined();
            expect(task.run).toBeDefined();
        });

        it('spawns at a known Lumbridge world position', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);

            expect(task.resident?.spawnPosition).toEqual({ x: 3222, y: 3218, level: 0 });
        });

        it('returns a verifier failure before the runner-level timeout can preempt metrics', async () => {
            let calls = 0;
            const task = makeApDecayAsk5mBenchmarkTask(() => {
                calls += 1;
                return calls === 1 ? 0 : 295_001;
            });
            const context = {
                actionAttempts: () => [],
                perceptions: () => [perception({ attention: 12 }), perception({ attention: 9 })],
                events: () => [],
                recordSummary: jest.fn(),
                signal: new AbortController().signal,
            };

            const outcome = await task.runAutonomous?.(context as never);

            expect(outcome).toMatchObject({
                status: 'failed',
                score: 0.35,
                metrics: expect.objectContaining({
                    apDecayObserved: 1,
                    lowApAskActions: 0,
                }),
            });
        });
    });
});

function attempt(action: AgentAction, finalStatus = 'success', attentionAfter?: number) {
    return { action, finalStatus, attentionAfter };
}

function lowApAsk(text: string) {
    return attempt({ kind: 'say', text, cause: 'low_ap_plea' });
}

function perception(input: { attention: number; events?: PerceptionEvent[] }): Perception {
    return {
        resident: {
            inventory: [],
            position: { x: 3222, y: 3218, level: 0 },
            attention: input.attention,
        },
        nearby: { worldItems: [] },
        events: input.events || [],
    };
}
