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
            text: 'Thank you for the AP, alice@onion!',
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
            text: 'Thank you for the AP, bob@onion, and everyone backing me!',
            cause: 'nervous:patron-memory-acknowledge',
        });

        state.tick = 72;
        expect(system.react(healthyPerception(72))).toBeUndefined();
    });

    it('uses runtime tick cooldowns when perception ticks restart after controller restart', () => {
        const state = runtimeState(150_772);
        state.hookCooldowns = {
            'patron-memory-acknowledge:any': 110_096,
            'patron-memory-acknowledge:scan': 136_301,
        };
        const system = new NervousSystem({
            soul: soul(),
            state,
            memory: memoryWith([
                'Patron gift from codex-live-mcp-1779728689@onion: 10 Shards (you are now acquaintance to them) (2026-05-25 17:05:10)',
            ]),
        });

        const reaction = system.react(healthyPerception(33_300));

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the AP, codex-live-mcp-1779728689@onion!',
            cause: 'nervous:patron-memory-acknowledge',
        });
    });

    it('expires short old-domain patron cooldowns left just ahead of restored state tick', () => {
        const state = runtimeState(150_772);
        state.hookCooldowns = {
            'patron-memory-acknowledge:any': 150_776,
        };
        const system = new NervousSystem({
            soul: soul(),
            state,
            memory: memoryWith(['Patron gift from fresh-live@onion: 10 Shards (2026-05-25 17:09:04)']),
        });

        const reaction = system.react(healthyPerception(33_300));

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the AP, fresh-live@onion!',
            cause: 'nervous:patron-memory-acknowledge',
        });
    });

    it('expires new patron-memory cooldowns in the active perception tick domain after restart', () => {
        const state = runtimeState(150_772);
        state.hookCooldowns = {
            'patron-memory-acknowledge:any': 110_096,
        };
        const memories = [
            'Patron gift from old-live@onion: 10 Shards (2026-05-25 17:05:10)',
            'Patron gift from fresh-live@onion: 10 Shards (2026-05-25 17:09:04)',
        ];
        const memory = memoryWith([memories[0]]);
        const system = new NervousSystem({ soul: soul(), state, memory });

        expect(system.react(healthyPerception(33_300))?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the AP, old-live@onion!',
            cause: 'nervous:patron-memory-acknowledge',
        });

        (memory.retrieve as jest.Mock).mockReturnValue(memories);
        const later = system.react(healthyPerception(33_331));

        expect(later?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the AP, fresh-live@onion!',
            cause: 'nervous:patron-memory-acknowledge',
        });
    });

    it('thanks a patron whose library memory uses AP format (S0a forward-compat)', () => {
        const state = runtimeState(42);
        const system = new NervousSystem({
            soul: soul(),
            state,
            memory: memoryWith(['Patron gift from alice@onion: 10 AP (you are now acquaintance to them) (2026-05-30 10:00:00)']),
        });

        const reaction = system.react(healthyPerception(42));

        expect(reaction?.action).toEqual({
            kind: 'say',
            text: 'Thank you for the AP, alice@onion!',
            cause: 'nervous:patron-memory-acknowledge',
        });
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

    it('does not treat raw starter fish as edible emergency food', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith([]),
        });

        const reaction = system.react({
            tick: 42,
            resident: {
                hp: { current: 2, max: 10 },
                inventory: [
                    { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                    { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    { itemId: 321, key: 'rs:raw_anchovies', amount: 1 },
                ],
            },
            events: [],
        });

        expect(reaction).toBeUndefined();
    });

    it('still treats cooked starter fish as edible emergency food', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith([]),
        });

        const reaction = system.react({
            tick: 42,
            resident: {
                hp: { current: 2, max: 10 },
                inventory: [
                    { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                    { itemId: 315, key: 'rs:shrimps', amount: 1 },
                ],
            },
            events: [],
        });

        expect(reaction?.action).toEqual({ kind: 'eat', slot: 1, cause: 'nervous:eat-when-low-health' });
    });

    it('skips raw fish and eats a later cooked fish slot', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith([]),
        });

        const reaction = system.react({
            tick: 42,
            resident: {
                hp: { current: 2, max: 10 },
                inventory: [
                    { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    { itemId: 315, key: 'rs:shrimps', amount: 1 },
                ],
            },
            events: [],
        });

        expect(reaction?.action).toEqual({ kind: 'eat', slot: 1, cause: 'nervous:eat-when-low-health' });
    });

    it('does not treat generic raw fish as edible emergency food', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith([]),
        });

        const reaction = system.react({
            tick: 42,
            resident: {
                hp: { current: 2, max: 10 },
                inventory: [{ itemId: 327, key: 'rs:raw_sardine', amount: 1 }],
            },
            events: [],
        });

        expect(reaction?.action?.cause).not.toBe('nervous:eat-when-low-health');
    });

    it('does not treat burnt food as edible emergency food', () => {
        const system = new NervousSystem({
            soul: soul(),
            state: runtimeState(42),
            memory: memoryWith([]),
        });

        const reaction = system.react({
            tick: 42,
            resident: {
                hp: { current: 2, max: 10 },
                inventory: [{ itemId: 7954, key: 'rs:burnt_shrimp', amount: 1 }],
            },
            events: [],
        });

        expect(reaction?.action?.cause).not.toBe('nervous:eat-when-low-health');
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
        it('acknowledges AP top-up events with a visible resume line', () => {
            const state = runtimeState(42);
            state.attention = 3000;
            const sys = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(42),
                events: [{ kind: 'attention_topup', amount: 3000, attentionAfter: 3000 }],
            });

            expect(reaction?.action).toMatchObject({
                kind: 'say',
                cause: 'nervous:attention-topup-resume',
            });
            expect((reaction?.action as { text?: string })?.text).toMatch(/AP|resum/i);
            expect(reaction?.suppressThinking).toBe(false);
        });

        it('appeals for attention when attention is below floor + buffer', () => {
            const state = runtimeState(100);
            state.attention = 4000;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).toBe('nervous:request-attention');
            expect(reaction?.action?.kind).toBe('say');
        });

        it('self-initiates AP-for-GP before asking humans when low AP and holding coins', () => {
            const state = runtimeState(100);
            state.attention = 5015;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(100),
                resident: { hp: { current: 10, max: 10 }, inventory: [{ itemId: 995, amount: 100 }] },
            });

            expect(reaction?.rule.id).toBe('self-initiated-ap-gp-exchange');
            expect(reaction?.action).toEqual({
                kind: 'city_exchange_ap_gp',
                cause: 'nervous:self-initiated-ap-gp-exchange',
                gpAmount: 100,
                apAmount: 200,
                idempotencyKey: 'self-ap-gp:res:hans:100',
            });
            expect(reaction?.suppressThinking).toBe(true);
            expect(reaction?.interruptThinking).toBe(true);
        });

        it('falls back to asking humans when low AP but no coins are held', () => {
            const state = runtimeState(100);
            state.attention = 5015;
            state.hookCooldowns!['prepare-epitaph:written'] = Number.MAX_SAFE_INTEGER;
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

        it('does not repeat a newly written appeal cooldown when perception ticks restart below state tick', () => {
            const state = runtimeState(150_772);
            state.attention = 4000;
            const sys = new NervousSystem({ soul: heroSoulWithName('Hans', 5000), state, memory: memoryWith([]) });

            const first = sys.react(healthyPerception(33_300));
            expect(first?.action?.cause).toBe('nervous:request-attention');

            const second = sys.react(healthyPerception(33_301));
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

        it('appeals for residents without a declared attention floor when AP is critically low', () => {
            const state = runtimeState(100);
            state.attention = 10;
            const sys = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).toBe('nervous:request-attention');
            expect((reaction?.action as { text?: string }).text).toContain('AP');
        });

        it('does not appeal for residents without a declared attention floor while AP is above the critical threshold', () => {
            const state = runtimeState(100);
            state.attention = 11;
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

    describe('prepareEpitaphReaction (M4)', () => {
        it('fires when attention is within the final-testament buffer of the floor', () => {
            const state = runtimeState(100);
            state.attention = 5050; // floor=5000, buffer=200 → threshold=5200; 5050 < 5200
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).toBe('nervous:prepare-epitaph');
            expect(reaction?.action?.kind).toBe('say');
        });

        it('does not fire when attention is above the final-testament threshold', () => {
            const state = runtimeState(100);
            state.attention = 5300; // 5300 >= floor(5000) + buffer(200) = 5200
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:prepare-epitaph');
        });

        it('does not fire for residents without a declared attention floor', () => {
            const state = runtimeState(100);
            state.attention = 50;
            const sys = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:prepare-epitaph');
        });

        it('does not fire a second time once the one-time cooldown is set', () => {
            const state = runtimeState(100);
            state.attention = 5050;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const first = sys.react(healthyPerception(100));
            expect(first?.action?.cause).toBe('nervous:prepare-epitaph');

            state.tick = 200;
            const second = sys.react(healthyPerception(200));
            expect(second?.action?.cause).not.toBe('nervous:prepare-epitaph');
        });

        it('does not repeat a newly written epitaph cooldown when perception ticks restart below state tick', () => {
            const state = runtimeState(150_772);
            state.attention = 5050;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const first = sys.react(healthyPerception(33_300));
            expect(first?.action?.cause).toBe('nervous:prepare-epitaph');

            const second = sys.react(healthyPerception(33_301));
            expect(second?.action?.cause).not.toBe('nervous:prepare-epitaph');
        });

        it('writes prepared-epitaph.txt to memory when the testament fires', () => {
            const writeFunc = jest.fn();
            const mem = { ...memoryWith([]), write: writeFunc } as unknown as MemoryStore;
            const state = runtimeState(100);
            state.attention = 5050;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: mem });

            sys.react(healthyPerception(100));

            expect(writeFunc).toHaveBeenCalledWith('res:hans', 'prepared-epitaph.txt', expect.stringContaining('my'), 'replace');
        });

        it('prefixes the message with the hero public name', () => {
            const state = runtimeState(100);
            state.attention = 5050;
            const sys = new NervousSystem({ soul: heroSoulWithName('Hans', 5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));
            const text = (reaction?.action as { kind: string; text?: string }).text ?? '';
            expect(text.startsWith('Hans:')).toBe(true);
        });

        it('fires before the requestAttention appeal (lower attention still triggers testament first)', () => {
            // attention=5050 is also < floor+buffer(5200) AND < floor+requestBuffer(10000)
            // prepare_epitaph should take precedence because it runs first in react()
            const state = runtimeState(100);
            state.attention = 5050;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).toBe('nervous:prepare-epitaph');
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
