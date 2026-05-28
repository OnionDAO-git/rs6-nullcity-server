import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeEquipmentPrep3mBenchmarkTask, verifyEquipmentPrep3m } from './equipment-prep-3m';

describe('verifyEquipmentPrep3m', () => {
    it('passes when useful gear is equipped before a safe combat action', () => {
        const outcome = verifyEquipmentPrep3m({
            elapsedMs: 30_000,
            actions: [
                { action: { kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }, result: { ok: true } },
                { action: { kind: 'attack', target: chicken(), cause: 'combat_attack_safe_target' }, result: { ok: true } },
            ],
            perceptions: [{ resident: { equipment: [{ itemId: 9703, key: 'rs:training_sword', amount: 1 }] } }],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            equipActions: 1,
            equipmentEvidence: 1,
            safeAttackActions: 1,
            equipBeforeAttack: 1,
        });
    });

    it('fails when the resident attacks without equipping carried gear first', () => {
        const outcome = verifyEquipmentPrep3m({
            elapsedMs: 30_000,
            actions: [{ action: { kind: 'attack', target: chicken(), cause: 'combat_attack_safe_target' }, result: { ok: true } }],
            perceptions: [],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No useful gear equip action');
    });

    it('requires equipment-state evidence, not only an acked equip click', () => {
        const outcome = verifyEquipmentPrep3m({
            elapsedMs: 30_000,
            actions: [{ action: { kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }, result: { ok: true } }],
            perceptions: [],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No equipment-state evidence');
    });

    it('accepts safe attack submission as follow-on evidence even if combat ack times out', () => {
        const outcome = verifyEquipmentPrep3m({
            elapsedMs: 30_000,
            actions: [
                { action: { kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }, result: { ok: true } },
                {
                    action: { kind: 'attack', target: chicken(), cause: 'combat_attack_safe_target' },
                    result: { ok: false, reason: 'action_result_timeout' },
                },
            ],
            perceptions: [{ resident: { equipment: [{ itemId: 9703, key: 'rs:training_sword', amount: 1 }] } }],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            safeAttackActions: 1,
            safeAttackAckedActions: 0,
            equipBeforeAttack: 1,
        });
    });
});

describe('makeEquipmentPrep3mBenchmarkTask', () => {
    it('seeds useful carried gear without pre-equipping it', () => {
        const task = makeEquipmentPrep3mBenchmarkTask();

        expect(task.id).toBe('equipment-prep-3m');
        expect(task.resident?.initialInventory).toEqual([{ itemId: 9703 }, { itemId: 315 }, { itemId: 315 }]);
        expect(task.resident?.initialEquipment).toEqual([]);
    });

    it('scripted mode submits equip before attack once equipment evidence appears', async () => {
        let now = 1_000;
        const submitted: unknown[] = [];
        const task = makeEquipmentPrep3mBenchmarkTask(() => now);
        const context = fakeContext({
            submit: async action => {
                submitted.push(action);
                now += 1_000;
                return { ok: true };
            },
            perceptions: [
                {
                    resident: { inventory: [{ itemId: 9703, key: 'rs:training_sword', amount: 1 }], equipment: [] },
                    nearby: { npcs: [chicken()] },
                },
                {
                    resident: { inventory: [], equipment: [{ itemId: 9703, key: 'rs:training_sword', amount: 1 }] },
                    nearby: { npcs: [chicken()] },
                },
            ],
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitted).toEqual([
            { kind: 'equip', slot: 0, cause: 'benchmark_equipment_prep_3m' },
            { kind: 'attack', target: chicken(), cause: 'benchmark_equipment_prep_3m' },
        ]);
    });
});

function chicken() {
    return {
        id: 'npc:chicken',
        kind: 'npc' as const,
        key: 'rs:chicken',
        name: 'Chicken',
        position: { x: 3232, y: 3299, level: 0 },
        hpFraction: 1,
    };
}

function fakeContext(options: {
    submit: BenchmarkTaskContext['submitAction'];
    perceptions: BenchmarkTaskContext['perceptions'] extends () => readonly (infer T)[] ? T[] : never;
}): BenchmarkTaskContext {
    let index = 0;
    const actions: ReturnType<BenchmarkTaskContext['actionAttempts']>[number][] = [];
    return {
        resident: 'bench-equipment-prep',
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
