import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { LegacyTracker } from './legacy';

describe('LegacyTracker', () => {
    it('counts mentor teaching only when action, nearby mentee, xp, and teaching speech align', () => {
        const state = runtimeState('mentor');
        const tracker = new LegacyTracker(
            soul('mentor', {
                targetMenteeCount: 1,
                skillsToTeach: ['cooking'],
            }),
            state,
        );

        tracker.observeActions(
            [
                { kind: 'say', text: 'Here is how you cook this.' },
                { kind: 'interact', option: 'Cook', skill: 'cooking', target: { objectId: 1, position: { x: 1, y: 1 } } },
            ],
            { nearby: [{ id: 'newcomer-1', kind: 'resident', position: { x: 2, y: 2 } }] },
        );

        state.tick += 1;
        const update = tracker.update({
            events: [{ kind: 'xp_gained', actorId: 'newcomer-1', skill: 'cooking', amount: 25 }],
            nearby: [{ id: 'newcomer-1', kind: 'resident', position: { x: 2, y: 2 } }],
        });

        expect(update).toEqual({ complete: true, cause: 'legacy_complete' });
        expect(state.legacy.progress.menteeIds).toEqual(['newcomer-1']);
        expect(state.attention).toBe(0);
        expect(state.deceased?.cause).toBe('legacy_complete');
    });

    it.each([
        [
            'reach_skill_level',
            { kind: 'reach_skill_level', skill: 'fishing', level: 5 },
            { events: [{ kind: 'level_up', skill: 'fishing', level: 5 }] },
        ],
        ['craft_item', { kind: 'craft_item', itemId: 315 }, { events: [{ kind: 'item_crafted', itemId: 315 }] }],
        ['defeat_npc', { kind: 'defeat_npc', npcKey: 'goblin' }, { events: [{ kind: 'npc_defeated', npcKey: 'goblin' }] }],
        ['reach_place', { kind: 'reach_place', placeSlug: 'lumbridge-castle' }, { location: { slug: 'lumbridge-castle' } }],
    ])('completes achiever legacy for %s', (_name, spec, perception) => {
        const state = runtimeState('achiever');
        const tracker = new LegacyTracker(soul('achiever', { spec }), state);

        const update = tracker.update(perception);

        expect(update).toEqual({ complete: true, cause: 'legacy_complete' });
        expect(state.legacy.complete).toBe(true);
        expect(state.attention).toBe(0);
        expect(state.deceased?.cause).toBe('legacy_complete');
    });

    it('increments endurer ticks and completes with endured cause', () => {
        const state = runtimeState('endurer');
        const tracker = new LegacyTracker(soul('endurer', { targetTicksLived: 2 }), state);

        expect(tracker.update({}).complete).toBe(false);
        expect(state.legacy.progress.ratio).toBe(0.5);

        const update = tracker.update({});

        expect(update).toEqual({ complete: true, cause: 'endured' });
        expect(state.legacy.progress.ticksLived).toBe(2);
        expect(state.deceased?.cause).toBe('endured');
        expect(state.attention).toBe(0);
    });
});

function runtimeState(kind: 'mentor' | 'achiever' | 'endurer'): RuntimeState {
    return {
        resident: `res:${kind}`,
        attention: 100,
        tick: 1,
        legacy: { kind, progress: {}, complete: false },
        budgets: {
            minuteStartedAt: new Date(0).toISOString(),
            dayStartedAt: new Date(0).toISOString(),
            requestsThisMinute: 0,
            requestsToday: 0,
        },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function soul(kind: 'mentor' | 'achiever' | 'endurer', parameters: Record<string, unknown>): Soul {
    return {
        frontmatter: {
            name: `res:${kind}`,
            archetype: kind,
            legacy: { kind, parameters },
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
        },
        body: '# Legacy test soul',
        sourcePath: '/tmp/legacy.md',
    };
}
