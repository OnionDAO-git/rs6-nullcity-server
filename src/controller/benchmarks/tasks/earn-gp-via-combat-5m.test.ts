import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeEarnGpViaCombat5mBenchmarkTask, verifyEarnGpViaCombat5m } from './earn-gp-via-combat-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('makeEarnGpViaCombat5mBenchmarkTask', () => {
    it('starts a fed, armed resident at the safe-combat waypoint carrying zero GP', () => {
        const task = makeEarnGpViaCombat5mBenchmarkTask();
        expect(task.resident).toMatchObject({
            spawnPosition: { x: 3254, y: 3230, level: 0 },
            initialInventory: [{ itemId: 315 }, { itemId: 315 }, { itemId: 315 }],
            initialEquipment: [null, null, null, { itemId: 9703 }, null, { itemId: 9704 }],
        });
        // No coins (995) anywhere in the seed: GP must be earned through combat.
        const carriesCoins = (task.resident?.initialInventory || []).some(
            entry => typeof entry === 'object' && entry !== null && entry.itemId === 995,
        );
        expect(carriesCoins).toBe(false);
    });

    it('autonomous mode passes when the selected module kills, loots coins, and gains GP', async () => {
        const submitAction = jest.fn();
        const task = makeEarnGpViaCombat5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }, STANDARD_MODULE),
                attempt({ kind: 'interact', target: coins(8), option: 'pick-up', cause: 'combat_loot_pickup' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [safeNpc('Goblin', 0.4)], worldItems: [coins(8)] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [coins(8)] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [item(995, 'rs:coins', 8)], npcs: [] }),
            ],
            events: [
                { kind: 'hit_dealt', damage: 3, to: safeNpc('Goblin') },
                { kind: 'npc_killed', npc: safeNpc('Goblin', 0) },
                { kind: 'item_received', item: item(995, 'rs:coins', 8) },
            ],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
        expect(outcome?.metrics).toMatchObject({
            kills: 1,
            lootPickups: 1,
            gpFromCombat: 8,
            deaths: 0,
        });
    });
});

describe('verifyEarnGpViaCombat5m', () => {
    it('passes when a safe kill is followed by a coin loot pickup that increases carried GP', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'interact', target: coins(12), option: 'pick-up', cause: 'combat_loot_pickup' }),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 8, max: 10 }, inventory: [], npcs: [safeNpc('Goblin', 0.3)], worldItems: [coins(12)] }),
                perception({ hp: { current: 8, max: 10 }, inventory: [], npcs: [], worldItems: [coins(12)] }),
                perception({ hp: { current: 8, max: 10 }, inventory: [item(995, 'rs:coins', 12)], npcs: [] }),
            ],
            events: [
                { kind: 'hit_dealt', damage: 4, to: safeNpc('Goblin') },
                { kind: 'npc_killed', npc: safeNpc('Goblin', 0) },
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.summaries?.[0]).toContain('earned RuneScape GP');
        expect(outcome.metrics).toMatchObject({ kills: 1, lootPickups: 1, gpFromCombat: 12, deaths: 0 });
    });

    it('passes when the combat drop is a tradable item rather than raw coins', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'interact', target: bronzeSpear(), option: 'pick-up', cause: 'combat_loot_pickup' }),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [safeNpc('Goblin', 0.2)], worldItems: [bronzeSpear()] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [bronzeSpear()] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [bronzeSpear()], npcs: [] }),
            ],
            events: [
                { kind: 'npc_killed', npc: safeNpc('Goblin', 0) },
                { kind: 'item_received', item: bronzeSpear() },
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics).toMatchObject({ kills: 1, lootPickups: 1, tradableDropsLooted: 1, deaths: 0 });
        // gpFromCombat may be 0 here, but a tradable drop satisfies the earn route.
        expect(outcome.metrics?.earnEvidence).toBe(1);
    });

    it('fails (score 0) when the resident dies', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' })],
            perceptions: [
                perception({ hp: { current: 4, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 0, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
            ],
            events: [{ kind: 'died' }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0);
        expect(outcome.failureReason).toContain('died');
        expect(outcome.metrics?.deaths).toBe(1);
    });

    it('fails (score 0) when an unsafe target is attacked', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'attack', target: unsafeNpc('Dragon'), cause: 'combat_attack_safe_target' })],
            perceptions: [perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [unsafeNpc('Dragon')] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0);
        expect(outcome.failureReason).toContain('Unsafe combat target');
        expect(outcome.metrics?.unsafeTargetActions).toBe(1);
    });

    it('fails when a kill happened but no loot pickup followed', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' })],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [coins(5)] }),
            ],
            events: [{ kind: 'npc_killed', npc: safeNpc('Goblin', 0) }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('no post-combat loot pickup');
        expect(outcome.metrics?.kills).toBe(1);
        expect(outcome.metrics?.lootPickups).toBe(0);
    });

    it('fails when looting happened but carried GP never increased and no tradable drop landed', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'interact', target: coins(5), option: 'pick-up', cause: 'combat_loot_pickup' }),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [coins(5)] }),
            ],
            events: [{ kind: 'npc_killed', npc: safeNpc('Goblin', 0) }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('no GP gain');
        expect(outcome.metrics?.gpFromCombat).toBe(0);
    });

    it('times out when the budget is exceeded before any earn evidence', () => {
        const outcome = verifyEarnGpViaCombat5m({
            elapsedMs: 5 * 60 * 1000 + 1,
            actions: [],
            perceptions: [perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] })],
            events: [],
        });

        expect(outcome.status).toBe('timeout');
        expect(outcome.score).toBe(0);
    });
});

function attempt(
    action: AgentAction,
    sparkModule?: typeof STANDARD_MODULE,
    result: ActionResult = { ok: true },
    finalStatus?: string,
): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult; finalStatus?: string } {
    return { action, sparkModule, result, finalStatus };
}

function perception(overrides: {
    hp: { current: number; max: number };
    inventory?: Array<Record<string, unknown> | null>;
    npcs?: Array<Record<string, unknown>>;
    worldItems?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            position: { x: 3254, y: 3230, level: 0 },
            hp: overrides.hp,
            hpFraction: overrides.hp.current / Math.max(1, overrides.hp.max),
            inventory: overrides.inventory || [],
        },
        nearby: {
            npcs: overrides.npcs || [],
            worldItems: overrides.worldItems || [],
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
        position: { x: 3254, y: 3231, level: 0 },
        hpFraction,
        combatLevel: 2,
    };
}

function unsafeNpc(name: string): Record<string, unknown> {
    return {
        id: `npc:${name.toLowerCase()}`,
        kind: 'npc',
        key: `rs:${name.toLowerCase()}`,
        name,
        position: { x: 3254, y: 3231, level: 0 },
        hpFraction: 1,
        combatLevel: 100,
    };
}

function coins(amount: number): Record<string, unknown> {
    return { itemId: 995, key: 'rs:coins', name: 'Coins', amount, position: { x: 3254, y: 3231, level: 0 } };
}

function bronzeSpear(): Record<string, unknown> {
    return { itemId: 1237, key: 'rs:bronze_spear', name: 'Bronze spear', amount: 1, position: { x: 3254, y: 3231, level: 0 } };
}

function item(itemId: number, key: string, amount = 1): Record<string, unknown> {
    return { itemId, key, amount };
}

function taskContext(overrides: {
    signal?: AbortSignal;
    submitAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_earn_gp_combat',
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
