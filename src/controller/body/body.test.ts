import { ResidentBody } from './body';
import type { BodyGateway } from './body';
import type { ActionLog } from '../logging/action-log';

describe('ResidentBody waiters', () => {
    it('resolves waitForPerception when a future perception matches', async () => {
        const body = testBody();
        const waiting = body.waitForPerception(perception => inventory(perception).some(item => item?.key === 'rs:logs'), {
            timeoutMs: 100,
        });

        body.observePerception({ tick: 1, resident: { inventory: [{ itemId: 1511, key: 'rs:logs', amount: 1 }] } });

        await expect(waiting).resolves.toEqual({
            ok: true,
            observation: expect.objectContaining({
                seq: 1,
                value: expect.objectContaining({ tick: 1 }),
            }),
        });
    });

    it('does not match stale latest perception when afterSeq is set', async () => {
        const body = testBody();
        body.observePerception({ tick: 1, resident: { position: { x: 1, y: 2, level: 0 } } });
        const afterSeq = body.getLatestPerceptionSeq();
        const waiting = body.waitForPerception(perception => position(perception) !== undefined, {
            afterSeq,
            timeoutMs: 100,
        });

        body.observePerception({ tick: 2, resident: { position: { x: 3, y: 4, level: 0 } } });

        await expect(waiting).resolves.toEqual({
            ok: true,
            observation: expect.objectContaining({
                seq: afterSeq + 1,
                value: expect.objectContaining({ tick: 2 }),
            }),
        });
    });

    it('resolves waitForEvent only for matching future events', async () => {
        const body = testBody();
        const waiting = body.waitForEvent(event => event.kind === 'item_received', { timeoutMs: 100 });

        body.observeEvent({ kind: 'chat', text: 'hello' });
        body.observeEvent({ kind: 'item_received', item: { itemId: 1511, key: 'rs:logs', amount: 1 } });

        await expect(waiting).resolves.toEqual({
            ok: true,
            observation: expect.objectContaining({
                seq: 2,
                value: expect.objectContaining({ kind: 'item_received' }),
            }),
        });
    });

    it('times out with a structured failure result', async () => {
        const body = testBody();

        await expect(body.waitForEvent(event => event.kind === 'arrived', { timeoutMs: 1 })).resolves.toEqual({
            ok: false,
            reason: 'timeout',
        });
    });

    it('aborts and cleans up pending waiters', async () => {
        const body = testBody();
        const abort = new AbortController();
        const waiting = body.waitForPerception(() => true, { timeoutMs: 100, signal: abort.signal });

        abort.abort();

        await expect(waiting).resolves.toEqual({ ok: false, reason: 'aborted' });
        expect(body.getPendingWaiterCount()).toBe(0);
    });

    it('keeps event history bounded while sequence numbers keep increasing', () => {
        const body = testBody();

        for (let index = 0; index < 105; index += 1) {
            body.observeEvent({ kind: 'chat', text: `event ${index}` });
        }

        expect(body.getLatestEventSeq()).toBe(105);
        expect(body.getRecentEvents()).toHaveLength(100);
        expect(body.getRecentEvents()[0]).toEqual({ kind: 'chat', text: 'event 5' });
    });

    it('preserves gateway request ids when the gateway exposes them', async () => {
        const gateway = {
            submitAction: jest.fn(async () => ({ ok: true })),
            submitActionWithRequestId: jest.fn(async () => ({ requestId: 'request-1', ackResult: { ok: true, cause: 'queued' } })),
        };
        const actionLog = { append: jest.fn() } as unknown as ActionLog;
        const body = new ResidentBody({ resident: 'res:test', gateway, actionLog });

        const result = await body.submit({ kind: 'noop' }, { tick: 1, source: 'thinking' });

        expect(result).toEqual({ ok: true, cause: 'queued', requestId: 'request-1' });
        expect(gateway.submitActionWithRequestId).toHaveBeenCalledWith('res:test', { kind: 'noop' });
        expect(actionLog.append).toHaveBeenCalledWith(
            'res:test',
            expect.objectContaining({
                result: { ok: true, cause: 'queued', requestId: 'request-1' },
            }),
        );
    });
});

function testBody(): ResidentBody {
    const gateway: BodyGateway = {
        submitAction: jest.fn(async () => ({ ok: true })),
    };
    const actionLog = { append: jest.fn() } as unknown as ActionLog;
    return new ResidentBody({ resident: 'res:test', gateway, actionLog });
}

function inventory(perception: Record<string, unknown>): Array<{ key?: string } | null> {
    const resident = record(perception.resident);
    return Array.isArray(resident.inventory) ? (resident.inventory as Array<{ key?: string } | null>) : [];
}

function position(perception: Record<string, unknown>): unknown {
    return record(perception.resident).position;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
