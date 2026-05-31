import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeLowHealthCookEatReengage5mBenchmarkTask, verifyLowHealthCookEatReengage5m } from './low-health-cook-eat-reengage-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('makeLowHealthCookEatReengage5mBenchmarkTask', () => {
    it('starts a disposable survivor at low HP with raw fish and firemaking tools', () => {
        expect(makeLowHealthCookEatReengage5mBenchmarkTask().resident).toMatchObject({
            spawnPosition: { x: 3222, y: 3218, level: 0 },
            initialInventory: [{ itemId: 317 }, { itemId: 590 }, { itemId: 1511 }, { itemId: 1351 }],
            initialSkills: { hitpoints: { exp: 1154, level: 3 } },
        });
    });

    it('post-connect setup ensures raw fish and tools are actually present in live inventory', async () => {
        const ensureInventoryItem = jest.fn(async () => undefined);
        const task = makeLowHealthCookEatReengage5mBenchmarkTask();
        const context = taskContext({
            submitAction: jest.fn(),
            ensureInventoryItem,
            actionAttempts: [],
            perceptions: [],
            events: [],
        });

        await task.setup?.(context);

        expect(ensureInventoryItem).toHaveBeenCalledWith({ itemId: 317 }, 1);
        expect(ensureInventoryItem).toHaveBeenCalledWith({ itemId: 590 }, 1);
        expect(ensureInventoryItem).toHaveBeenCalledWith({ itemId: 1511 }, 1);
        expect(ensureInventoryItem).toHaveBeenCalledWith({ itemId: 1351 }, 1);
        expect(context.recordSummary).toHaveBeenCalledWith(expect.stringContaining('Ensured raw fish and cooking tools'));
    });

    it('autonomous mode observes selected-module recovery and safe reengage without scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeLowHealthCookEatReengage5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'use_item_on', itemSlot: 0, target: fire(), cause: 'low_health_cook_food' }, STANDARD_MODULE),
                attempt({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' }, STANDARD_MODULE),
                attempt({ kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    objects: [fire()],
                    npcs: [safeNpc('Man')],
                }),
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(315, 'rs:shrimp')],
                    objects: [fire()],
                    npcs: [safeNpc('Man')],
                    skills: { cooking: { xp: 30 } },
                }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man')] }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man', 0.5)] }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
        expect(outcome?.metrics).toMatchObject({
            lowHealthStartObserved: 1,
            rawFishInitiallyCarried: 1,
            successfulCookingActions: 1,
            eatActions: 1,
            hpImprovedAfterEat: 1,
            safeReengageAttacks: 1,
            recoveryChain: 1,
        });
    });

    it('autonomous mode does not count thinking-only attack proposals as safe reengage', async () => {
        const submitAction = jest.fn();
        const abortController = new AbortController();
        abortController.abort();
        const task = makeLowHealthCookEatReengage5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            signal: abortController.signal,
            submitAction,
            actionAttempts: [
                attempt(
                    { kind: 'use_item_on', itemSlot: 0, target: fire(), cause: 'low_health_cook_food' },
                    STANDARD_MODULE,
                    { ok: true },
                    'success',
                    'body',
                ),
                attempt(
                    { kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' },
                    STANDARD_MODULE,
                    { ok: true },
                    'success',
                    'nervous-system',
                ),
                attempt(
                    { kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' },
                    STANDARD_MODULE,
                    { ok: true },
                    undefined,
                    'thinking',
                ),
                attempt(
                    { kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' },
                    STANDARD_MODULE,
                    { ok: true },
                    'timeout',
                    'body',
                ),
            ],
            perceptions: [
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    objects: [fire()],
                    npcs: [safeNpc('Man')],
                }),
                perception({ hp: { current: 3, max: 10 }, inventory: [item(315, 'rs:shrimp')], objects: [fire()], npcs: [safeNpc('Man')] }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man')] }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(outcome?.status).not.toBe('passed');
        expect(outcome?.metrics?.safeReengageAttacks).toBe(0);
    });
});

describe('verifyLowHealthCookEatReengage5m', () => {
    it('passes when raw fish is cooked, eaten, and followed by a safe attack', () => {
        const outcome = verifyLowHealthCookEatReengage5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'use_item_on_item', itemSlot: 1, targetSlot: 2, cause: 'low_health_make_cooking_fire' }),
                attempt({ kind: 'use_item_on', itemSlot: 0, target: fire(), cause: 'low_health_cook_food' }),
                attempt({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' }),
                attempt({ kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' }),
            ],
            perceptions: [
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp'), item(590, 'rs:tinderbox'), item(1511, 'rs:logs')],
                    npcs: [safeNpc('Man')],
                }),
                perception({ hp: { current: 3, max: 10 }, inventory: [item(315, 'rs:shrimp')], objects: [fire()], npcs: [safeNpc('Man')] }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man')] }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man', 0.4)] }),
            ],
            events: [{ kind: 'hit_dealt', damage: 1, to: safeNpc('Man') }],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.summaries?.[0]).toContain('cooked food, ate it, and reengaged');
    });

    it('fails when the resident attacks before eating the cooked food', () => {
        const outcome = verifyLowHealthCookEatReengage5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'use_item_on', itemSlot: 0, target: fire(), cause: 'low_health_cook_food' }),
                attempt({ kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' }),
            ],
            perceptions: [
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    objects: [fire()],
                    npcs: [safeNpc('Man')],
                }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man')] }),
            ],
            events: [{ kind: 'hit_dealt', damage: 1, to: safeNpc('Man') }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No ordered low-health cook/eat/reengage chain');
        expect(outcome.metrics?.safeReengageAttacks).toBe(0);
    });

    it('accepts raw fish observed after the first connect-time perception race', () => {
        const outcome = verifyLowHealthCookEatReengage5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'use_item_on', itemSlot: 0, target: fire(), cause: 'low_health_cook_food' }),
                attempt({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' }),
                attempt({ kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' }),
            ],
            perceptions: [
                perception({ hp: { current: 3, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man')] }),
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    objects: [fire()],
                    npcs: [safeNpc('Man')],
                }),
                perception({ hp: { current: 3, max: 10 }, inventory: [item(315, 'rs:shrimp')], objects: [fire()], npcs: [safeNpc('Man')] }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [fire()], npcs: [safeNpc('Man')] }),
            ],
            events: [{ kind: 'hit_dealt', damage: 1, to: safeNpc('Man') }],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({
            lowHealthStartObserved: 1,
            rawFishInitiallyCarried: 1,
            recoveryChain: 1,
        });
    });

    it('counts successful range interaction with low-health cook cause as cooking evidence', () => {
        const outcome = verifyLowHealthCookEatReengage5m({
            elapsedMs: 90_000,
            actions: [
                attempt(
                    { kind: 'interact', target: range(), option: 'cook', cause: 'low_health_cook_food' },
                    STANDARD_MODULE,
                    { ok: true },
                    'success',
                ),
                attempt({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' }, STANDARD_MODULE, { ok: true }, 'success'),
                attempt(
                    { kind: 'attack', target: safeNpc('Man'), cause: 'combat_attack_safe_target' },
                    STANDARD_MODULE,
                    { ok: true },
                    'success',
                ),
            ],
            perceptions: [
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    objects: [range()],
                    npcs: [safeNpc('Man')],
                }),
                perception({
                    hp: { current: 3, max: 10 },
                    inventory: [item(315, 'rs:shrimp')],
                    objects: [range()],
                    npcs: [safeNpc('Man')],
                }),
                perception({ hp: { current: 6, max: 10 }, inventory: [], objects: [range()], npcs: [safeNpc('Man')] }),
            ],
            events: [{ kind: 'hit_dealt', damage: 1, to: safeNpc('Man') }],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.successfulCookingActions).toBe(1);
    });
});

function attempt(
    action: AgentAction,
    sparkModule?: typeof STANDARD_MODULE,
    result: ActionResult = { ok: true },
    finalStatus?: string,
    source?: string,
): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult; finalStatus?: string; source?: string } {
    return { action, sparkModule, result, finalStatus, source };
}

function perception(overrides: {
    hp: { current: number; max: number };
    inventory?: Array<Record<string, unknown> | null>;
    skills?: Record<string, unknown>;
    npcs?: Array<Record<string, unknown>>;
    objects?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            position: { x: 3222, y: 3218, level: 0 },
            hp: overrides.hp,
            hpFraction: overrides.hp.current / Math.max(1, overrides.hp.max),
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

function safeNpc(name: string, hpFraction = 1): Record<string, unknown> {
    return {
        id: `npc:${name.toLowerCase()}`,
        kind: 'npc',
        key: `rs:${name.toLowerCase().replaceAll(' ', '_')}`,
        name,
        position: { x: 3221, y: 3218, level: 0 },
        hpFraction,
        combatLevel: 2,
    };
}

function fire(): Record<string, unknown> {
    return { objectId: 2732, key: 'rs:fire', name: 'Fire', position: { x: 3222, y: 3218, level: 0 } };
}

function range(): Record<string, unknown> {
    return { objectId: 114, key: 'rs:range', name: 'Range', position: { x: 3221, y: 3218, level: 0 } };
}

function item(itemId: number, key: string): Record<string, unknown> {
    return { itemId, key, amount: 1 };
}

function taskContext(overrides: {
    signal?: AbortSignal;
    submitAction: jest.Mock;
    ensureInventoryItem?: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult; source?: string }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_low_health_cook',
        module: STANDARD_MODULE,
        signal: overrides.signal || new AbortController().signal,
        submitAction: overrides.submitAction,
        ensureInventoryItem: overrides.ensureInventoryItem,
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
