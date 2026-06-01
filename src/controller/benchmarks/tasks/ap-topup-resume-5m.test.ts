import type { AgentAction } from '../../transport/message-codecs';
import {
    AP_TOPUP_RESUME_5M_TASK_ID,
    AP_TOPUP_RESUME_5M_TASK_VERSION,
    makeApTopupResume5mBenchmarkTask,
    verifyApTopupResume5m,
} from './ap-topup-resume-5m';

describe('ap-topup-resume-5m benchmark task', () => {
    describe('verifyApTopupResume5m', () => {
        it('passes when low AP ask, fade, top-up jump, and resumed action are all observed', () => {
            const outcome = verifyApTopupResume5m({
                elapsedMs: 80_000,
                actions: [
                    attempt({ kind: 'say', text: 'I need AP.', cause: 'nervous:request-attention' }, 'success', 10),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 0),
                    attempt({ kind: 'say', text: 'Resuming my work.', cause: 'direct_chat_wait_resume' }, 'success', 3000),
                    attempt({ kind: 'move_to', x: 3223, y: 3218, range: 1, cause: 'resume_path' }, 'success', 2999),
                ],
                perceptions: [],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome).toMatchObject({
                status: 'passed',
                score: 1,
                metrics: {
                    startingAp: 10,
                    finalAp: 2999,
                    apDecayObserved: 1,
                    lowApAskActions: 1,
                    attentionExhaustedLogouts: 1,
                    topUpJumps: 1,
                    resumeAfterTopUpActions: 1,
                },
            });
        });

        it('fails when no AP top-up jump is observed after fade', () => {
            const outcome = verifyApTopupResume5m({
                elapsedMs: 70_000,
                actions: [
                    attempt({ kind: 'say', text: 'running low', cause: 'nervous:request-attention' }, 'success', 10),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 0),
                    attempt({ kind: 'say', text: 'still fading', cause: 'status' }, 'success', 0),
                ],
                perceptions: [],
                events: [{ kind: 'resident_faded' }],
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.failureReason).toContain('No AP top-up jump');
            expect(outcome.metrics).toMatchObject({ topUpJumps: 0 });
        });

        it('fails when top-up happens but no resumed non-logout action follows', () => {
            const outcome = verifyApTopupResume5m({
                elapsedMs: 70_000,
                actions: [
                    attempt({ kind: 'request_attention', cause: 'low_ap' }, 'success', 6),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 0),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 3000),
                ],
                perceptions: [],
                events: [{ kind: 'resident_faded' }],
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.failureReason).toContain('no resumed non-logout action');
            expect(outcome.metrics).toMatchObject({ topUpJumps: 1, resumeAfterTopUpActions: 0 });
        });

        it('accepts benchmark AP top-up evidence even when gateway logout evidence lands after the top-up record', () => {
            const outcome = verifyApTopupResume5m({
                elapsedMs: 85_000,
                actions: [
                    attempt({ kind: 'say', text: 'I need AP.', cause: 'nervous:request-attention' }, 'success', 10),
                    attempt({ kind: 'ap_topup', cause: 'benchmark:ap-topup-resume-5m', amount: 3000 }, 'success', 3000),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 0),
                    attempt({ kind: 'say', text: 'AP received; resuming.', cause: 'nervous:attention-topup-resume' }, 'success', 2999),
                ],
                perceptions: [],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome).toMatchObject({
                status: 'passed',
                score: 1,
                metrics: {
                    topUpJumps: 1,
                    resumeAfterTopUpActions: 1,
                },
            });
        });

        it('does not count a body-blocked resume line as visible resumed work', () => {
            const outcome = verifyApTopupResume5m({
                elapsedMs: 85_000,
                actions: [
                    attempt({ kind: 'say', text: 'I need AP.', cause: 'nervous:request-attention' }, 'success', 10),
                    attempt({ kind: 'ap_topup', cause: 'benchmark:ap-topup-resume-5m', amount: 3000 }, 'success', 3000),
                    attempt({ kind: 'say', text: 'AP received; resuming.', cause: 'nervous:attention-topup-resume' }, 'blocked', 2999),
                    attempt({ kind: 'logout', cause: 'attention_exhausted' }, 'failure', 0),
                ],
                perceptions: [],
                events: [{ kind: 'attention_exhausted' }],
            });

            expect(outcome.status).toBe('failed');
            expect(outcome.failureReason).toContain('no resumed non-logout action');
            expect(outcome.metrics).toMatchObject({
                topUpJumps: 1,
                resumeAfterTopUpActions: 0,
            });
        });
    });

    describe('makeApTopupResume5mBenchmarkTask', () => {
        it('declares the expected task id/version and autonomous mode support', () => {
            const task = makeApTopupResume5mBenchmarkTask(() => 0);

            expect(task.id).toBe(AP_TOPUP_RESUME_5M_TASK_ID);
            expect(task.version).toBe(AP_TOPUP_RESUME_5M_TASK_VERSION);
            expect(task.timeoutMs).toBe(5 * 60 * 1000);
            expect(task.runAutonomous).toBeDefined();
            expect(task.run).toBeDefined();
        });
    });
});

function attempt(action: AgentAction, finalStatus = 'success', attentionAfter?: number) {
    return { action, finalStatus, attentionAfter };
}
