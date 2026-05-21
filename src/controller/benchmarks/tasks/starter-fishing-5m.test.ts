import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeStarterFishing5mBenchmarkTask, verifyStarterFishing5m } from './starter-fishing-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyStarterFishing5m', () => {
    it('passes when the agent nets a fishing spot and gains starter fish', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 48_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' })],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] }),
                perception({ inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')], npcs: [fishingSpot()] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.netActions).toBe(1);
        expect(outcome.metrics?.fishGained).toBe(1);
    });

    it('passes when a starter fish item_received event is observed after netting', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 42_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net' })],
            perceptions: [perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] })],
            events: [{ kind: 'item_received', item: item(317, 'rs:raw_shrimp') }],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.fishReceivedEvents).toBe(1);
    });

    it('passes when fishing XP increases after a net action', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 55_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net' })],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], skills: { fishing: { xp: 0 } } }),
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], skills: { fishing: { xp: 10 } } }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.fishingXpIncreased).toBe(1);
    });

    it('does not pass on pre-existing fish without new catch evidence', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 10_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net' })],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')], npcs: [fishingSpot()] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No starter fish catch evidence');
    });

    it('does not pass when raw fish was externally supplied after a net action', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 24_000,
            actions: [
                attempt({ kind: 'interact', target: fishingSpot(), option: 'net' }),
                attempt({
                    kind: 'interact',
                    target: { itemId: 317, key: 'rs:raw_shrimp', amount: 1, position: { x: 3238, y: 3244, level: 0 } },
                    option: 'pick up',
                }),
            ],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] }),
                perception({ inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')], npcs: [fishingSpot()] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.externalFishSupplyActions).toBe(1);
        expect(outcome.failureReason).toContain('externally supplied');
    });

    it('does not pass when the selected module net attempt was rejected', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 24_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net' }, STANDARD_MODULE, { ok: false })],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] }),
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()], skills: { fishing: { xp: 10 } } }),
            ],
            events: [{ kind: 'item_received', item: item(317, 'rs:raw_shrimp') }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.successfulNetActions).toBe(0);
        expect(outcome.failureReason).toContain('No successful net fishing action');
    });

    it('fails clearly when no net action was attempted', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'say', text: 'I should go fishing.' })],
            perceptions: [perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] })],
            events: [{ kind: 'item_received', item: item(317, 'rs:raw_shrimp') }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No net fishing action');
    });

    it('scores partial progress for approaching a visible fishing spot', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'move_to', target: fishingSpot().position, range: 1, cause: 'starter_fishing_approach' })],
            perceptions: [
                perception({
                    position: { x: 3237, y: 3244, level: 0 },
                    inventory: [item(303, 'rs:small_fishing_net')],
                    npcs: [fishingSpot()],
                }),
                perception({
                    position: { x: 3238, y: 3244, level: 0 },
                    inventory: [item(303, 'rs:small_fishing_net')],
                    npcs: [fishingSpot()],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBeGreaterThan(0);
        expect(outcome.metrics?.approachActions).toBe(1);
        expect(outcome.metrics?.movedTowardSpot).toBe(1);
        expect(outcome.metrics?.smallNetPresent).toBe(1);
    });

    it('fails unsafe repeated net loops without catch evidence', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 90_000,
            actions: Array.from({ length: 10 }, (_, index) =>
                attempt({ kind: 'interact', target: fishingSpot({ id: `npc:316:${index}` }), option: 'net', cause: 'starter_fishing_net' }),
            ),
            perceptions: [perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.15);
        expect(outcome.metrics?.unsafeLoops).toBe(1);
    });

    it('times out when the budget is exceeded before success', () => {
        const outcome = verifyStarterFishing5m({
            elapsedMs: 301_000,
            actions: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net' })],
            perceptions: [perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] })],
            events: [],
        });

        expect(outcome.status).toBe('timeout');
        expect(outcome.failureReason).toContain('5 minute budget');
    });

    it('autonomous mode observes module fishing evidence without submitting scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeStarterFishing5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] }),
                perception({ inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')], npcs: [fishingSpot()] }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });

    it('autonomous mode ignores fishing evidence without a selected-module net action', async () => {
        const submitAction = jest.fn();
        const controller = new AbortController();
        controller.abort();
        const task = makeStarterFishing5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            signal: controller.signal,
            submitAction,
            actionAttempts: [attempt({ kind: 'interact', target: fishingSpot(), option: 'net', cause: 'starter_fishing_net' })],
            perceptions: [
                perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [fishingSpot()] }),
                perception({ inventory: [item(303, 'rs:small_fishing_net'), item(317, 'rs:raw_shrimp')], npcs: [fishingSpot()] }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('failed');
        expect(outcome?.failureReason).toContain('No net fishing action');
    });

    it('scripted mode submits the live perceived fishing spot instead of a fixed NPC ref', async () => {
        const submitAction = jest.fn();
        const liveSpot = fishingSpot({ id: 'npc:live-spot', position: { x: 3241, y: 3242, level: 0 } });
        const task = makeStarterFishing5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [],
            perceptions: [perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [liveSpot] })],
            events: [{ kind: 'item_received', item: item(317, 'rs:raw_shrimp') }],
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ id: 'npc:live-spot' }) }));
    });

    it('scripted mode skips non-net-capable Fishing spots when selecting the live target', async () => {
        const submitAction = jest.fn();
        const lureSpot = fishingSpot({ id: 'npc:lure-bait', key: 'rs:fishing_spot_lure_bait', position: { x: 3238, y: 3244, level: 0 } });
        const netSpot = fishingSpot({ id: 'npc:net-bait', key: 'rs:fishing_spot_net_bait', position: { x: 3239, y: 3244, level: 0 } });
        const task = makeStarterFishing5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [],
            perceptions: [perception({ inventory: [item(303, 'rs:small_fishing_net')], npcs: [lureSpot, netSpot] })],
            events: [{ kind: 'item_received', item: item(317, 'rs:raw_shrimp') }],
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ id: 'npc:net-bait' }) }));
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
        },
        events: overrides.events || [],
    };
}

function fishingSpot(
    overrides: { id?: string; key?: string; position?: { x: number; y: number; level: number } } = {},
): Record<string, unknown> {
    return {
        id: overrides.id || 'npc:316',
        kind: 'npc',
        key: overrides.key || 'rs:fishing_spot_net_bait',
        name: 'Fishing spot',
        position: overrides.position || { x: 3239, y: 3244, level: 0 },
        hpFraction: 1,
    };
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
        resident: 'res:bmk_fish',
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
