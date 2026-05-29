import type { AgentAction, Perception } from '../../transport/message-codecs';
import {
    AP_GP_LIBRARY_STRATEGY_5M_TASK_ID,
    makeApGpLibraryStrategy5mBenchmarkTask,
    verifyApGpLibraryStrategy5m,
} from './ap-gp-library-strategy-5m';

describe('ap-gp-library-strategy-5m benchmark task', () => {
    it('passes when practical AP/GP-first behavior appears with visible GP evidence and strategy narration', () => {
        const outcome = verifyApGpLibraryStrategy5m({
            elapsedMs: 45_000,
            actions: [
                attempt({ kind: 'interact', option: 'pick-up', target: coinWorldItem(25), cause: 'opportunistic_pickup' }),
                attempt({
                    kind: 'say',
                    text: 'AP first, then GP. Next: collect visible coins and write this route into the Library.',
                    cause: 'presence_beacon',
                }),
            ],
            perceptions: [
                perception({ attention: 6, inventory: [], worldItems: [coinWorldItem(25)] }),
                perception({ attention: 6, inventory: [coinItem(25)], worldItems: [] }),
            ],
        });

        expect(outcome).toMatchObject({
            status: 'passed',
            score: 1,
            metrics: {
                lowAttentionObserved: 1,
                coinGroundObserved: 1,
                coinPickupActions: 1,
                practicalStrategySayActions: 1,
            },
        });
    });

    it('fails when a practical AP/GP strategy line is never narrated', () => {
        const outcome = verifyApGpLibraryStrategy5m({
            elapsedMs: 45_000,
            actions: [attempt({ kind: 'interact', option: 'pick-up', target: coinWorldItem(25), cause: 'opportunistic_pickup' })],
            perceptions: [
                perception({ attention: 6, inventory: [], worldItems: [coinWorldItem(25)] }),
                perception({ attention: 6, inventory: [coinItem(25)], worldItems: [] }),
            ],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('strategy');
        expect(outcome.metrics).toMatchObject({ coinPickupActions: 1, practicalStrategySayActions: 0 });
    });

    it('seeds starter coins only for setup drop and still supports autonomous strategy verification', () => {
        const task = makeApGpLibraryStrategy5mBenchmarkTask(() => 0);

        expect(task.id).toBe(AP_GP_LIBRARY_STRATEGY_5M_TASK_ID);
        expect(task.resident?.initialInventory).toEqual([{ itemId: 995, amount: 25 }]);
        expect(task.runAutonomous).toBeDefined();
    });
});

function attempt(action: AgentAction, finalStatus = 'success') {
    return { action, finalStatus };
}

function perception(input: {
    attention: number;
    inventory?: Array<Record<string, unknown>>;
    worldItems?: Array<Record<string, unknown>>;
}): Perception {
    return {
        resident: {
            attention: input.attention,
            inventory: input.inventory || [],
            position: { x: 3225, y: 3230, level: 0 },
        },
        nearby: {
            worldItems: input.worldItems || [],
        },
        events: [],
    };
}

function coinItem(amount = 25): Record<string, unknown> {
    return { itemId: 995, key: 'rs:coins', amount };
}

function coinWorldItem(amount = 25): Record<string, unknown> {
    return { ...coinItem(amount), position: { x: 3225, y: 3230, level: 0 } };
}
