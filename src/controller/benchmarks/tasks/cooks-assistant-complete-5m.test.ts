import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeCooksAssistantComplete5mBenchmarkTask, verifyCooksAssistantComplete5m } from './cooks-assistant-complete-5m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyCooksAssistantComplete5m', () => {
    it('passes when the resident starts the quest, hands in all ingredients, and completes Cook Assistant', () => {
        const outcome = verifyCooksAssistantComplete5m({
            elapsedMs: 58_000,
            actions: [
                { action: { kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_talk_to_cook' } },
                { action: { kind: 'dialogue_choice', optionIndex: 0, cause: 'cooks_assistant_dialogue_step' } },
                { action: { kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_hand_in_ingredients' } },
                { action: { kind: 'dialogue_continue', cause: 'cooks_assistant_hand_in_dialogue_step' } },
            ],
            perceptions: [
                perception({
                    inventory: [item(1927), item(1933), item(1944)],
                    quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                }),
                perception({
                    inventory: [],
                    quests: { 'rs:cooks_assistant': { progress: 'complete', complete: true } },
                    events: [
                        { kind: 'item_lost', itemId: 1927 },
                        { kind: 'item_lost', itemId: 1933 },
                        { kind: 'item_lost', itemId: 1944 },
                    ],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.questStarted).toBe(1);
        expect(outcome.metrics?.questComplete).toBe(1);
        expect(outcome.metrics?.ingredientsCarriedAtStart).toBe(3);
        expect(outcome.metrics?.ingredientsConsumed).toBe(3);
    });

    it('fails clearly when the quest is started but never completed', () => {
        const outcome = verifyCooksAssistantComplete5m({
            elapsedMs: 120_000,
            actions: [
                { action: { kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_talk_to_cook' } },
                { action: { kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_hand_in_ingredients' } },
            ],
            perceptions: [
                perception({
                    inventory: [item(1927), item(1933), item(1944)],
                    quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBeLessThan(1);
        expect(outcome.failureReason).toContain('did not complete');
    });

    it('scripted mode submits start and hand-in dialogue sequences', async () => {
        let elapsed = 0;
        let startChoices = 0;
        let handInContinues = 0;
        const perceptions = [perception({ npcs: [cook()], inventory: [item(1927), item(1933), item(1944)] })];
        const submitAction = jest.fn(async (action: AgentAction) => {
            elapsed += 1_000;
            if (action.kind === 'dialogue_choice' && action.optionIndex === 0) {
                startChoices += 1;
            }
            if (startChoices >= 2 && !hasQuestStarted(perceptions)) {
                perceptions.push(
                    perception({
                        npcs: [cook()],
                        inventory: [item(1927), item(1933), item(1944)],
                        quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                    }),
                );
            }
            if (action.kind === 'dialogue_continue' && hasQuestStarted(perceptions)) {
                handInContinues += 1;
            }
            if (handInContinues >= 8 && !hasQuestCompleted(perceptions)) {
                perceptions.push(
                    perception({
                        npcs: [cook()],
                        inventory: [],
                        quests: { 'rs:cooks_assistant': { progress: 'complete', complete: true } },
                        events: [
                            { kind: 'item_lost', itemId: 1927 },
                            { kind: 'item_lost', itemId: 1933 },
                            { kind: 'item_lost', itemId: 1944 },
                        ],
                    }),
                );
            }
            return { ok: true };
        });
        const task = makeCooksAssistantComplete5mBenchmarkTask(() => elapsed, 0);
        const context = taskContext({ submitAction, perceptions });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'interact', option: 'talk-to' }));
        expect(submitAction).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'dialogue_choice', optionIndex: 3, cause: 'benchmark_cooks_assistant_start' }),
        );
        expect(submitAction).toHaveBeenCalledWith(expect.objectContaining({ cause: 'benchmark_cooks_assistant_hand_in' }));
    });

    it('scripted mode keeps advancing the long hand-in dialogue until completion is observable', async () => {
        let elapsed = 0;
        let startChoices = 0;
        let handInContinues = 0;
        const perceptions = [perception({ npcs: [cook()], inventory: [item(1927), item(1933), item(1944)] })];
        const submitAction = jest.fn(async (action: AgentAction) => {
            elapsed += 1_000;
            if (action.kind === 'dialogue_choice' && action.optionIndex === 0) {
                startChoices += 1;
            }
            if (startChoices >= 2 && !hasQuestStarted(perceptions)) {
                perceptions.push(
                    perception({
                        npcs: [cook()],
                        inventory: [item(1927), item(1933), item(1944)],
                        quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                    }),
                );
            }
            if (action.kind === 'dialogue_continue' && hasQuestStarted(perceptions)) {
                handInContinues += 1;
            }
            if (handInContinues >= 14 && !hasQuestCompleted(perceptions)) {
                perceptions.push(
                    perception({
                        npcs: [cook()],
                        inventory: [],
                        quests: { 'rs:cooks_assistant': { progress: 'complete', complete: true } },
                        events: [
                            { kind: 'item_lost', itemId: 1927 },
                            { kind: 'item_lost', itemId: 1933 },
                            { kind: 'item_lost', itemId: 1944 },
                        ],
                    }),
                );
            }
            return { ok: true };
        });
        const task = makeCooksAssistantComplete5mBenchmarkTask(() => {
            elapsed += 250;
            return elapsed;
        }, 0);
        const context = taskContext({ submitAction, perceptions });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(handInContinues).toBeGreaterThanOrEqual(14);
    });

    it('scripted mode retries the hand-in talk when the previous dialogue has not closed yet', async () => {
        let elapsed = 0;
        let startChoices = 0;
        let handInTalks = 0;
        let handInContinues = 0;
        const perceptions = [perception({ npcs: [cook()], inventory: [item(1927), item(1933), item(1944)] })];
        const submitAction = jest.fn(async (action: AgentAction) => {
            elapsed += 1_000;
            if (action.kind === 'dialogue_choice' && action.optionIndex === 0) {
                startChoices += 1;
            }
            if (startChoices >= 2 && !hasQuestStarted(perceptions)) {
                perceptions.push(
                    perception({
                        npcs: [cook()],
                        inventory: [item(1927), item(1933), item(1944)],
                        quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                    }),
                );
            }
            if (action.kind === 'interact' && action.cause === 'benchmark_cooks_assistant_hand_in') {
                handInTalks += 1;
                return { ok: handInTalks > 1 };
            }
            if (action.kind === 'dialogue_continue' && handInTalks > 1) {
                handInContinues += 1;
            }
            if (handInContinues >= 8 && !hasQuestCompleted(perceptions)) {
                perceptions.push(
                    perception({
                        npcs: [cook()],
                        inventory: [],
                        quests: { 'rs:cooks_assistant': { progress: 'complete', complete: true } },
                        events: [
                            { kind: 'item_lost', itemId: 1927 },
                            { kind: 'item_lost', itemId: 1933 },
                            { kind: 'item_lost', itemId: 1944 },
                        ],
                    }),
                );
            }
            return { ok: true };
        });
        const task = makeCooksAssistantComplete5mBenchmarkTask(() => elapsed, 0);
        const context = taskContext({ submitAction, perceptions });

        const outcome = await task.run(context);

        expect(outcome.status).toBe('passed');
        expect(handInTalks).toBe(2);
    });

    it('autonomous mode observes selected module hand-in actions without submitting scripted actions', async () => {
        const submitAction = jest.fn();
        const task = makeCooksAssistantComplete5mBenchmarkTask(() => 1_000);
        const context = taskContext({
            submitAction,
            actionAttempts: [
                attempt({ kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_talk_to_cook' }, STANDARD_MODULE),
                attempt({ kind: 'dialogue_choice', optionIndex: 0, cause: 'cooks_assistant_dialogue_step' }, STANDARD_MODULE),
                attempt(
                    { kind: 'interact', target: cook(), option: 'talk-to', cause: 'cooks_assistant_hand_in_ingredients' },
                    STANDARD_MODULE,
                ),
                attempt({ kind: 'dialogue_continue', cause: 'cooks_assistant_hand_in_dialogue_step' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ inventory: [item(1927), item(1933), item(1944)] }),
                perception({ quests: { 'rs:cooks_assistant': { progress: 50, complete: false } } }),
                perception({ quests: { 'rs:cooks_assistant': { progress: 'complete', complete: true } } }),
            ],
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

function item(itemId: number): Record<string, unknown> {
    return { itemId, amount: 1 };
}

function perception(
    overrides: {
        npcs?: Array<Record<string, unknown>>;
        inventory?: Array<Record<string, unknown>>;
        quests?: Record<string, { progress: number | string; complete: boolean }>;
        events?: PerceptionEvent[];
    } = {},
): Perception {
    return {
        tick: 1,
        resident: {
            position: { x: 3208, y: 3215, level: 0 },
            inventory: overrides.inventory || [],
            quests: overrides.quests || {},
        },
        nearby: {
            npcs: overrides.npcs || [],
        },
        events: overrides.events || [],
    };
}

function hasQuestStarted(perceptions: Perception[]): boolean {
    return perceptions.some(perception => {
        const quest = (perception.resident as any)?.quests?.['rs:cooks_assistant'];
        return quest && (quest.progress === 'complete' || quest.progress >= 50);
    });
}

function hasQuestCompleted(perceptions: Perception[]): boolean {
    return perceptions.some(perception => {
        const quest = (perception.resident as any)?.quests?.['rs:cooks_assistant'];
        return quest && (quest.complete === true || quest.progress === 'complete');
    });
}

function taskContext(overrides: {
    submitAction: jest.Mock;
    perceptions: Perception[];
    events?: PerceptionEvent[];
    actionAttempts?: Array<{ action: AgentAction; sparkModule?: { id: string; version: string } }>;
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_cooks_assistant_complete',
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
