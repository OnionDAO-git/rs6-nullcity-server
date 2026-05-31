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
        // S-INFER-4 (A): thanking a remembered patron is NON-URGENT social — the
        // say still fires but must NOT cancel a slow in-flight brain deliberation.
        expect(reaction?.interruptThinking).toBe(false);
    });

    it('does not repeat the same remembered patron gift after acknowledging it', () => {
        const state = runtimeState(42);
        state.attention = 1000;
        const memory = memoryWith(['Patron gift from alice@onion: 10 Shards (2026-05-24 13:33:26)']);
        const system = new NervousSystem({ soul: soul(), state, memory });

        expect(system.react(healthyPerception(42))?.action.kind).toBe('say');

        state.tick = 72;
        const repeated = system.react(healthyPerception(72));

        expect(repeated).toBeUndefined();
    });

    it('briefly throttles patron memory scans after all visible gifts were already acknowledged', () => {
        const state = runtimeState(42);
        state.attention = 1000;
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
        state.attention = 1000;
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
        // S-INFER-4 (A): being addressed by patron chat is NON-URGENT — acknowledge
        // (the say fires) but do NOT abort a 40s brain deliberation in flight.
        expect(reaction?.interruptThinking).toBe(false);
    });

    it('cooldowns repeated live patron:ask acknowledgements from the same human', () => {
        const state = runtimeState(42);
        state.attention = 1000;
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
            // S-INFER-4 (A): a proactive AP-runway top-up is economic, NOT imminent
            // death (it fires well above the floor). The exchange still executes;
            // it just must not cancel an in-flight brain. The true death reflex is
            // requestAttentionReaction, which never interrupted thinking.
            expect(reaction?.interruptThinking).toBe(false);
        });

        it('self-funds no-floor residents before AP reaches the last-second appeal threshold', () => {
            const state = runtimeState(100);
            state.attention = 2999;
            const sys = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(100),
                resident: { hp: { current: 10, max: 10 }, inventory: [{ itemId: 995, amount: 1000 }] },
            });

            expect(reaction?.rule.id).toBe('self-initiated-ap-gp-exchange');
            expect(reaction?.action).toMatchObject({
                kind: 'city_exchange_ap_gp',
                cause: 'nervous:self-initiated-ap-gp-exchange',
                gpAmount: 250,
                apAmount: 500,
                idempotencyKey: 'self-ap-gp:res:agent:100',
            });
        });

        it('does not self-fund no-floor residents at the runway threshold', () => {
            const state = runtimeState(100);
            state.attention = 3000;
            const sys = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(100),
                resident: { hp: { current: 10, max: 10 }, inventory: [{ itemId: 995, amount: 1000 }] },
            });

            expect(reaction?.action?.cause).not.toBe('nervous:self-initiated-ap-gp-exchange');
        });

        it('keeps floor residents on the floor+buffer threshold rather than the no-floor threshold', () => {
            const state = runtimeState(100);
            state.attention = 5300;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(100),
                resident: { hp: { current: 10, max: 10 }, inventory: [{ itemId: 995, amount: 1000 }] },
            });

            expect(reaction?.action?.cause).not.toBe('nervous:self-initiated-ap-gp-exchange');
        });

        it('hero surplus: exchanges accumulated GP for AP for floor-clamped heroes even when AP is above threshold', () => {
            const state = runtimeState(100);
            state.attention = 5500; // well above floor+buffer (5020) — ordinary exchange would not fire
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(100),
                resident: { hp: { current: 10, max: 10 }, inventory: [{ itemId: 995, amount: 100 }] },
            });

            expect(reaction?.rule.id).toBe('self-initiated-ap-gp-exchange');
            expect(reaction?.action).toEqual({
                kind: 'city_exchange_ap_gp',
                cause: 'nervous:hero-surplus-gp-exchange',
                gpAmount: 95, // 100 - HERO_SURPLUS_GP_RESERVE (5)
                apAmount: 190, // 95 * 2
                idempotencyKey: 'self-ap-gp:res:hans:100',
            });
            expect(reaction?.suppressThinking).toBe(true);
            // S-INFER-4 (A): hero surplus-GP→AP top-up is economic/routine; the
            // exchange still executes but must not abort a slow brain deliberation.
            expect(reaction?.interruptThinking).toBe(false);
        });

        it('hero surplus: does not fire when floor-clamped hero holds no coins', () => {
            const state = runtimeState(100);
            state.attention = 5500;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:hero-surplus-gp-exchange');
        });

        it('starts a starter GP harvest instead of suppressing thinking when low AP and no coins are held', () => {
            const state = runtimeState(100);
            state.attention = 5300;
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.rule.id).toBe('starter-gp-harvest');
            expect(reaction?.action).toEqual({ kind: 'noop', cause: 'nervous:starter-gp-harvest' });
            expect(reaction?.suppressThinking).toBe(false);
            expect(reaction?.interruptThinking).toBe(false);
            expect(state.cognition?.activeGoal).toMatchObject({
                id: 'earn-starter-gp-via-combat',
                createdAtTick: 100,
            });
        });

        it('does not start a starter GP harvest for floor-protected story residents without a RuneScape behavior module', () => {
            const state = runtimeState(100);
            state.attention = 5300;
            const sys = new NervousSystem({ soul: storySoulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:starter-gp-harvest');
            expect(state.cognition?.activeGoal?.id).not.toBe('earn-starter-gp-via-combat');
        });

        it('does not let stale starter GP harvest goals suppress story residents from asking for attention', () => {
            const state = runtimeState(101);
            state.attention = 5300;
            state.cognition = {
                activeGoal: {
                    id: 'earn-starter-gp-via-combat',
                    description: 'Earn starter RuneScape GP by safely fighting low-level NPCs and looting coins.',
                    steps: ['Attack a safe Goblin', 'Loot coin item 995'],
                    createdAtTick: 100,
                    ttlTicks: 600,
                },
            };
            const sys = new NervousSystem({ soul: storySoulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(101));

            expect(reaction?.action?.cause).toBe('nervous:request-attention');
            expect(state.cognition?.activeGoal).toBeUndefined();
        });

        it('starts a starter GP harvest for residents using the standard RuneScape module without legacy behavior', () => {
            const state = runtimeState(100);
            state.attention = 5300;
            const sys = new NervousSystem({ soul: moduleSoulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).toBe('nervous:starter-gp-harvest');
            expect(state.cognition?.activeGoal?.id).toBe('earn-starter-gp-via-combat');
        });

        it('does not start a starter GP harvest when the standard RuneScape module is disabled', () => {
            const state = runtimeState(100);
            state.attention = 5300;
            const sys = new NervousSystem({ soul: moduleSoulWithFloor(5000, false), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(100));

            expect(reaction?.action?.cause).not.toBe('nervous:starter-gp-harvest');
            expect(state.cognition?.activeGoal?.id).not.toBe('earn-starter-gp-via-combat');
        });

        it('lets an active starter GP harvest continue without an attention appeal', () => {
            const state = runtimeState(101);
            state.attention = 5300;
            state.hookCooldowns!['starter-gp-harvest'] = 220;
            state.cognition = {
                activeGoal: {
                    id: 'earn-starter-gp-via-combat',
                    description: 'Earn starter RuneScape GP by safely fighting low-level NPCs and looting coins.',
                    steps: ['Attack a safe Goblin', 'Loot coin item 995'],
                    createdAtTick: 100,
                    ttlTicks: 600,
                },
            };
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react(healthyPerception(101));

            expect(reaction?.action?.cause).not.toBe('nervous:request-attention');
            expect(reaction?.action?.cause).not.toBe('nervous:starter-gp-harvest');
        });

        it('still appeals for attention when an active starter GP harvest resident is low health with no food', () => {
            const state = runtimeState(101);
            state.attention = 5300;
            state.hookCooldowns!['starter-gp-harvest'] = 220;
            state.cognition = {
                activeGoal: {
                    id: 'earn-starter-gp-via-combat',
                    description: 'Earn starter RuneScape GP by safely fighting low-level NPCs and looting coins.',
                    steps: ['Attack a safe Goblin', 'Loot coin item 995'],
                    createdAtTick: 100,
                    ttlTicks: 600,
                },
            };
            const sys = new NervousSystem({ soul: soulWithFloor(5000), state, memory: memoryWith([]) });

            const reaction = sys.react({
                ...healthyPerception(101),
                resident: { hp: { current: 2, max: 10 }, inventory: [] },
            });

            expect(reaction?.action?.cause).toBe('nervous:request-attention');
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

            const reaction = sys.react({
                ...healthyPerception(100),
                resident: { hp: { current: 2, max: 10 }, inventory: [] },
            });

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

    describe('interruptThinking survival/non-urgent classification (S-INFER-4)', () => {
        // Live finding: 728/764 (95%) qwopus brain decisions were thinking_cancelled
        // because NON-URGENT reflexes fired interruptThinking:true and aborted the
        // slow (~40s) in-flight deliberation. Survival reflexes MUST still interrupt
        // (so residents never deliberate themselves to death); routine social/
        // economic reflexes must NOT.

        it('SURVIVAL: low-health eat reflex still interrupts thinking', () => {
            const system = new NervousSystem({
                soul: soul(),
                state: runtimeState(42),
                memory: memoryWith([]),
            });

            const reaction = system.react({
                tick: 42,
                resident: { hp: { current: 2, max: 10 }, inventory: [{ key: 'shrimp', amount: 1 }] },
                events: [],
            });

            expect(reaction?.rule.id).toBe('eat-when-low-health');
            expect(reaction?.action).toEqual({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' });
            // A resident at 20% HP MUST abandon a slow deliberation to eat NOW.
            expect(reaction?.suppressThinking).toBe(true);
            expect(reaction?.interruptThinking).toBe(true);
        });

        it('NON-URGENT: being addressed by chat (patron:ask) acts but does NOT interrupt thinking', () => {
            const state = runtimeState(99);
            state.attention = 5000;
            const system = new NervousSystem({ soul: soul(), state, memory: memoryWith([]) });

            const reaction = system.react({
                tick: 99,
                resident: { hp: { current: 10, max: 10 }, inventory: [] },
                events: [
                    {
                        kind: 'chat',
                        source: 'patron:ask',
                        from: { name: 'visitor-1' },
                        text: 'Are you there?',
                    },
                ],
            });

            expect(reaction?.rule.id).toContain('patron-ask-acknowledge');
            // The acknowledgement STILL fires (resident responds)...
            expect(reaction?.action.kind).toBe('say');
            expect(reaction?.suppressThinking).toBe(true);
            // ...but it must NOT cancel a 40s in-flight brain deliberation.
            expect(reaction?.interruptThinking).toBe(false);
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

function storySoulWithFloor(floor: number): Soul {
    return {
        sourcePath: '/tmp/res-story-hero.md',
        body: '# Story hero soul',
        frontmatter: {
            name: 'res:hans',
            archetype: 'mentor',
            model: { thinking: false },
            attentionProfile: { startingAttention: 14000, decayCurve: 'standard', floor },
            heroProfile: { publicName: 'Hans', tier: 'hero', signatureAction: 'guards the courtyard' },
        },
    };
}

function moduleSoulWithFloor(floor: number, enabled = true): Soul {
    return {
        sourcePath: '/tmp/res-standard-module.md',
        body: '# Standard module soul',
        frontmatter: {
            name: 'res:qa-standard',
            archetype: 'achiever',
            attentionProfile: { startingAttention: 14000, decayCurve: 'standard', floor },
            modules: [{ id: 'onion.runescape.standard', enabled }],
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
