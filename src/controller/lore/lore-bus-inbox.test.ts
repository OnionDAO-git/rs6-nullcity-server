import { LoreBus } from './lore-bus';
import { loreBusInboxFor } from './lore-bus-inbox';
import { WHISPER_LORE_KIND } from './whisper';

const SELF_ID = 'res:alice';
const OTHER_ID = 'res:bob';
const POS_A = { x: 3242, y: 3208, level: 0 };
const POS_B = { x: 3243, y: 3209, level: 0 }; // 1.4 tiles from POS_A
const POS_FAR = { x: 3400, y: 3208, level: 0 }; // 158 tiles away

function publishFireLit(bus: LoreBus, source: string, pos: { x: number; y: number; level: number }, radius = 10) {
    return bus.publish({
        kind: 'fire_lit',
        source,
        payload: { position: pos, fireObjectId: 26185 },
        visibility: { sourceCoord: [pos.x, pos.y, pos.level], radiusTiles: radius },
    });
}

describe('loreBusInboxFor', () => {
    describe('drain() with no events', () => {
        it('returns empty array when bus has no events', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            expect(inbox.drain(POS_A)).toEqual([]);
        });

        it('returns empty array when drain called without position', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            expect(inbox.drain()).toEqual([]);
        });
    });

    describe('self-event filtering', () => {
        it('excludes events sourced from the resident itself', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, SELF_ID, POS_A);
            expect(inbox.drain(POS_A)).toEqual([]);
        });

        it('includes events from other residents', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, OTHER_ID, POS_A);
            const events = inbox.drain(POS_A);
            expect(events).toHaveLength(1);
            expect(events[0].source).toBe(OTHER_ID);
            expect(events[0].kind).toBe('fire_lit');
        });
    });

    describe('whisper kind filtering', () => {
        it('excludes whisper events (handled by WhisperInbox)', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            bus.publish({
                kind: WHISPER_LORE_KIND,
                source: OTHER_ID,
                payload: { to: SELF_ID, text: 'hello' },
                visibility: { sourceCoord: [POS_A.x, POS_A.y, POS_A.level], radiusTiles: 6 },
            });
            expect(inbox.drain(POS_A)).toEqual([]);
        });
    });

    describe('position-based filtering at drain time', () => {
        it('returns event when observer is within the visibility radius', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, OTHER_ID, POS_A, 10);
            const events = inbox.drain(POS_B); // POS_B is ~1.4 tiles from POS_A
            expect(events).toHaveLength(1);
        });

        it('drops event when observer is outside the visibility radius', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, OTHER_ID, POS_A, 10);
            const events = inbox.drain(POS_FAR); // 158 tiles away
            expect(events).toHaveLength(0);
        });

        it('drops event when observer and source are on different levels', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            bus.publish({
                kind: 'fire_lit',
                source: OTHER_ID,
                payload: {},
                visibility: { sourceCoord: [POS_A.x, POS_A.y, 1], radiusTiles: 10 },
            });
            const events = inbox.drain({ ...POS_A, level: 0 });
            expect(events).toHaveLength(0);
        });

        it('returns event without visibility hint regardless of observer position', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            bus.publish({ kind: 'broadcast', source: OTHER_ID, payload: { text: 'Hello city!' } });
            const events = inbox.drain(POS_FAR);
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe('broadcast');
            expect(events[0].sourcePosition).toBeUndefined();
        });

        it('returns all events when drain called without observer position', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, OTHER_ID, POS_A, 10);
            const events = inbox.drain(); // no position → no filtering
            expect(events).toHaveLength(1);
        });
    });

    describe('buffer lifecycle', () => {
        it('clears the buffer after drain', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, OTHER_ID, POS_A);
            expect(inbox.drain(POS_A)).toHaveLength(1);
            expect(inbox.drain(POS_A)).toHaveLength(0);
        });

        it('delivers multiple events in FIFO order', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            bus.publish({ kind: 'first', source: OTHER_ID, payload: {} });
            bus.publish({ kind: 'second', source: OTHER_ID, payload: {} });
            const events = inbox.drain();
            expect(events.map(e => e.kind)).toEqual(['first', 'second']);
        });

        it('drops the oldest event when the buffer is full', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID, { maxBufferSize: 2 });
            bus.publish({ kind: 'ev1', source: OTHER_ID, payload: {} });
            bus.publish({ kind: 'ev2', source: OTHER_ID, payload: {} });
            bus.publish({ kind: 'ev3', source: OTHER_ID, payload: {} }); // should evict ev1
            const events = inbox.drain();
            expect(events.map(e => e.kind)).toEqual(['ev2', 'ev3']);
        });

        it('stops receiving events after unsubscribe', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            inbox.unsubscribe();
            publishFireLit(bus, OTHER_ID, POS_A);
            expect(inbox.drain(POS_A)).toHaveLength(0);
        });
    });

    describe('delivered event shape', () => {
        it('populates sourcePosition from visibility hint', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            publishFireLit(bus, OTHER_ID, POS_A);
            const [ev] = inbox.drain(POS_A);
            expect(ev.sourcePosition).toEqual(POS_A);
        });

        it('passes payload through verbatim', () => {
            const bus = new LoreBus();
            const inbox = loreBusInboxFor(bus, SELF_ID);
            bus.publish({ kind: 'quest_complete', source: OTHER_ID, payload: { quest: 'Cook’s Assistant' } });
            const [ev] = inbox.drain();
            expect(ev.payload).toEqual({ quest: 'Cook’s Assistant' });
        });
    });
});
