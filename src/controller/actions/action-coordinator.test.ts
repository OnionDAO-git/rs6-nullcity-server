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
        let releaseWait!: () => void;
        const submitter = fakeSubmitter(() => Promise.resolve({ ok: true }));
        const coordinator = new ActionCoordinator({ resident: 'res:test', submitter });

        const first = coordinator.submit({
            producer: 'body',
            action: { kind: 'move_to', target: { x: 1, y: 1, level: 0 } },
            waitForEffect: async () => {
                await new Promise<void>(resolve => {
                    releaseWait = resolve;
                });
                return { ok: true };
            },
        });
        await Promise.resolve();

        await coordinator.submit({ producer: 'nervous-system', action: { kind: 'eat', slot: 0 } });
        releaseWait();

        await expect(first).resolves.toEqual(
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
