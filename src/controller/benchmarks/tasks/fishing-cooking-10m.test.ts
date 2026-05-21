import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeFishingCooking10mBenchmarkTask, verifyFishingCooking10m } from './fishing-cooking-10m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyFishingCooking10m', () => {
    it('passes when the agent catches raw starter fish and cooks it on a heat source', () => {
        const outcome = verifyFishingCooking10m({
            elapsedMs: 120_000,
            actions: [
                attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' }),
                attempt({ kind: 'use_item_on', itemSlot: 1, target: fire(), cause: 'starter_fishing_cook_catch' }),
            ],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], objects: [fire()] }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                    skills: { cooking: { xp: 0 } },
                }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(315, 'rs:shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                    skills: { cooking: { xp: 30 } },
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.netActions).toBe(1);
        expect(outcome.metrics?.cookingActions).toBe(1);
        expect(outcome.metrics?.cookedFishGained).toBe(1);
        expect(outcome.metrics?.cookingXpIncreased).toBe(1);
    });

    it('does not pass on cooked fish without a selected cooking action', () => {
        const outcome = verifyFishingCooking10m({
            elapsedMs: 120_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' })],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], objects: [fire()] }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(315, 'rs:shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No cooking action');
    });

    it('does not pass when fish was externally supplied instead of caught and cooked', () => {
        const outcome = verifyFishingCooking10m({
            elapsedMs: 120_000,
            actions: [
                attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' }),
                attempt({
                    kind: 'interact',
                    target: { ...item(317, 'rs:raw_shrimp'), position: { x: 3238, y: 3244, level: 0 } },
                    option: 'pick-up',
                }),
                attempt({ kind: 'use_item_on', itemSlot: 1, target: fire(), cause: 'starter_fishing_cook_catch' }),
            ],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], objects: [fire()] }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(315, 'rs:shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.externalFishSupplyActions).toBe(1);
        expect(outcome.failureReason).toContain('externally supplied');
    });

    it('autonomous mode observes selected-module fishing and cooking evidence without scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeFishingCooking10mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' }, STANDARD_MODULE),
                attempt({ kind: 'use_item_on', itemSlot: 1, target: fire(), cause: 'starter_fishing_cook_catch' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], objects: [fire()] }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                }),
                perception({
                    inventory: [item(303, 'rs:small_fishing_net'), item(315, 'rs:shrimp')],
                    npcs: [fishingSpot()],
                    objects: [fire()],
                }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });

    it('scripted mode makes a cooking fire when raw fish is ready and no heat source is visible', async () => {
        const controller = new AbortController();
        const submitAction = jest.fn(async () => {
            controller.abort();
            return { ok: true };
        });
        const task = makeFishingCooking10mBenchmarkTask(() => 1_000);
        const context = taskContext({
            signal: controller.signal,
            submitAction,
            actionAttempts: [],
            perceptions: [
                perception({
                    inventory: [
                        item(303, 'rs:small_fishing_net'),
                        item(590, 'rs:tinderbox'),
                        item(1511, 'rs:logs'),
                        item(317, 'rs:raw_shrimp'),
                    ],
                    npcs: [fishingSpot()],
                }),
            ],
            events: [],
        });

        await task.run(context);

        expect(submitAction).toHaveBeenCalledWith({
            kind: 'use_item_on_item',
            itemSlot: 1,
            targetSlot: 2,
            cause: 'benchmark_fishing_cooking_make_fire',
        });
    });
});

function attempt(
    action: AgentAction,
    sparkModule?: typeof STANDARD_MODULE,
    result?: ActionResult,
): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult } {
    return { action, sparkModule, result };
}

function perception(overrides: {
    position?: { x: number; y: number; level: number };
    inventory?: Array<Record<string, unknown> | null>;
    skills?: Record<string, unknown>;
    npcs?: Array<Record<string, unknown>>;
    objects?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            position: overrides.position || { x: 3237, y: 3244, level: 0 },
            inventory: overrides.inventory || [],
            ...(overrides.skills ? { skills: overrides.skills } : {}),
        },
        nearby: {
            npcs: overrides.npcs || [],
            objects: overrides.objects || [],
        },
        events: overrides.events || [],
    };
}

function fishingSpot(): Record<string, unknown> {
    return {
        id: 'npc:316',
        kind: 'npc',
        key: 'rs:fishing_spot_net_bait',
        name: 'Fishing spot',
        position: { x: 3239, y: 3244, level: 0 },
        hpFraction: 1,
    };
}

function fire(): Record<string, unknown> {
    return { objectId: 2732, position: { x: 3238, y: 3244, level: 0 } };
}

function item(itemId: number, key: string): Record<string, unknown> {
    return { itemId, key, amount: 1 };
}

function taskContext(overrides: {
    signal?: AbortSignal;
    submitAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_fish_cook',
        module: STANDARD_MODULE,
        signal: overrides.signal || new AbortController().signal,
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
