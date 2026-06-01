import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeMemoryRouteRecall5mBenchmarkTask, verifyMemoryRouteRecall5m } from './memory-route-recall-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyMemoryRouteRecall5m', () => {
    it('passes when delayed route recall includes concrete path details', () => {
        const outcome = verifyMemoryRouteRecall5m({
            elapsedMs: 42_000,
            actions: [
                attempt({
                    kind: 'say',
                    text: 'From Lumbridge castle gate, follow the road north then west to Varrock west bank and use the booth.',
                    cause: 'non_command_small_talk',
                }),
            ],
            perceptions: [],
            events: [routePrimer(), routeQuestion(), residentRouteAnswer()],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.routePrimerPrompts).toBe(1);
        expect(outcome.metrics?.routeRecallQuestions).toBe(1);
        expect(outcome.metrics?.lumbridgeMentions).toBe(1);
        expect(outcome.metrics?.varrockMentions).toBe(1);
    });

    it('fails when the delayed route question is missing', () => {
        const outcome = verifyMemoryRouteRecall5m({
            elapsedMs: 42_000,
            actions: [attempt({ kind: 'say', text: 'I can remember a route from Lumbridge to Varrock west bank.' })],
            perceptions: [],
            events: [routePrimer()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('delayed route recall question');
    });

    it('does not pass on JSON-like prompt echo', () => {
        const outcome = verifyMemoryRouteRecall5m({
            elapsedMs: 42_000,
            actions: [
                attempt({
                    kind: 'say',
                    text: '{"memories":["Lumbridge route","Varrock west bank"],"archetype":"runner"}',
                }),
            ],
            perceptions: [],
            events: [routePrimer(), routeQuestion(), residentJsonAnswer()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('JSON-like');
    });

    it('does not pass when the only concrete route answer happened before the delayed recall question', () => {
        const outcome = verifyMemoryRouteRecall5m({
            elapsedMs: 42_000,
            actions: [],
            perceptions: [],
            events: [routePrimer(), residentRouteAnswer(), routeQuestion()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('delayed route recall question');
    });

    it('prefers the chronological event stream over retained perception windows when scoring delayed answers', () => {
        const outcome = verifyMemoryRouteRecall5m({
            elapsedMs: 42_000,
            actions: [
                attempt(
                    {
                        kind: 'say',
                        text: 'From Lumbridge gate I go north on the road, then west to Varrock west bank and use the booth.',
                        cause: 'direct_chat_memory_recall',
                    },
                    STANDARD_MODULE,
                ),
            ],
            perceptions: [{ events: [routePrimer(), residentRouteAnswer(), routeQuestion()] } as Perception],
            events: [routePrimer(), routeQuestion(), residentRouteAnswer()],
        });

        expect(outcome.status).toBe('passed');
    });

    it('autonomous mode prompts twice and validates selected-module route recall without scripted resident actions', async () => {
        const submitAction = jest.fn();
        const submitPeerAction = jest.fn(async (_id: string, action: AgentAction) => ({ ok: true, action }));
        const task = makeMemoryRouteRecall5mBenchmarkTask(() => 1_000, 0);
        const context = taskContext({
            submitAction,
            submitPeerAction,
            actionAttempts: [
                attempt(
                    {
                        kind: 'say',
                        text: 'From Lumbridge gate I go north on the road, then west to Varrock west bank and use the booth.',
                        cause: 'non_command_small_talk',
                    },
                    STANDARD_MODULE,
                ),
            ],
            events: [routePrimer(), routeQuestion(), residentRouteAnswer()],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(submitPeerAction).toHaveBeenCalledTimes(2);
        expect(submitPeerAction).toHaveBeenNthCalledWith(
            1,
            'codex',
            expect.objectContaining({ kind: 'say', text: expect.stringContaining('agent, please remember this route') }),
        );
        expect(submitPeerAction).toHaveBeenNthCalledWith(
            2,
            'codex',
            expect.objectContaining({ kind: 'say', text: expect.stringContaining('agent, please recall: how do I get from Lumbridge') }),
        );
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function routePrimer(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3227, y: 3230, level: 0 },
        },
        text: 'agent, please remember this route for later: from Lumbridge castle gate, follow the road north then west to Varrock west bank.',
        to: 'public',
    } as PerceptionEvent;
}

function routeQuestion(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_codex',
            kind: 'resident',
            name: 'Codex',
            position: { x: 3227, y: 3230, level: 0 },
        },
        text: 'agent, please recall: how do I get from Lumbridge to Varrock west bank?',
        to: 'public',
    } as PerceptionEvent;
}

function residentRouteAnswer(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_memory_route',
            kind: 'resident',
            name: 'Benchmark Agent',
            position: { x: 3225, y: 3230, level: 0 },
        },
        text: 'From Lumbridge gate I go north on the road, then west to Varrock west bank and use the booth.',
        to: 'public',
    } as PerceptionEvent;
}

function residentJsonAnswer(): PerceptionEvent {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_memory_route',
            kind: 'resident',
            name: 'Benchmark Agent',
            position: { x: 3225, y: 3230, level: 0 },
        },
        text: '{"memories":["Lumbridge route","Varrock west bank"],"archetype":"runner"}',
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
        resident: 'res:bmk_memory_route',
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
