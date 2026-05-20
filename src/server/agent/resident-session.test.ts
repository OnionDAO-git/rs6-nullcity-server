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

function fakeResident(events = []): jest.Mocked<Resident> {
    return {
        username: 'res:pip',
        isActive: true,
        enqueueActions: jest.fn(),
        publishPerception: jest.fn(() => ({ tick: 1, events }) as never),
        drainActionResults: jest.fn(() => [{ ok: true }]),
        save: jest.fn(() => true),
    } as unknown as jest.Mocked<Resident>;
}
