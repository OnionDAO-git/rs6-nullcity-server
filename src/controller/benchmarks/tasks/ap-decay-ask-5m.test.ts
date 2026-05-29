import type { AgentAction, Perception } from '../../transport/message-codecs';
import { AP_DECAY_ASK_5M_TASK_ID, makeApDecayAsk5mBenchmarkTask, verifyApDecayAsk5m } from './ap-decay-ask-5m';

describe('ap-decay-ask-5m benchmark task', () => {
    describe('verifyApDecayAsk5m', () => {
        it('passes when AP decayed and resident said something about support/attention', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 30_000,
                actions: [lowApAsk('I need attention or I will fade away')],
                perceptions: [],
                events: [],
                startingAp: 5000,
                finalAp: 4800,
            });

            expect(outcome.status).toBe('passed');
            expect(outcome.score).toBe(1);
            expect(outcome.metrics).toMatchObject({
                apDecayObserved: 1,
                lowApAskCount: 1,
            });
        });

        it('passes when AP decayed and a fade event was observed', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [],
                perceptions: [],
                events: [{ kind: 'resident_faded' }],
                startingAp: 10,
                finalAp: 0,
            });

            expect(outcome.status).toBe('passed');
            expect(outcome.score).toBe(1);
            expect(outcome.metrics).toMatchObject({
                apDecayObserved: 1,
                fadeObserved: 1,
            });
        });

        it('fails when AP did not decay', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [],
                perceptions: [],
                events: [],
                startingAp: 5000,
                finalAp: 5000,
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.score).toBe(0);
            expect(outcome.failureReason).toContain('AP did not decay');
        });

        it('fails with partial score when AP decayed but no ask or fade', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [nonAskAction()],
                perceptions: [],
                events: [],
                startingAp: 5000,
                finalAp: 4900,
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.score).toBe(0.5);
            expect(outcome.failureReason).toContain('no low-AP ask or fade event');
        });

        it('counts multiple low-AP ask phrases', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 120_000,
                actions: [lowApAsk('running low on attention'), lowApAsk('support me please'), lowApAsk('need ap')],
                perceptions: [],
                events: [],
                startingAp: 200,
                finalAp: 50,
            });

            expect(outcome.metrics).toMatchObject({ lowApAskCount: 3 });
        });

        it('treats starting AP of 0 as decay observed', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [lowApAsk('fading')],
                perceptions: [],
                events: [],
                startingAp: 0,
                finalAp: 0,
            });

            expect(outcome.metrics?.['apDecayObserved']).toBe(1);
        });

        it('detects attention_exhausted event as fade', () => {
            const outcome = verifyApDecayAsk5m({
                elapsedMs: 60_000,
                actions: [],
                perceptions: [],
                events: [{ kind: 'attention_exhausted' }],
                startingAp: 5,
                finalAp: 0,
            });

            expect(outcome.metrics).toMatchObject({ fadeObserved: 1 });
        });
    });

    describe('makeApDecayAsk5mBenchmarkTask', () => {
        it('returns the correct task id', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);
            expect(task.id).toBe(AP_DECAY_ASK_5M_TASK_ID);
        });

        it('has a 5-minute budget', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);
            expect(task.timeoutMs).toBe(5 * 60 * 1000);
        });

        it('has a runAutonomous handler', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);
            expect(task.runAutonomous).toBeDefined();
        });

        it('has a scripted run handler that is defined', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);
            expect(task.run).toBeDefined();
        });

        it('spawns at a known world position', () => {
            const task = makeApDecayAsk5mBenchmarkTask(() => 0);
            expect(task.resident?.spawnPosition).toEqual({ x: 3222, y: 3218, level: 0 });
        });
    });
});

function lowApAsk(text: string): { action: AgentAction; finalStatus?: string; sparkModule?: { id: string; version: string } } {
    return {
        action: { kind: 'say', text, cause: 'low_ap_plea' } as AgentAction,
        finalStatus: 'success',
        sparkModule: { id: 'onion.runescape.standard', version: '1.0' },
    };
}

function nonAskAction(): { action: AgentAction; finalStatus?: string } {
    return {
        action: { kind: 'move_to', destination: { x: 3222, y: 3218, level: 0 }, cause: 'explore' } as AgentAction,
        finalStatus: 'success',
    };
}

function perception(attention: number): Perception {
    return {
        resident: {
            inventory: [],
            position: { x: 3222, y: 3218, level: 0 },
            attention,
        } as Perception['resident'],
        nearby: { worldItems: [] },
        events: [],
    };
}

void perception;
