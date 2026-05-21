import { activeWorld } from '@engine/world';
import type { Resident } from '@engine/world/actor/resident/resident';
import type { ActionLog } from './protocol/action-log';
import { ResidentSession } from './resident-session';

jest.mock('@engine/world', () => ({
    activeWorld: { tickComplete: createTickSubject() },
}));

describe('ResidentSession', () => {
    it('fans out action results once and resolves MCP-style submit waiters', async () => {
        const resident = fakeResident();
        const actionLog = { append: jest.fn() } as unknown as ActionLog;
        const session = new ResidentSession(resident, actionLog);
        const observerA = { id: 'a', sendPerception: jest.fn(), sendActionResults: jest.fn() };
        const observerB = { id: 'b', sendPerception: jest.fn(), sendActionResults: jest.fn() };
        session.attach(observerA);
        session.attach(observerB);

        const result = session.submitActionAndWait({ kind: 'noop' }, 'request-1', 100);
        (activeWorld.tickComplete as unknown as TickSubject).next();

        await expect(result).resolves.toEqual({ ok: true });
        expect(observerA.sendActionResults).toHaveBeenCalledWith(resident, [{ requestId: 'request-1', result: { ok: true } }]);
        expect(observerB.sendActionResults).toHaveBeenCalledWith(resident, [{ requestId: 'request-1', result: { ok: true } }]);
        expect(resident.drainActionResults).toHaveBeenCalledTimes(1);

        session.close();
    });

    it('resolves wait_for_event callers on matching perception events', async () => {
        const resident = fakeResident([{ kind: 'chat', text: 'hello' }] as never);
        const session = new ResidentSession(resident, { append: jest.fn() } as unknown as ActionLog);

        const event = session.waitForEvent(['chat'], 100);
        (activeWorld.tickComplete as unknown as TickSubject).next();

        await expect(event).resolves.toEqual({ kind: 'chat', text: 'hello' });
        session.close();
    });

    it('does not reuse a timed-out request id for a late action result', async () => {
        const resident = fakeResident([], [[{ ok: true }]]);
        const session = new ResidentSession(resident, { append: jest.fn() } as unknown as ActionLog);
        const observer = { id: 'observer', sendPerception: jest.fn(), sendActionResults: jest.fn() };
        session.attach(observer);

        const result = session.submitActionAndWait({ kind: 'noop' }, 'request-1', 1);
        await expect(result).resolves.toEqual({ ok: false, reason: 'action_result_timeout' });

        (activeWorld.tickComplete as unknown as TickSubject).next();

        expect(observer.sendActionResults).toHaveBeenCalledWith(resident, [{ result: { ok: true } }]);
        session.close();
    });

    it('resolves an earlier wait with its real result when a later wait times out first', async () => {
        jest.useFakeTimers();
        const resident = fakeResident([], [[{ ok: true }]]);
        const session = new ResidentSession(resident, { append: jest.fn() } as unknown as ActionLog);
        const observer = { id: 'observer', sendPerception: jest.fn(), sendActionResults: jest.fn() };
        session.attach(observer);

        try {
            const first = session.submitActionAndWait({ kind: 'noop' }, 'request-1', 100);
            const second = session.submitActionAndWait({ kind: 'say', text: 'second' }, 'request-2', 1);

            jest.advanceTimersByTime(1);
            await expect(second).resolves.toEqual({ ok: false, reason: 'action_result_timeout' });

            (activeWorld.tickComplete as unknown as TickSubject).next();

            await expect(first).resolves.toEqual({ ok: true });
            expect(observer.sendActionResults).toHaveBeenCalledWith(resident, [{ requestId: 'request-1', result: { ok: true } }]);
        } finally {
            session.close();
            jest.useRealTimers();
        }
    });

    it('consumes a timed-out result without assigning it to a newer waiter', async () => {
        jest.useFakeTimers();
        const resident = fakeResident([], [[{ ok: true }], [{ ok: true }]]);
        const session = new ResidentSession(resident, { append: jest.fn() } as unknown as ActionLog);
        const observer = { id: 'observer', sendPerception: jest.fn(), sendActionResults: jest.fn() };
        session.attach(observer);

        try {
            const first = session.submitActionAndWait({ kind: 'noop' }, 'request-1', 1);
            jest.advanceTimersByTime(1);
            await expect(first).resolves.toEqual({ ok: false, reason: 'action_result_timeout' });

            const second = session.submitActionAndWait({ kind: 'say', text: 'second' }, 'request-2', 100);
            let settled = false;
            second.then(() => {
                settled = true;
            });

            (activeWorld.tickComplete as unknown as TickSubject).next();
            await Promise.resolve();

            expect(settled).toBe(false);
            expect(observer.sendActionResults).toHaveBeenCalledWith(resident, [{ result: { ok: true } }]);

            (activeWorld.tickComplete as unknown as TickSubject).next();

            await expect(second).resolves.toEqual({ ok: true });
            expect(observer.sendActionResults).toHaveBeenLastCalledWith(resident, [{ requestId: 'request-2', result: { ok: true } }]);
        } finally {
            session.close();
            jest.useRealTimers();
        }
    });

    it('preserves FIFO correlation when a middle request times out', async () => {
        jest.useFakeTimers();
        const resident = fakeResident([], [[{ ok: true }, { ok: true }, { ok: true }]]);
        const session = new ResidentSession(resident, { append: jest.fn() } as unknown as ActionLog);
        const observer = { id: 'observer', sendPerception: jest.fn(), sendActionResults: jest.fn() };
        session.attach(observer);

        try {
            const first = session.submitActionAndWait({ kind: 'noop' }, 'request-1', 100);
            const second = session.submitActionAndWait({ kind: 'say', text: 'second' }, 'request-2', 1);
            const third = session.submitActionAndWait({ kind: 'say', text: 'third' }, 'request-3', 100);

            jest.advanceTimersByTime(1);
            await expect(second).resolves.toEqual({ ok: false, reason: 'action_result_timeout' });

            (activeWorld.tickComplete as unknown as TickSubject).next();

            await expect(first).resolves.toEqual({ ok: true });
            await expect(third).resolves.toEqual({ ok: true });
            expect(observer.sendActionResults).toHaveBeenCalledWith(resident, [
                { requestId: 'request-1', result: { ok: true } },
                { result: { ok: true } },
                { requestId: 'request-3', result: { ok: true } },
            ]);
        } finally {
            session.close();
            jest.useRealTimers();
        }
    });
});

interface TickSubject {
    next(): void;
    subscribe(handler: () => void): { unsubscribe(): void };
}

function createTickSubject(): TickSubject {
    const subscribers: Array<() => void> = [];
    return {
        subscribe: jest.fn((handler: () => void) => {
            subscribers.push(handler);
            return {
                unsubscribe: jest.fn(() => {
                    const index = subscribers.indexOf(handler);
                    if (index >= 0) {
                        subscribers.splice(index, 1);
                    }
                }),
            };
        }),
        next: () => {
            for (const handler of subscribers.slice()) {
                handler();
            }
        },
    };
}

function fakeResident(
    events = [],
    resultBatches: Array<Array<{ ok: boolean; reason?: string }>> = [[{ ok: true }]],
): jest.Mocked<Resident> {
    return {
        username: 'res:pip',
        isActive: true,
        enqueueActions: jest.fn(),
        publishPerception: jest.fn(() => ({ tick: 1, events }) as never),
        drainActionResults: jest.fn(() => (resultBatches.length ? resultBatches.shift() : []) as never),
        save: jest.fn(() => true),
    } as unknown as jest.Mocked<Resident>;
}
