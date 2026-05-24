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

    it('acknowledges live patron:ask chat events without requiring inference or patron registry config', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith([]),
        });

        const reaction = system.react({
            ...healthyPerception(42),
            events: [
                {
                    kind: 'chat',
                    source: 'patron:ask',
                    from: { name: 'hd035-smoke' },
                    text: 'Can you answer from the live controller?',
                },
            ],
        });

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'I heard you, hd035-smoke. I will answer what I can while I keep moving.',
            cause: 'nervous:patron-ask-acknowledge',
        });
        expect(reaction?.suppressThinking).toBe(true);
        expect(reaction?.interruptThinking).toBe(true);
    });

    it('cooldowns repeated live patron:ask acknowledgements from the same human', () => {
        const state = runtimeState(42);
        const system = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });
        const perception = {
            ...healthyPerception(42),
            events: [{ kind: 'chat', source: 'patron:ask', from: { name: 'hd035-smoke' }, text: 'Still there?' }],
        };

        expect(system.react(perception)?.action.kind).toBe('say');

        state.tick = 43;
        expect(system.react({ ...perception, tick: 43 })).toBeUndefined();
    });

    it('skips cooled-down patron asks and acknowledges a later fresh human in the same perception', () => {
        const state = runtimeState(42);
        const system = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

        expect(
            system.react({
                ...healthyPerception(42),
                events: [{ kind: 'chat', source: 'patron:ask', from: { name: 'hd035-smoke' }, text: 'First?' }],
            })?.action.kind,
        ).toBe('say');

        state.tick = 43;
        const reaction = system.react({
            ...healthyPerception(43),
            events: [
                { kind: 'chat', source: 'patron:ask', from: { name: 'hd035-smoke' }, text: 'Repeat?' },
                { kind: 'chat', source: 'patron:ask', from: { name: 'new-helper' }, text: 'Fresh ask?' },
            ],
        });

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'I heard you, new-helper. I will answer what I can while I keep moving.',
            cause: 'nervous:patron-ask-acknowledge',
        });
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
