import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import {
    makeCooksAssistantVisibleIngredients5mBenchmarkTask,
    verifyCooksAssistantVisibleIngredients5m,
} from './cooks-assistant-visible-ingredients-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyCooksAssistantVisibleIngredients5m', () => {
    it('passes when the selected module picks visible ingredients back up and completes Cook Assistant', () => {
        const outcome = verifyCooksAssistantVisibleIngredients5m({
            elapsedMs: 140_000,
            actions: [
                { action: { kind: 'drop', slot: 0, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' } },
                { action: { kind: 'drop', slot: 1, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' } },
                { action: { kind: 'drop', slot: 2, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' } },
                {
                    action: { kind: 'interact', target: groundItem(1927), option: 'pick-up', cause: 'cooks_assistant_pickup_ingredient' },
                    sparkModule: STANDARD_MODULE,
                },
                {
                    action: { kind: 'interact', target: groundItem(1933), option: 'pick-up', cause: 'cooks_assistant_pickup_ingredient' },
                    sparkModule: STANDARD_MODULE,
                },
                {
                    action: { kind: 'interact', target: groundItem(1944), option: 'pick-up', cause: 'cooks_assistant_pickup_ingredient' },
                    sparkModule: STANDARD_MODULE,
                },
                {
                    action: { kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_hand_in_ingredients' },
                    sparkModule: STANDARD_MODULE,
                },
            ],
            perceptions: [
                perception({ inventory: [item(1927), item(1933), item(1944)] }),
                perception({ inventory: [], worldItems: [groundItem(1927), groundItem(1933), groundItem(1944)] }),
                perception({
                    inventory: [item(1927), item(1933), item(1944)],
                    quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                }),
                perception({
                    inventory: [],
                    quests: { 'rs:cooks_assistant': { progress: 'complete', complete: true } },
                    events: [
                        { kind: 'item_lost', itemId: 1927 },
                        { kind: 'item_lost', itemId: 1933 },
                        { kind: 'item_lost', itemId: 1944 },
                    ],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            setupIngredientDrops: 3,
            ingredientPickupActions: 3,
            ingredientsVisibleOnGround: 3,
            ingredientsCarriedAfterPickup: 3,
            questComplete: 1,
        });
    });

    it('fails clearly when ingredients are visible but no pickup actions happen', () => {
        const outcome = verifyCooksAssistantVisibleIngredients5m({
            elapsedMs: 120_000,
            actions: [
                { action: { kind: 'drop', slot: 0, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' } },
                { action: { kind: 'drop', slot: 1, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' } },
                { action: { kind: 'drop', slot: 2, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' } },
            ],
            perceptions: [
                perception({ inventory: [], worldItems: [groundItem(1927), groundItem(1933), groundItem(1944)] }),
                perception({ inventory: [], worldItems: [groundItem(1927), groundItem(1933), groundItem(1944)] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No selected-module pickup');
        expect(outcome.score).toBeLessThan(1);
    });
});

describe('makeCooksAssistantVisibleIngredients5mBenchmarkTask', () => {
    it('drops seeded ingredients during setup before autonomous observation', async () => {
        const submitted: AgentAction[] = [];
        const task = makeCooksAssistantVisibleIngredients5mBenchmarkTask(() => 1_000);
        const context = fakeContext({
            submitAction: async action => {
                submitted.push(action);
                return { ok: true };
            },
            perceptions: [perception({ inventory: [item(1927), item(1933), item(1944)] })],
            actionAttempts: [
                {
                    action: { kind: 'interact', target: groundItem(1927), option: 'pick-up', cause: 'cooks_assistant_pickup_ingredient' },
                    sparkModule: STANDARD_MODULE,
                },
                {
                    action: { kind: 'interact', target: groundItem(1933), option: 'pick-up', cause: 'cooks_assistant_pickup_ingredient' },
                    sparkModule: STANDARD_MODULE,
                },
                {
                    action: { kind: 'interact', target: groundItem(1944), option: 'pick-up', cause: 'cooks_assistant_pickup_ingredient' },
                    sparkModule: STANDARD_MODULE,
                },
            ],
        });

        await task.setup?.(context);

        expect(task.id).toBe('cooks-assistant-visible-ingredients-5m');
        expect(task.resident?.initialInventory).toEqual([{ itemId: 1927 }, { itemId: 1933 }, { itemId: 1944 }]);
        expect(submitted).toEqual([
            { kind: 'drop', slot: 0, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' },
            { kind: 'drop', slot: 1, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' },
            { kind: 'drop', slot: 2, cause: 'benchmark_seed_cooks_assistant_visible_ingredients' },
        ]);
    });
});

function cook(): Record<string, unknown> {
    return {
        id: 'npc:12',
        kind: 'npc',
        key: 'rs:lumbridge_castle_cook',
        name: 'Cook',
        position: { x: 3207, y: 3215, level: 0 },
    };
}

function item(itemId: number): Record<string, unknown> {
    return { itemId, amount: 1 };
}

function groundItem(itemId: number): Record<string, unknown> {
    return { itemId, amount: 1, position: { x: 3208 + (itemId % 3), y: 3216, level: 0 } };
}

function perception(
    overrides: {
        inventory?: Array<Record<string, unknown>>;
        worldItems?: Array<Record<string, unknown>>;
        quests?: Record<string, { progress: number | string; complete: boolean }>;
        events?: PerceptionEvent[];
    } = {},
): Perception {
    return {
        tick: 1,
        resident: {
            position: { x: 3208, y: 3215, level: 0 },
            inventory: overrides.inventory || [],
            quests: overrides.quests || {},
        },
        nearby: {
            npcs: [cook()],
            worldItems: overrides.worldItems || [],
        },
        events: overrides.events || [],
    };
}

function fakeContext(overrides: {
    submitAction: BenchmarkTaskContext['submitAction'];
    perceptions: Perception[];
    events?: PerceptionEvent[];
    actionAttempts?: Array<{ action: AgentAction; sparkModule?: { id: string; version: string } }>;
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_cooks_visible_ingredients',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: jest.fn(),
        submitPeerAction: jest.fn(),
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts || [],
        latestPerception: () => overrides.perceptions[0],
        perceptions: () => overrides.perceptions,
        events: () => overrides.events || [],
    };
}
