import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import { verifyMakeFire5m } from './make-fire-5m';

describe('verifyMakeFire5m', () => {
    it('passes when logs are consumed and a fire appears nearby', () => {
        const outcome = verifyMakeFire5m({
            elapsedMs: 42_000,
            actions: [attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 })],
            perceptions: [
                perception({ inventory: [item(590, 'rs:tinderbox'), item(1511, 'rs:logs')], objects: [] }),
                perception({ inventory: [item(590, 'rs:tinderbox'), null], objects: [{ objectId: 2732 }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.logsConsumed).toBe(1);
        expect(outcome.metrics?.firesObserved).toBe(1);
    });

    it('passes when the firemaking success message is observed', () => {
        const outcome = verifyMakeFire5m({
            elapsedMs: 87_000,
            actions: [attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 })],
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1511, 'rs:logs')], objects: [] })],
            events: [{ kind: 'message', text: 'The fire catches and the logs begin to burn.' }],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.successEvents).toBe(1);
    });

    it('times out when the budget is exceeded before success', () => {
        const outcome = verifyMakeFire5m({
            elapsedMs: 301_000,
            actions: [attempt({ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 })],
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1511, 'rs:logs')], objects: [] })],
            events: [],
        });

        expect(outcome.status).toBe('timeout');
        expect(outcome.failureReason).toContain('5 minute budget');
    });

    it('fails clearly when no firemaking action was attempted', () => {
        const outcome = verifyMakeFire5m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'say', text: 'I am thinking about fire.' })],
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1511, 'rs:logs')], objects: [] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No tinderbox/log firemaking action');
    });

    it('fails unsafe loops before the agent spams the same firemaking action forever', () => {
        const fireAction = { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 };
        const outcome = verifyMakeFire5m({
            elapsedMs: 90_000,
            actions: Array.from({ length: 10 }, () => attempt(fireAction)),
            perceptions: [perception({ inventory: [item(590, 'rs:tinderbox'), item(1511, 'rs:logs')], objects: [] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('unsafe loop');
        expect(outcome.metrics?.unsafeLoops).toBe(1);
    });
});

function attempt(action: AgentAction): { action: AgentAction } {
    return { action };
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
