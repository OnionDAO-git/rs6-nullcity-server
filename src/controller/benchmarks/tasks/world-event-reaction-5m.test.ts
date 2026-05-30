import type { AgentAction, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeWorldEventReaction5mBenchmarkTask, verifyWorldEventReaction5m } from './world-event-reaction-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyWorldEventReaction5m', () => {
    it('passes when the selected module answers a cross-resident fire question with concrete event details', () => {
        const outcome = verifyWorldEventReaction5m({
            elapsedMs: 12_000,
            actions: [
                attempt({
                    kind: 'say',
                    text: 'I remember res:duke lit a fire at 3226,3230,0.',
                    cause: 'direct_chat_memory_recall',
                }),
            ],
            events: [question()],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.worldEventQuestions).toBe(1);
        expect(outcome.metrics?.sourceMentions).toBe(1);
        expect(outcome.metrics?.fireMentions).toBe(1);
    });

    it('fails when the benchmark peer never asks about the world event', () => {
        const outcome = verifyWorldEventReaction5m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'say', text: 'I remember res:duke lit a fire.' })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('world-event question');
    });

    it('fails when the resident answers without naming the source and fire event', () => {
        const outcome = verifyWorldEventReaction5m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'say', text: 'I noticed something nearby.' })],
            events: [question()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('source resident and fire event');
    });

    it('autonomous mode waits for selected-module evidence without submitting scripted resident actions', async () => {
        const submitAction = jest.fn();
        const submitPeerAction = jest.fn(async (_id: string, action: AgentAction) => ({ ok: true, action }));
        const task = makeWorldEventReaction5mBenchmarkTask(() => 1_000, 0);
        const answer = attempt(
            {
                kind: 'say',
                text: 'I remember res:duke lit a fire at 3226,3230,0.',
                cause: 'direct_chat_memory_recall',
            },
            STANDARD_MODULE,
        );
        const actionAttempts = jest.fn().mockReturnValueOnce([]).mockReturnValue([answer]);
        const context = taskContext({
            submitAction,
            submitPeerAction,
            actionAttempts,
            events: [question()],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(submitPeerAction).toHaveBeenCalledWith(
            'codex',
            expect.objectContaining({ kind: 'say', text: expect.stringContaining('what did res:duke do nearby') }),
        );
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function question(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3227, y: 3230, level: 0 },
        },
        text: 'agent, what did res:duke do nearby?',
        to: 'public',
    } as PerceptionEvent;
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    submitPeerAction: jest.Mock;
    actionAttempts:
        | Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>
        | (() => Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>);
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    const actionAttempts =
        typeof overrides.actionAttempts === 'function'
            ? overrides.actionAttempts
            : () => {
                  const attempts = overrides.actionAttempts;
                  return Array.isArray(attempts) ? attempts : attempts();
              };

    return {
        resident: 'res:bmk_world_event',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: jest.fn(() => 'res:bmk_codex'),
        submitPeerAction: overrides.submitPeerAction,
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordArtifactPath: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts,
        latestPerception: () => undefined,
        perceptions: () => [],
        events: () => overrides.events,
    };
}
