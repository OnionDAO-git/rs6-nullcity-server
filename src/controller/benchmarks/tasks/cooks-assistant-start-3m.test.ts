import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeCooksAssistantStart3mBenchmarkTask, verifyCooksAssistantStart3m } from './cooks-assistant-start-3m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyCooksAssistantStart3m', () => {
    it('passes when the resident talks to Cook and reaches Cook Assistant progress 50', () => {
        const outcome = verifyCooksAssistantStart3m({
            elapsedMs: 32_000,
            actions: [
                { action: { kind: 'interact', target: cook(), option: 'talk-to' } },
                { action: { kind: 'dialogue_continue' } },
                { action: { kind: 'dialogue_choice', optionIndex: 0 } },
            ],
            perceptions: [perception(), perception({ quests: { 'rs:cooks_assistant': { progress: 50, complete: false } } })],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.talkToCookActions).toBe(1);
        expect(outcome.metrics?.questStarted).toBe(1);
    });

    it('fails clearly when no Cook talk action was attempted', () => {
        const outcome = verifyCooksAssistantStart3m({
            elapsedMs: 10_000,
            actions: [{ action: { kind: 'dialogue_choice', optionIndex: 0 } }],
            perceptions: [perception({ quests: { 'rs:cooks_assistant': { progress: 50, complete: false } } })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No talk-to Cook action');
    });

    it('fails when dialogue actions happen but quest progress does not change', () => {
        const outcome = verifyCooksAssistantStart3m({
            elapsedMs: 45_000,
            actions: [
                { action: { kind: 'interact', target: cook(), option: 'talk-to' } },
                { action: { kind: 'dialogue_continue' } },
                { action: { kind: 'dialogue_choice', optionIndex: 0 } },
            ],
            perceptions: [perception({ quests: { 'rs:cooks_assistant': { progress: 0, complete: false } } })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.dialogueActions).toBe(2);
        expect(outcome.failureReason).toContain('Quest progress did not reach stage 50');
    });

    it('scripted mode submits talk-to Cook and the acceptance dialogue sequence', async () => {
        let elapsed = 0;
        let firstOptionChoices = 0;
        const perceptions = [perception({ npcs: [cook()] })];
        const submitAction = jest.fn(async (action: AgentAction) => {
            elapsed += 1_000;
            if (action.kind === 'dialogue_choice' && action.optionIndex === 0) {
                firstOptionChoices += 1;
            }
            if (firstOptionChoices >= 2) {
                perceptions.push(perception({ npcs: [cook()], quests: { 'rs:cooks_assistant': { progress: 50, complete: false } } }));
            }
            return { ok: true };
        });
        const task = makeCooksAssistantStart3mBenchmarkTask(() => elapsed, 0);
        const context = taskContext({
            submitAction,
            perceptions,
        });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(firstOptionChoices).toBe(2);
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'interact', option: 'talk-to' }));
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dialogue_choice', optionIndex: 0 }));
    });

    it('autonomous mode observes selected module actions without submitting scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeCooksAssistantStart3mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_talk_to_cook' }, STANDARD_MODULE),
                attempt({ kind: 'dialogue_continue', cause: 'dialogue_continue' }, STANDARD_MODULE),
                attempt({ kind: 'dialogue_choice', optionIndex: 0, cause: 'dialogue_choice_first' }, STANDARD_MODULE),
            ],
            perceptions: [perception(), perception({ quests: { 'rs:cooks_assistant': { progress: 50, complete: false } } })],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('passed');
    });
});

function cook(): Record<string, unknown> {
    return {
        id: 'npc:12',
        kind: 'npc',
        key: 'rs:lumbridge_castle_cook',
        name: 'Cook',
        position: { x: 3207, y: 3215, level: 0 },
    };
}

function perception(
    overrides: {
        npcs?: Array<Record<string, unknown>>;
        quests?: Record<string, { progress: number | string; complete: boolean }>;
    } = {},
): Perception {
    return {
        tick: 1,
        resident: {
            position: { x: 3208, y: 3215, level: 0 },
            quests: overrides.quests || {},
        },
        nearby: {
            npcs: overrides.npcs || [],
        },
        events: [],
    };
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    perceptions: Perception[];
    events?: PerceptionEvent[];
    actionAttempts?: Array<{ action: AgentAction; sparkModule?: { id: string; version: string } }>;
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_cooks_assistant',
        module: STANDARD_MODULE,
        signal: new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: jest.fn(),
        submitPeerAction: jest.fn(),
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts || [],
        latestPerception: () => overrides.perceptions[0],
        perceptions: () => overrides.perceptions,
        events: () => overrides.events || [],
    };
}

function attempt(action: AgentAction, sparkModule?: { id: string; version: string }) {
    return { action, sparkModule };
}
