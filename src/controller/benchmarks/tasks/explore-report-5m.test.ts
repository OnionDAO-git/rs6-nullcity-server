import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeExploreReport5mBenchmarkTask, verifyExploreReport5m } from './explore-report-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyExploreReport5m', () => {
    it('passes when the resident moves and gives an informative environment report', () => {
        const outcome = verifyExploreReport5m({
            elapsedMs: 38_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3228, y: 3230, level: 0 } }),
                attempt({ kind: 'say', text: 'I moved to 3228,3230. Nearby: 2 objects, 1 player, no items.' }),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 } }),
                perception({ position: { x: 3228, y: 3230, level: 0 }, objects: [{ objectId: 1276 }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.movementActions).toBe(1);
        expect(outcome.metrics?.positionChanged).toBe(1);
        expect(outcome.metrics?.informativeReports).toBe(1);
    });

    it('passes when the first collected perception is already at the reported destination', () => {
        const outcome = verifyExploreReport5m({
            elapsedMs: 38_000,
            actions: [
                attempt({ kind: 'move_to', target: { x: 3228, y: 3230, level: 0 } }),
                attempt({ kind: 'say', text: 'I moved to 3226,3230. Nearby: 474 objects, 0 NPCs, 4 players, 1 items.' }),
            ],
            perceptions: [perception({ position: { x: 3226, y: 3230, level: 0 }, objects: [{ objectId: 1276 }] })],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.reportedMovement).toBe(1);
    });

    it('fails clearly when no movement was attempted', () => {
        const outcome = verifyExploreReport5m({
            elapsedMs: 12_000,
            actions: [attempt({ kind: 'say', text: 'I see a tree nearby.' })],
            perceptions: [perception({ position: { x: 3225, y: 3230, level: 0 } })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No exploratory movement');
    });

    it('fails clearly when movement happened but no report was made', () => {
        const outcome = verifyExploreReport5m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'move_to', target: { x: 3228, y: 3230, level: 0 } })],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 } }),
                perception({ position: { x: 3228, y: 3230, level: 0 } }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No informative environment report');
    });

    it('does not accept vague chatter as an environment report', () => {
        const outcome = verifyExploreReport5m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'move_to', target: { x: 3228, y: 3230, level: 0 } }), attempt({ kind: 'say', text: 'hello' })],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 } }),
                perception({ position: { x: 3228, y: 3230, level: 0 } }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.informativeReports).toBe(0);
    });

    it('times out when the budget is exceeded before success', () => {
        const outcome = verifyExploreReport5m({
            elapsedMs: 301_000,
            actions: [attempt({ kind: 'move_to', target: { x: 3228, y: 3230, level: 0 } })],
            perceptions: [perception({ position: { x: 3225, y: 3230, level: 0 } })],
            events: [],
        });

        expect(outcome.status).toBe('timeout');
        expect(outcome.failureReason).toContain('5 minute budget');
    });

    it('autonomous mode observes module exploration evidence without submitting scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeExploreReport5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'move_to', target: { x: 3228, y: 3230, level: 0 }, cause: 'agent_explore' }, STANDARD_MODULE),
                attempt({ kind: 'say', text: 'I moved to 3228,3230. Nearby: trees and players.', cause: 'agent_report' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ position: { x: 3225, y: 3230, level: 0 } }),
                perception({ position: { x: 3228, y: 3230, level: 0 } }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });
});

function attempt(action: AgentAction, sparkModule?: typeof STANDARD_MODULE): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE } {
    return { action, sparkModule };
}

function perception(overrides: {
    position: { x: number; y: number; level: number };
    objects?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            position: overrides.position,
        },
        nearby: {
            objects: overrides.objects || [],
            npcs: [],
            players: [],
            worldItems: [],
        },
        events: overrides.events || [],
    };
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_explore',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts,
        latestPerception: () => overrides.perceptions.at(-1),
        perceptions: () => overrides.perceptions,
        events: () => overrides.events,
    };
}
