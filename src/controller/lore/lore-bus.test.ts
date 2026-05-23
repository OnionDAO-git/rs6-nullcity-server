import { LoreBus, type LoreEvent, type LoreEventInput, loreEventSchema } from './lore-bus';

describe('loreEventSchema', () => {
    it('accepts a fire_lit event with full payload', () => {
        const event = {
            kind: 'fire_lit',
            ts: '2026-05-23T08:00:00.000Z',
            source: 'res:agent',
            payload: { logId: 'rs:logs' },
        };
        expect(() => loreEventSchema.parse(event)).not.toThrow();
    });

    it('rejects an event with an empty kind', () => {
        const event = { kind: '', ts: '2026-05-23T08:00:00.000Z', source: 'res:agent', payload: {} };
        expect(() => loreEventSchema.parse(event)).toThrow();
    });

    it('rejects an event with an empty source', () => {
        const event = { kind: 'fire_lit', ts: '2026-05-23T08:00:00.000Z', source: '', payload: {} };
        expect(() => loreEventSchema.parse(event)).toThrow();
    });

    it('accepts a visibility hint with sourceCoord + radiusTiles for proximity broadcast', () => {
        const event = {
            kind: 'fire_lit',
            ts: '2026-05-23T08:00:00.000Z',
            source: 'res:agent',
            payload: {},
            visibility: { sourceCoord: [3222, 3218, 0], radiusTiles: 8 },
        };
        const parsed = loreEventSchema.parse(event);
        expect(parsed.visibility?.radiusTiles).toBe(8);
    });

    it('rejects visibility with negative radius', () => {
        const event = {
            kind: 'fire_lit',
            ts: '2026-05-23T08:00:00.000Z',
            source: 'res:agent',
            payload: {},
            visibility: { sourceCoord: [3222, 3218, 0], radiusTiles: -1 },
        };
        expect(() => loreEventSchema.parse(event)).toThrow();
    });
});

describe('LoreBus', () => {
    function makeBus(): LoreBus {
        return new LoreBus({ now: () => new Date('2026-05-23T08:00:00.000Z') });
    }

    function fireLit(overrides: Partial<LoreEventInput> = {}): LoreEventInput {
        return {
            kind: 'fire_lit',
            source: 'res:agent',
            payload: { logId: 'rs:logs' },
            ...overrides,
        };
    }

    describe('publish + subscribe', () => {
        it('delivers a published event to a subscriber', () => {
            const bus = makeBus();
            const received: LoreEvent[] = [];
            bus.subscribe(event => received.push(event));

            bus.publish(fireLit());

            expect(received).toHaveLength(1);
            expect(received[0].kind).toBe('fire_lit');
            expect(received[0].source).toBe('res:agent');
            expect(received[0].ts).toBe('2026-05-23T08:00:00.000Z');
        });

        it('delivers to multiple subscribers (fan-out)', () => {
            const bus = makeBus();
            const a: LoreEvent[] = [];
            const b: LoreEvent[] = [];
            bus.subscribe(event => a.push(event));
            bus.subscribe(event => b.push(event));

            bus.publish(fireLit());

            expect(a).toHaveLength(1);
            expect(b).toHaveLength(1);
        });

        it('lets a subscriber filter by kind via the kindFilter option', () => {
            const bus = makeBus();
            const fires: LoreEvent[] = [];
            bus.subscribe(event => fires.push(event), { kindFilter: 'fire_lit' });

            bus.publish(fireLit());
            bus.publish({ kind: 'log_chopped', source: 'res:agent', payload: {} });

            expect(fires.map(e => e.kind)).toEqual(['fire_lit']);
        });

        it('isolates subscriber errors so one bad subscriber does not break the others', () => {
            const bus = makeBus();
            const errorSubscriberCalls: number[] = [];
            const goodSubscriberCalls: number[] = [];
            bus.subscribe(() => {
                errorSubscriberCalls.push(1);
                throw new Error('boom');
            });
            bus.subscribe(() => goodSubscriberCalls.push(1));

            bus.publish(fireLit());

            expect(errorSubscriberCalls).toHaveLength(1);
            expect(goodSubscriberCalls).toHaveLength(1);
        });

        it('does not deliver events to subscribers that unsubscribed before the publish', () => {
            const bus = makeBus();
            const received: LoreEvent[] = [];
            const unsubscribe = bus.subscribe(event => received.push(event));
            unsubscribe();

            bus.publish(fireLit());

            expect(received).toEqual([]);
        });
    });

    describe('proximity gating (visibility radius)', () => {
        it('delivers a visibility-tagged event only to subscribers that pass the proximityFilter', () => {
            const bus = makeBus();
            const inRange: LoreEvent[] = [];
            const outOfRange: LoreEvent[] = [];

            bus.subscribe(event => inRange.push(event), {
                proximityFilter: { observerCoord: [3222, 3220, 0], maxDistanceTiles: 8 },
            });
            bus.subscribe(event => outOfRange.push(event), {
                proximityFilter: { observerCoord: [3500, 3500, 0], maxDistanceTiles: 8 },
            });

            bus.publish({
                ...fireLit(),
                visibility: { sourceCoord: [3222, 3218, 0], radiusTiles: 8 },
            });

            expect(inRange).toHaveLength(1);
            expect(outOfRange).toHaveLength(0);
        });

        it('delivers visibility-tagged events to subscribers without a proximityFilter (untagged subscribers receive all)', () => {
            const bus = makeBus();
            const received: LoreEvent[] = [];
            bus.subscribe(event => received.push(event));

            bus.publish({
                ...fireLit(),
                visibility: { sourceCoord: [3222, 3218, 0], radiusTiles: 1 },
            });

            expect(received).toHaveLength(1);
        });

        it('uses the smaller of event.visibility.radiusTiles and subscriber.proximityFilter.maxDistanceTiles as the effective range', () => {
            const bus = makeBus();
            const received: LoreEvent[] = [];
            bus.subscribe(event => received.push(event), {
                proximityFilter: { observerCoord: [3222, 3225, 0], maxDistanceTiles: 100 },
            });

            // sourceCoord (3222,3218) to observer (3222,3225) = 7 tiles; event radius 5 → no delivery.
            bus.publish({
                ...fireLit(),
                visibility: { sourceCoord: [3222, 3218, 0], radiusTiles: 5 },
            });

            expect(received).toEqual([]);
        });

        it('skips delivery when source and observer are on different levels (verticality)', () => {
            const bus = makeBus();
            const received: LoreEvent[] = [];
            bus.subscribe(event => received.push(event), {
                proximityFilter: { observerCoord: [3222, 3218, 1], maxDistanceTiles: 10 },
            });

            bus.publish({
                ...fireLit(),
                visibility: { sourceCoord: [3222, 3218, 0], radiusTiles: 10 },
            });

            expect(received).toEqual([]);
        });
    });

    describe('event log + snapshot', () => {
        it('retains all published events in chronological order (capped)', () => {
            const bus = new LoreBus({ now: () => new Date('2026-05-23T08:00:00.000Z'), maxEventsRetained: 5 });

            for (let i = 0; i < 7; i += 1) {
                bus.publish({ kind: 'tick', source: 'res:agent', payload: { i } });
            }

            const recent = bus.recentEvents();
            expect(recent).toHaveLength(5);
            // First two should have been dropped.
            expect(recent[0].payload).toEqual({ i: 2 });
            expect(recent[4].payload).toEqual({ i: 6 });
        });

        it('returns a shallow-frozen array from recentEvents to prevent caller mutation', () => {
            const bus = makeBus();
            bus.publish(fireLit());
            const recent = bus.recentEvents();
            expect(Object.isFrozen(recent)).toBe(true);
        });
    });

    describe('clock + ts injection', () => {
        it('uses the injected now() to stamp events when ts is not provided', () => {
            const bus = new LoreBus({ now: () => new Date('2026-06-01T12:00:00.000Z') });
            bus.publish(fireLit());
            expect(bus.recentEvents()[0].ts).toBe('2026-06-01T12:00:00.000Z');
        });

        it('preserves a provided ts on the published event', () => {
            const bus = makeBus();
            bus.publish({ ...fireLit(), ts: '2025-12-31T23:59:59.000Z' });
            expect(bus.recentEvents()[0].ts).toBe('2025-12-31T23:59:59.000Z');
        });
    });
});
