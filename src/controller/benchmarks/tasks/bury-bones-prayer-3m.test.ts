import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeBuryBonesPrayer3mBenchmarkTask, verifyBuryBonesPrayer3m } from './bury-bones-prayer-3m';

describe('verifyBuryBonesPrayer3m', () => {
    it('passes when burying carried bones consumes them and increases Prayer XP', () => {
        const outcome = verifyBuryBonesPrayer3m({
            elapsedMs: 30_000,
            actions: [{ action: { kind: 'item_action', slot: 0, option: 'bury', cause: 'benchmark_bury_bones_prayer_3m' } }],
            perceptions: [
                { resident: { inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }], skills: { prayer: { xp: 0 } } } },
                { resident: { inventory: [], skills: { prayer: { xp: 4.5 } } }, events: [{ kind: 'item_lost', item: bones() }] },
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            buryActions: 1,
            bonesConsumed: 1,
            prayerXpIncreased: 1,
        });
    });

    it('fails when bones are consumed without Prayer XP progress', () => {
        const outcome = verifyBuryBonesPrayer3m({
            elapsedMs: 30_000,
            actions: [{ action: { kind: 'item_action', slot: 0, option: 'bury', cause: 'benchmark_bury_bones_prayer_3m' } }],
            perceptions: [
                { resident: { inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }], skills: { prayer: { xp: 0 } } } },
                { resident: { inventory: [], skills: { prayer: { xp: 0 } } }, events: [{ kind: 'item_lost', item: bones() }] },
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('no Prayer XP');
    });
});

describe('makeBuryBonesPrayer3mBenchmarkTask', () => {
    it('seeds carried bones and submits a bury action', async () => {
        let now = 1_000;
        const submitted: unknown[] = [];
        const task = makeBuryBonesPrayer3mBenchmarkTask(() => now);
        const context = fakeContext({
            submit: async action => {
                submitted.push(action);
                now += 1_000;
                return { ok: true };
            },
            perceptions: [
                { resident: { inventory: [bones()], skills: { prayer: { xp: 0 } } } },
                { resident: { inventory: [], skills: { prayer: { xp: 4.5 } } }, events: [{ kind: 'item_lost', item: bones() }] },
            ],
        });

        expect(task.id).toBe('bury-bones-prayer-3m');
        expect(task.resident?.initialInventory).toEqual([{ itemId: 526 }]);

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitted).toEqual([{ kind: 'item_action', slot: 0, option: 'bury', cause: 'benchmark_bury_bones_prayer_3m' }]);
    });
});

function bones() {
    return { itemId: 526, key: 'rs:bones', amount: 1 };
}

function fakeContext(options: {
    submit: BenchmarkTaskContext['submitAction'];
    perceptions: BenchmarkTaskContext['perceptions'] extends () => readonly (infer T)[] ? T[] : never;
}): BenchmarkTaskContext {
    let index = 0;
    const actions: ReturnType<BenchmarkTaskContext['actionAttempts']>[number][] = [];
    return {
        resident: 'bench-bury-bones-prayer',
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        signal: new AbortController().signal,
        submitAction: async action => {
            const result = await options.submit(action);
            actions.push({ action, result });
            index = Math.min(index + 1, options.perceptions.length - 1);
            return result;
        },
        peerResident: () => undefined,
        submitPeerAction: async () => ({ ok: false, reason: 'no_peer' }),
        recordActionAttempt: attempt => actions.push(attempt),
        recordInferenceRequest: () => undefined,
        recordSummary: () => undefined,
        actionAttempts: () => actions,
        latestPerception: () => options.perceptions[index],
        perceptions: () => options.perceptions.slice(0, index + 1),
        events: () => [],
    };
}
