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
    describe('requestAttentionReaction (M3)', () => {
        it('appeals for attention when attention is below floor + buffer', () => {
            const state = runtimeState(100);
            state.attention = 4000;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).toBe('nervous:request-attention');
            expect(reaction?.action?.kind).toBe('say');
        });

        it('does not appeal when attention is at or above floor + buffer', () => {
            const state = runtimeState(100);
            state.attention = 10001;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:request-attention');
        });

        it('does not appeal when attention is zero (already exhausted)', () => {
            const state = runtimeState(100);
            state.attention = 0;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:request-attention');
        });

        it('does not repeat the appeal within the cooldown window', () => {
            const state = runtimeState(100);
            state.attention = 4000;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const first = sys.react(healthyPerception(100));
            expect(first?.action?.cause).toBe('nervous:request-attention');

            state.tick = 200;
            const second = sys.react(healthyPerception(200));
            expect(second?.action?.cause).not.toBe('nervous:request-attention');
        });

        it('re-appeals after the cooldown expires', () => {
            const state = runtimeState(100);
            state.attention = 4000;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            sys.react(healthyPerception(100));

            state.tick = 701;
            const later = sys.react(healthyPerception(701));
            expect(later?.action?.cause).toBe('nervous:request-attention');
        });

        it('does not appeal for residents without a declared attention floor', () => {
            const state = runtimeState(100);
            state.attention = 1;
            const sys = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:request-attention');
        });

        it('prefixes the message with the hero public name when available', () => {
            const state = runtimeState(100);
            state.attention = 4000;
            const sys = new NervousSystem({ soul: heroSoulWithName('Hans', 5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));
            const text = (reaction?.action as { kind: string; text?: string; cause?: string }).text ?? '';
            expect(text.startsWith('Hans:')).toBe(true);
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

function soulWithFloor(floor: number): Soul {
    return {
        sourcePath: '/tmp/res-hero.md',
        body: '# Hero soul',
        frontmatter: {
            name: 'res:hans',
            archetype: 'mentor',
            attentionProfile: { startingAttention: 14000, decayCurve: 'standard', floor },
            behavior: { kind: 'hybrid-agent' },
        },
    };
}

function heroSoulWithName(publicName: string, floor: number): Soul {
    return {
        ...soulWithFloor(floor),
        frontmatter: {
            ...soulWithFloor(floor).frontmatter,
            heroProfile: { publicName, tier: 'hero', signatureAction: 'guards the courtyard' },
        },
    };
}

function healthyPerception(tick: number): Record<string, unknown> {
    return {
        tick,
        resident: { hp: { current: 10, max: 10 }, inventory: [] },
        events: [],
    };
}
