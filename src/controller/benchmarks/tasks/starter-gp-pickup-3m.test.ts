import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import { STARTER_GP_PICKUP_3M_TASK_ID, makeStarterGpPickup3mBenchmarkTask, verifyStarterGpPickup3m } from './starter-gp-pickup-3m';

describe('starter-gp-pickup-3m benchmark task', () => {
    it('passes when a resident picks up real coin item 995 from the ground', () => {
        const outcome = verifyStarterGpPickup3m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'interact', option: 'pick-up', target: coinWorldItem(), cause: 'opportunistic_pickup' })],
            perceptions: [
                perception({ inventory: [], worldItems: [coinWorldItem(25)] }),
                perception({ inventory: [coinItem(25)], worldItems: [] }),
            ],
            events: [{ kind: 'item_received', item: coinItem(25) }],
        });

        expect(outcome).toMatchObject({
            status: 'passed',
            score: 1,
            metrics: {
                coinItemId: 995,
                coinGroundObserved: 1,
                coinPickupActions: 1,
                successfulCoinPickupActions: 1,
                gpGainedFromGround: 1,
                gpObservedAmount: 25,
            },
        });
    });

    it('does not pass when GP only exists in starting inventory', () => {
        const outcome = verifyStarterGpPickup3m({
            elapsedMs: 12_000,
            actions: [],
            perceptions: [perception({ inventory: [coinItem(25)], worldItems: [] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No coin pickup action');
        expect(outcome.metrics).toMatchObject({ gpObservedAmount: 25, gpGainedFromGround: 0 });
    });

    it('describes a resident that starts with coins only to seed a zero-to-GP pickup proof', () => {
        const task = makeStarterGpPickup3mBenchmarkTask(() => 0);

        expect(task.id).toBe(STARTER_GP_PICKUP_3M_TASK_ID);
        expect(task.resident?.initialInventory).toEqual([{ itemId: 995, amount: 25 }]);
        expect(task.runAutonomous).toBeDefined();
    });
});

function attempt(action: AgentAction, finalStatus = 'success') {
    return { action, finalStatus };
}

function perception(input: {
    inventory?: Array<Record<string, unknown>>;
    worldItems?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        resident: {
            inventory: input.inventory || [],
            position: { x: 3225, y: 3230, level: 0 },
        },
        nearby: {
            worldItems: input.worldItems || [],
        },
        events: input.events || [],
    };
}

function coinItem(amount = 25): Record<string, unknown> {
    return { itemId: 995, key: 'rs:coins', amount };
}

function coinWorldItem(amount = 25): Record<string, unknown> {
    return { ...coinItem(amount), position: { x: 3225, y: 3230, level: 0 } };
}
