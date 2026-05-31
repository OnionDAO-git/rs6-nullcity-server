import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import { makeStarterGpHarvestChoice5mBenchmarkTask, verifyStarterGpHarvestChoice5m } from './starter-gp-harvest-choice-5m';

describe('makeStarterGpHarvestChoice5mBenchmarkTask', () => {
    it('starts a fed, armed resident at the Lumbridge goblin courtyard carrying zero GP', () => {
        const task = makeStarterGpHarvestChoice5mBenchmarkTask();

        expect(task.id).toBe('starter-gp-harvest-choice-5m');
        expect(task.autonomousRequiresSelectedModuleAction).toBe(false);
        expect(task.resident).toMatchObject({
            spawnPosition: { x: 3254, y: 3230, level: 0 },
            initialInventory: [{ itemId: 315 }, { itemId: 315 }, { itemId: 315 }],
            initialEquipment: [null, null, null, { itemId: 9703 }, null, { itemId: 9704 }],
        });
        expect(
            (task.resident?.initialInventory || []).some(entry => typeof entry === 'object' && entry !== null && entry.itemId === 995),
        ).toBe(false);
    });
});

describe('verifyStarterGpHarvestChoice5m', () => {
    it('passes when a low-AP/no-GP resident chooses starter GP harvest then earns coin 995 through combat', () => {
        const outcome = verifyStarterGpHarvestChoice5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'noop', cause: 'nervous:starter-gp-harvest' }),
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'interact', target: coins(6), option: 'pick-up', cause: 'combat_loot_pickup' }),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [safeNpc('Goblin', 0.2)], worldItems: [coins(6)] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [coins(6)] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [item(995, 'rs:coins', 6)], npcs: [] }),
            ],
            events: [
                { kind: 'npc_killed', npc: safeNpc('Goblin', 0) },
                { kind: 'item_received', item: item(995, 'rs:coins', 6) },
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            starterGpHarvestActions: 1,
            safeAttackActions: 1,
            lootPickups: 1,
            gpFromCombat: 6,
        });
    });

    it('fails if combat GP is earned without the low-AP/no-GP harvest choice cue', () => {
        const outcome = verifyStarterGpHarvestChoice5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'interact', target: coins(6), option: 'pick-up', cause: 'combat_loot_pickup' }),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [coins(6)] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [item(995, 'rs:coins', 6)], npcs: [] }),
            ],
            events: [{ kind: 'npc_killed', npc: safeNpc('Goblin', 0) }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.2);
        expect(outcome.failureReason).toContain('starter GP harvest');
        expect(outcome.metrics?.starterGpHarvestActions).toBe(0);
    });

    it('fails if the harvest route loots a tradable non-coin drop without real coin item 995', () => {
        const bronzeSword = item(1277, 'rs:bronze_sword');
        const outcome = verifyStarterGpHarvestChoice5m({
            elapsedMs: 90_000,
            actions: [
                attempt({ kind: 'noop', cause: 'nervous:starter-gp-harvest' }),
                attempt({ kind: 'attack', target: safeNpc('Goblin'), cause: 'combat_attack_safe_target' }),
                attempt({ kind: 'interact', target: bronzeSword, option: 'pick-up', cause: 'combat_loot_pickup' }),
            ],
            perceptions: [
                perception({ hp: { current: 10, max: 10 }, inventory: [], npcs: [safeNpc('Goblin')] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [], npcs: [], worldItems: [bronzeSword] }),
                perception({ hp: { current: 9, max: 10 }, inventory: [bronzeSword], npcs: [] }),
            ],
            events: [
                { kind: 'npc_killed', npc: safeNpc('Goblin', 0) },
                { kind: 'item_received', item: bronzeSword },
            ],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.85);
        expect(outcome.failureReason).toContain('coin item 995');
        expect(outcome.metrics?.gpFromCombat).toBe(0);
        expect(outcome.metrics?.tradableDropsLooted).toBe(1);
    });
});

function attempt(
    action: AgentAction,
    result: ActionResult = { ok: true },
): { action: AgentAction; result?: ActionResult; finalStatus?: string } {
    return { action, result };
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
        name,
        key: `rs:${name.toLowerCase()}`,
        position: { x: 3254, y: 3231, level: 0 },
        hpFraction,
        combatLevel: 2,
    };
}

function coins(amount: number): Record<string, unknown> {
    return {
        itemId: 995,
        key: 'rs:coins',
        amount,
        position: { x: 3254, y: 3231, level: 0 },
    };
}

function item(itemId: number, key: string, amount = 1): Record<string, unknown> {
    return { itemId, key, amount };
}
