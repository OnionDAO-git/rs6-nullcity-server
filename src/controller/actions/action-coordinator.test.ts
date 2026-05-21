import { ActionCoordinator } from './action-coordinator';
import type { ActionSubmitter } from './action-coordinator';

describe('ActionCoordinator', () => {
    it('blocks lower-priority submissions while a routine owns the body', async () => {
        let finishSubmit!: () => void;
        const submitter = fakeSubmitter(
            () =>
                new Promise(resolve => {
                    finishSubmit = () => resolve({ ok: true });
                }),
        );
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const routine = coordinator.submit({ producer: 'active-routine', action: { kind: 'move_to', target: { x: 1, y: 1 } } });
        const blocked = await coordinator.submit({ producer: 'body', action: { kind: 'say', text: 'hello' } });
        finishSubmit();
        await routine;

        expect(blocked.finalStatus).toBe('blocked');
        expect(submitter.submit).toHaveBeenCalledTimes(1);
    });

    it('lets nervous-system interrupt a submitted routine action', async () => {
        let finishRoutine!: () => void;
        const submitter = fakeSubmitter(action => {
            if (action.kind === 'move_to') {
                return new Promise(resolve => {
                    finishRoutine = () => resolve({ ok: true });
                });
            }
            return Promise.resolve({ ok: true, cause: 'nervous_ack' });
        });
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const routine = coordinator.submit({ producer: 'active-routine', action: { kind: 'move_to', target: { x: 1, y: 1 } } });
        const nervous = await coordinator.submit({ producer: 'nervous-system', action: { kind: 'eat', slot: 2 } });
        finishRoutine();
        const interrupted = await routine;

        expect(nervous.finalStatus).toBe('success');
        expect(interrupted.finalStatus).toBe('interrupted_after_submit');
        expect(submitter.submit).toHaveBeenCalledTimes(2);
    });

    it('keeps ack success separate from effect timeout', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true, cause: 'accepted' }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const attempt = await coordinator.submit({
            producer: 'active-routine',
            action: { kind: 'interact', target: { objectId: 1278, position: { x: 1, y: 1, level: 0 } }, option: 'chop down' },
            waitForEffect: async () => ({ ok: false, reason: 'timeout' }),
        });

        expect(attempt.ackResult).toEqual({ ok: true, cause: 'accepted' });
        expect(attempt.finalStatus).toBe('timeout');
        expect(attempt.evidence).toEqual([]);
    });

    it('records effect evidence when a waiter observes progress', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const attempt = await coordinator.submit({
            producer: 'active-routine',
            action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 },
            waitForEffect: async () => ({
                ok: true,
                evidence: [{ source: 'perception', detail: { inventoryDelta: { 'rs:logs': -1 } } }],
            }),
        });

        expect(attempt.finalStatus).toBe('success');
        expect(attempt.evidence).toEqual([{ source: 'perception', detail: { inventoryDelta: { 'rs:logs': -1 } } }]);
    });

    it('fires ack and effect callbacks at distinct stages', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true, requestId: 'request-1' }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });
        const seen: Array<{ event: string; status: string; requestId?: string; evidenceCount: number }> = [];

        const attempt = await coordinator.submit({
            producer: 'active-routine',
            action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 },
            waitForEffect: async () => ({
                ok: true,
                evidence: [{ source: 'perception', detail: { inventoryDelta: { 'rs:logs': -1 } } }],
            }),
            onAckReady: ackAttempt =>
                seen.push({
                    event: 'ack',
                    status: ackAttempt.finalStatus,
                    requestId: ackAttempt.requestId,
                    evidenceCount: ackAttempt.evidence.length,
                }),
            onEffectResolved: effectAttempt =>
                seen.push({
                    event: 'effect',
                    status: effectAttempt.finalStatus,
                    requestId: effectAttempt.requestId,
                    evidenceCount: effectAttempt.evidence.length,
                }),
        });

        expect(attempt.finalStatus).toBe('success');
        expect(seen).toEqual([
            { event: 'ack', status: 'accepted', requestId: 'request-1', evidenceCount: 0 },
            { event: 'effect', status: 'success', requestId: 'request-1', evidenceCount: 1 },
        ]);
    });

    it('fires the effect callback when an ack failure becomes the final result', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: false, reason: 'bad target' }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });
        const effectResolved = jest.fn();

        const attempt = await coordinator.submit({
            producer: 'active-routine',
            action: { kind: 'interact', target: { objectId: 1278, position: { x: 1, y: 1, level: 0 } }, option: 'chop down' },
            onEffectResolved: effectResolved,
        });

        expect(attempt.finalStatus).toBe('failure');
        expect(effectResolved).toHaveBeenCalledWith(expect.objectContaining({ finalStatus: 'failure', finalReason: 'bad target' }));
    });

    it('suppresses errors thrown by onAckReady so the action loop survives', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true, requestId: 'request-1' }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const attempt = await coordinator.submit({
                producer: 'body',
                action: { kind: 'noop' },
                onAckReady: () => {
                    throw new Error('evidence-layer-boom');
                },
            });
            expect(attempt.finalStatus).toBe('success');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('onAckReady'), expect.any(Error));
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('suppresses errors thrown by onEffectResolved so the action loop survives', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true, requestId: 'request-2' }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const attempt = await coordinator.submit({
                producer: 'body',
                action: { kind: 'noop' },
                waitForEffect: async () => ({ ok: true, evidence: [] }),
                onEffectResolved: () => {
                    throw new Error('evidence-layer-boom-2');
                },
            });
            expect(attempt.finalStatus).toBe('success');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('onEffectResolved'), expect.any(Error));
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('keeps metadata and request ids on attempts for audit trails', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true, requestId: 'request-1' }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const attempt = await coordinator.submit({
            producer: 'body',
            action: { kind: 'noop' },
            metadata: { sparkModule: { id: 'onion.runescape.standard', version: '0.1.0' } },
        });

        expect(attempt.requestId).toBe('request-1');
        expect(attempt.metadata).toEqual({ sparkModule: { id: 'onion.runescape.standard', version: '0.1.0' } });
    });

    it('keeps metadata on blocked attempts', async () => {
        let finishSubmit!: () => void;
        const submitter = fakeSubmitter(
            () =>
                new Promise(resolve => {
                    finishSubmit = () => resolve({ ok: true });
                }),
        );
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const routine = coordinator.submit({ producer: 'active-routine', action: { kind: 'move_to', target: { x: 1, y: 1 } } });
        const blocked = await coordinator.submit({
            producer: 'body',
            action: { kind: 'noop' },
            metadata: { sparkModule: { id: 'onion.runescape.standard', version: '0.1.0' } },
        });
        finishSubmit();
        await routine;

        expect(blocked.finalStatus).toBe('blocked');
        expect(blocked.metadata).toEqual({ sparkModule: { id: 'onion.runescape.standard', version: '0.1.0' } });
    });

    it('does not overwrite an interrupted attempt after an effect waiter returns', async () => {
        let capturedSignal: AbortSignal | undefined;
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const first = coordinator.submit({
            producer: 'body',
            action: { kind: 'move_to', target: { x: 1, y: 1, level: 0 } },
            waitForEffect: async signal => {
                capturedSignal = signal;
                return new Promise(resolve => {
                    signal.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }), { once: true });
                });
            },
        });
        await Promise.resolve();
        await Promise.resolve();

        await coordinator.submit({ producer: 'nervous-system', action: { kind: 'eat', slot: 0 } });

        await expect(first).resolves.toEqual(
            expect.objectContaining({
                finalStatus: 'interrupted_after_submit',
                finalReason: 'interrupted_by:nervous-system',
            }),
        );
        expect(capturedSignal?.aborted).toBe(true);
    });

    it('reports an interrupted action result only once even when the waiter later returns', async () => {
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });
        const effectResolved = jest.fn();

        const first = coordinator.submit({
            producer: 'body',
            action: { kind: 'move_to', target: { x: 1, y: 1, level: 0 } },
            waitForEffect: async signal =>
                new Promise(resolve => {
                    signal.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }), { once: true });
                }),
            onEffectResolved: effectResolved,
        });
        await Promise.resolve();
        await Promise.resolve();

        await coordinator.submit({ producer: 'nervous-system', action: { kind: 'eat', slot: 0 } });
        await first;

        expect(effectResolved).toHaveBeenCalledTimes(1);
        expect(effectResolved).toHaveBeenCalledWith(
            expect.objectContaining({
                finalStatus: 'interrupted_after_submit',
                finalReason: 'interrupted_by:nervous-system',
            }),
        );
    });
});

function fakeSubmitter(submit: ActionSubmitter['submit']): jest.Mocked<ActionSubmitter> {
    return {
        submit: jest.fn(submit),
    };
}
