import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { NervousSystem } from './nervous-system';

describe('NervousSystem', () => {
    it('thanks a patron remembered from library without waiting for inference (HD-031)', () => {
        const state = runtimeState(42);
        const system = new NervousSystem({
            soul: soul(),
            state,
            memory: memoryWith(['Patron gift from alice@onion: 10 Shards (you are now acquaintance to them) (2026-05-24 13:33:26)']),
        });

        const reaction = system.react(healthyPerception(42));

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the Shards, alice@onion!',
            cause: 'nervous:patron-memory-acknowledge',
        });
        expect(reaction?.suppressThinking).toBe(true);
        expect(reaction?.interruptThinking).toBe(true);
    });

    it('does not repeat the same remembered patron gift after acknowledging it', () => {
        const state = runtimeState(42);
        const memory = memoryWith(['Patron gift from alice@onion: 10 Shards (2026-05-24 13:33:26)']);
        const system = new NervousSystem({ soul: soul(), state, memory });

        expect(system.react(healthyPerception(42))?.action.kind).toBe('say');

        state.tick = 72;
        const repeated = system.react(healthyPerception(72));

        expect(repeated).toBeUndefined();
    });

    it('briefly throttles patron memory scans after all visible gifts were already acknowledged', () => {
        const state = runtimeState(42);
        const memory = memoryWith(['Patron gift from alice@onion: 10 Shards (2026-05-24 13:33:26)']);
        const system = new NervousSystem({ soul: soul(), state, memory });

        expect(system.react(healthyPerception(42))?.action.kind).toBe('say');
        expect(memory.retrieve).toHaveBeenCalledTimes(1);

        state.tick = 72;
        expect(system.react(healthyPerception(72))).toBeUndefined();
        expect(memory.retrieve).toHaveBeenCalledTimes(2);

        state.tick = 73;
        expect(system.react(healthyPerception(73))).toBeUndefined();
        expect(memory.retrieve).toHaveBeenCalledTimes(2);
    });

    it('collapses a backlog of unacknowledged patron memories into one visible thanks', () => {
        const state = runtimeState(42);
        const memory = memoryWith([
            'Patron gift from alice@onion: 5 Shards (2026-05-24 13:00:00)',
            'Patron gift from bob@onion: 10 Shards (2026-05-24 13:33:26)',
        ]);
        const system = new NervousSystem({ soul: soul(), state, memory });

        const reaction = system.react(healthyPerception(42));

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the Shards, bob@onion, and everyone backing me!',
            cause: 'nervous:patron-memory-acknowledge',
        });

        state.tick = 72;
        expect(system.react(healthyPerception(72))).toBeUndefined();
    });

    it('keeps survival reflexes ahead of patron-memory thanks', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith(['Patron gift from alice@onion: 10 Shards (2026-05-24 13:33:26)']),
        });

        const reaction = system.react({
            tick: 42,
            resident: { hp: { current: 2, max: 10 }, inventory: [{ key: 'shrimp', amount: 1 }] },
            events: [],
        });

        expect(reaction?.action).toEqual({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' });
    });
});

function soul(): Soul {
    return {
        sourcePath: '/tmp/res-agent.md',
        body: '# Test soul',
        frontmatter: {
            name: 'res:agent',
            archetype: 'endurer',
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            behavior: { kind: 'hybrid-agent' },
        },
    };
}

function runtimeState(tick: number): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:agent',
        attention: 100,
        tick,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function memoryWith(memories: string[]): MemoryStore {
    return {
        ensureResident: jest.fn(() => '/tmp/res-agent'),
        retrieve: jest.fn(() => memories),
    } as unknown as MemoryStore;
}

function healthyPerception(tick: number): Record<string, unknown> {
    return {
        tick,
        resident: { hp: { current: 10, max: 10 }, inventory: [] },
        events: [],
    };
}
