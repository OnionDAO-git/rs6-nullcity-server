import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeMemoryRecall3mBenchmarkTask, verifyMemoryRecall3m } from './memory-recall-3m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyMemoryRecall3m', () => {
    it('passes when the resident answers a nearby memory question with concrete Library details', () => {
        const outcome = verifyMemoryRecall3m({
            elapsedMs: 18_000,
            actions: [
                attempt({
                    kind: 'say',
                    text: 'Alice gave me a tinderbox, and I promised Codex shrimp.',
                    cause: 'non_command_small_talk',
                }),
            ],
            perceptions: [],
            events: [peerQuestion()],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.memoryQuestions).toBe(1);
        expect(outcome.metrics?.aliceMentions).toBe(1);
        expect(outcome.metrics?.tinderboxMentions).toBe(1);
        expect(outcome.metrics?.shrimpMentions).toBe(1);
    });

    it('does not pass on vague chatter that ignores the seeded memories', () => {
        const outcome = verifyMemoryRecall3m({
            elapsedMs: 18_000,
            actions: [attempt({ kind: 'say', text: 'I remember that people have helped me before.' })],
            perceptions: [],
            events: [peerQuestion()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBeLessThan(1);
        expect(outcome.failureReason).toContain('did not mention');
    });

    it('does not pass on JSON-like prompt echo even when the memory words appear', () => {
        const outcome = verifyMemoryRecall3m({
            elapsedMs: 18_000,
            actions: [
                attempt({
                    kind: 'say',
                    text: '{ "archetype": "endurer", "memories": ["Patron gift from alice@onion: rs:tinderbox", "promised Codex shrimp"] }',
                }),
            ],
            perceptions: [],
            events: [peerQuestion()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('JSON-like');
    });

    it('autonomous mode asks once and observes selected-module recall without submitting scripted resident actions', async () => {
        const submitAction = jest.fn();
        const submitPeerAction = jest.fn(async (_id: string, action: AgentAction) => ({ ok: true, action }));
        const task = makeMemoryRecall3mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            submitPeerAction,
            actionAttempts: [
                attempt(
                    {
                        kind: 'say',
                        text: 'Alice gave me a tinderbox, and I promised Codex shrimp.',
                        cause: 'non_command_small_talk',
                    },
                    STANDARD_MODULE,
                ),
            ],
            events: [peerQuestion()],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(submitPeerAction).toHaveBeenCalledWith(
            'codex',
            expect.objectContaining({ kind: 'say', text: expect.stringContaining('alice@onion') }),
        );
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function peerQuestion(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3227, y: 3230, level: 0 },
        },
        text: 'Hey friend, what do you remember about alice@onion and my shrimp promise?',
        to: 'public',
    } as PerceptionEvent;
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    submitPeerAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>;
    events: PerceptionEvent[];
    perceptions?: Perception[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_memory',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: jest.fn(() => 'res:bmk_codex'),
        submitPeerAction: overrides.submitPeerAction,
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts,
        latestPerception: () => overrides.perceptions?.at(-1),
        perceptions: () => overrides.perceptions || [],
        events: () => overrides.events,
    };
}
