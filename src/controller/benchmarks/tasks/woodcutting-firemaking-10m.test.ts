import { objectIds } from '../../../engine/world/config/object-ids';
import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeWoodcuttingFiremaking10mBenchmarkTask, verifyWoodcuttingFiremaking10m } from './woodcutting-firemaking-10m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyWoodcuttingFiremaking10m', () => {
    it('passes when logs are self-supplied and then burned', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 121_000,
            actions: [
                attempt({ kind: 'interact', target: tree(), option: 'chop down', cause: 'woodcutting_level1_routine' }),
                attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 2, cause: 'woodcutting_chain_firemaking' }),
            ],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), item(1511, 'rs:logs')],
                    objects: [tree()],
                }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), null],
                    objects: [{ objectId: objectIds.fire }],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.woodcuttingActions).toBe(1);
        expect(outcome.metrics?.logsGained).toBe(1);
        expect(outcome.metrics?.logsConsumedAfterGain).toBe(1);
        expect(outcome.metrics?.firesObserved).toBe(1);
    });

    it('passes when woodcutting and firemaking success events are observed', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 97_000,
            actions: [
                attempt({ kind: 'interact', target: tree(), option: 'chop down' }),
                attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 2 }),
            ],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), item(1511, 'rs:logs')],
                    objects: [tree()],
                }),
            ],
            events: [
                { kind: 'message', text: 'You manage to chop some logs.' },
                { kind: 'message', text: 'The fire catches and the logs begin to burn.' },
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.woodcuttingSuccessEvents).toBe(1);
        expect(outcome.metrics?.firemakingSuccessEvents).toBe(1);
    });

    it('does not pass on firemaking evidence without self-supplied logs', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 })],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1511, 'rs:logs')], objects: [] }),
                perception({ inventory: [item(590, 'rs:tinderbox'), null], objects: [{ objectId: objectIds.fire }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No woodcutting action');
    });

    it('does not pass when firemaking happens before woodcutting', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 121_000,
            actions: [
                attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 2, cause: 'firemaking_fallback' }),
                attempt({ kind: 'interact', target: tree(), option: 'chop down', cause: 'woodcutting_level1_routine' }),
            ],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), item(1511, 'rs:logs')],
                    objects: [tree()],
                }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), null],
                    objects: [{ objectId: objectIds.fire }],
                }),
            ],
            events: [{ kind: 'message', text: 'The fire catches and the logs begin to burn.' }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordered woodcutting-to-firemaking action chain');
        expect(outcome.metrics?.orderedActionChain).toBe(0);
    });

    it('does not count unrelated item use as firemaking', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 121_000,
            actions: [
                attempt({ kind: 'interact', target: tree(), option: 'chop down', cause: 'woodcutting_level1_routine' }),
                attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'unrelated_item_use' }),
            ],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), item(1511, 'rs:logs')],
                    objects: [tree()],
                }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), null],
                    objects: [{ objectId: objectIds.fire }],
                }),
            ],
            events: [{ kind: 'message', text: 'The fire catches and the logs begin to burn.' }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('no valid tinderbox/log firemaking action');
        expect(outcome.metrics?.validFiremakingActions).toBe(0);
    });

    it('does not treat picked-up logs as self-supplied woodcutting evidence', () => {
        const groundLogs = { itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3226, y: 3230, level: 0 } };
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 121_000,
            actions: [
                attempt({ kind: 'interact', target: tree(), option: 'chop down', cause: 'woodcutting_level1_routine' }),
                attempt({ kind: 'interact', target: groundLogs, option: 'pick-up', cause: 'pickup_logs' }),
                attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 2, cause: 'firemaking_fallback' }),
            ],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), item(1511, 'rs:logs')],
                    objects: [tree()],
                }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), null],
                    objects: [{ objectId: objectIds.fire }],
                }),
            ],
            events: [{ kind: 'message', text: 'The fire catches and the logs begin to burn.' }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No self-supplied logs');
        expect(outcome.metrics?.externalLogSupplyActions).toBe(1);
    });

    it('scores partial progress when chopping happens before logs appear', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 45_000,
            actions: [attempt({ kind: 'interact', target: tree(), option: 'chop down' })],
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBeGreaterThan(0);
        expect(outcome.metrics?.woodcuttingActions).toBe(1);
        expect(outcome.failureReason).toContain('No self-supplied logs');
    });

    it('times out when the budget is exceeded before success', () => {
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 601_000,
            actions: [attempt({ kind: 'interact', target: tree(), option: 'chop down' })],
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] })],
            events: [],
        });

        expect(outcome.status).toBe('timeout');
        expect(outcome.failureReason).toContain('10 minute budget');
    });

    it('fails unsafe loops before the agent repeats the same chain action forever', () => {
        const chopAction = { kind: 'interact', target: tree(), option: 'chop down' };
        const outcome = verifyWoodcuttingFiremaking10m({
            elapsedMs: 180_000,
            actions: Array.from({ length: 12 }, () => attempt(chopAction)),
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('unsafe loop');
        expect(outcome.metrics?.unsafeLoops).toBe(1);
    });

    it('autonomous mode observes module woodcutting and firemaking evidence without submitting scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeWoodcuttingFiremaking10mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'interact', target: tree(), option: 'chop down', cause: 'woodcutting_level1_routine' }, STANDARD_MODULE),
                attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 2, cause: 'woodcutting_chain_firemaking' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe')], objects: [tree()] }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), item(1511, 'rs:logs')],
                    objects: [tree()],
                }),
                perception({
                    inventory: [item(590, 'rs:tinderbox'), item(1351, 'rs:bronze_axe'), null],
                    objects: [{ objectId: objectIds.fire }],
                }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function perception(overrides: {
    inventory?: Array<Record<string, unknown> | null>;
    objects?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            inventory: overrides.inventory || [],
        },
        nearby: {
            objects: overrides.objects || [],
        },
        events: overrides.events || [],
    };
}

function item(itemId: number, key: string): Record<string, unknown> {
    return { itemId, key, amount: 1 };
}

function tree(): Record<string, unknown> {
    return { objectId: objectIds.tree.normal[0].default, position: { x: 3226, y: 3230, level: 0 }, orientation: 0 };
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_wood_fire',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: jest.fn(),
        submitPeerAction: jest.fn(),
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts,
        latestPerception: () => overrides.perceptions.at(-1),
        perceptions: () => overrides.perceptions,
        events: () => overrides.events,
    };
}
