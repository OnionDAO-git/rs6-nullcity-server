import { ResidentBody } from '../body/body';
import type { BodyGateway } from '../body/body';
import type { ActionLog } from '../logging/action-log';
import { ActionCoordinator } from './action-coordinator';
import { ResidentActions } from './resident-actions';

describe('ResidentActions', () => {
    it('walks once and waits for a future position before reporting success', async () => {
        const { actions, body, gateway } = testActions();
        body.observePerception({ tick: 1, resident: { position: { x: 1, y: 1, level: 0 } } });

        const walking = actions.walkTo({ x: 5, y: 5, level: 0 }, { timeoutMs: 100 });

        await Promise.resolve();
        expect(gateway.submitAction).toHaveBeenCalledTimes(1);
        expect(gateway.submitAction).toHaveBeenCalledWith('res:test', { kind: 'move_to', target: { x: 5, y: 5, level: 0 } });

        body.observePerception({ tick: 2, resident: { position: { x: 5, y: 5, level: 0 } } });

        await expect(walking).resolves.toMatchObject({
            finalStatus: 'success',
            evidence: [{ source: 'perception', detail: { kind: 'position_reached', position: { x: 5, y: 5, level: 0 } } }],
        });
    });

    it('says a line once and waits for a matching chat event', async () => {
        const { actions, body, gateway } = testActions();

        const saying = actions.say('I am testing my senses.', { timeoutMs: 100 });

        await Promise.resolve();
        expect(gateway.submitAction).toHaveBeenCalledTimes(1);
        expect(gateway.submitAction).toHaveBeenCalledWith('res:test', { kind: 'say', text: 'I am testing my senses.' });

        body.observeEvent({ kind: 'chat', text: 'I am testing my senses.' });

        await expect(saying).resolves.toMatchObject({
            finalStatus: 'success',
            evidence: [{ source: 'event', detail: { kind: 'chat_observed', text: 'I am testing my senses.' } }],
        });
    });

    it('keeps action acknowledgement separate from effect timeout', async () => {
        const { actions } = testActions();

        await expect(actions.walkTo({ x: 9, y: 9, level: 0 }, { timeoutMs: 1 })).resolves.toMatchObject({
            ackResult: { ok: true },
            finalStatus: 'timeout',
            finalReason: 'timeout',
        });
    });
});

function testActions(): { actions: ResidentActions; body: ResidentBody; gateway: jest.Mocked<BodyGateway> } {
    const gateway: jest.Mocked<BodyGateway> = {
        submitAction: jest.fn<ReturnType<BodyGateway['submitAction']>, Parameters<BodyGateway['submitAction']>>(async () => ({ ok: true })),
    };
    const body = new ResidentBody({
        resident: 'res:test',
        gateway,
        actionLog: { append: jest.fn() } as unknown as ActionLog,
    });
    const coordinator = new ActionCoordinator({ resident: 'res:test', submitter: body });
    return {
        actions: new ResidentActions({ body, coordinator }),
        body,
        gateway,
    };
}
