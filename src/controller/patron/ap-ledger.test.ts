import { ApLedger, type ApEvent } from './ap-ledger';

describe('ApLedger', () => {
    describe('empty ledger', () => {
        it('starts at balance 0 and not faded', () => {
            const ledger = ApLedger.empty();
            const state = ledger.replay();
            expect(state.balance).toBe(0);
            expect(state.faded).toBe(false);
            expect(state.eventCount).toBe(0);
        });

        it('balance() returns 0', () => {
            expect(ApLedger.empty().balance()).toBe(0);
        });

        it('isFaded() returns false', () => {
            expect(ApLedger.empty().isFaded()).toBe(false);
        });
    });

    describe('grant events', () => {
        it('increases balance', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(100));
            expect(ledger.balance()).toBe(100);
        });

        it('accumulates multiple grants', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(50));
            ledger.append(grant(30));
            expect(ledger.balance()).toBe(80);
        });

        it('clears faded state', () => {
            const ledger = ApLedger.empty();
            ledger.append(decay(10, 1));
            ledger.append(fade(1));
            expect(ledger.isFaded()).toBe(true);
            ledger.append(grant(20));
            expect(ledger.isFaded()).toBe(false);
            expect(ledger.balance()).toBe(20);
        });
    });

    describe('decay events', () => {
        it('reduces balance', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(100));
            ledger.append(decay(5, 1));
            expect(ledger.balance()).toBe(95);
        });

        it('clamps balance at 0 — never goes negative', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(10));
            ledger.append(decay(15, 1));
            expect(ledger.balance()).toBe(0);
        });

        it('allows zero-amount decay (hero floor case)', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(5000));
            ledger.append(decay(0, 1));
            expect(ledger.balance()).toBe(5000);
        });
    });

    describe('spend events', () => {
        it('reduces balance for an action cost', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(100));
            ledger.append(spend(1, 'move_to'));
            expect(ledger.balance()).toBe(99);
        });

        it('clamps at 0 when spend exceeds balance', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(3));
            ledger.append(spend(5, 'attack'));
            expect(ledger.balance()).toBe(0);
        });
    });

    describe('fade events', () => {
        it('marks resident as faded without changing balance', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(10));
            ledger.append(decay(10, 1));
            expect(ledger.balance()).toBe(0);
            expect(ledger.isFaded()).toBe(false);
            ledger.append(fade(1));
            expect(ledger.balance()).toBe(0);
            expect(ledger.isFaded()).toBe(true);
        });

        it('fade does not re-fire when already faded', () => {
            const ledger = ApLedger.empty();
            ledger.append(fade(1));
            ledger.append(fade(2));
            expect(ledger.isFaded()).toBe(true);
            expect(ledger.balance()).toBe(0);
        });
    });

    describe('top_up events', () => {
        it('increases balance and clears faded', () => {
            const ledger = ApLedger.empty();
            ledger.append(fade(1));
            expect(ledger.isFaded()).toBe(true);
            ledger.append(topUp(50, 'patron:alice'));
            expect(ledger.balance()).toBe(50);
            expect(ledger.isFaded()).toBe(false);
        });

        it('accumulates on existing balance', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(20));
            ledger.append(topUp(30, 'patron:alice'));
            expect(ledger.balance()).toBe(50);
        });
    });

    describe('resume events', () => {
        it('adds AP and clears faded', () => {
            const ledger = ApLedger.empty();
            ledger.append(fade(1));
            ledger.append(resume(100));
            expect(ledger.balance()).toBe(100);
            expect(ledger.isFaded()).toBe(false);
        });

        it('zero-amount resume clears faded without adding AP', () => {
            const ledger = ApLedger.empty();
            ledger.append(fade(1));
            ledger.append(resume(0));
            expect(ledger.balance()).toBe(0);
            expect(ledger.isFaded()).toBe(false);
        });
    });

    describe('mixed lifecycle', () => {
        it('grant → decay to zero → fade → top-up → resume state', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(50, 'city:birth'));
            ledger.append(decay(50, 1));
            expect(ledger.balance()).toBe(0);
            ledger.append(fade(1));
            expect(ledger.isFaded()).toBe(true);
            ledger.append(topUp(100, 'patron:bob'));
            expect(ledger.balance()).toBe(100);
            expect(ledger.isFaded()).toBe(false);
            ledger.append(decay(20, 2));
            ledger.append(spend(5, 'move_to'));
            expect(ledger.balance()).toBe(75);
        });

        it('eventCount tracks the total events appended', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(100));
            ledger.append(decay(10, 1));
            ledger.append(fade(1));
            expect(ledger.replay().eventCount).toBe(3);
        });
    });

    describe('snapshot / restore round-trip', () => {
        it('fromSnapshot restores the same state as original', () => {
            const original = ApLedger.empty();
            original.append(grant(100, 'city:birth'));
            original.append(decay(30, 1));
            original.append(spend(5, 'move_to'));

            const snapshot = original.snapshot();
            const restored = ApLedger.fromSnapshot(snapshot);

            expect(restored.balance()).toBe(original.balance());
            expect(restored.isFaded()).toBe(original.isFaded());
            expect(restored.allEvents()).toHaveLength(3);
        });

        it('snapshot schemaVersion is 1', () => {
            const snap = ApLedger.empty().snapshot();
            expect(snap.schemaVersion).toBe(1);
        });

        it('fromSnapshot rejects invalid schemaVersion', () => {
            expect(() => ApLedger.fromSnapshot({ schemaVersion: 2 as 1, events: [] })).toThrow();
        });

        it('snapshot events are copies, not references', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(50));
            const snap = ledger.snapshot();
            (snap.events[0] as { amount: number }).amount = 9999;
            expect(ledger.balance()).toBe(50);
        });
    });

    describe('fromEvents', () => {
        it('reconstructs ledger from a plain event array', () => {
            const events: ApEvent[] = [grant(200, 'city:birth'), decay(50, 1), fade(1)];
            const ledger = ApLedger.fromEvents(events);
            expect(ledger.balance()).toBe(150);
            expect(ledger.isFaded()).toBe(true);
            expect(ledger.allEvents()).toHaveLength(3);
        });

        it('rejects events with invalid shape', () => {
            expect(() => ApLedger.fromEvents([{ kind: 'grant', amount: -5, source: 'x', ts: 't' }])).toThrow();
        });
    });

    describe('allEvents()', () => {
        it('returns events in insertion order', () => {
            const ledger = ApLedger.empty();
            ledger.append(grant(10));
            ledger.append(decay(5, 1));
            const events = ledger.allEvents();
            expect(events[0].kind).toBe('grant');
            expect(events[1].kind).toBe('decay');
        });
    });

    describe('validation', () => {
        it('rejects a grant with non-positive amount', () => {
            const ledger = ApLedger.empty();
            expect(() => ledger.append({ kind: 'grant', amount: 0, source: 'x', ts: 't' })).toThrow();
        });

        it('rejects a grant with negative amount', () => {
            const ledger = ApLedger.empty();
            expect(() => ledger.append({ kind: 'grant', amount: -1, source: 'x', ts: 't' })).toThrow();
        });

        it('rejects a decay with negative amount', () => {
            const ledger = ApLedger.empty();
            expect(() => ledger.append({ kind: 'decay', amount: -1, curve: 'standard', tick: 0, ts: 't' })).toThrow();
        });

        it('rejects a spend with zero amount', () => {
            const ledger = ApLedger.empty();
            expect(() => ledger.append({ kind: 'spend', amount: 0, reason: 'x', ts: 't' })).toThrow();
        });
    });
});

function grant(amount: number, source = 'test:patron'): ApEvent {
    return { kind: 'grant', amount, source, ts: '2026-05-29T00:00:00.000Z' };
}

function decay(amount: number, tick: number): ApEvent {
    return { kind: 'decay', amount, curve: 'standard', tick, ts: '2026-05-29T00:00:00.000Z' };
}

function spend(amount: number, reason: string): ApEvent {
    return { kind: 'spend', amount, reason, ts: '2026-05-29T00:00:00.000Z' };
}

function topUp(amount: number, source: string): ApEvent {
    return { kind: 'top_up', amount, source, ts: '2026-05-29T00:00:00.000Z' };
}

function fade(tick: number): ApEvent {
    return { kind: 'fade', tick, ts: '2026-05-29T00:00:00.000Z' };
}

function resume(amount: number): ApEvent {
    return { kind: 'resume', amount, ts: '2026-05-29T00:00:00.000Z' };
}
