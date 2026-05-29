import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeLevelUpFiremaking3mBenchmarkTask, verifyLevelUpFiremaking3m } from './level-up-firemaking-3m';

describe('verifyLevelUpFiremaking3m', () => {
    it('passes when a real firemaking action produces a firemaking level-up event', () => {
        const outcome = verifyLevelUpFiremaking3m({
            elapsedMs: 30_000,
            actions: [{ action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'benchmark_level_up_firemaking_3m' } }],
            perceptions: [{ events: [{ kind: 'level_up', skill: 'firemaking', level: 2 }] }],
            events: [
                { kind: 'fire_lit', experience: 40 },
                { kind: 'level_up', skill: 'firemaking', level: 2 },
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            firemakingActions: 1,
            fireLitEvents: 1,
            firemakingLevelUpEvents: 2,
        });
    });

    it('fails when a fire is made but no level-up event is observed', () => {
        const outcome = verifyLevelUpFiremaking3m({
            elapsedMs: 30_000,
            actions: [{ action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'benchmark_level_up_firemaking_3m' } }],
            perceptions: [],
            events: [{ kind: 'fire_lit', experience: 40 }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('no firemaking level-up');
        expect(outcome.score).toBeGreaterThan(0.5);
    });
});

describe('makeLevelUpFiremaking3mBenchmarkTask', () => {
    it('seeds firemaking one XP below level 2 while still requiring a real action', () => {
        const task = makeLevelUpFiremaking3mBenchmarkTask();

        expect(task.id).toBe('level-up-firemaking-3m');
        expect(task.resident?.initialInventory).toEqual([{ itemId: 590 }, { itemId: 1511 }]);
        expect(task.resident?.initialSkills).toEqual({ firemaking: { exp: 82, level: 1 } });
    });

    it('scripted mode submits tinderbox-on-logs and waits for level-up evidence', async () => {
        let now = 1_000;
        const submitted: unknown[] = [];
        const task = makeLevelUpFiremaking3mBenchmarkTask(() => now);
        const context = fakeContext({
            submit: async action => {
                submitted.push(action);
                now += 1_000;
                return { ok: true };
            },
            events: [
                { kind: 'fire_lit', experience: 40 },
                { kind: 'level_up', skill: 'firemaking', level: 2 },
            ],
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitted).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'benchmark_level_up_firemaking_3m' }]);
    });
});

function fakeContext(options: {
    submit: BenchmarkTaskContext['submitAction'];
    events: ReturnType<BenchmarkTaskContext['events']>[number][];
}): BenchmarkTaskContext {
    const actions: ReturnType<BenchmarkTaskContext['actionAttempts']>[number][] = [];
    let submitted = false;
    return {
        resident: 'bench-level-up-firemaking',
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        signal: new AbortController().signal,
        submitAction: async action => {
            const result = await options.submit(action);
            actions.push({ action, result });
            submitted = true;
            return result;
        },
        peerResident: () => undefined,
        submitPeerAction: async () => ({ ok: false, reason: 'no_peer' }),
        recordActionAttempt: attempt => actions.push(attempt),
        recordInferenceRequest: () => undefined,
        recordSummary: () => undefined,
        actionAttempts: () => actions,
        latestPerception: () => undefined,
        perceptions: () => [],
        events: () => (submitted ? options.events : []),
    };
}
