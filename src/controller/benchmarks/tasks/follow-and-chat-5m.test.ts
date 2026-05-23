import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeFollowAndChat5mBenchmarkTask, verifyFollowAndChat5m } from './follow-and-chat-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyFollowAndChat5m', () => {
    it('passes when a peer command causes the resident to follow and answer in chat', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 42_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
                attempt({ kind: 'say', text: 'I am online at 3228,3230. Goal: Follow Codex.', cause: 'direct_chat_status' }),
                attempt({ kind: 'say', text: 'I will pause here and wait for a new goal.' }),
                attempt({ kind: 'move_to', target: { x: 3234, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3234, 3230)] }),
                perception({ position: { x: 3232, y: 3230, level: 0 }, players: [player('Codex', 3234, 3230)] }),
            ],
            events: commandLoopEvents(),
            refollowText: 'agent follow me again',
            waitCommandAfterActionIndex: 2,
            refollowCommandAfterActionIndex: 3,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.followCommands).toBe(2);
        expect(outcome.metrics?.followActions).toBe(2);
        expect(outcome.metrics?.chatResponses).toBe(2);
        expect(outcome.metrics?.statusResponses).toBe(1);
        expect(outcome.metrics?.waitAcknowledgements).toBe(1);
        expect(outcome.metrics?.refollowActions).toBe(1);
    });

    it('fails when the resident follows and answers but never acknowledges wait or resumes following', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 42_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
                attempt({ kind: 'say', text: 'I am online at 3228,3230. Goal: Follow Codex.', cause: 'direct_chat_status' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230), chat('agent status', 3229, 3230)],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No benchmark peer wait command');
        expect(outcome.metrics?.waitCommands).toBe(0);
        expect(outcome.metrics?.refollowActions).toBe(0);
    });

    it('counts movement toward the benchmark speaker as follow movement without a follow cause', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 42_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'body_step' }),
                attempt({ kind: 'say', text: 'I am online at 3228,3230. I am with you.', cause: 'direct_chat_status' }),
                attempt({ kind: 'say', text: 'I will pause here and wait for a new goal.' }),
                attempt({ kind: 'move_to', target: { x: 3234, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3234, 3230)] }),
            ],
            events: commandLoopEvents(),
            refollowText: 'agent follow me again',
            waitCommandAfterActionIndex: 2,
            refollowCommandAfterActionIndex: 3,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.followActions).toBe(2);
    });

    it('does not pass no-cause follow movement when observed movement does not approach the speaker', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 42_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'body_step' }),
                attempt({ kind: 'say', text: 'I am online at 3225,3232. I am with you.', cause: 'direct_chat_status' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3225, y: 3232, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230), chat('agent status', 3229, 3230)],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('no progress toward the speaker');
        expect(outcome.metrics?.followActions).toBe(1);
        expect(outcome.metrics?.movedTowardSpeaker).toBe(0);
    });

    it('caps no-cause follow target range to the benchmark follow tolerance', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 42_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3200, y: 3200, level: 0 }, range: 100, cause: 'body_step' }),
                attempt({ kind: 'say', text: 'I am online at 3228,3230. I am with you.', cause: 'direct_chat_status' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230), chat('agent status', 3229, 3230)],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No direct follow movement');
        expect(outcome.metrics?.followActions).toBe(0);
    });

    it('fails clearly when the resident answers but never follows', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'say', text: 'hello', cause: 'direct_chat_status' })],
            perceptions: [perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] })],
            events: [chat('agent follow me', 3229, 3230)],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No direct follow movement');
    });

    it('fails clearly when the resident follows but never answers in chat', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' })],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230), chat('agent status', 3229, 3230)],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No chat response');
    });

    it('credits arrival events as follow progress while still requiring benchmark peer chat', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 20_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
                attempt({ kind: 'say', text: 'status: I am with you', cause: 'direct_chat_status' }),
                attempt({ kind: 'say', text: 'I will pause here and wait for a new goal.' }),
                attempt({ kind: 'move_to', target: { x: 3234, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
            ],
            perceptions: [perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] })],
            events: [...commandLoopEvents(), arrived()],
            refollowText: 'agent follow me again',
            waitCommandAfterActionIndex: 2,
            refollowCommandAfterActionIndex: 3,
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.arrivedEvents).toBe(1);
    });

    it('rejects follow and status commands from a non-benchmark peer', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 20_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
                attempt({ kind: 'say', text: 'I am online at 3228,3230.', cause: 'direct_chat_status' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230, 'NotCodex'), chat('agent status', 3229, 3230, 'NotCodex')],
            peerId: 'player:codex',
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No peer follow command');
        expect(outcome.metrics?.followCommands).toBe(0);
    });

    it('does not credit unrelated speech as the status response', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 20_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
                attempt({ kind: 'say', text: 'Chopping trees for logs now.' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230), chat('agent status', 3229, 3230)],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No status chat response');
        expect(outcome.metrics?.chatResponses).toBe(1);
        expect(outcome.metrics?.statusResponses).toBe(0);
    });

    it('does not credit status-like speech that happened before the benchmark status prompt', () => {
        const outcome = verifyFollowAndChat5m({
            elapsedMs: 20_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' }),
                attempt({ kind: 'say', text: 'I am online at 3228,3230.', cause: 'ambient_status' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
            ],
            events: [chat('agent follow me', 3229, 3230), chat('agent status', 3229, 3230)],
            statusResponseAfterActionIndex: 2,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No status chat response');
        expect(outcome.metrics?.chatResponses).toBe(1);
        expect(outcome.metrics?.statusResponses).toBe(0);
    });

    it('autonomous mode uses peer stimuli without submitting scripted agent actions', async () => {
        const submitAction = jest.fn();
        const followText = 'agent follow me benchmark res:bmk_follow';
        const statusText = 'agent status benchmark res:bmk_follow';
        const waitText = 'agent wait benchmark res:bmk_follow';
        const refollowText = 'agent follow me again benchmark res:bmk_follow';
        const actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }> = [];
        const perceptions: Perception[] = [
            perception({ position: { x: 3225, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }),
        ];
        const events: PerceptionEvent[] = [];
        const submitPeerAction = jest.fn(async (_id: string, action: AgentAction) => {
            if (action.kind === 'say' && action.text === followText) {
                events.push(chat(followText, 3229, 3230, 'res:bmk_codex', 'resident'));
                actionAttempts.push(
                    attempt(
                        { kind: 'move_to', target: { x: 3229, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' },
                        STANDARD_MODULE,
                    ),
                );
                perceptions.push(perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3229, 3230)] }));
            }
            if (action.kind === 'say' && action.text === statusText) {
                events.push(chat(statusText, 3229, 3230, 'res:bmk_codex', 'resident'));
                actionAttempts.push(
                    attempt({ kind: 'say', text: 'I am online at 3228,3230.', cause: 'direct_chat_status' }, STANDARD_MODULE),
                );
            }
            if (action.kind === 'say' && action.text === waitText) {
                events.push(chat(waitText, 3229, 3230, 'res:bmk_codex', 'resident'));
                actionAttempts.push(attempt({ kind: 'say', text: 'I will pause here and wait for a new goal.' }, STANDARD_MODULE));
            }
            if (action.kind === 'move_to') {
                perceptions.push(perception({ position: { x: 3228, y: 3230, level: 0 }, players: [player('Codex', 3234, 3230)] }));
            }
            if (action.kind === 'say' && action.text === refollowText) {
                events.push(chat(refollowText, 3234, 3230, 'res:bmk_codex', 'resident'));
                actionAttempts.push(
                    attempt(
                        { kind: 'move_to', target: { x: 3234, y: 3230, level: 0 }, range: 2, cause: 'direct_chat_follow' },
                        STANDARD_MODULE,
                    ),
                );
            }
            return { ok: true };
        });
        let currentTime = 1_000;
        const task = makeFollowAndChat5mBenchmarkTask(() => {
            currentTime += 500;
            return currentTime;
        });
        const context = taskContext({
            submitAction,
            submitPeerAction,
            actionAttempts,
            perceptions,
            events,
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitPeerAction).toHaveBeenCalledWith('codex', expect.objectContaining({ kind: 'say', text: followText }));
        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function perception(overrides: {
    position: { x: number; y: number; level: number };
    players?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            id: 'resident:res:bmk_follow',
            position: overrides.position,
        },
        nearby: {
            objects: [],
            npcs: [],
            players: overrides.players || [],
            worldItems: [],
        },
        events: overrides.events || [],
    };
}

function player(name: string, x: number, y: number, kind: 'player' | 'resident' = 'player'): Record<string, unknown> {
    return {
        id: `${kind}:${name.toLowerCase()}`,
        kind,
        name,
        position: { x, y, level: 0 },
        hpFraction: 1,
    };
}

function chat(text: string, x: number, y: number, name = 'Codex', kind: 'player' | 'resident' = 'player'): PerceptionEvent {
    return {
        kind: 'chat',
        from: player(name, x, y, kind),
        text,
        to: 'public',
    };
}

function arrived(): PerceptionEvent {
    return { kind: 'arrived' } as unknown as PerceptionEvent;
}

function commandLoopEvents(): PerceptionEvent[] {
    return [
        chat('agent follow me', 3229, 3230),
        chat('agent status', 3229, 3230),
        chat('agent wait', 3229, 3230),
        chat('agent follow me again', 3234, 3230),
    ];
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    submitPeerAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_follow',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: id => (id === 'codex' ? 'res:bmk_codex' : undefined),
        submitPeerAction: overrides.submitPeerAction,
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts,
        latestPerception: () => overrides.perceptions.at(-1),
        perceptions: () => overrides.perceptions,
        events: () => overrides.events,
    };
}
