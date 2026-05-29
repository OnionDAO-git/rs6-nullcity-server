import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeStarterMining5mBenchmarkTask, verifyStarterMining5m } from './starter-mining-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyStarterMining5m', () => {
    it('passes when the resident mines a starter rock and gains ore', () => {
        const outcome = verifyStarterMining5m({
            elapsedMs: 36_000,
            actions: [attempt({ kind: 'interact', target: copperRock(), option: 'mine', cause: 'starter_mining_routine' })],
            perceptions: [
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [copperRock()] }),
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe'), item(436, 'rs:copper_ore')], objects: [copperRock()] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.mineActions).toBe(1);
        expect(outcome.metrics?.oreGained).toBe(1);
    });

    it('passes when mining XP increases after mining a starter rock', () => {
        const outcome = verifyStarterMining5m({
            elapsedMs: 42_000,
            actions: [attempt({ kind: 'interact', target: tinRock(), option: 'mine' })],
            perceptions: [
                perception({
                    inventory: [item(1265, 'rs:bronze_pickaxe')],
                    objects: [tinRock()],
                    skills: { mining: { xp: 0 } },
                }),
                perception({
                    inventory: [item(1265, 'rs:bronze_pickaxe')],
                    objects: [tinRock()],
                    skills: { mining: { xp: 17.5 } },
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.miningXpIncreased).toBe(1);
    });

    it('does not pass when ore appears from pickup instead of mining', () => {
        const outcome = verifyStarterMining5m({
            elapsedMs: 24_000,
            actions: [
                attempt({ kind: 'interact', target: copperRock(), option: 'mine' }),
                attempt({
                    kind: 'interact',
                    target: { itemId: 436, key: 'rs:copper_ore', amount: 1, position: { x: 3227, y: 3148, level: 0 } },
                    option: 'pick up',
                }),
            ],
            perceptions: [
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [copperRock()] }),
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe'), item(436, 'rs:copper_ore')], objects: [copperRock()] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.externalOreSupplyActions).toBe(1);
        expect(outcome.failureReason).toContain('externally supplied');
    });

    it('fails clearly when no mine action was attempted', () => {
        const outcome = verifyStarterMining5m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'say', text: 'I should go mining.' })],
            perceptions: [perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [copperRock()] })],
            events: [{ kind: 'item_received', item: item(436, 'rs:copper_ore') }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No mine action');
    });

    it('does not pass when the selected module mine attempt was rejected', () => {
        const outcome = verifyStarterMining5m({
            elapsedMs: 24_000,
            actions: [attempt({ kind: 'interact', target: copperRock(), option: 'mine' }, STANDARD_MODULE, { ok: false })],
            perceptions: [
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [copperRock()], skills: { mining: { xp: 0 } } }),
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [copperRock()], skills: { mining: { xp: 17.5 } } }),
            ],
            events: [{ kind: 'item_received', item: item(436, 'rs:copper_ore') }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.successfulMineActions).toBe(0);
        expect(outcome.failureReason).toContain('No successful mine action');
    });

    it('autonomous mode observes selected-module mining evidence without submitting scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeStarterMining5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'interact', target: copperRock(), option: 'mine', cause: 'starter_mining_routine' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [copperRock()] }),
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe'), item(436, 'rs:copper_ore')], objects: [copperRock()] }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });

    it('scripted mode submits the live perceived starter rock', async () => {
        const submitAction = jest.fn();
        const liveRock = tinRock({ objectId: 2095, position: { x: 3228, y: 3147, level: 0 } });
        const task = makeStarterMining5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [],
            perceptions: [
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe')], objects: [liveRock] }),
                perception({ inventory: [item(1265, 'rs:bronze_pickaxe'), item(438, 'rs:tin_ore')], objects: [liveRock] }),
            ],
            events: [],
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ objectId: 2095 }) }));
    });

    it('scripted mode prefers the nearest starter rock when perception lists a farther rock first', async () => {
        const submitAction = jest.fn();
        const farRock = tinRock({ objectId: 11934, position: { x: 3222, y: 3147, level: 0 } });
        const adjacentRock = copperRock({ objectId: 11936, position: { x: 3228, y: 3144, level: 0 } });
        const task = makeStarterMining5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [],
            perceptions: [
                perception({
                    position: { x: 3228, y: 3145, level: 0 },
                    inventory: [item(1265, 'rs:bronze_pickaxe')],
                    objects: [farRock, adjacentRock],
                }),
                perception({
                    position: { x: 3228, y: 3145, level: 0 },
                    inventory: [item(1265, 'rs:bronze_pickaxe'), item(436, 'rs:copper_ore')],
                    objects: [farRock, adjacentRock],
                }),
            ],
            events: [],
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ objectId: 11936 }) }));
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
    objects?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            position: overrides.position || { x: 3227, y: 3147, level: 0 },
            inventory: overrides.inventory || [],
            ...(overrides.skills ? { skills: overrides.skills } : {}),
        },
        nearby: {
            objects: overrides.objects || [],
        },
        events: overrides.events || [],
    };
}

function copperRock(overrides: { objectId?: number; position?: { x: number; y: number; level: number } } = {}): Record<string, unknown> {
    return {
        objectId: overrides.objectId || 2090,
        position: overrides.position || { x: 3227, y: 3148, level: 0 },
    };
}

function tinRock(overrides: { objectId?: number; position?: { x: number; y: number; level: number } } = {}): Record<string, unknown> {
    return {
        objectId: overrides.objectId || 2094,
        position: overrides.position || { x: 3228, y: 3148, level: 0 },
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
        resident: 'res:bmk_mine',
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
