import type { ActionResult } from '@engine/world/actor/resident/action/agent-action';
import { isLoopbackPeerAddress } from './auth';
import { AgentGateway } from './gateway';
import { frame } from './protocol/messages';
import { recoverRequestId } from './protocol/recover-request-id';

jest.mock('@engine/world', () => ({ activeWorld: { playerList: [] } }));
jest.mock('@engine/world/actor/resident/perception/perception-builder', () => ({
    PerceptionBuilder: jest.fn().mockImplementation(() => ({
        buildForSubject: jest.fn(),
    })),
}));
jest.mock('@engine/world/actor/util', () => ({ isResident: jest.fn(() => false) }));
jest.mock('./resident-registry', () => ({
    ResidentRegistry: jest.fn().mockImplementation(() => ({
        list: jest.fn(() => []),
        releaseController: jest.fn(() => []),
    })),
}));

describe('AgentGateway authorization helpers', () => {
    it('allows tokenless development access only from loopback peers', () => {
        expect(isLoopbackPeerAddress('127.0.0.1')).toBe(true);
        expect(isLoopbackPeerAddress('::1')).toBe(true);
        expect(isLoopbackPeerAddress('::ffff:127.0.0.1')).toBe(true);

        expect(isLoopbackPeerAddress('10.0.0.5')).toBe(false);
        expect(isLoopbackPeerAddress('172.16.0.5')).toBe(false);
        expect(isLoopbackPeerAddress('192.168.1.50')).toBe(false);
    });
});

// S-DEMO-P0-1 (QA-20260530-018): the parse-failure path now recovers the
// request id (best effort) so the controller resolves its pending request
// immediately. The previous shape sent an error frame without `request_id`
// which left the controller's promise dangling until its 10s timeout —
// surfacing as `Gateway request timed out: burn_resident_gold` in audit.
describe('recoverRequestId', () => {
    it('returns the string id from a parsed frame', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ v: 1, id: 'controller-1-2', kind: 'burn_resident_gold' })))).toBe(
            'controller-1-2',
        );
    });

    it('returns the numeric id from a parsed frame', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ v: 1, id: 42, kind: 'inspect_resident_gold' })))).toBe(42);
    });

    it('accepts string payloads (not just Buffers)', () => {
        expect(recoverRequestId(JSON.stringify({ id: 'req-7' }))).toBe('req-7');
    });

    it('returns undefined when JSON is malformed', () => {
        expect(recoverRequestId(Buffer.from('not json at all'))).toBeUndefined();
    });

    it('returns undefined when id is missing', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ v: 1, kind: 'foo' })))).toBeUndefined();
    });

    it('returns undefined when id is the wrong type', () => {
        expect(recoverRequestId(Buffer.from(JSON.stringify({ id: { nested: true } })))).toBeUndefined();
    });
});

describe('AgentGateway submit_action', () => {
    it('ACKs as soon as the action is queued and leaves finality to action_result frames', async () => {
        const gateway = new AgentGateway();
        const resident = { username: 'res:pip' };
        const send = jest.fn();
        const slowResult = deferred<ActionResult>();
        const session = {
            submitAction: jest.fn(),
            submitActionAndWait: jest.fn(() => slowResult.promise),
        };
        Object.assign(gateway as unknown as MutableGateway, {
            registry: {
                get: jest.fn(() => resident),
                controllerFor: jest.fn(() => 'controller-1'),
            },
            sessionFor: jest.fn(() => session),
        });

        const completion = (gateway as unknown as MutableGateway)
            .handleMessage(
                {
                    v: 1,
                    kind: 'submit_action',
                    id: 'request-1',
                    payload: { name: 'res:pip', action: { kind: 'noop' } },
                },
                'controller-1',
                { id: 'observer', sendPerception: jest.fn() },
                send,
                new Set(),
            )
            .then(() => 'resolved');

        const raceResult = await Promise.race([completion, delay(20).then(() => 'pending')]);
        if (session.submitActionAndWait.mock.calls.length > 0) {
            slowResult.resolve({ ok: true });
            await completion;
        }

        expect(raceResult).toBe('resolved');
        expect(session.submitAction).toHaveBeenCalledWith({ kind: 'noop' }, 'request-1');
        expect(session.submitActionAndWait).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(
            frame(
                'ok',
                { ok: true, result: { ok: true, status: 'queued', cause: 'queued', requestId: 'request-1' } as ActionResult },
                'request-1',
            ),
        );
    });
});

type MutableGateway = {
    registry: {
        get(name: string): unknown;
        controllerFor(name: string): string | null;
    };
    sessionFor(resident: unknown): {
        submitAction(action: unknown, requestId?: string | number): void;
        submitActionAndWait(action: unknown, requestId?: string | number): Promise<ActionResult>;
    };
    handleMessage(
        message: unknown,
        controllerId: string,
        observer: { id: string; sendPerception: jest.Mock },
        send: (message: object) => void,
        clientSpectatorSessions: Set<string>,
    ): Promise<void>;
};

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}
