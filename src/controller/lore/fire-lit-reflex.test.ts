import { FireLitReflex, FIRE_LIT_LORE_KIND, FIRE_LIT_DEFAULT_RADIUS_TILES } from './fire-lit-reflex';
import { LoreBus, type LoreEvent } from './lore-bus';

type Perception = Parameters<FireLitReflex['observe']>[0];

function withFireAt(x: number, y: number, level: number, fireObjectId: number = 26185): Perception {
    return {
        resident: { position: { x, y, level } },
        nearby: { objects: [{ objectId: fireObjectId, position: { x, y, level } }] },
    } as Perception;
}

function withNoFire(x: number, y: number, level: number): Perception {
    return {
        resident: { position: { x, y, level } },
        nearby: { objects: [] },
    } as Perception;
}

describe('FireLitReflex (L-α-2)', () => {
    function makeRig() {
        const bus = new LoreBus({ now: () => new Date('2026-05-23T10:30:00.000Z') });
        const received: LoreEvent[] = [];
        bus.subscribe(event => received.push(event), { kindFilter: FIRE_LIT_LORE_KIND });
        const reflex = new FireLitReflex({ bus });
        return { bus, reflex, received };
    }

    describe('FIRE_LIT_LORE_KIND', () => {
        it('exposes a stable string constant other modules can subscribe to', () => {
            expect(FIRE_LIT_LORE_KIND).toBe('fire_lit');
        });
    });

    describe('observe — first call (cold start)', () => {
        it('does NOT publish fire_lit on the very first observation even if a fire is already present', () => {
            const { reflex, received } = makeRig();
            // Cold start: resident appears next to an existing fire from a prior session.
            // We cannot infer THEY lit it, so we must not fire the reflex.
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            expect(received).toHaveLength(0);
        });

        it('does NOT publish fire_lit on first observation when no fire is present', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            expect(received).toHaveLength(0);
        });
    });

    describe('observe — transition from no-fire → fire (the reflex)', () => {
        it('publishes fire_lit on the tick a fire appears at the resident position', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            expect(received).toHaveLength(1);
            expect(received[0].kind).toBe('fire_lit');
            expect(received[0].source).toBe('res:agent');
        });

        it('attaches the fire coord + default radius hint so proximity gating works', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            expect(received[0].visibility).toEqual({
                sourceCoord: [3243, 3209, 0],
                radiusTiles: FIRE_LIT_DEFAULT_RADIUS_TILES,
            });
        });

        it('includes the resident position + fire object id in the payload', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0, 26185), 'res:agent');
            expect(received[0].payload).toEqual({
                position: { x: 3243, y: 3209, level: 0 },
                fireObjectId: 26185,
            });
        });

        it('does NOT re-publish on subsequent ticks while the fire is still burning', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            expect(received).toHaveLength(1);
        });

        it('re-arms after the fire goes out, so the NEXT fire_lit fires too', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent'); // emits #1
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent'); // burns out
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent'); // emits #2
            expect(received).toHaveLength(2);
        });
    });

    describe('observe — only "near me" counts as my fire', () => {
        it('does NOT publish when a fire appears more than 1 tile from the resident', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            const farFire = {
                resident: { position: { x: 3243, y: 3209, level: 0 } },
                nearby: { objects: [{ objectId: 26185, position: { x: 3250, y: 3209, level: 0 } }] },
            } as Perception;
            reflex.observe(farFire, 'res:agent');
            expect(received).toHaveLength(0);
        });

        it('does NOT publish when a fire appears on a different level', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            const wrongLevelFire = {
                resident: { position: { x: 3243, y: 3209, level: 0 } },
                nearby: { objects: [{ objectId: 26185, position: { x: 3243, y: 3209, level: 1 } }] },
            } as Perception;
            reflex.observe(wrongLevelFire, 'res:agent');
            expect(received).toHaveLength(0);
        });
    });

    describe('observe — multi-resident isolation', () => {
        it('tracks transitions per source resident independently', () => {
            const { reflex, received } = makeRig();
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent-a');
            reflex.observe(withNoFire(3245, 3210, 0), 'res:agent-b');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent-a');
            reflex.observe(withFireAt(3245, 3210, 0), 'res:agent-b');
            expect(received).toHaveLength(2);
            expect(received.map(e => e.source).sort()).toEqual(['res:agent-a', 'res:agent-b']);
        });
    });

    describe('observe — defensive (malformed perception)', () => {
        it('does nothing when perception is null/undefined/missing position', () => {
            const { reflex, received } = makeRig();
            reflex.observe(null as unknown as Perception, 'res:agent');
            reflex.observe(undefined as unknown as Perception, 'res:agent');
            reflex.observe({} as Perception, 'res:agent');
            reflex.observe({ resident: {} } as Perception, 'res:agent');
            expect(received).toHaveLength(0);
        });
    });

    describe('custom radius option', () => {
        it('honors a caller-provided radiusTiles override on visibility', () => {
            const bus = new LoreBus();
            const received: LoreEvent[] = [];
            bus.subscribe(event => received.push(event), { kindFilter: FIRE_LIT_LORE_KIND });
            const reflex = new FireLitReflex({ bus, radiusTiles: 25 });
            reflex.observe(withNoFire(3243, 3209, 0), 'res:agent');
            reflex.observe(withFireAt(3243, 3209, 0), 'res:agent');
            expect(received[0].visibility?.radiusTiles).toBe(25);
        });
    });
});
