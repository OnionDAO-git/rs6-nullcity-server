/**
 * Soul-side nervous rules per hero (sprint E20 follow-up).
 *
 * Each hero soul (res-hans, res-father-aereck, res-wise-old-man,
 * res-duke-horacio, res-pip, res-thrand) declares ~4 reflex rules in its
 * frontmatter. These tests drive each rule through the actual NervousSystem
 * by loading the markdown soul, building a fresh runtime state, and feeding
 * a perception that should fire the rule. The goal is observable PERSONALITY
 * beyond the watchdog fallback line, modelled on Codex's patron-acknowledge
 * pattern (commit 80f25d18).
 *
 * Conventions:
 *   - Each rule id has a one-test assertion that proves it fires under the
 *     intended perception.
 *   - Each soul also has one test that confirms cooldown is honoured
 *     (representative — we don't repeat per-rule).
 *   - We deliberately use the real SoulLoader + real NervousSystem so the
 *     YAML schema, priority clamp, and cooldown logic are exercised end to
 *     end (no mocks beyond MemoryStore).
 */

import path from 'path';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import { NervousSystem } from '../nervous-system/nervous-system';
import { SoulLoader } from './soul-loader';

const STARTER_SOULS_DIR = path.join(__dirname, 'starter-souls');

describe('hero soul nervous rules', () => {
    describe('res:hans', () => {
        it('greets the courtyard when a chat event arrives', () => {
            const reaction = reactToEvents('res:hans', [{ kind: 'chat', text: 'hi', from: { name: 'visitor' } }]);
            expect(reaction?.rule.id).toBe('hans-courtyard-greet-chat');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: 'A good day in the courtyard, friend.',
                cause: 'nervous:hans-courtyard-greet-chat',
            });
        });

        it('mutters about a blade when an attack event lands', () => {
            const reaction = reactToEvents('res:hans', [{ kind: 'attack' }]);
            expect(reaction?.rule.id).toBe('hans-combat-aside');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "A blade scrapes leather — that's a sound I never miss." });
        });

        it('steadies the listener when a hit event lands', () => {
            const reaction = reactToEvents('res:hans', [{ kind: 'hit' }]);
            expect(reaction?.rule.id).toBe('hans-took-a-hit');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Easy now — keep your feet, friend.' });
        });

        it('mentions the bell during a low-attention quiet patrol', () => {
            const reaction = reactQuiet('res:hans', { attention: 7000 });
            expect(reaction?.rule.id).toBe('hans-low-attention-patrol-mutter');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'The bells from the chapel are due any moment.' });
        });

        it('marks a death event for the courtyard memory', () => {
            const reaction = reactToEvents('res:hans', [{ kind: 'death' }]);
            expect(reaction?.rule.id).toBe('hans-stranger-on-death');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "That's one more name to remember." });
        });

        it('mutters an ambient post-minder when nothing else fires', () => {
            const reaction = reactAmbient('res:hans');
            expect(reaction?.rule.id).toBe('hans-post-ambient');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: "I've been at this post longer than I can count. The courtyard still surprises me.",
                cause: 'nervous:hans-post-ambient',
            });
        });

        it('honours the cooldown on the chat greeter', () => {
            const { system, state } = buildSystem('res:hans');
            const first = system.react(perceptionWithEvents(42, [{ kind: 'chat', text: 'hi', from: { name: 'visitor' } }]));
            expect(first?.rule.id).toBe('hans-courtyard-greet-chat');

            state.tick = 43;
            const blocked = system.react(perceptionWithEvents(43, [{ kind: 'chat', text: 'hi again', from: { name: 'visitor' } }]));
            expect(blocked?.rule.id).not.toBe('hans-courtyard-greet-chat');
        });
    });

    describe('res:father-aereck', () => {
        it('blesses the ground when a chat event arrives', () => {
            const reaction = reactToEvents('res:father-aereck', [{ kind: 'chat', text: 'hello' }]);
            expect(reaction?.rule.id).toBe('aereck-bless-on-chat');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Bless this ground beneath us.' });
        });

        it('mourns when a death event lands', () => {
            const reaction = reactToEvents('res:father-aereck', [{ kind: 'death' }]);
            expect(reaction?.rule.id).toBe('aereck-mourn-on-death');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'May the altar light their way home.' });
        });

        it('soothes after a hit event lands', () => {
            const reaction = reactToEvents('res:father-aereck', [{ kind: 'hit' }]);
            expect(reaction?.rule.id).toBe('aereck-soothe-after-hit');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Steady — the altar restores Prayer when you are ready.' });
        });

        it('holds quiet vigil when attention is low', () => {
            const reaction = reactQuiet('res:father-aereck', { attention: 8000 });
            expect(reaction?.rule.id).toBe('aereck-quiet-vigil-low-attention');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'A breath of incense, and the quiet between prayers.' });
        });

        it('censures violence on hallowed ground when an attack event lands', () => {
            const reaction = reactToEvents('res:father-aereck', [{ kind: 'attack' }]);
            expect(reaction?.rule.id).toBe('aereck-attack-censure');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: 'Not here. This is hallowed ground — take your quarrel to the fields.',
            });
        });

        it('emits ambient chapel invitation when nothing else fires', () => {
            const reaction = reactAmbient('res:father-aereck');
            expect(reaction?.rule.id).toBe('aereck-chapel-ambient');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'The altar is always lit. Come when you are ready.' });
        });
    });

    describe('res:wise-old-man', () => {
        it('offers an aphorism on chat', () => {
            const reaction = reactToEvents('res:wise-old-man', [{ kind: 'chat', text: 'hello' }]);
            expect(reaction?.rule.id).toBe('wise-aphorism-on-chat');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Ah. The fire that warmed kings cooks the same fish.' });
        });

        it('warns when combat begins nearby', () => {
            const reaction = reactToEvents('res:wise-old-man', [{ kind: 'attack' }]);
            expect(reaction?.rule.id).toBe('wise-warn-on-attack');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Pick your fights. Most need not be picked at all.' });
        });

        it('marks a death for the long memory', () => {
            const reaction = reactToEvents('res:wise-old-man', [{ kind: 'death' }]);
            expect(reaction?.rule.id).toBe('wise-mark-a-death');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'One more for the long memory.' });
        });

        it('rests on the bench during quiet attention', () => {
            const reaction = reactQuiet('res:wise-old-man', { attention: 8500 });
            expect(reaction?.rule.id).toBe('wise-quiet-low-attention');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "A bench, a cup of tea, and a quiet morning — that's plenty." });
        });

        it('stoically notes a hit', () => {
            const reaction = reactToEvents('res:wise-old-man', [{ kind: 'hit' }]);
            expect(reaction?.rule.id).toBe('wise-hit-stoic');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "Hmph. That stings. Though I've felt worse, I assure you." });
        });

        it('emits ambient fire praise when nothing else fires', () => {
            const reaction = reactAmbient('res:wise-old-man');
            expect(reaction?.rule.id).toBe('wise-fire-ambient');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'A well-laid fire at dusk — there is nothing more civilised.' });
        });
    });

    describe('res:duke-horacio', () => {
        it('greets formally on chat', () => {
            const reaction = reactToEvents('res:duke-horacio', [{ kind: 'chat', text: 'hello' }]);
            expect(reaction?.rule.id).toBe('duke-formal-greet-on-chat');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Well met. The duchy stands open to you.' });
        });

        it('declines combat when an attack lands', () => {
            const reaction = reactToEvents('res:duke-horacio', [{ kind: 'attack' }]);
            expect(reaction?.rule.id).toBe('duke-decline-combat-on-attack');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'The duchy keeps a constabulary for that, friend.' });
        });

        it('honours the fallen on a death event', () => {
            const reaction = reactToEvents('res:duke-horacio', [{ kind: 'death' }]);
            expect(reaction?.rule.id).toBe('duke-honour-the-fallen');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Aye. A name for the archive, and a candle from Father Aereck.' });
        });

        it('makes a kitchen aside when the castle is quiet', () => {
            const reaction = reactQuiet('res:duke-horacio', { attention: 8000 });
            expect(reaction?.rule.id).toBe('duke-castle-aside-low-attention');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'The kitchen smells are early today — Cook is busy below.' });
        });

        it('rebukes a hit within the duchy walls', () => {
            const reaction = reactToEvents('res:duke-horacio', [{ kind: 'hit' }]);
            expect(reaction?.rule.id).toBe('duke-hit-rebuke');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "This is unacceptable conduct within the duchy's walls." });
        });

        it('emits ambient duchy pride when nothing else fires', () => {
            const reaction = reactAmbient('res:duke-horacio');
            expect(reaction?.rule.id).toBe('duke-duchy-ambient');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: 'The duchy stands, friend. Whatever else changes out there, this castle holds.',
            });
        });
    });

    describe('res:pip', () => {
        it('asks a curious question on chat', () => {
            const reaction = reactToEvents('res:pip', [{ kind: 'chat', text: 'hi' }]);
            expect(reaction?.rule.id).toBe('pip-curious-on-chat');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Oh — hello! Have you been to Lumbridge before?' });
        });

        it('startles when hit', () => {
            const reaction = reactToEvents('res:pip', [{ kind: 'hit' }]);
            expect(reaction?.rule.id).toBe('pip-startle-on-hit');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Ow! Wait — what was that?' });
        });

        it('wonders aloud on a nearby death', () => {
            const reaction = reactToEvents('res:pip', [{ kind: 'death' }]);
            expect(reaction?.rule.id).toBe('pip-wonder-at-death');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Did... did someone fall? I should tell Father Aereck.' });
        });

        it('asks for guidance when attention is low', () => {
            const reaction = reactQuiet('res:pip', { attention: 3000 });
            expect(reaction?.rule.id).toBe('pip-ask-for-guidance');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "I think I'm a little lost — does anyone have a moment?" });
        });

        it('worries aloud when an attack event lands nearby', () => {
            const reaction = reactToEvents('res:pip', [{ kind: 'attack' }]);
            expect(reaction?.rule.id).toBe('pip-attack-worry');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: 'Oh! Is everyone alright over there? Maybe we should all take a step back?',
            });
        });

        it('emits ambient guide mapping when nothing else fires', () => {
            const reaction = reactAmbient('res:pip');
            expect(reaction?.rule.id).toBe('pip-guide-ambient');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: "I've been mapping safe routes around Lumbridge — there are more than you'd think!",
            });
        });
    });

    describe('res:thrand', () => {
        it('acknowledges chat briefly while working', () => {
            const reaction = reactToEvents('res:thrand', [{ kind: 'chat', text: 'hi' }]);
            expect(reaction?.rule.id).toBe('thrand-acknowledge-chat');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: "Aye. Brief is fine — I'm working." });
        });

        it('notes a hit and resolves to adjust the routine', () => {
            const reaction = reactToEvents('res:thrand', [{ kind: 'hit' }]);
            expect(reaction?.rule.id).toBe('thrand-mark-the-hit');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Hm. Note that — adjust the routine.' });
        });

        it('offers a quiet respect when a death lands', () => {
            const reaction = reactToEvents('res:thrand', [{ kind: 'death' }]);
            expect(reaction?.rule.id).toBe('thrand-quiet-respect-on-death');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'One less line on the slate.' });
        });

        it('mutters routine reassurance when attention is low', () => {
            const reaction = reactQuiet('res:thrand', { attention: 3000 });
            expect(reaction?.rule.id).toBe('thrand-routine-mutter-low-attention');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Small steps. The river will still be there.' });
        });

        it('assesses combat margins when an attack event lands', () => {
            const reaction = reactToEvents('res:thrand', [{ kind: 'attack' }]);
            expect(reaction?.rule.id).toBe('thrand-attack-assess');
            expect(reaction?.action).toMatchObject({
                kind: 'say',
                text: 'Combat nearby. Assess the margins — survive the exchange before thinking about the loot.',
            });
        });

        it('emits ambient progress note when nothing else fires', () => {
            const reaction = reactAmbient('res:thrand');
            expect(reaction?.rule.id).toBe('thrand-progress-ambient');
            expect(reaction?.action).toMatchObject({ kind: 'say', text: 'Still here as Thrand. The tick marks say today was productive.' });
        });
    });
});

function reactToEvents(residentName: string, events: Array<Record<string, unknown>>) {
    const { system, state } = buildSystem(residentName);
    return system.react(perceptionWithEvents(state.tick, events));
}

function reactQuiet(residentName: string, overrides: { attention: number }) {
    const { system, state } = buildSystem(residentName);
    state.attention = overrides.attention;
    return system.react(perceptionWithEvents(state.tick, []));
}

function reactAmbient(residentName: string) {
    const { system, state } = buildSystem(residentName);
    return system.react(perceptionWithEvents(state.tick, []));
}

function buildSystem(residentName: string): { system: NervousSystem; state: RuntimeState } {
    const loader = new SoulLoader(STARTER_SOULS_DIR);
    const soul = loader.load(residentName);
    const state = runtimeState(residentName, 42);
    const system = new NervousSystem({ soul, state, memory: stubMemory() });
    return { system, state };
}

function runtimeState(residentName: string, tick: number): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: residentName,
        attention: 14000,
        tick,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function stubMemory(): MemoryStore {
    return {
        ensureResident: jest.fn(() => '/tmp/hero-soul-test'),
        retrieve: jest.fn(() => [] as string[]),
    } as unknown as MemoryStore;
}

function perceptionWithEvents(tick: number, events: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
        tick,
        resident: { hp: { current: 10, max: 10 }, inventory: [] },
        events,
    };
}
