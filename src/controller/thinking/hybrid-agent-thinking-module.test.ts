import { objectIds } from '@engine/world/config/object-ids';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { HybridAgentThinkingModule } from './hybrid-agent-thinking-module';

describe('HybridAgentThinkingModule', () => {
    it('passes abort signals to inference and aborts the active completion when stopped', async () => {
        let capturedSignal: AbortSignal | undefined;
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(
            request =>
                new Promise(resolve => {
                    capturedSignal = request.signal;
                    request.signal?.addEventListener('abort', () =>
                        resolve({
                            text: '',
                            nooped: true,
                            cancelledBy: String(request.signal?.reason || 'aborted'),
                        }),
                    );
                }),
        );
        const agent = hybridAgent({ complete });

        const thinking = agent.think(perception({ tick: 1, events: [chatFromCodex('hello there', 3201, 3200)] }));
        await Promise.resolve();
        expect(capturedSignal).toBeDefined();

        agent.stop('watchdog-test');
        const result = await thinking;

        expect(capturedSignal?.aborted).toBe(true);
        expect(capturedSignal?.reason).toBe('watchdog-test');
        expect(result.nooped).toBe(true);
        expect(result.cause).toBe('watchdog-test');
        expect(complete).toHaveBeenCalledTimes(1);
    });

    it('seeds a local exploration goal after a Brain watchdog timeout on an expired goal', async () => {
        let capturedSignal: AbortSignal | undefined;
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(
            request =>
                new Promise(resolve => {
                    capturedSignal = request.signal;
                    request.signal?.addEventListener('abort', () =>
                        resolve({
                            text: '',
                            nooped: true,
                            cancelledBy: String(request.signal?.reason || 'aborted'),
                        }),
                    );
                }),
        );
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                ttlTicks: 10,
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 20,
        };
        const agent = hybridAgent({ complete }, state);

        const thinking = agent.think(perception({ tick: 50 }));
        for (let i = 0; i < 5 && !capturedSignal; i += 1) {
            await Promise.resolve();
        }
        expect(capturedSignal).toBeDefined();

        agent.stop('thinking_watchdog_timeout');
        const result = await thinking;

        expect(result.nooped).toBe(true);
        expect(result.cause).toBe('thinking_watchdog_timeout');
        expect(result.planChange).toEqual({ id: 'scout-nearby-area', steps: 3, source: 'brain_timeout_fallback' });
        expect(state.cognition?.lastBrainTick).toBe(50);
        expect(state.cognition?.brainBackoffUntilTick).toBe(650);
        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'scout-nearby-area',
                createdAtTick: 50,
            }),
        );
    });

    it('does not retry Brain inference while watchdog backoff is active', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(async () => {
            throw new Error('Brain should be backed off');
        });
        const state = runtimeState();
        state.tick = 119;
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                ttlTicks: 450,
                createdAtTick: 50,
            },
            lastBrainTick: 50,
            brainBackoffUntilTick: 650,
            lastBodyTick: 120,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(perception({ tick: 120 }));

        expect(result.nooped).toBe(true);
        expect(result.cause).toBe('body_wait');
        expect(complete).not.toHaveBeenCalled();
    });

    it('uses local exploration movement before Body inference while Brain is backed off', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(async () => {
            throw new Error('Body inference should not gate local exploration');
        });
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                ttlTicks: 450,
                createdAtTick: 50,
            },
            lastBrainTick: 50,
            brainBackoffUntilTick: 650,
            lastBodyTick: 119,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(perception({ tick: 120, resident: residentAt(3200, 3200) }));

        expect(result.cause).toBe('exploration_fallback');
        expect(result.actions).toEqual([
            expect.objectContaining({
                kind: 'move_to',
                cause: 'explore_patrol',
            }),
        ]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('switches from a completed firemaking goal into scouting instead of grinding another tree', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(async () => {
            throw new Error('Completed local firemaking should not need inference');
        });
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                steps: ['Chop logs', 'Use tinderbox on logs'],
                ttlTicks: 600,
                createdAtTick: 20,
            },
            lastBrainTick: 20,
            brainBackoffUntilTick: 650,
            lastBodyTick: 49,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 50,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    ],
                },
                objects: [
                    { objectId: objectIds.fire, position: { x: 3200, y: 3200, level: 0 } },
                    { objectId: objectIds.tree.normal[0].default, position: { x: 3201, y: 3200, level: 0 } },
                ],
                events: [{ kind: 'fire_lit', position: { x: 3200, y: 3200, level: 0 } }],
            }),
        );

        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'scout-nearby-area',
                createdAtTick: 50,
            }),
        );
        expect(result.cause).toBe('exploration_fallback');
        expect(result.actions).toEqual([
            expect.objectContaining({
                kind: 'move_to',
                cause: 'explore_patrol',
            }),
        ]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('refreshes a local exploration goal when the current goal would expire during Brain backoff', async () => {
        let capturedSignal: AbortSignal | undefined;
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(
            request =>
                new Promise(resolve => {
                    capturedSignal = request.signal;
                    request.signal?.addEventListener('abort', () =>
                        resolve({
                            text: '',
                            nooped: true,
                            cancelledBy: String(request.signal?.reason || 'aborted'),
                        }),
                    );
                }),
        );
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                ttlTicks: 100,
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 20,
        };
        const agent = hybridAgent({ complete }, state);

        const thinking = agent.think(perception({ tick: 50 }));
        for (let i = 0; i < 5 && !capturedSignal; i += 1) {
            await Promise.resolve();
        }
        expect(capturedSignal).toBeDefined();

        agent.stop('thinking_watchdog_timeout');
        await thinking;

        expect(state.cognition?.brainBackoffUntilTick).toBe(650);
        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'scout-nearby-area',
                createdAtTick: 50,
            }),
        );
    });

    it('uses local firemaking ambition after a Brain watchdog timeout when tools are carried', async () => {
        let capturedSignal: AbortSignal | undefined;
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(
            request =>
                new Promise(resolve => {
                    capturedSignal = request.signal;
                    request.signal?.addEventListener('abort', () =>
                        resolve({
                            text: '',
                            nooped: true,
                            cancelledBy: String(request.signal?.reason || 'aborted'),
                        }),
                    );
                }),
        );
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'stale-scout',
                description: 'Look around.',
                ttlTicks: 5,
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 20,
        };
        const agent = hybridAgent({ complete }, state);

        const thinking = agent.think(
            perception({
                tick: 50,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );
        for (let i = 0; i < 5 && !capturedSignal; i += 1) {
            await Promise.resolve();
        }
        expect(capturedSignal).toBeDefined();

        agent.stop('thinking_watchdog_timeout');
        await thinking;

        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'make-fire',
                createdAtTick: 50,
            }),
        );
    });

    it('falls back to scouting after a Brain watchdog timeout instead of grinding visible trees by default', async () => {
        let capturedSignal: AbortSignal | undefined;
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(
            request =>
                new Promise(resolve => {
                    capturedSignal = request.signal;
                    request.signal?.addEventListener('abort', () =>
                        resolve({
                            text: '',
                            nooped: true,
                            cancelledBy: String(request.signal?.reason || 'aborted'),
                        }),
                    );
                }),
        );
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'stale-scout',
                description: 'Look around.',
                ttlTicks: 5,
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 20,
        };
        const agent = hybridAgent({ complete }, state);

        const thinking = agent.think(
            perception({
                tick: 50,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    ],
                },
                objects: [{ objectId: objectIds.tree.normal[0].default, position: { x: 3201, y: 3200, level: 0 } }],
            }),
        );
        for (let i = 0; i < 5 && !capturedSignal; i += 1) {
            await Promise.resolve();
        }
        expect(capturedSignal).toBeDefined();

        agent.stop('thinking_watchdog_timeout');
        await thinking;

        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'scout-nearby-area',
                createdAtTick: 50,
            }),
        );
    });

    it('uses deep-thinking Brain inference to set and announce a goal, then no-thinking Body inference to act', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'explore-yard',
                        description: 'Walk outside, stay visible to Codex, and look for a practical skill action.',
                        steps: ['announce the goal', 'move toward visible space', 'try a useful action'],
                    },
                    say: 'I am going to stay findable, explore outside, and look for something useful to do.',
                }),
            },
            {
                text: JSON.stringify({
                    cause: 'body_step',
                    actions: [{ kind: 'move_to', target: { x: 3203, y: 3200, level: 0 } }],
                }),
            },
        ]);
        const agent = hybridAgent(llm);

        const brain = await agent.think(perception({ tick: 1 }));
        expect(brain.actions).toEqual([
            { kind: 'say', text: 'I am going to stay findable, explore outside, and look for something useful to do.' },
        ]);

        const body = await agent.think(perception({ tick: 2 }));
        expect(body.actions).toEqual([{ kind: 'move_to', target: { x: 3203, y: 3200, level: 0 } }]);

        expect(llm.complete).toHaveBeenCalledTimes(2);
        const brainRequest = llm.complete.mock.calls[0][0];
        const bodyRequest = llm.complete.mock.calls[1][0];
        expect(brainRequest.thinking).toBe(true);
        expect(brainRequest.prompt).toContain('/think');
        expect(brainRequest.prompt).toContain('RuneBench-style loop');
        expect(brainRequest.prompt).toContain('Measurable goals');
        expect(bodyRequest.thinking).toBe(false);
        expect(bodyRequest.prompt).toContain('/no_think');
        expect(bodyRequest.prompt).toContain('Walk outside, stay visible to Codex');
        expect(bodyRequest.prompt).toContain('AgentAction tool surface');
        expect(bodyRequest.prompt).toContain('Workflow cards');
    });

    it('writes Brain memo output and exposes goal changes in decision telemetry', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'scout-lumbridge',
                        description: 'Scout Lumbridge for useful resources and stay findable.',
                        steps: ['walk to a landmark', 'report what looks useful'],
                    },
                    say: 'I am scouting Lumbridge and noting useful landmarks.',
                    memo: {
                        path: 'events/2026-05-24.md',
                        text: 'I chose to scout Lumbridge so I can find useful resources and stay easy to find.',
                        mode: 'append',
                    },
                }),
            },
        ]);
        const memoryStore = memory();
        const agent = hybridAgent(llm, runtimeState(), soul(), memoryStore);

        const result = await agent.think(perception({ tick: 10 }));

        expect(memoryStore.write).toHaveBeenCalledWith(
            'res:agent',
            'events/2026-05-24.md',
            'I chose to scout Lumbridge so I can find useful resources and stay easy to find.',
            'append',
        );
        expect((result as any).memoUpdates).toBe(1);
        expect((result as any).planChange).toEqual({ id: 'scout-lumbridge', steps: 2 });
    });

    it('clears stale committed movement when the Brain switches goals', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'woodcut-1',
                        description: 'Practice woodcutting on an ordinary tree to gather logs.',
                        steps: ['Find an ordinary tree', 'Chop it'],
                    },
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks.',
                createdAtTick: 1,
            },
            activeMove: {
                target: { x: 3241, y: 3253, level: 0 },
                range: 1,
                cause: 'explore_visible_object',
                startedAtTick: 20,
                lastTick: 20,
                lastPositionKey: '3224,3244,0',
                stationaryCount: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 60,
            lastBodyActionKey: '{"kind":"move_to","target":{"x":3241,"y":3253,"level":0},"range":1,"cause":"continue_move"}',
        };
        const agent = hybridAgent(llm, state);

        await agent.think(perception({ tick: 60, resident: residentAt(3224, 3244) }));

        expect(state.cognition?.activeGoal?.id).toBe('woodcut-1');
        expect(state.cognition?.activeMove).toBeUndefined();
        expect(state.cognition?.lastBodyActionKey).toBeUndefined();
    });

    it('recovers from a restarted world tick without keeping stale clock-gated goals', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'scout-reset-world',
                        description: 'Re-orient after the world restart and pick a useful visible task.',
                    },
                    say: 'World clock reset; I am re-orienting and picking a fresh goal.',
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 199_528;
        state.lastMeaningfulProgressAt = 199_527;
        state.stuckSince = 199_528;
        state.budgets.lastTick = 199_528;
        state.budgets.requestsThisTick = 1;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs and light a fire.',
                createdAtTick: 199_528,
                ttlTicks: 300,
            },
            activeMove: {
                target: { x: 3213, y: 3238, level: 0 },
                startedAtTick: 199_528,
                lastTick: 199_528,
            },
            followTarget: { name: 'codex', setAtTick: 199_528 },
            lastBrainTick: 199_528,
            lastBodyTick: 199_528,
            lastBodyActionKey: '{"kind":"use_item_on_item"}',
            lastBodyActionTick: 199_528,
            pickupCooldowns: { coins: 199_528 },
            explorationCooldowns: { tree: 199_528 },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(perception({ tick: 5 }));

        expect(result.actions).toEqual([{ kind: 'say', text: 'World clock reset; I am re-orienting and picking a fresh goal.' }]);
        expect(state.tick).toBe(5);
        expect(state.lastMeaningfulProgressAt).toBeUndefined();
        expect(state.stuckSince).toBeUndefined();
        expect(state.budgets.lastTick).toBeUndefined();
        expect(state.budgets.requestsThisTick).toBeUndefined();
        expect(state.cognition).toEqual(
            expect.objectContaining({
                activeGoal: expect.objectContaining({ id: 'scout-reset-world', createdAtTick: 5 }),
                followTarget: { name: 'codex', setAtTick: 5 },
                lastBrainTick: 5,
                lastGoalShareTick: 5,
            }),
        );
        expect(state.cognition?.activeMove).toBeUndefined();
        expect(state.cognition?.lastBodyTick).toBeUndefined();
        expect(state.cognition?.lastBodyActionKey).toBeUndefined();
        expect(state.cognition?.pickupCooldowns).toBeUndefined();
        expect(llm.complete).toHaveBeenCalledTimes(1);
    });

    it('uses an explicit goal coordinate before waiting on Body inference', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Move to the visible tree at 3225,3245 and chop it to gather logs.',
                steps: ['Move adjacent to the tree at x:3225, y:3245.', "Interact with 'chop down'."],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(perception({ tick: 3, resident: residentAt(3211, 3246), objects: [] }));

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3225, y: 3245, level: 0 }, range: 1, cause: 'goal_coordinate_move' },
        ]);
        expect(result.cause).toBe('goal_coordinate_move');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('avoids recently failed targets before choosing a routine target', async () => {
        const staleTree = { objectId: 1278, position: { x: 3213, y: 3238, level: 0 }, orientation: 1 };
        const nextTree = { objectId: 1278, position: { x: 3217, y: 3241, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Chop ordinary trees to gather logs.',
                steps: ['Find the next reachable tree.', 'Chop it.'],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
            targetFailureCooldowns: {
                'object:1278:3213,3238,0': 9,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 10,
                resident: residentAt(3212, 3238),
                objects: [staleTree, nextTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: nextTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('avoids coordinate-only movement timeout targets before choosing a routine target', async () => {
        const staleTree = { objectId: 1278, position: { x: 3213, y: 3238, level: 0 }, orientation: 1 };
        const nextTree = { objectId: 1278, position: { x: 3217, y: 3241, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Chop ordinary trees to gather logs.',
                steps: ['Find the next reachable tree.', 'Chop it.'],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
            targetFailureCooldowns: {
                'target:3213,3238,0': 9,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 10,
                resident: residentAt(3212, 3238),
                objects: [staleTree, nextTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: nextTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not let slow small talk inference starve an overdue routine action', async () => {
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('small talk should wait')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs from a nearby ordinary tree and light a fire with the tinderbox.',
                steps: ['Chop a tree for logs.', 'Use tinderbox on logs.'],
                createdAtTick: 1,
            },
            lastBrainTick: 10,
            lastBodyTick: 0,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 10,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [tree],
                events: [{ kind: 'chat', from: player('codex', 3218, 3200), text: 'nice day', to: 'public' }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: tree, option: 'chop down', cause: 'woodcutting_level1_routine' }]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('runs deterministic body routines before due Brain inference when a useful action is available', async () => {
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('brain should wait')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs from a nearby ordinary tree and light a fire with the tinderbox.',
                steps: ['Chop a tree for logs.', 'Use tinderbox on logs.'],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 200,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: tree, option: 'chop down', cause: 'woodcutting_level1_routine' }]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('moves while stuck instead of farming the same opportunistic pickup as recovery', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('brain should wait')));
        const state = runtimeState();
        state.stuckSince = 5;
        state.cognition = {
            lastBrainTick: 10,
            lastBodyTick: 0,
        };
        const agent = hybridAgent({ complete }, state);
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3211, y: 3240, level: 0 } };

        const result = await agent.think(
            perception({
                tick: 10,
                resident: residentAt(3211, 3246),
                worldItems: [coins],
            }),
        );

        expect(result.actions).toEqual([expect.objectContaining({ kind: 'move_to', range: 1, cause: 'stuck_pre_inference_explore' })]);
        expect(result.actions).not.toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('keeps Agent findable by falling back to the visibility anchor when Body inference noops', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'practice',
                description: 'Practice moving around while staying visible.',
                steps: ['return to the anchor if far away'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
            lastAnchorReturnTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: residentAt(3215, 3200),
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3200, y: 3200, level: 0 }, cause: 'return_to_visibility_anchor' }]);
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(llm.complete.mock.calls[0][0].thinking).toBe(false);
    });

    it('returns to the visibility anchor even when exploration has nearby patrol work', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                steps: ['walk around', 'return to the anchor if I drift too far'],
                createdAtTick: 10,
                ttlTicks: 600,
            },
            lastBrainTick: 10,
            lastBodyTick: 0,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 0,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 120,
                resident: residentAt(3095, 3160),
                objects: [{ objectId: 2739, position: { x: 3096, y: 3160, level: 0 }, orientation: 0 }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3095, y: 3168, level: 0 }, range: 1, cause: 'return_to_visibility_anchor' },
        ]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('converts persisted long anchor moves into reachable waypoint steps', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 10,
                ttlTicks: 600,
            },
            activeMove: {
                target: { x: 3200, y: 3200, level: 0 },
                range: 0,
                cause: 'return_to_visibility_anchor',
                startedAtTick: 90,
                lastTick: 90,
                lastPositionKey: '3094,3160,0',
                stationaryCount: 0,
            },
            lastBrainTick: 10,
            lastBodyTick: 0,
            brainBackoffUntilTick: 1000,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 120,
                resident: residentAt(3095, 3160),
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3095, y: 3168, level: 0 }, range: 1, cause: 'return_to_visibility_anchor' },
        ]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('backs off a stuck anchor return and tries recovery instead of repeating the blocked waypoint', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.stuckSince = 110;
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 10,
                ttlTicks: 600,
            },
            activeMove: {
                target: { x: 3105, y: 3184, level: 0 },
                range: 1,
                cause: 'return_to_visibility_anchor',
                startedAtTick: 90,
                lastTick: 100,
                lastPositionKey: '3105,3176,0',
                stationaryCount: 1,
            },
            lastBrainTick: 10,
            lastBodyTick: 0,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 0,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 120,
                resident: residentAt(3105, 3176),
            }),
        );

        expect(result.cause).toBe('stuck_move_recovery');
        expect(result.actions).toHaveLength(1);
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_move_recovery' }));
        expect(result.actions[0]).not.toEqual(
            expect.objectContaining({ target: { x: 3105, y: 3184, level: 0 }, cause: 'return_to_visibility_anchor' }),
        );
        expect(state.cognition?.lastAnchorReturnTick).toBe(120);
        expect(complete).not.toHaveBeenCalled();
    });

    it('abandons a struggling anchor return for a visible local skill opportunity', async () => {
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3105, y: 3170, level: 0 }, orientation: 0 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.stuckSince = 110;
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 10,
                ttlTicks: 600,
            },
            activeMove: {
                target: { x: 3225, y: 3230, level: 0 },
                range: 1,
                cause: 'return_to_visibility_anchor',
                startedAtTick: 90,
                lastTick: 100,
                lastPositionKey: '3095,3165,0',
                stationaryCount: 1,
            },
            lastBrainTick: 10,
            lastBodyTick: 0,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 0,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: {
                    ...residentAt(3095, 3165),
                    inventory: [
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    ],
                },
                objects: [tree],
            }),
        );

        expect(result.cause).toBe('scouting_woodcutting_opportunity');
        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'scouting_woodcutting_opportunity' }]);
        expect(state.cognition?.activeGoal?.id).toBe('chop-level-one-tree');
        expect(state.cognition?.activeMove).toEqual(
            expect.objectContaining({ target: tree.position, cause: 'scouting_woodcutting_opportunity' }),
        );
        expect(state.cognition?.lastAnchorReturnTick).toBe(150);
        expect(complete).not.toHaveBeenCalled();
    });

    it('uses stuck exploration before a hard anchor return when the resident is already stuck', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.stuckSince = 110;
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 10,
                ttlTicks: 600,
            },
            lastBrainTick: 10,
            lastBodyTick: 0,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 0,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 120,
                resident: residentAt(3095, 3160),
            }),
        );

        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(result.actions).toHaveLength(1);
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        expect(result.actions[0]).not.toEqual(expect.objectContaining({ cause: 'return_to_visibility_anchor' }));
        expect(state.cognition?.lastAnchorReturnTick).toBe(120);
        expect(complete).not.toHaveBeenCalled();
    });

    it('cools down a blocked openable target when stuck so scouting does not orbit the same gate', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const gate = { objectId: 1530, position: { x: 3111, y: 3162, level: 0 }, orientation: 0 };
        const state = runtimeState();
        state.tick = 20860;
        state.stuckSince = 20850;
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 20800,
                ttlTicks: 600,
            },
            activeMove: {
                target: gate.position,
                range: 1,
                cause: 'explore_open_obstacle',
                startedAtTick: 20840,
                lastTick: 20855,
                lastPositionKey: '3122,3158,0',
                stationaryCount: 1,
            },
            lastBrainTick: 20800,
            lastBodyTick: 20800,
            brainBackoffUntilTick: 21400,
        };
        const agent = hybridAgent({ complete }, state);

        const first = await agent.think(
            perception({
                tick: 20875,
                resident: residentAt(3122, 3158),
                objects: [gate],
            }),
        );
        state.cognition!.activeMove = undefined;
        const second = await agent.think(
            perception({
                tick: 20876,
                resident: residentAt(3125, 3158),
                objects: [gate],
            }),
        );

        expect(first.cause).toBe('stuck_move_recovery');
        expect(second.cause).toBe('stuck_pre_inference_explore');
        expect(second.actions[0]).not.toEqual(expect.objectContaining({ target: gate.position }));
        expect(state.cognition?.explorationCooldowns?.['object:1530:3111,3162,0']).toBe(20875);
        expect(complete).not.toHaveBeenCalled();
    });

    it('cools down a stuck woodcutting target so the routine tries another visible tree', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const blockedTree = { objectId: 1278, position: { x: 3200, y: 3255, level: 0 }, orientation: 3 };
        const otherTree = { objectId: 1278, position: { x: 3208, y: 3262, level: 0 }, orientation: 0 };
        const state = runtimeState();
        state.stuckSince = 110;
        state.cognition = {
            activeGoal: {
                id: 'chop-level-one-tree',
                description: 'Practice woodcutting on ordinary level-1 trees and gather logs.',
                createdAtTick: 1,
                ttlTicks: 600,
            },
            activeMove: {
                target: blockedTree.position,
                range: 1,
                cause: 'woodcutting_level1_routine',
                startedAtTick: 100,
                lastTick: 110,
                lastPositionKey: '3200,3262,0',
                stationaryCount: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
        };
        const agent = hybridAgent({ complete }, state);

        const first = await agent.think(
            perception({
                tick: 120,
                resident: residentAt(3200, 3262),
                objects: [blockedTree, otherTree],
            }),
        );
        state.stuckSince = undefined;
        state.cognition!.activeMove = undefined;

        const second = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3262),
                objects: [blockedTree, otherTree],
            }),
        );

        expect(first.cause).toBe('stuck_move_recovery');
        expect(state.cognition?.targetFailureCooldowns?.['object:1278:3200,3255,0']).toBe(120);
        expect(second.actions).toEqual([{ kind: 'move_to', target: otherTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('patrols instead of free-opening exploration gates during scouting', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const gate = { objectId: 1530, position: { x: 3229, y: 3230, level: 0 }, orientation: 0 };
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
        };
        const agent = hybridAgent({ complete }, state);

        const first = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3226, 3230),
                objects: [gate],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'move_to', target: { x: 3223, y: 3230, level: 0 }, range: 1, cause: 'explore_patrol' }]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('patrols while stuck instead of free-opening adjacent exploration gates', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const gate = { objectId: 1530, position: { x: 3111, y: 3162, level: 0 }, orientation: 0 };
        const state = runtimeState();
        state.stuckSince = 180;
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 200,
                resident: residentAt(3110, 3162),
                objects: [gate],
            }),
        );

        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3110, y: 3165, level: 0 }, range: 1, cause: 'stuck_pre_inference_explore' },
        ]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('can use item-on-item firemaking as a reliable fallback when the active goal asks for fire', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Make a fire to prove I can use tools and items.',
                steps: ['use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'firemaking_fallback' }]);
    });

    it('uses firemaking muscle memory even when Body suggests wandering with logs in inventory', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: { x: 3234, y: 3238, level: 0 } }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Light gathered logs with the tinderbox.',
                steps: ['use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'firemaking_fallback' }]);
        expect(result.cause).toBe('firemaking_fallback');
    });

    it('gathers logs for a fire goal even when the Brain only says to light a fire', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'light-fire',
                description: 'Light a fire nearby.',
                steps: ['Make the area warmer'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [normalTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('firemaking_gather_logs');
    });

    it('gathers logs locally for a fire goal instead of chasing a distant model target', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const farTree = { objectId: 1278, position: { x: 3241, y: 3235, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'interact', target: farTree, option: 'chop down' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'light-fire',
                description: 'Gather logs and light a fire nearby.',
                steps: ['get logs', 'use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [normalTree, farTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('firemaking_gather_logs');
    });

    it('does not re-light stale logs when a fresh fire is already visible nearby', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const fire = { objectId: 2732, position: { x: 3225, y: 3230, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs and light a fire with the tinderbox.',
                steps: ['use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                objects: [fire, normalTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('firemaking_gather_logs');
    });

    it('redirects low-level woodcutting goals from higher-level trees to ordinary trees', async () => {
        const willow = { objectId: 1308, position: { x: 3234, y: 3238, level: 0 }, orientation: 3 };
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'interact', target: willow, option: 'chop down' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'chop-normal-tree',
                description: 'Chop an ordinary nearby Tree to gather logs for firemaking practice.',
                steps: ['Move beside a visible ordinary Tree or Dead tree', 'Interact with chop down'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3225, 3230),
                objects: [willow, normalTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('woodcutting_level1_routine');
    });

    it('keeps explicit woodcutting goals labeled as woodcutting when Body has no actions', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'chop-normal-tree',
                description: 'Chop an ordinary nearby Tree to gather logs for firemaking practice.',
                steps: ['Move beside a visible ordinary Tree or Dead tree', 'Interact with chop down'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3225, 3230),
                objects: [normalTree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('woodcutting_level1_routine');
    });

    it('keeps routine woodcutting focused on the nearest ordinary tree when Body suggests a different one', async () => {
        const nearestTree = { objectId: 1278, position: { x: 3234, y: 3231, level: 0 }, orientation: 1 };
        const fartherTree = { objectId: 1278, position: { x: 3243, y: 3242, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'interact', target: fartherTree, option: 'chop down' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Chop ordinary trees to train Woodcutting and gather logs for firemaking.',
                steps: ['Move to a nearby ordinary tree or dead tree.', 'Chop the tree to gather logs.'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3234, 3231),
                objects: [nearestTree, fartherTree],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'interact', target: nearestTree, option: 'chop down', cause: 'woodcutting_level1_routine' },
        ]);
        expect(result.cause).toBe('woodcutting_level1_routine');
    });

    it('turns gathered logs into an explicit firemaking subgoal during woodcutting practice', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Practice Woodcutting on an ordinary tree to gather logs.',
                steps: ['Find a tree', 'Chop it', 'Use logs for a practical next action'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'woodcutting_chain_firemaking' }]);
        expect(result.cause).toBe('woodcutting_chain_firemaking');
        expect(state.cognition?.activeGoal?.id).toBe('make-fire');
    });

    it('lights carried logs before chasing nearby loot during an active firemaking goal', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                steps: ['Find a tree', 'Chop it', 'Use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                worldItems: [coins],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'firemaking_fallback' }]);
        expect(result.cause).toBe('firemaking_fallback');
    });

    it('briefly picks up useful nearby items during routine skill work', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 12, position: { x: 3218, y: 3200, level: 0 } };
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcutting-practice',
                description: 'Practice woodcutting on ordinary trees and gather logs.',
                steps: ['Find a tree', 'Chop it', 'Keep any useful supplies nearby'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(result.cause).toBe('opportunistic_pickup');
    });

    it('does not chase firemaking logs beside an active fire as opportunistic loot', async () => {
        const logs = { itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3218, y: 3201, level: 0 } };
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3201, level: 0 }, orientation: 0 };
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                steps: ['Find a tree', 'Chop it', 'Use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                worldItems: [logs],
                objects: [fire, tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: tree, option: 'chop down', cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('firemaking_gather_logs');
    });

    it('does not abandon routine skill work for distant opportunistic pickups', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 12, position: { x: 3230, y: 3200, level: 0 } };
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcutting-practice',
                description: 'Practice woodcutting on ordinary trees and gather logs.',
                steps: ['Find a tree', 'Chop it', 'Keep any useful supplies nearby'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: tree, option: 'chop down', cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('woodcutting_level1_routine');
    });

    it('breaks out of repeated stationary woodcutting with a visible exploration move', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const landmark = { objectId: 879, position: { x: 3230, y: 3231, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Chop ordinary trees to train Woodcutting and gather logs for firemaking.',
                steps: ['Move to a nearby ordinary tree or dead tree.', 'Chop the tree to gather logs.'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);
        const stillAtTree = perception({
            resident: residentAt(3225, 3231),
            objects: [normalTree, landmark],
        });

        await agent.think({ ...stillAtTree, tick: 3 });
        await agent.think({ ...stillAtTree, tick: 40 });
        const result = await agent.think({ ...stillAtTree, tick: 80 });

        expect(result.actions).toEqual([{ kind: 'move_to', target: landmark.position, range: 2, cause: 'routine_loop_break' }]);
        expect(result.cause).toBe('routine_loop_break');
        expect(state.cognition?.activeGoal?.id).toBe('train-woodcutting');
    });

    it('uses evidence stuck state to break a repeated local routine immediately after restart', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const landmark = { objectId: 879, position: { x: 3230, y: 3231, level: 0 }, orientation: 0 };
        const repeatedAction = { kind: 'interact', target: normalTree, option: 'chop down', cause: 'woodcutting_level1_routine' };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.tick = 100;
        state.stuckSince = 70;
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Chop ordinary trees to train Woodcutting and gather logs for firemaking.',
                steps: ['Move to a nearby ordinary tree or dead tree.', 'Chop the tree to gather logs.'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 80,
            lastBodyActionKey: JSON.stringify(repeatedAction),
            lastBodyActionTick: 95,
            routineLoopKey: 'woodcutting-firemaking|3225,3231,0',
            routineLoopCount: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: {
                    ...residentAt(3225, 3231),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [normalTree, landmark],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: landmark.position, range: 2, cause: 'routine_loop_break' }]);
        expect(result.cause).toBe('routine_loop_break');
        expect(state.cognition?.activeGoal?.id).toBe('train-woodcutting');
    });

    it('keeps a make-fire goal after a temporary routine loop break move', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const landmark = { objectId: 879, position: { x: 3230, y: 3231, level: 0 }, orientation: 0 };
        const repeatedAction = { kind: 'interact', target: normalTree, option: 'chop down', cause: 'woodcutting_level1_routine' };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.tick = 100;
        state.stuckSince = 70;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs and light a fire with the tinderbox.',
                steps: ['chop a nearby ordinary tree', 'use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 100,
            lastBodyTick: 80,
            lastBodyActionKey: JSON.stringify(repeatedAction),
            lastBodyActionTick: 95,
            routineLoopKey: 'woodcutting-firemaking|3225,3231,0',
            routineLoopCount: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: {
                    ...residentAt(3225, 3231),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [normalTree, landmark],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: landmark.position, range: 2, cause: 'routine_loop_break' }]);
        expect(result.cause).toBe('routine_loop_break');
        expect(state.cognition?.activeGoal?.id).toBe('make-fire');
    });

    it('uses logs before breaking out of alternating stationary firemaking and woodcutting work', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const landmark = { objectId: 879, position: { x: 3230, y: 3231, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs and light a fire with the tinderbox.',
                steps: ['chop a nearby ordinary tree', 'use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3225, 3231),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                objects: [normalTree, landmark],
            }),
        );
        await agent.think(
            perception({
                tick: 40,
                resident: {
                    ...residentAt(3225, 3231),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [normalTree, landmark],
            }),
        );
        const result = await agent.think(
            perception({
                tick: 80,
                resident: {
                    ...residentAt(3225, 3231),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                objects: [normalTree, landmark],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'firemaking_fallback' }]);
        expect(result.cause).toBe('firemaking_fallback');
        expect(state.cognition?.activeGoal?.id).toBe('make-fire');
    });

    it('does not keep repeating the same anchor move when a firemaking fallback is available', async () => {
        const anchorMove = { kind: 'move_to', target: { x: 3200, y: 3200, level: 0 } };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [anchorMove] }) }]);
        const state = runtimeState();
        state.tick = 10;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Make a fire to prove I can use tools and items.',
                steps: ['use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 10,
            lastBodyActionKey: JSON.stringify(anchorMove),
            lastBodyActionTick: 10,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 18,
                resident: {
                    ...residentAt(3215, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'firemaking_fallback' }]);
    });

    it('backs off repeated firemaking fallback actions too', async () => {
        const fireAction = { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'firemaking_fallback' };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.tick = 10;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Make a fire to prove I can use tools and items.',
                steps: ['use tinderbox on logs'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 10,
            lastBodyActionKey: JSON.stringify(fireAction),
            lastBodyActionTick: 10,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 18,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([]);
        expect(result.nooped).toBe(true);
    });

    it('walks toward distant model interaction targets before trying to use them', async () => {
        const tree = { objectId: 1902, position: { x: 3230, y: 3209, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    cause: 'body_step',
                    actions: [{ kind: 'interact', target: tree, option: 'action-1' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'chop-tree',
                description: 'Chop down a tree to gather logs.',
                steps: ['Move close to the tree', 'Interact with the tree'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'approach_interaction_target' }]);
        expect(result.cause).toBe('approach_interaction_target');
    });

    it('approaches beside visible objects when Body tries to move onto the object tile', async () => {
        const tree = { objectId: 1902, position: { x: 3230, y: 3209, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    cause: 'body_step',
                    actions: [{ kind: 'move_to', target: tree.position }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'chop-tree',
                description: 'Chop down a tree to gather logs.',
                steps: ['Move close to the tree', 'Interact with the tree'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'approach_interaction_target' }]);
        expect(result.cause).toBe('approach_interaction_target');
    });

    it('allows repeated range approach moves so local stepping can continue', async () => {
        const tree = { objectId: 1902, position: { x: 3230, y: 3209, level: 0 }, orientation: 3 };
        const approachMove = { kind: 'move_to', target: tree.position, range: 1, cause: 'approach_interaction_target' };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    cause: 'body_step',
                    actions: [{ kind: 'move_to', target: tree.position }],
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 10;
        state.cognition = {
            activeGoal: {
                id: 'chop-tree',
                description: 'Chop down a tree to gather logs.',
                steps: ['Move close to the tree', 'Interact with the tree'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
            lastBodyActionKey: JSON.stringify(approachMove),
            lastBodyActionTick: 10,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 11,
                resident: residentAt(3218, 3201),
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([approachMove]);
        expect(result.cause).toBe('approach_interaction_target');
        expect(result.nooped).toBe(false);
    });

    it('keeps pursuing an in-progress distant move instead of thrashing between landmarks', async () => {
        const firstLandmark = { x: 3243, y: 3242, level: 0 };
        const secondLandmark = { x: 3241, y: 3253, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: firstLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: secondLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'report what is visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3233, 3243),
            }),
        );
        const result = await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3233, 3243),
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: firstLandmark, range: 1, cause: 'continue_move' }]);
        expect(result.cause).toBe('continue_move');
    });

    it('keeps scouting local opportunities instead of chasing a far model landmark', async () => {
        const farLandmark = { x: 3245, y: 3245, level: 0 };
        const guide = {
            id: 'npc:86',
            kind: 'npc' as const,
            key: 'rs:runescape_guide',
            name: 'RuneScape Guide',
            position: { x: 3229, y: 3239, level: 0 },
        };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: farLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 100;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby person', 'report what is visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3233, 3239),
                npcs: [guide],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: guide.position, range: 1, cause: 'explore_talk_to_npc' }]);
        expect(result.cause).toBe('exploration_fallback');
    });

    it('uses progress stuck evidence to abandon an active move and recover locally', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const guide = {
            id: 'npc:86',
            kind: 'npc' as const,
            key: 'rs:runescape_guide',
            name: 'RuneScape Guide',
            position: { x: 3229, y: 3239, level: 0 },
        };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 100;
        state.stuckSince = 80;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'recover from blocked routes'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
            activeMove: {
                target: blockedLandmark,
                range: 1,
                cause: 'approach_interaction_target',
                startedAtTick: 92,
                lastTick: 99,
                lastPositionKey: '3234,3236,0',
                stationaryCount: 0,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3234, 3237),
                npcs: [guide],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: guide.position, range: 1, cause: 'stuck_move_recovery' }]);
        expect(result.cause).toBe('stuck_move_recovery');
        expect(state.cognition?.activeMove?.target).toEqual(guide.position);
    });

    it('lets local firemaking interrupt a stale stuck move', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 100;
        state.stuckSince = 80;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs from a nearby ordinary tree and light a fire with the tinderbox.',
                steps: ['Use tinderbox on logs once logs are in inventory.'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
            activeMove: {
                target: blockedLandmark,
                range: 1,
                cause: 'approach_interaction_target',
                startedAtTick: 92,
                lastTick: 99,
                lastPositionKey: '3231,3238,0',
                stationaryCount: 0,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: {
                    ...residentAt(3231, 3238),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 2, cause: 'firemaking_fallback' }]);
        expect(result.cause).toBe('firemaking_fallback');
        expect(state.cognition?.activeMove).toBeUndefined();
    });

    it('asks for help when progress evidence says a recovery move is also stuck', async () => {
        const recoveryTarget = { x: 3230, y: 3238, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: recoveryTarget, range: 1, cause: 'continue_move' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 100;
        state.stuckSince = 80;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover from blocked routes', 'ask for help'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
            activeMove: {
                target: recoveryTarget,
                range: 1,
                cause: 'stuck_move_recovery',
                startedAtTick: 92,
                lastTick: 99,
                lastPositionKey: '3233,3238,0',
                stationaryCount: 0,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3233, 3237),
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'Stuck here trying to head west. Can someone clear a path?',
                cause: 'stuck_help_request',
                voiceSource: 'phrasebook',
                helpRequestReason: 'repeated_movement_failure',
            },
        ]);
        expect(result.cause).toBe('stuck_help_request');
        expect(state.cognition?.activeMove).toBeUndefined();
    });

    it('uses a local patrol instead of retrying a far model target after stuck evidence', async () => {
        const farLandmark = { x: 3244, y: 3239, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: farLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 100;
        state.stuckSince = 80;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover locally after blocked routes', 'stay visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3230, 3238),
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3233, y: 3238, level: 0 }, range: 1, cause: 'stuck_pre_inference_explore' },
        ]);
        expect(result.cause).toBe('stuck_pre_inference_explore');
    });

    it('switches to a nearby patrol when a committed move makes no visible progress', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'report what is visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3233, 3243),
            }),
        );
        await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3233, 3243),
            }),
        );
        const result = await agent.think(
            perception({
                tick: 5,
                resident: residentAt(3233, 3243),
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3230, y: 3243, level: 0 }, range: 1, cause: 'stuck_move_recovery' },
        ]);
        expect(result.cause).toBe('stuck_move_recovery');
    });

    it('switches tactics when a committed move keeps changing position without getting closer', async () => {
        const blockedTree = { objectId: 1278, position: { x: 3190, y: 3255, level: 0 }, orientation: 0 };
        const nearbyScenery = { objectId: 4735, position: { x: 3195, y: 3262, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting-1',
                description: 'Chop a nearby ordinary tree to gather logs and gain Woodcutting XP.',
                createdAtTick: 100,
            },
            lastBrainTick: 100,
            lastBodyTick: 100,
            activeMove: {
                target: blockedTree.position,
                range: 1,
                cause: 'woodcutting_level1_routine',
                startedAtTick: 100,
                lastTick: 116,
                lastPositionKey: '3193,3259,0',
                stationaryCount: 0,
                lastDistance: 4,
                bestDistance: 3,
                lastImprovedTick: 20,
                nonImprovingCount: 3,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 124,
                resident: {
                    ...residentAt(3193, 3260),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [blockedTree, nearbyScenery],
            }),
        );

        expect(result.actions[0]).toMatchObject({ kind: 'move_to', range: 1, cause: 'stuck_move_recovery' });
        expect(result.actions[0]).toHaveProperty('target');
        expect((result.actions[0] as { target?: unknown }).target).not.toEqual(blockedTree.position);
        expect(result.cause).toBe('stuck_move_recovery');
        expect(state.cognition?.activeMove?.target).not.toEqual(blockedTree.position);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not continue an active move target that just timed out', async () => {
        const timedOutTarget = { x: 3217, y: 3233, level: 0 };
        const freshTarget = { x: 3215, y: 3236, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: freshTarget, range: 1, cause: 'explore_patrol' }],
                    cause: 'explore_patrol',
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'manual-nav-test',
                description: 'Patrol a safe route.',
                createdAtTick: 190,
                ttlTicks: 1000,
            },
            lastBrainTick: 199,
            lastBodyTick: 190,
            lastGoalShareTick: 199,
            lastPresenceBeaconTick: 199,
            lastAnchorReturnTick: 195,
            targetFailureCooldowns: {
                'target:3217,3233,0': 199,
            },
            activeMove: {
                target: timedOutTarget,
                range: 1,
                cause: 'explore_patrol',
                startedAtTick: 198,
                lastTick: 199,
                lastPositionKey: '3215,3233,0',
                stationaryCount: 0,
                lastDistance: 2,
                bestDistance: 2,
                lastImprovedTick: 198,
                nonImprovingCount: 1,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 200,
                resident: residentAt(3215, 3233),
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: freshTarget, range: 1 }]);
        expect(result.cause).toBe('explore_patrol');
        expect(state.cognition?.activeMove?.target).toEqual(freshTarget);
    });

    it('tracks active move closing progress from a fresh movement intent', async () => {
        const tree = { objectId: 1278, position: { x: 3190, y: 3255, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting-1',
                description: 'Chop a nearby ordinary tree to gather logs and gain Woodcutting XP.',
                createdAtTick: 80,
            },
            lastBrainTick: 80,
            lastBodyTick: 80,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 100,
                resident: {
                    ...residentAt(3193, 3259),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(state.cognition?.activeMove).toEqual(
            expect.objectContaining({
                target: tree.position,
                lastDistance: 4,
                bestDistance: 4,
                lastImprovedTick: 100,
                nonImprovingCount: 0,
            }),
        );

        await agent.think(
            perception({
                tick: 108,
                resident: {
                    ...residentAt(3193, 3258),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(state.cognition?.activeMove).toEqual(
            expect.objectContaining({
                target: tree.position,
                lastDistance: 3,
                bestDistance: 3,
                lastImprovedTick: 108,
                nonImprovingCount: 0,
            }),
        );
    });

    it('does not abandon a recent equal-distance detour before the plateau threshold', async () => {
        const tree = { objectId: 1278, position: { x: 3190, y: 3255, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting-1',
                description: 'Chop a nearby ordinary tree to gather logs and gain Woodcutting XP.',
                createdAtTick: 100,
            },
            lastBrainTick: 100,
            lastBodyTick: 100,
            activeMove: {
                target: tree.position,
                range: 1,
                cause: 'woodcutting_level1_routine',
                startedAtTick: 100,
                lastTick: 146,
                lastPositionKey: '3193,3259,0',
                stationaryCount: 0,
                lastDistance: 4,
                bestDistance: 4,
                lastImprovedTick: 112,
                nonImprovingCount: 5,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 160,
                resident: {
                    ...residentAt(3194, 3259),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(result.cause).not.toBe('stuck_move_recovery');
        expect(result.actions).not.toEqual([expect.objectContaining({ cause: 'stuck_move_recovery' })]);
        expect(state.cognition?.activeMove).toEqual(
            expect.objectContaining({
                target: tree.position,
                bestDistance: 4,
                lastImprovedTick: 112,
            }),
        );
    });

    it('initializes persisted active moves without new distance fields before judging them stuck', async () => {
        const tree = { objectId: 1278, position: { x: 3190, y: 3255, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting-1',
                description: 'Chop a nearby ordinary tree to gather logs and gain Woodcutting XP.',
                createdAtTick: 100,
            },
            lastBrainTick: 100,
            lastBodyTick: 100,
            activeMove: {
                target: tree.position,
                range: 1,
                cause: 'woodcutting_level1_routine',
                startedAtTick: 100,
                lastTick: 220,
                lastPositionKey: '3193,3259,0',
                stationaryCount: 0,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 228,
                resident: {
                    ...residentAt(3194, 3259),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(result.cause).not.toBe('stuck_move_recovery');
        expect(state.cognition?.activeMove).toEqual(
            expect.objectContaining({
                target: tree.position,
                lastDistance: 4,
                bestDistance: 4,
                lastImprovedTick: 228,
                nonImprovingCount: 0,
            }),
        );
    });

    it('asks for help when stuck movement recovery also makes no visible progress', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'recover from blocked routes', 'ask for help if recovery fails'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3233, 3243),
            }),
        );
        await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3233, 3243),
            }),
        );
        await agent.think(
            perception({
                tick: 5,
                resident: residentAt(3233, 3243),
            }),
        );
        await agent.think(
            perception({
                tick: 6,
                resident: residentAt(3233, 3243),
            }),
        );
        const result = await agent.think(
            perception({
                tick: 7,
                resident: residentAt(3233, 3243),
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I keep getting turned around trying to go west. Could someone lead me?',
                cause: 'stuck_help_request',
                voiceSource: 'phrasebook',
                helpRequestReason: 'repeated_movement_failure',
            },
        ]);
        expect(result.cause).toBe('stuck_help_request');
    });

    it('tries to open a nearby door or gate before abandoning a stuck move', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const door = { objectId: 1530, position: { x: 3233, y: 3244, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'open doors or gates if blocked'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3233, 3243),
                objects: [door],
            }),
        );
        await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3233, 3243),
                objects: [door],
            }),
        );
        const result = await agent.think(
            perception({
                tick: 5,
                resident: residentAt(3233, 3243),
                objects: [door],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: door, option: 'open', cause: 'stuck_open_obstacle' }]);
        expect(result.cause).toBe('stuck_open_obstacle');
    });

    it('reports a visible fence blocker before switching to stuck movement recovery', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const fence = { objectId: objectIds.shortCuts.fenceNearKharidCows, position: { x: 3233, y: 3244, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'report blocked routes'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3233, 3243),
                objects: [fence],
            }),
        );
        await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3233, 3243),
                objects: [fence],
            }),
        );
        const report = await agent.think(
            perception({
                tick: 5,
                resident: residentAt(3233, 3243),
                objects: [fence],
            }),
        );
        const recovery = await agent.think(
            perception({
                tick: 6,
                resident: residentAt(3233, 3243),
                objects: [fence],
            }),
        );

        expect(report.actions).toEqual([
            { kind: 'say', text: 'I am stuck near a fence. I will step away and try another route.', cause: 'stuck_blocker_report' },
        ]);
        expect(report.cause).toBe('stuck_blocker_report');
        expect(recovery.actions).toEqual([
            { kind: 'move_to', target: { x: 3230, y: 3243, level: 0 }, range: 1, cause: 'stuck_move_recovery' },
        ]);
        expect(recovery.cause).toBe('stuck_move_recovery');
    });

    it('does not report ordinary scenery as a stuck blocker', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3233, y: 3244, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
            {
                text: JSON.stringify({
                    actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['walk toward a nearby landmark', 'recover from blocked routes'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3233, 3243),
                objects: [tree],
            }),
        );
        await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3233, 3243),
                objects: [tree],
            }),
        );
        const result = await agent.think(
            perception({
                tick: 5,
                resident: residentAt(3233, 3243),
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3230, y: 3243, level: 0 }, range: 1, cause: 'stuck_move_recovery' },
        ]);
        expect(result.cause).toBe('stuck_move_recovery');
    });

    it('answers direct status chat without waiting for Body inference', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Practice firemaking.',
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('What are you doing agent?', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online at 3218,3201. Goal: Practice firemaking.' }]);
        expect(result.cause).toBe('direct_chat_status');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers addressed small talk without waiting for Body inference', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('hey agent, how are you?', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am here and watching. I can follow, scout, make fires, fish, cook, trade, or train safely.',
            },
        ]);
        expect(result.cause).toBe('direct_chat_small_talk');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('asks for clarification on unknown addressed commands without waiting for Body inference', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent can you enchant my sword?', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'Do not understand.',
                voiceSource: 'phrasebook',
            },
        ]);
        expect(result.cause).toBe('direct_chat_decline_unknown_command');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('moves toward direct follow commands before Body inference', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'stay-visible',
                description: 'Stay visible to Codex.',
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent follow me', 3222, 3213)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3222, y: 3213, level: 0 }, range: 2, cause: 'direct_chat_follow' },
        ]);
        expect(result.cause).toBe('direct_chat_follow');
        expect(state.cognition?.followTarget).toMatchObject({
            name: 'codex',
            id: 'player:codex',
            kind: 'player',
            paused: false,
        });
        expect(state.cognition?.activeGoal?.id).toBe('follow-codex');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps following a commanded player without waiting for Body inference', async () => {
        const codex = player('codex', 3225, 3213);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'follow-codex',
                description: 'Follow codex and stay close enough to be seen.',
                createdAtTick: 1,
            },
            followTarget: { name: 'codex', id: 'player:codex', kind: 'player', setAtTick: 1 },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [codex],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3225, y: 3213, level: 0 }, range: 2, cause: 'follow_player_active' },
        ]);
        expect(result.cause).toBe('follow_player_active');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('stays in follow/listen mode instead of letting Brain announce an unrelated skilling goal', async () => {
        const codex = { id: 'resident:res:bmk_codex', kind: 'resident', name: 'Codex', position: { x: 3225, y: 3230, level: 0 } };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'chop-level-one-tree',
                        description: 'Practice woodcutting on ordinary level-1 trees and gather logs.',
                    },
                    say: 'Chopping down a tree for logs.',
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'follow-codex',
                description: 'Follow codex and stay close enough to be seen.',
                createdAtTick: 1,
            },
            followTarget: { name: 'Codex', id: 'resident:res:bmk_codex', kind: 'resident', setAtTick: 1 },
            lastBrainTick: 1,
            lastBodyTick: 1,
            lastGoalShareTick: 20,
            lastPresenceBeaconTick: 20,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 60,
                resident: residentAt(3225, 3230),
                players: [codex],
            }),
        );

        expect(result.actions).toEqual([
            expect.objectContaining({
                kind: 'say',
                text: expect.stringContaining('Goal: Follow codex and stay close enough to be seen.'),
            }),
        ]);
        expect(JSON.stringify(result.actions)).not.toContain('Chopping down a tree');
        expect(result.cause).toBe('presence_beacon');
        expect(state.cognition?.activeGoal?.id).toBe('follow-codex');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('waits in follow/listen mode when the followed actor is temporarily not visible', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: { id: 'scout', description: 'Scout around for something else to do.' },
                    say: 'I am going to scout nearby.',
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'follow-codex',
                description: 'Follow codex and stay close enough to be seen.',
                createdAtTick: 1,
            },
            followTarget: { name: 'Codex', id: 'resident:res:bmk_codex', kind: 'resident', setAtTick: 1 },
            lastBrainTick: 1,
            lastBodyTick: 1,
            lastGoalShareTick: 55,
            lastPresenceBeaconTick: 55,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 60,
                resident: residentAt(3225, 3230),
                players: [],
            }),
        );

        expect(result.actions).toEqual([]);
        expect(result.cause).toBe('follow_listen_hold');
        expect(state.cognition?.activeGoal?.id).toBe('follow-codex');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('starts following a named nearby player from direct chat', async () => {
        const codex = player('codex', 3225, 3213);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [codex],
                events: [chatFromCodex('agent follow codex', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3225, y: 3213, level: 0 }, range: 2, cause: 'direct_chat_follow' },
        ]);
        expect(result.cause).toBe('direct_chat_follow');
        expect(state.cognition?.followTarget).toMatchObject({ name: 'codex', id: 'player:codex' });
        expect(state.cognition?.activeGoal?.id).toBe('follow-codex');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('stops persistent following on direct stop-following commands', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'follow-codex',
                description: 'Follow codex and stay close enough to be seen.',
                createdAtTick: 1,
            },
            followTarget: { name: 'codex', id: 'player:codex', kind: 'player', setAtTick: 1 },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent stop following', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I will stop following codex.' }]);
        expect(result.cause).toBe('direct_chat_stop_following');
        expect(state.cognition?.followTarget).toMatchObject({ paused: true });
        expect(state.cognition?.activeGoal).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('moves toward direct follow commands from another resident peer', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'stay-visible',
                description: 'Stay visible to nearby actors.',
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromResidentPeer('agent follow me', 3222, 3213)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3222, y: 3213, level: 0 }, range: 2, cause: 'direct_chat_follow' },
        ]);
        expect(result.cause).toBe('direct_chat_follow');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('ignores direct follow chat emitted by itself', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'stay-visible',
                description: 'Stay visible to nearby actors.',
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromSelfResident('agent follow me', 3222, 3213)],
            }),
        );

        expect(result.cause).not.toBe('direct_chat_follow');
        expect(result.actions).not.toContainEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3213, level: 0 },
            range: 2,
            cause: 'direct_chat_follow',
        });
    });

    it('returns to the visibility anchor on direct home commands without inference', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent return home', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3200, y: 3200, level: 0 }, range: 2, cause: 'direct_chat_return_home' },
        ]);
        expect(result.cause).toBe('direct_chat_return_home');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('clears the active goal on direct stop commands without inference', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Practice firemaking.',
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent stop', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I will pause here and wait for a new goal.', cause: 'direct_chat_stop' }]);
        expect(result.cause).toBe('direct_chat_stop');
        expect(state.cognition?.activeGoal).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('retaliates against NPC attackers without waiting for inference', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'attack', target: goblin, cause: 'combat_retaliate' },
            { kind: 'say', text: 'You think you can break me, Goblin? Think again.' },
        ]);
        expect(result.cause).toBe('combat_retaliate');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('retreats from NPC combat when hurt and carrying no recognizable food', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3214, y: 3205, level: 0 }, cause: 'combat_retreat' },
            { kind: 'say', text: 'Barely hanging on... need to run!' },
        ]);
        expect(result.cause).toBe('combat_retreat');
        expect(state.cognition?.pendingCombatNarration).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('explains a combat retreat on the next safe tick without inference', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            lastBrainTick: 2,
            activeGoal: {
                id: 'dummy-goal',
                description: 'Keep exploring',
                createdAtTick: 1,
                ttlTicks: 1000,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3214, y: 3205, level: 0 }, cause: 'combat_retreat' },
            { kind: 'say', text: 'Barely hanging on... need to run!' },
        ]);

        state.cognition!.lastBodyTick = 3;
        const narration = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3214, 3205),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
            }),
        );

        expect(narration.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3200, y: 3200, level: 0 },
                range: 6,
                cause: 'low_health_return_to_anchor',
            },
        ]);
        expect(narration.cause).toBe('low_health_return_to_anchor');
        expect(state.cognition?.pendingCombatNarration).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('eats before retaliating when hurt and carrying food', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'eat', slot: 0, cause: 'combat_eat_before_retaliating' },
            { kind: 'say', text: "Just eating to keep going. I won't fall here." },
        ]);
        expect(result.cause).toBe('combat_eat_before_retaliating');
        expect(state.cognition?.pendingCombatNarration).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('explains combat eating on the next safe tick without inference', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            lastBrainTick: 2,
            activeGoal: {
                id: 'dummy-goal',
                description: 'Keep exploring',
                createdAtTick: 1,
                ttlTicks: 1000,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'eat', slot: 0, cause: 'combat_eat_before_retaliating' },
            { kind: 'say', text: "Just eating to keep going. I won't fall here." },
        ]);

        state.cognition!.lastBodyTick = 3;
        const narration = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 6, max: 10 },
                    inventory: [],
                },
            }),
        );

        expect(narration.actions).toEqual([]);
        expect(state.cognition?.pendingCombatNarration).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('warns when attacked by a player instead of fighting back automatically', async () => {
        const alice = player('Alice', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [alice],
                events: [{ kind: 'hit_taken', from: alice }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'Alice is attacking me. Tell me "agent attack Alice" if I should fight back.' },
        ]);
        expect(result.cause).toBe('combat_reaction');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('runs direct attack commands against visible actors without inference', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [goblin],
                events: [chatFromCodex('agent attack goblin', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: goblin, cause: 'direct_chat_attack' }]);
        expect(result.cause).toBe('direct_chat_attack');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('refuses direct attack commands when hurt and carrying no food', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                npcs: [goblin],
                events: [chatFromCodex('agent attack goblin', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'HP too low to fight.',
                voiceSource: 'phrasebook',
            },
        ]);
        expect(result.cause).toBe('direct_chat_decline_low_hp');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('starts combat training by approaching a safe low-level NPC without inference', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const chicken = npc('Chicken', 3224, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [goblin, chicken],
                events: [chatFromCodex('agent train combat', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: chicken, cause: 'combat_attack_safe_target' }]);
        expect(result.cause).toBe('direct_chat_train_combat');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('attacks an adjacent safe target for an active combat training goal', async () => {
        const rat = npc('Rat', 3219, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs and retreat if hurt.',
                steps: ['find a chicken or rat', 'attack when healthy', 'eat or stop when hurt'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [rat],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: rat, cause: 'combat_attack_safe_target' }]);
        expect(result.cause).toBe('combat_attack_safe_target');
    });

    it('loots useful drops before attacking the next safe combat target', async () => {
        const rat = npc('Rat', 3219, 3201);
        const bones = { itemId: 526, key: 'rs:bones', amount: 1, position: { x: 3222, y: 3201, level: 0 } };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs and collect loot.',
                steps: ['fight safe targets', 'pick up bones and coins', 'bury bones between fights'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [rat],
                worldItems: [bones],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: bones, option: 'pick-up', cause: 'combat_loot_pickup' }]);
        expect(result.cause).toBe('combat_loot_pickup');
    });

    it('buries carried bones before finding the next combat target', async () => {
        const rat = npc('Rat', 3219, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs and collect loot.',
                steps: ['fight safe targets', 'pick up bones and coins', 'bury bones between fights'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }],
                },
                npcs: [rat],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'item_action', slot: 0, option: 'bury', cause: 'combat_bury_looted_bones' }]);
        expect(result.cause).toBe('combat_bury_looted_bones');
    });

    it('does not stop fighting to bury bones while already in combat', async () => {
        const rat = npc('Rat', 3219, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs and collect loot.',
                steps: ['fight safe targets', 'pick up bones and coins', 'bury bones between fights'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inCombat: true,
                    combatTarget: rat,
                    inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }],
                },
                npcs: [rat],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'attack', target: rat, cause: 'combat_retaliate' },
            { kind: 'say', text: "I've survived worse than Rat. Let's get this over with." },
        ]);
        expect(result.cause).toBe('combat_retaliate');
    });

    it('eats before continuing combat training when hurt and carrying food', async () => {
        const chicken = npc('Chicken', 3219, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs and retreat if hurt.',
                steps: ['fight a safe target', 'eat when hurt'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [chicken],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'eat', slot: 0, cause: 'combat_eat_before_training' }]);
        expect(result.cause).toBe('combat_eat_before_training');
    });

    it('refuses to start combat training while hurt and carrying no food', async () => {
        const chicken = npc('Chicken', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                npcs: [chicken],
                events: [chatFromCodex('agent train combat', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I am too hurt to start combat without food. I need to heal or get food first.' },
        ]);
        expect(result.cause).toBe('direct_chat_train_combat');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('runs direct retreat commands without inference', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: { ...residentAt(3218, 3201), combatTarget: goblin },
                npcs: [goblin],
                events: [chatFromCodex('agent run away', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3214, y: 3205, level: 0 }, cause: 'direct_chat_retreat' }]);
        expect(result.cause).toBe('direct_chat_retreat');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('runs direct trade commands with the speaking player without inference', async () => {
        const codex = player('codex', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [codex],
                events: [chatFromCodex('agent trade me', 3219, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'trade_request', target: codex, cause: 'direct_chat_trade' }]);
        expect(result.cause).toBe('direct_chat_trade');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('approaches the speaking player before sending a direct trade request when too far away', async () => {
        const codex = player('codex', 3225, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [codex],
                events: [chatFromCodex('agent trade me', 3225, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: codex.position, range: 1, cause: 'direct_chat_trade' }]);
        expect(result.cause).toBe('direct_chat_trade');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('remembers an approached direct trade command and sends the request after arrival', async () => {
        const codex = player('codex', 3225, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const approach = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [codex],
                events: [chatFromCodex('agent trade me', 3225, 3201)],
            }),
        );
        const request = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3225, 3201),
                players: [codex],
            }),
        );

        expect(approach.actions).toEqual([{ kind: 'move_to', target: codex.position, range: 1, cause: 'direct_chat_trade' }]);
        expect(request.actions).toEqual([{ kind: 'trade_request', target: codex, cause: 'direct_chat_trade' }]);
        expect(request.cause).toBe('direct_chat_trade');
        expect(state.cognition?.pendingDirectTrade).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('reciprocates trusted trade requests without inference', async () => {
        const codex = player('codex', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                players: [codex],
                events: [{ kind: 'trade_requested', from: codex }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'trade_request', target: codex, cause: 'trade_reciprocate_trusted_request' }]);
        expect(result.cause).toBe('trade_reciprocate_trusted_request');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('offers one safe non-tool item when a trusted trade opens', async () => {
        const codex = player('codex', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                        { itemId: 315, key: 'rs:shrimps', amount: 1 },
                    ],
                    activeTrade: {
                        partner: codex,
                        ours: [],
                        theirs: [],
                        ourStage: 'editing',
                        theirStage: 'editing',
                    },
                },
                players: [codex],
                events: [{ kind: 'trade_opened', partner: codex, sessionId: 'trade-1' }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'trade_offer_item', inventorySlot: 2, amount: 1, cause: 'trade_offer_safe_item' }]);
        expect(result.cause).toBe('trade_offer_safe_item');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('advances a trusted trade through accept stages when its offer is ready', async () => {
        const codex = player('codex', 3219, 3201);
        const stageOneAgent = hybridAgent(scriptedLlm([]), runtimeState());
        const stageOne = await stageOneAgent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    activeTrade: {
                        partner: codex,
                        ours: [{ itemId: 1511, key: 'rs:logs', amount: 1 }],
                        theirs: [],
                        ourStage: 'editing',
                        theirStage: 'editing',
                    },
                },
                players: [codex],
                events: [{ kind: 'trade_offer_updated' }],
            }),
        );

        expect(stageOne.actions).toEqual([{ kind: 'trade_accept_stage_1', cause: 'trade_accept_stage_1' }]);
        expect(stageOne.cause).toBe('trade_accept_stage_1');

        const stageTwoAgent = hybridAgent(scriptedLlm([]), runtimeState());
        const stageTwo = await stageTwoAgent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    activeTrade: {
                        partner: codex,
                        ours: [{ itemId: 1511, key: 'rs:logs', amount: 1 }],
                        theirs: [],
                        ourStage: 'accepted_1',
                        theirStage: 'accepted_1',
                    },
                },
                players: [codex],
                events: [{ kind: 'trade_offer_updated' }],
            }),
        );

        expect(stageTwo.actions).toEqual([{ kind: 'trade_accept_stage_2', cause: 'trade_accept_stage_2' }]);
        expect(stageTwo.cause).toBe('trade_accept_stage_2');
    });

    it('declines active trades with untrusted partners without inference', async () => {
        const alice = player('Alice', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    activeTrade: {
                        partner: alice,
                        ours: [],
                        theirs: [{ itemId: 995, key: 'rs:coins', amount: 1000 }],
                        ourStage: 'editing',
                        theirStage: 'accepted_1',
                    },
                    inventory: [{ itemId: 1511, key: 'rs:logs', amount: 1 }],
                },
                players: [alice],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'trade_decline', cause: 'trade_decline_untrusted_partner' }]);
        expect(result.cause).toBe('trade_decline_untrusted_partner');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers direct look commands with actionable surroundings without inference', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                worldItems: [{ itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3218, y: 3202, level: 0 } }],
                events: [chatFromCodex('agent what do you see?', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I see Hans nearby at 3219,3201. I can talk, fight if needed, pick up items, or explore.' },
        ]);
        expect(result.cause).toBe('direct_chat_look');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('describes visible fishing spots as fishing opportunities when carrying a net', async () => {
        const fishingSpot = npc('Fishing spot', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [fishingSpot],
                events: [chatFromCodex('agent what do you see?', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I see a Fishing spot at 3219,3201. I can use my small fishing net there.' }]);
        expect(result.cause).toBe('direct_chat_look');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers direct inventory commands without inference', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 3 },
                    ],
                },
                events: [chatFromCodex('agent inventory', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am carrying tinderbox, logs x3.' }]);
        expect(result.cause).toBe('direct_chat_inventory');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers direct help commands with visible capabilities without inference', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent what can you do?', 3218, 3201)],
            }),
        );

        expect(result.actions[0]).toEqual(
            expect.objectContaining({
                kind: 'say',
                text: expect.stringContaining('follow me'),
            }),
        );
        expect(String((result.actions[0] as any).text)).toContain('make fire');
        expect(String((result.actions[0] as any).text)).toContain('status');
        expect(String((result.actions[0] as any).text)).toContain('trade');
        expect(result.cause).toBe('direct_chat_help');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('runs direct pickup and drop commands without inference', async () => {
        const logs = { itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3219, y: 3201, level: 0 } };
        const pickupAgent = hybridAgent(scriptedLlm([]), runtimeState());

        const pickup = await pickupAgent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                worldItems: [logs],
                events: [chatFromCodex('agent pick up logs', 3218, 3201)],
            }),
        );

        expect(pickup.actions).toEqual([{ kind: 'interact', target: logs, option: 'pick-up', cause: 'direct_chat_pickup' }]);
        expect(pickup.cause).toBe('direct_chat_pickup');

        const dropAgent = hybridAgent(scriptedLlm([]), runtimeState());
        const drop = await dropAgent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [null, { itemId: 1511, key: 'rs:logs', amount: 1 }],
                },
                events: [chatFromCodex('agent drop logs', 3218, 3201)],
            }),
        );

        expect(drop.actions).toEqual([{ kind: 'drop', slot: 1, cause: 'direct_chat_drop' }]);
        expect(drop.cause).toBe('direct_chat_drop');
    });

    it('runs direct bury bones commands from inventory without inference', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [null, { itemId: 526, key: 'rs:bones', amount: 1 }],
                },
                events: [chatFromCodex('agent bury bones', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'item_action', slot: 1, option: 'bury', cause: 'prayer_bury_bones' }]);
        expect(result.cause).toBe('direct_chat_bury_bones');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('picks up visible bones before burying when none are carried', async () => {
        const bones = { itemId: 526, key: 'rs:bones', amount: 1, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                worldItems: [bones],
                events: [chatFromCodex('agent bury bones', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: bones, option: 'pick-up', cause: 'prayer_pickup_bones' }]);
        expect(result.cause).toBe('direct_chat_bury_bones');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('starts prayer training by approaching a visible safe bone source without inference', async () => {
        const goblin = npc('Goblin', 3224, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [goblin],
                events: [chatFromCodex('agent train prayer', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: goblin, cause: 'prayer_attack_safe_bone_source' }]);
        expect(result.cause).toBe('direct_chat_train_prayer');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('prefers a lower-risk animal bone source over an adjacent human for prayer training', async () => {
        const man = npc('Man', 3219, 3201);
        const chicken = npc('Chicken', 3225, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [man, chicken],
                events: [chatFromCodex('agent train prayer', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: chicken, cause: 'prayer_attack_safe_bone_source' }]);
        expect(result.cause).toBe('direct_chat_train_prayer');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('attacks an adjacent safe bone source when a prayer goal has no bones yet', async () => {
        const rat = npc('Rat', 3219, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-prayer',
                description: 'Pick up bones and bury them to train Prayer after safe combat.',
                steps: ['find a safe rat or goblin', 'attack it', 'pick up bones', 'bury bones'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [rat],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: rat, cause: 'prayer_attack_safe_bone_source' }]);
        expect(result.cause).toBe('prayer_attack_safe_bone_source');
    });

    it('seeks a nearby Lumbridge bone source for prayer training instead of attacking named non-training NPCs', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [chatFromCodex('agent train prayer', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3222, y: 3218, level: 0 }, range: 6, cause: 'prayer_seek_safe_bone_source' },
        ]);
        expect(result.cause).toBe('direct_chat_train_prayer');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('uses prayer muscle memory when the active goal asks to bury bones', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-prayer',
                description: 'Pick up bones and bury them to train Prayer after combat.',
                steps: ['find bones', 'pick up bones', 'bury bones'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'item_action', slot: 0, option: 'bury', cause: 'prayer_bury_bones' }]);
        expect(result.cause).toBe('prayer_bury_bones');
    });

    it('runs direct NPC talk commands without inference', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [chatFromCodex('agent talk to Hans', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: hans, option: 'talk-to', cause: 'direct_chat_talk' }]);
        expect(result.cause).toBe('direct_chat_talk');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('approaches NPC talk targets that are not close enough yet', async () => {
        const hans = npc('Hans', 3225, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [chatFromCodex('agent talk to Hans', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: hans.position, range: 1, cause: 'direct_chat_talk' }]);
        expect(result.cause).toBe('direct_chat_talk');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('continues simple dialogue without waiting for inference', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [{ kind: 'dialogue_opened', npc: hans, prompt: 'Hello there.' }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'dialogue_continue', cause: 'dialogue_continue' }]);
        expect(result.cause).toBe('dialogue_continue');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('selects the first dialogue option without waiting for inference', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [{ kind: 'dialogue_updated', prompt: 'Choose an option', options: ['Who are you?', 'Never mind.'] }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'dialogue_choice', optionIndex: 0, cause: 'dialogue_choice_first' }]);
        expect(result.cause).toBe('dialogue_choice_first');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('uses local exploration fallback to talk to a nearby NPC when scouting', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and talk to useful people.',
                steps: ['walk to nearby people', 'talk to an NPC', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [hans],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: hans, option: 'talk-to', cause: 'explore_talk_to_npc' }]);
        expect(result.cause).toBe('exploration_fallback');
    });

    it('does not keep talking to the same exploration NPC while scouting', async () => {
        const guide = {
            id: 'npc:86',
            kind: 'npc' as const,
            key: 'rs:runescape_guide',
            name: 'RuneScape Guide',
            position: { x: 3230, y: 3238, level: 0 },
        };
        const landmark = { objectId: 879, position: { x: 3235, y: 3239, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }, { text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.tick = 100;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['talk to a nearby person', 'move on to another landmark'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
        };
        const agent = hybridAgent(llm, state);

        const first = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3230, 3239),
                npcs: [guide],
                objects: [landmark],
            }),
        );
        const second = await agent.think(
            perception({
                tick: 102,
                resident: residentAt(3230, 3239),
                npcs: [guide],
                objects: [landmark],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'interact', target: guide, option: 'talk-to', cause: 'explore_talk_to_npc' }]);
        expect(second.actions).toEqual([{ kind: 'move_to', target: landmark.position, range: 2, cause: 'explore_visible_object' }]);
        expect(state.cognition?.explorationCooldowns?.['npc:npc:86']).toBe(101);
    });

    it('does not chain through the same exploration NPC family while scouting', async () => {
        const firstSheep = {
            id: 'npc:sheep-1',
            kind: 'npc' as const,
            key: 'rs:sheep',
            name: 'Sheep',
            position: { x: 3207, y: 3262, level: 0 },
        };
        const secondSheep = {
            id: 'npc:sheep-2',
            kind: 'npc' as const,
            key: 'rs:sheep',
            name: 'Sheep',
            position: { x: 3203, y: 3267, level: 0 },
        };
        const landmark = { objectId: 879, position: { x: 3210, y: 3267, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }, { text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.tick = 100;
        state.cognition = {
            activeGoal: {
                id: 'scout-sheep-field',
                description: 'Scout nearby animals and landmarks while staying easy to find.',
                steps: ['talk to one nearby animal', 'move on to another landmark'],
                createdAtTick: 0,
            },
            lastBrainTick: 90,
            lastBodyTick: 90,
        };
        const agent = hybridAgent(llm, state);

        const first = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3207, 3262),
                npcs: [firstSheep],
                objects: [landmark],
            }),
        );
        const second = await agent.think(
            perception({
                tick: 102,
                resident: residentAt(3207, 3262),
                npcs: [secondSheep],
                objects: [landmark],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'interact', target: firstSheep, option: 'talk-to', cause: 'explore_talk_to_npc' }]);
        expect(second.actions).toEqual([{ kind: 'move_to', target: landmark.position, range: 2, cause: 'explore_visible_object' }]);
        expect(state.cognition?.explorationCooldowns?.['npc-key:rs:sheep']).toBe(101);
    });

    it('starts a local exploration workflow from direct chat without inference', async () => {
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                objects: [fountain],
                events: [chatFromCodex('agent explore', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(result.cause).toBe('direct_chat_explore');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('uses local exploration fallback when an active scouting goal has no Body action', async () => {
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful places.',
                steps: ['walk to nearby landmarks', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(result.cause).toBe('exploration_fallback');
    });

    it('turns an aged scouting loop into a local woodcutting opportunity instead of only patrolling', async () => {
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3205, y: 3200, level: 0 }, orientation: 0 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                steps: ['walk locally', 'try a useful task after looking around'],
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3204, 3200),
                objects: [tree],
            }),
        );

        expect(result.cause).toBe('scouting_woodcutting_opportunity');
        expect(result.actions).toEqual([
            { kind: 'interact', target: tree, option: 'chop down', cause: 'scouting_woodcutting_opportunity' },
        ]);
        expect(state.cognition?.activeGoal?.id).toBe('chop-level-one-tree');
        expect(state.cognition?.lastScoutingSkillOpportunityTick).toBe(150);
        expect(complete).not.toHaveBeenCalled();
    });

    it('takes a visible local work opportunity during aged far-away scouting', async () => {
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3105, y: 3170, level: 0 }, orientation: 0 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                steps: ['walk locally', 'try a useful task after looking around'],
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 150,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3104, 3175),
                objects: [tree],
            }),
        );

        expect(result.cause).toBe('scouting_woodcutting_opportunity');
        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'scouting_woodcutting_opportunity' }]);
        expect(state.cognition?.activeGoal?.id).toBe('chop-level-one-tree');
        expect(state.cognition?.lastScoutingSkillOpportunityTick).toBe(150);
        expect(complete).not.toHaveBeenCalled();
    });

    it('prefers visible local work over another landmark during aged scouting', async () => {
        const landmark = { objectId: 879, position: { x: 3102, y: 3175, level: 0 }, orientation: 0 };
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3105, y: 3170, level: 0 }, orientation: 0 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                steps: ['walk locally', 'try a useful task after looking around'],
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3104, 3170),
                objects: [landmark, tree],
            }),
        );

        expect(result.cause).toBe('scouting_woodcutting_opportunity');
        expect(result.actions).toEqual([
            { kind: 'interact', target: tree, option: 'chop down', cause: 'scouting_woodcutting_opportunity' },
        ]);
        expect(state.cognition?.activeGoal?.id).toBe('chop-level-one-tree');
        expect(complete).not.toHaveBeenCalled();
    });

    it('uses local work before anchor return when Body inference noops during aged scouting', async () => {
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3105, y: 3170, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                steps: ['walk locally', 'try a useful task after looking around'],
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 130,
            lastBodyTick: 1,
            lastAnchorReturnTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3104, 3175),
                objects: [tree],
            }),
        );

        expect(result.cause).toBe('scouting_woodcutting_opportunity');
        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'scouting_woodcutting_opportunity' }]);
        expect(state.cognition?.activeGoal?.id).toBe('chop-level-one-tree');
        expect(state.cognition?.lastScoutingSkillOpportunityTick).toBe(150);
        expect(llm.complete).toHaveBeenCalledTimes(1);
    });

    it('returns toward the visibility anchor during aged far-away scouting when no local work is visible', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                steps: ['walk locally', 'try a useful task after looking around'],
                createdAtTick: 1,
                ttlTicks: 600,
            },
            lastBrainTick: 1,
            lastBodyTick: 1,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 150,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3104, 3175),
                objects: [],
            }),
        );

        expect(result.cause).toBe('return_to_visibility_anchor');
        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3104, y: 3183, level: 0 }, range: 1, cause: 'return_to_visibility_anchor' },
        ]);
        expect(state.cognition?.activeGoal?.id).toBe('scout-nearby-area');
        expect(state.cognition?.lastScoutingSkillOpportunityTick).toBeUndefined();
        expect(complete).not.toHaveBeenCalled();
    });

    it('keeps a fresh scouting goal in exploration before taking a visible skilling opportunity', async () => {
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3105, y: 3170, level: 0 }, orientation: 0 };
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(() => Promise.reject(new Error('Body inference should not run')));
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 120,
                ttlTicks: 600,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            brainBackoffUntilTick: 1000,
            lastAnchorReturnTick: 150,
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3104, 3175),
                objects: [tree],
            }),
        );

        expect(result.cause).toBe('exploration_fallback');
        expect(result.actions[0]).toEqual({ kind: 'move_to', target: tree.position, range: 2, cause: 'explore_tree_stand' });
        expect(state.cognition?.activeGoal?.id).toBe('scout-nearby-area');
        expect(complete).not.toHaveBeenCalled();
    });

    it('moves on when scouting has already reached a nearby landmark', async () => {
        const fountain = { objectId: 879, position: { x: 3230, y: 3238, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['check a nearby landmark', 'move on after reaching it'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3230, 3238),
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3233, y: 3238, level: 0 }, range: 1, cause: 'explore_patrol' }]);
        expect(result.cause).toBe('exploration_fallback');
    });

    it('picks up useful nearby items while scouting instead of only reporting them', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3218, y: 3201, level: 0 } };
        const fountain = { objectId: 879, position: { x: 3219, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful things.',
                steps: ['walk to nearby landmarks', 'notice useful items', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(result.cause).toBe('opportunistic_pickup');
    });

    it('does not chase coins while scouting at low health', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3200, y: 3200, level: 0 } };
        const fountain = { objectId: 879, position: { x: 3201, y: 3200, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful things.',
                steps: ['walk to nearby landmarks', 'notice useful items', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3200, 3200),
                    hp: { current: 3, max: 10 },
                    inventory: [null],
                },
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(result.actions).not.toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(result.cause).toBe('low_health_hold_position');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('moves toward useful ground items while scouting when they are out of reach', async () => {
        const logs = { itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3224, y: 3201, level: 0 } };
        const fountain = { objectId: 879, position: { x: 3219, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful things.',
                steps: ['walk to nearby landmarks', 'notice useful items', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [logs],
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: logs, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(result.cause).toBe('opportunistic_pickup');
    });

    it('remembers recently attempted ground pickups and resumes scouting', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3218, y: 3201, level: 0 } };
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }, { text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful things.',
                steps: ['walk to nearby landmarks', 'notice useful items', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const first = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );
        const second = await agent.think(
            perception({
                tick: 40,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(second.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(second.cause).toBe('exploration_fallback');
    });

    it('keeps scavenged item spawns on the longer exploration cooldown while scouting', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3218, y: 3201, level: 0 } };
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
            { text: JSON.stringify({ actions: [] }) },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful things.',
                steps: ['walk to nearby landmarks', 'notice useful items', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const first = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(state.cognition?.explorationCooldowns?.['item:995:rs:coins:3218,3201,0']).toBe(3);

        const stillExploring = await agent.think(
            perception({
                tick: 150,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(stillExploring.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(stillExploring.cause).toBe('exploration_fallback');

        const revisitAfterCooldown = await agent.think(
            perception({
                tick: 650,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(revisitAfterCooldown.actions).toEqual([
            { kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' },
        ]);
    });

    it('keeps scavenged item spawns cooldowned after scouting shifts into skill practice', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3218, y: 3201, level: 0 } };
        const tree = { objectId: 1278, position: { x: 3220, y: 3201, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-woodcutting',
                description: 'Practice woodcutting on ordinary trees and gather logs.',
                steps: ['Find a visible ordinary tree.', 'Chop it for logs.'],
                createdAtTick: 30,
            },
            lastBrainTick: 30,
            lastBodyTick: 0,
            explorationCooldowns: {
                'item:995:rs:coins:3218,3201,0': 30,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 150,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                worldItems: [coins],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('woodcutting_level1_routine');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not opportunistically pick up items owned by another actor while scouting', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3218, y: 3201, level: 0 }, ownerId: 'player:codex' };
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful things.',
                steps: ['walk to nearby landmarks', 'notice useful items', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(result.cause).toBe('exploration_fallback');
    });

    it('turns repeated scouting chatter into visible exploration movement', async () => {
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'say', text: 'I see trees and objects nearby. Standing by.' }],
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout the nearby Lumbridge area and look for useful places.',
                steps: ['walk to nearby landmarks', 'report anything useful'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
            lastExplorationReportTick: 10,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: residentAt(3218, 3201),
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(result.cause).toBe('exploration_fallback');
    });

    it('starts a firemaking workflow from direct chat without waiting for inference', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [normalTree],
                events: [chatFromCodex('agent make fire', 3224, 3230)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('direct_chat_make_fire');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not pretend it can chop logs for firemaking without an axe', async () => {
        const normalTree = { objectId: 1278, position: { x: 3225, y: 3232, level: 0 }, orientation: 3 };
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3225, 3230),
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                objects: [normalTree],
                events: [chatFromCodex('agent make a fire', 3224, 3230)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I need an axe or logs before I can make a fire from that tree.' }]);
        expect(result.cause).toBe('direct_chat_make_fire');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('starts a starter fishing workflow from direct chat without waiting for inference', async () => {
        const fishingSpot = npc('Fishing spot', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [fishingSpot],
                events: [chatFromCodex('agent fish', 3218, 3200)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: fishingSpot, option: 'net', cause: 'starter_fishing_net' }]);
        expect(result.cause).toBe('direct_chat_fish');
        expect(state.cognition?.activeGoal?.id).toBe('catch-starter-fish');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not pretend it can fish without a small fishing net', async () => {
        const fishingSpot = npc('Fishing spot', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [],
                },
                npcs: [fishingSpot],
                events: [chatFromCodex('agent fish', 3218, 3200)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'Cannot do that without a small fishing net.',
                voiceSource: 'phrasebook',
            },
        ]);
        expect(result.cause).toBe('direct_chat_decline_missing_tool');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('runs direct cook commands on carried raw starter fish without inference', async () => {
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3202, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 317, key: 'rs:raw_shrimp', amount: 1 }],
                },
                objects: [fire],
                events: [chatFromCodex('agent cook shrimp', 3218, 3200)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on', itemSlot: 0, target: fire, cause: 'starter_fishing_cook_catch' }]);
        expect(result.cause).toBe('direct_chat_cook');
        expect(state.cognition?.activeGoal?.id).toBe('cook-starter-fish');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('moves into range of a visible starter fishing spot before netting', async () => {
        const fishingSpot = npc('Fishing spot', 3224, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-shrimp',
                description: 'Catch shrimp with a small fishing net at a Fishing spot.',
                steps: ['Find a Fishing spot', 'Use the net option'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fishingSpot.position, range: 1, cause: 'starter_fishing_approach' }]);
        expect(result.cause).toBe('starter_fishing_approach');
    });

    it('cooks raw starter fish on a visible fire before continuing the starter fishing loop', async () => {
        const fishingSpot = npc('Fishing spot', 3224, 3201);
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3202, level: 0 } };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch.',
                steps: ['Catch shrimp', 'Cook raw fish on a fire or range'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
                npcs: [fishingSpot],
                objects: [fire],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on', itemSlot: 1, target: fire, cause: 'starter_fishing_cook_catch' }]);
        expect(result.cause).toBe('starter_fishing_cook_catch');
    });

    it('explains the missing heat source when carrying raw starter fish', async () => {
        const fishingSpot = npc('Fishing spot', 3224, 3201);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch.',
                steps: ['Catch shrimp', 'Cook raw fish on a fire or range'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3209, 3213),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I have raw fish now. I need a fire or range to cook it.', cause: 'starter_fishing_missing_heat' },
        ]);
        expect(result.cause).toBe('starter_fishing_missing_heat');
    });

    it('seeds starter fishing as the active benchmark goal without initial Brain drift', async () => {
        const fishingSpot = npc('Fishing spot', 3239, 3244);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3237, 3244),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fishingSpot.position, range: 1, cause: 'starter_fishing_approach' }]);
        expect(result.cause).toBe('starter_fishing_approach');
        expect(state.cognition?.activeGoal?.id).toBe('catch-starter-fish');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('seeds fishing-cooking as an active benchmark goal without initial Brain drift', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'fishing-cooking-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3238, 3244),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
                objects: [{ objectId: objectIds.fire, position: { x: 3238, y: 3244, level: 0 } }],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'use_item_on',
                itemSlot: 1,
                target: { objectId: objectIds.fire, position: { x: 3238, y: 3244, level: 0 } },
                cause: 'starter_fishing_cook_catch',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_cook_catch');
        expect(state.cognition?.activeGoal?.id).toBe('catch-and-cook-starter-fish');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('does not pre-light the only cooking fire before catching fish for the fishing-cooking benchmark', async () => {
        const fishingSpot = npc('Fishing spot', 3241, 3242);
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'fishing-cooking-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3240, 3244),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fishingSpot.position, range: 1, cause: 'starter_fishing_approach' }]);
        expect(result.cause).toBe('starter_fishing_approach');
    });

    it('seeds combat prayer as the active benchmark goal without initial Brain drift', async () => {
        const goblin = npc('Goblin', 3254, 3231);
        goblin.key = 'rs:goblin';
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'combat-prayer-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3254, 3230),
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [goblin],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: goblin, cause: 'combat_attack_safe_target' }]);
        expect(result.cause).toBe('combat_attack_safe_target');
        expect(state.cognition?.activeGoal?.id).toBe('train-combat-safely');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('seeds explore-report as an active benchmark goal without initial Brain drift', async () => {
        const fountain = { objectId: 879, position: { x: 3222, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'explore-report-5m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                objects: [fountain],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' }]);
        expect(result.cause).toBe('exploration_fallback');
        expect(state.cognition?.activeGoal?.id).toBe('scout-nearby-area');
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(llm.complete.mock.calls[0][0].thinking).toBe(false);
    });

    it('beacons its active goal periodically before Body inference', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Practice firemaking.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online at 3218,3201. Goal: Practice firemaking.' }]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('eats carried food before non-combat goal beacons when low on health', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Practice firemaking.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                    inCombat: false,
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'eat', slot: 0, cause: 'low_health_eat' }]);
        expect(result.cause).toBe('low_health_eat');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('mentions the need for food or healing in goal beacons when low on health without food', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3201, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                    inCombat: false,
                },
            }),
        );

        expect(result.cause).toBe('low_health_hold_position');
        expect(result.actions[0]).toEqual({
            kind: 'say',
            text: 'I am hurt at 3201,3201. Holding near safety until I find food or heal.',
        });
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('returns toward the visibility anchor before roaming when low on health without food', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                    inCombat: false,
                },
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3200, y: 3200, level: 0 },
                range: 6,
                cause: 'low_health_return_to_anchor',
            },
        ]);
        expect(result.cause).toBe('low_health_return_to_anchor');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('holds position near the anchor instead of skilling when low on health without food', async () => {
        const tree = { objectId: 1278, position: { x: 3201, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcutting-practice',
                description: 'Practice woodcutting on ordinary trees and gather logs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 120,
            lastGoalShareTick: 120,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3200, 3200),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                    inCombat: false,
                },
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([]);
        expect(result.cause).toBe('low_health_hold_position');
        expect(result.nooped).toBe(true);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('occasionally says it is holding for food or healing when low on health near the anchor', async () => {
        const tree = { objectId: 1278, position: { x: 3201, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcutting-practice',
                description: 'Practice woodcutting on ordinary trees and gather logs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            lastGoalShareTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3200, 3200),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                    inCombat: false,
                },
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am hurt at 3200,3200. Holding near safety until I find food or heal.' }]);
        expect(result.cause).toBe('low_health_hold_position');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('prepares food before returning to anchor when low on health and carrying raw fish', async () => {
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 317, key: 'rs:raw_shrimp', amount: 1 }],
                    inCombat: false,
                },
                objects: [fire],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'use_item_on',
                itemSlot: 0,
                target: fire,
                cause: 'low_health_cook_food',
            },
        ]);
        expect(result.cause).toBe('low_health_cook_food');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('starts beaconing benchmark-seeded goals after the first share interval', async () => {
        const fishingSpot = npc('Fishing spot', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);
        const scene = (tick: number) =>
            perception({
                tick,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [fishingSpot],
            });

        await agent.think(scene(1));
        const result = await agent.think(scene(22));

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Catch shrimp with a small fishing net at a visible Fishing spot. Next: fish at 3219,3201 with my small net.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('beacons a concrete nearby opportunity with its active goal', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I am online at 3218,3201. Goal: Practice scouting. Next: pick up coins at 3219,3201.' },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('beacons tree stands as scouting while the exploration goal is still fresh', async () => {
        const tree = { objectId: objectIds.tree.normal[0].default, position: { x: 3224, y: 3201, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 100,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find. Next: scout the tree stand at 3224,3201.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('varies long-running presence beacons so live chat is not only an online status template', async () => {
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const sheep = npc('Sheep', 3219, 3202);
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.tick = 2521;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 2520,
            lastBodyTick: 2520,
            lastPresenceBeaconTick: 2300,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2521,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
                npcs: [sheep],
                objects: [tree],
            }),
        );

        expect(result.actions[0].kind).toBe('say');
        const text = String((result.actions[0] as { text?: string }).text);
        expect(text).toBe(
            'I am scouting. Nearby I see 1 tree, 1 item, and 1 NPC at 3218,3201. Goal: Practice scouting. Next: pick up coins at 3219,3201.',
        );
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon an exploration-cooldowned pickup as the next step', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            explorationCooldowns: {
                'item:995:rs:coins:3219,3201,0': 120,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                worldItems: [coins],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I am online at 3218,3201. Goal: Practice scouting. Next: chop the tree at 3219,3200.' },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon a pickup-cooldowned item as the next step', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            pickupCooldowns: {
                '995:rs:coins:3219,3201,0': 120,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                worldItems: [coins],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I am online at 3218,3201. Goal: Practice scouting. Next: chop the tree at 3219,3200.' },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon an exploration-cooldowned NPC family as the next step', async () => {
        const sheep = npc('Sheep', 3219, 3201);
        sheep.key = 'rs:sheep';
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            explorationCooldowns: {
                'npc-key:rs:sheep': 120,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                npcs: [sheep],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I am online at 3218,3201. Goal: Practice scouting. Next: chop the tree at 3219,3200.' },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon an exploration-cooldowned object as the next step', async () => {
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const gate = { objectId: 1530, position: { x: 3219, y: 3202, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            explorationCooldowns: {
                'object:1278:3219,3200,0': 120,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
                objects: [tree, gate],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Practice scouting.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon a target-failed tree as the next step', async () => {
        const failedTree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const nextTree = { objectId: 1278, position: { x: 3221, y: 3201, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcut-visible-tree',
                description: 'Move to a visible tree and chop it to gather logs and gain Woodcutting XP.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            targetFailureCooldowns: {
                'target:3219,3200,0': 120,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [failedTree, nextTree],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Move to a visible tree and chop it to gather logs and gain Woodcutting XP. Next: chop the tree at 3221,3201.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon self-owned stale logs as the next step', async () => {
        const logs = {
            itemId: 1511,
            key: 'rs:logs',
            amount: 1,
            position: { x: 3219, y: 3201, level: 0 },
            ownerId: 'player:res:agent',
        };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Practice scouting.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
                worldItems: [logs],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online at 3218,3201. Goal: Practice scouting.' }]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon stale firemaking logs beside an active fire as the next step', async () => {
        const logs = { itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3218, y: 3201, level: 0 } };
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3201, level: 0 }, orientation: 0 };
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                worldItems: [logs],
                objects: [fire, tree],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Gather ordinary logs and light a fire with the tinderbox. Next: chop the tree at 3219,3200.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('beacons firemaking next steps before unrelated NPC chatter', async () => {
        const guide = npc('RuneScape Guide', 3219, 3201);
        const tree = { objectId: 1278, position: { x: 3219, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather logs from a nearby ordinary tree and light a fire with the tinderbox.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                npcs: [guide],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Gather logs from a nearby ordinary tree and light a fire with the tinderbox. Next: chop the tree at 3219,3200.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('beacons starter fishing as the concrete next step instead of talking to the spot', async () => {
        const fishingSpot = npc('Fishing spot', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-starter-fish',
                description: 'Catch shrimp with a small fishing net.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Catch shrimp with a small fishing net. Next: fish at 3219,3201 with my small net.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps woodcutting beacons aligned with the active goal when only an NPC is nearby', async () => {
        const guide = npc('RuneScape Guide', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcut-visible-tree',
                description: 'Move to a visible tree and chop it to gather logs and gain Woodcutting XP.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
                npcs: [guide],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online at 3218,3201. Goal: Move to a visible tree and chop it to gather logs and gain Woodcutting XP. Next: look for an ordinary tree to chop.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps the concrete next step visible when beacon goals are long', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'long-scout-plan',
                description:
                    'Walk through the surrounding Lumbridge paths, keep track of useful training resources, stay close enough for Codex to find me, and opportunistically practice safe beginner actions.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
                worldItems: [coins],
            }),
        );

        expect(result.actions[0].kind).toBe('say');
        const text = String((result.actions[0] as { text?: string }).text);
        expect(text).toContain('Next: pick up coins at 3219,3201.');
        expect(text.length).toBeLessThanOrEqual(220);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('F5-T1 (Confident Retaliation): HP 95%, attacked by chicken. Assert attack + say with combat_decision.retaliate_confident phrasing.', async () => {
        const chickenTarget = npc('Chicken', 3219, 3201);
        chickenTarget.combatLevel = 1;
        chickenTarget.hpFraction = 1.0;
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 95, max: 100 },
                    combatLevel: 10,
                },
                npcs: [chickenTarget],
                events: [{ kind: 'hit_taken', from: chickenTarget }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'attack', target: chickenTarget, cause: 'combat_retaliate' },
            { kind: 'say', text: 'You think you can break me, Chicken? Think again.' },
        ]);
        expect(result.cause).toBe('combat_retaliate');
    });

    it('F5-T2 (Eat & Retaliate): HP 40%, food slot present, attacked by cow. Assert eat + say with combat_decision.retaliate_after_eat.', async () => {
        const cowTarget = npc('Cow', 3219, 3201);
        cowTarget.combatLevel = 2;
        cowTarget.hpFraction = 1.0;
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 40, max: 100 },
                    combatLevel: 10,
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [cowTarget],
                events: [{ kind: 'hit_taken', from: cowTarget }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'eat', slot: 0, cause: 'combat_eat_before_retaliating' },
            { kind: 'say', text: "Just eating to keep going. I won't fall here." },
        ]);
        expect(result.cause).toBe('combat_eat_before_retaliating');
    });

    it('F5-T3 (Low HP Retreat): HP 20%, no food, attacked by goblin. Assert move_to flee target + say with combat_decision.retreat_low_hp.', async () => {
        const goblinTarget = npc('Goblin', 3219, 3201);
        goblinTarget.combatLevel = 2;
        goblinTarget.hpFraction = 1.0;
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 20, max: 100 },
                    combatLevel: 10,
                    inventory: [],
                },
                npcs: [goblinTarget],
                events: [{ kind: 'hit_taken', from: goblinTarget }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3214, y: 3205, level: 0 }, cause: 'combat_retreat' },
            { kind: 'say', text: 'Barely hanging on... need to run!' },
        ]);
        expect(result.cause).toBe('combat_retreat');
    });

    it('F5-T4 (Outmatched Retreat): HP 80%, attacked by Greater Demon (unsafe). Assert move_to flee target + say with combat_decision.retreat_outmatched.', async () => {
        const demonTarget = npc('Greater Demon', 3219, 3201);
        demonTarget.combatLevel = 20;
        demonTarget.hpFraction = 1.0;
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 80, max: 100 },
                    combatLevel: 10,
                },
                npcs: [demonTarget],
                events: [{ kind: 'hit_taken', from: demonTarget }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3214, y: 3205, level: 0 }, cause: 'combat_retreat' },
            { kind: 'say', text: 'No point throwing my life away. Greater Demon is too much today.' },
        ]);
        expect(result.cause).toBe('combat_retreat');
    });

    it('F5-T5 (Aggressor Selection): Selects weakest visible aggressor based on HP fraction, combat level, and distance.', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        goblin.combatLevel = 2;
        goblin.hpFraction = 1.0;

        const chickenB = npc('Chicken', 3219, 3202);
        chickenB.id = 'npc:chicken_b';
        chickenB.combatLevel = 1;
        chickenB.hpFraction = 0.5;

        const chickenC = npc('Chicken', 3219, 3203);
        chickenC.id = 'npc:chicken_c';
        chickenC.combatLevel = 1;
        chickenC.hpFraction = 0.5;

        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 10, max: 10 },
                    combatLevel: 10,
                },
                npcs: [goblin, chickenB, chickenC],
                events: [
                    { kind: 'hit_taken', from: goblin },
                    { kind: 'hit_taken', from: chickenB },
                    { kind: 'hit_taken', from: chickenC },
                ],
            }),
        );

        expect(result.actions[0]).toEqual({ kind: 'attack', target: chickenB, cause: 'combat_retaliate' });
    });

    it('F5-T6 (Episode Deduplication): Assert narration is only emitted on tick 1, and subsequent consecutive combat ticks do not repeat narration.', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        goblin.combatLevel = 2;
        goblin.hpFraction = 1.0;

        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        // Tick 2: Initial attack, should narrate
        const result1 = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 10, max: 10 },
                    combatLevel: 10,
                    inCombat: true,
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result1.actions).toEqual([
            { kind: 'attack', target: goblin, cause: 'combat_retaliate' },
            { kind: 'say', text: 'You think you can break me, Goblin? Think again.' },
        ]);
        expect(state.cognition?.combatEpisodeNarrated).toBe(true);

        // Tick 3: consecutive combat tick, change Goblin HP fraction slightly to bypass repeated action check
        const goblinHurt = { ...goblin, hpFraction: 0.9 };
        state.cognition!.lastBodyTick = 2; // Advance thinking tick

        const result2 = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 10, max: 10 },
                    combatLevel: 10,
                    inCombat: true,
                },
                npcs: [goblinHurt],
                events: [{ kind: 'hit_taken', from: goblinHurt }],
            }),
        );

        // Should attack but NOT say any narration phrase since combatEpisodeNarrated is true
        expect(result2.actions).toEqual([{ kind: 'attack', target: goblinHurt, cause: 'combat_retaliate' }]);
    });

    it('F5-T7 (Episode Cooldown & Reset): Combat ends, then attacked again. Assert new narration emits.', async () => {
        const goblin = npc('Goblin', 3219, 3201);
        goblin.combatLevel = 2;
        goblin.hpFraction = 1.0;

        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        // Tick 2: Combat starts
        const result1 = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 10, max: 10 },
                    combatLevel: 10,
                    inCombat: true,
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );
        expect(result1.actions).toContainEqual({ kind: 'say', text: 'You think you can break me, Goblin? Think again.' });

        // Ticks 3, 4, 5: Not in combat (3 ticks total)
        for (let t = 3; t <= 5; t++) {
            state.cognition!.lastBodyTick = t - 1;
            await agent.think(
                perception({
                    tick: t,
                    resident: {
                        ...residentAt(3218, 3201),
                        inCombat: false,
                    },
                }),
            );
        }

        expect(state.cognition?.combatEpisodeActive).toBe(false);
        expect(state.cognition?.combatEndCelebrated).toBe(true);

        // Clear the body action backoff key so tick 6 doesn't trigger repeat action backoff
        state.cognition!.lastBodyActionKey = undefined;

        // Tick 6: Attacked again
        state.cognition!.lastBodyTick = 5;
        const result2 = await agent.think(
            perception({
                tick: 6,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 10, max: 10 },
                    combatLevel: 10,
                    inCombat: true,
                },
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result2.actions).toEqual([
            { kind: 'attack', target: goblin, cause: 'combat_retaliate' },
            { kind: 'say', text: 'You think you can break me, Goblin? Think again.' },
        ]);
    });

    it('F5-T8 (Kill Celebration): Combat ends. Assert say with "Down. I survived." is scheduled.', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            combatEpisodeActive: true,
            consecutiveNonCombatTicks: 0,
            combatEndCelebrated: false,
        };
        const agent = hybridAgent(llm, state);

        // Tick 3: non-combat tick 1
        await agent.think(
            perception({
                tick: 3,
                resident: { ...residentAt(3218, 3201), inCombat: false },
            }),
        );
        expect(state.cognition.combatEndCelebrated).toBe(false);

        // Tick 4: non-combat tick 2
        state.cognition.lastBodyTick = 3;
        await agent.think(
            perception({
                tick: 4,
                resident: { ...residentAt(3218, 3201), inCombat: false },
            }),
        );
        expect(state.cognition.combatEndCelebrated).toBe(false);

        // Tick 5: non-combat tick 3 -> triggers celebration
        state.cognition.lastBodyTick = 4;
        const result = await agent.think(
            perception({
                tick: 5,
                resident: { ...residentAt(3218, 3201), inCombat: false },
            }),
        );

        expect(state.cognition.combatEndCelebrated).toBe(true);
        expect(state.cognition.combatEpisodeActive).toBe(false);
        expect(result.actions).toEqual([{ kind: 'say', text: 'Down. I survived.' }]);
    });

    it('F5-T9 (Voice Registers): Achiever vs. Endurer vs. Mentor registers result in different phrasings.', async () => {
        const chickenTarget = npc('Chicken', 3219, 3201);
        chickenTarget.combatLevel = 1;
        chickenTarget.hpFraction = 1.0;

        const llm = scriptedLlm([]);

        // Achiever
        const soulAchiever = soul();
        soulAchiever.frontmatter.archetype = 'achiever';
        const stateAchiever = runtimeState();
        const agentAchiever = hybridAgent(llm, stateAchiever, soulAchiever);

        const resultAchiever = await agentAchiever.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 95, max: 100 },
                    combatLevel: 10,
                },
                npcs: [chickenTarget],
                events: [{ kind: 'hit_taken', from: chickenTarget }],
            }),
        );
        expect(resultAchiever.actions).toContainEqual({
            kind: 'say',
            text: "Time to level up. Let's go!",
        });

        // Mentor
        const soulMentor = soul();
        soulMentor.frontmatter.archetype = 'mentor';
        const stateMentor = runtimeState();
        const agentMentor = hybridAgent(llm, stateMentor, soulMentor);

        const resultMentor = await agentMentor.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 95, max: 100 },
                    combatLevel: 10,
                },
                npcs: [chickenTarget],
                events: [{ kind: 'hit_taken', from: chickenTarget }],
            }),
        );
        expect(resultMentor.actions).toContainEqual({
            kind: 'say',
            text: 'Let us see how Chicken fares against structured technique.',
        });

        // Endurer
        const soulEndurer = soul();
        soulEndurer.frontmatter.archetype = 'endurer';
        const stateEndurer = runtimeState();
        const agentEndurer = hybridAgent(llm, stateEndurer, soulEndurer);

        const resultEndurer = await agentEndurer.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 95, max: 100 },
                    combatLevel: 10,
                },
                npcs: [chickenTarget],
                events: [{ kind: 'hit_taken', from: chickenTarget }],
            }),
        );
        expect(resultEndurer.actions).toContainEqual({
            kind: 'say',
            text: 'You think you can break me, Chicken? Think again.',
        });
    });

    describe('F2: Nearby human reaction', () => {
        it('F2-T1: Player says "what a nice day" within earshot. Assert: small talk reply with voiceSource: "inference".', async () => {
            const llm = scriptedLlm([{ text: 'Yes, it is indeed a beautiful day.' }]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202); // 2 tiles away (within earshot)

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'what a nice day',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions).toEqual([{ kind: 'say', text: 'Yes, it is indeed a beautiful day.', voiceSource: 'inference' }]);
            expect(result.chat_reply_emitted).toBe(true);
            expect(result.chat_reply_kind).toBe('small_talk');
            expect(result.voiceSource).toBe('inference');
        });

        it('F2-T1b: Small talk prompt includes recent Library memories so the resident can answer recall questions.', async () => {
            const llm = scriptedLlm([{ text: 'Alice gave me a tinderbox, and I promised Codex shrimp.' }]);
            const state = runtimeState();
            const agent = hybridAgent(
                llm,
                state,
                soul(),
                memory([
                    'Patron gift from alice@onion: rs:tinderbox (2026-05-23 03:00:00)',
                    'story_note: I promised to cook shrimp for Codex at 2026-05-23 03:01:00',
                ]),
            );
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'what do you remember about alice and my shrimp?',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions).toEqual([
                { kind: 'say', text: 'Alice gave me a tinderbox, and I promised Codex shrimp.', voiceSource: 'inference' },
            ]);
            const prompt = llm.complete.mock.calls[0]?.[0].prompt;
            expect(prompt).toContain('Recent Library memories');
            expect(prompt).toContain('alice@onion');
            expect(prompt).toContain('promised to cook shrimp for Codex');
        });

        it('F2-T1c: Small talk converts JSON-like memory echo into a natural recall line.', async () => {
            const llm = scriptedLlm([
                {
                    text: '{ "archetype": "endurer", "voice": "default", "memories": [ "Patron gift from alice@onion: rs:tinderbox (2026-05-23 03:00:00)", "story_note: I promised to cook shrimp for Codex at 2026-05-23 03:01:00" ] }',
                },
            ]);
            const agent = hybridAgent(
                llm,
                runtimeState(),
                soul(),
                memory([
                    'Patron gift from alice@onion: rs:tinderbox (2026-05-23 03:00:00)',
                    'story_note: I promised to cook shrimp for Codex after practicing fishing. at 2026-05-23 03:01:00',
                ]),
            );
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [{ kind: 'chat', from: peer, text: 'what do you remember about alice and my shrimp?', to: 'public' }],
                }),
            );

            const text = String((result.actions[0] as any).text);
            expect(text).not.toContain('{');
            expect(text).not.toContain('..');
            expect(text.toLowerCase()).toContain('alice');
            expect(text.toLowerCase()).toContain('tinderbox');
            expect(text.toLowerCase()).toContain('shrimp');
        });

        it('F2-T2: Player says "agent go" within earshot. Assert: clarifying question with voiceSource: "phrasebook".', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'agent go',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions[0].kind).toBe('say');
            const text = String((result.actions[0] as any).text);
            expect(text.toLowerCase()).toContain('go');
            expect(result.actions[0].voiceSource).toBe('phrasebook');
            expect(result.chat_reply_emitted).toBe(true);
            expect(result.chat_reply_kind).toBe('clarifying_question');
            expect(result.voiceSource).toBe('phrasebook');
        });

        it('F2-T3: Player says "agent make fire" while resident has no tinderbox. Assert: decline say mentions tinderbox and refusalReason: "missing_tool" in telemetry.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: {
                        ...residentAt(3200, 3200),
                        inventory: [], // Empty inventory
                    },
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'agent make fire',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions[0].kind).toBe('say');
            const text = String((result.actions[0] as any).text);
            expect(text.toLowerCase()).toContain('tinderbox');
            expect(result.actions[0].voiceSource).toBe('phrasebook');
            expect(result.chat_reply_emitted).toBe(true);
            expect(result.chat_reply_kind).toBe('polite_decline');
            expect(result.refusalReason).toBe('missing_tool');
        });

        it('F2-T4: Player says "agent make fire" while resident is mid-combat. Assert: NO say reply emitted, combat wins, refusalReason: "busy_higher_priority_goal".', async () => {
            const chickenTarget = npc('Chicken', 3201, 3201);
            chickenTarget.combatLevel = 1;
            chickenTarget.hpFraction = 1.0;
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: {
                        ...residentAt(3200, 3200),
                        hp: { current: 10, max: 10 },
                        combatLevel: 10,
                        inCombat: true,
                    },
                    npcs: [chickenTarget],
                    events: [
                        { kind: 'hit_taken', from: chickenTarget },
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'agent make fire',
                            to: 'public',
                        },
                    ],
                }),
            );

            // Expect ONLY combat actions, no say action from direct chat!
            expect(result.actions).toEqual([
                { kind: 'attack', target: chickenTarget, cause: 'combat_retaliate' },
                { kind: 'say', text: 'You think you can break me, Chicken? Think again.' },
            ]);
            expect(result.chat_reply_emitted).toBe(false);
            expect(result.chat_reply_kind).toBe('polite_decline');
            expect(result.refusalReason).toBe('busy_higher_priority_goal');
        });

        it('F2-T5: Player says "what a nice day" but CHAT_REPLIES_PER_WINDOW is exhausted. Assert: no say action, chat_reply_suppressed: "rate_limited".', async () => {
            const llm = scriptedLlm([{ text: 'Nice day!' }]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            // Setup rates: push three replies at tick 1
            const ticks = [1, 1, 1];
            state.cognition = {
                chatReplyTicks: ticks,
                activeGoal: { id: 'catch-starter-fish', description: 'catch fish', createdAtTick: 2 },
                lastBrainTick: 2,
                lastBodyTick: 999,
            };

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'what a nice day',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions).toEqual([]);
            expect(result.chat_reply_emitted).toBe(false);
            expect(result.chat_reply_suppressed).toBe('rate_limited');
        });

        it('F2-T6: Player says "what a nice day" but inference budget is exhausted. Assert: no say action, chat_reply_suppressed: "budget_exhausted".', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            // Exhaust minute budget
            state.budgets.requestsThisMinute = 1000;
            state.budgets.minuteStartedAt = new Date().toISOString();

            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'what a nice day',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions).toEqual([]);
            expect(result.chat_reply_emitted).toBe(false);
            expect(result.chat_reply_suppressed).toBe('budget_exhausted');
        });

        it('F2-T7: Player says "what a nice day" at 12 tiles distance. Assert: no reply.', async () => {
            const llm = scriptedLlm([{ text: 'Nice day!' }]);
            const state = runtimeState();
            state.cognition = {
                activeGoal: { id: 'catch-starter-fish', description: 'catch fish', createdAtTick: 2 },
                lastBrainTick: 2,
                lastBodyTick: 999,
            };
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3212, 3200); // 12 tiles away (out of earshot)

            const result = await agent.think(
                perception({
                    tick: 2,
                    events: [
                        {
                            kind: 'chat',
                            from: peer,
                            text: 'what a nice day',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions).toEqual([]);
        });

        it('F2-T8: Voice preservation: different voice registers result in different phrasings.', async () => {
            const llm = scriptedLlm([]);
            const peer = player('codex', 3202, 3202);

            // Achiever
            const soulAchiever = soul();
            soulAchiever.frontmatter.archetype = 'achiever';
            const agentAchiever = hybridAgent(llm, runtimeState(), soulAchiever);
            const resAchiever = await agentAchiever.think(
                perception({
                    tick: 2,
                    events: [{ kind: 'chat', from: peer, text: 'agent go', to: 'public' }],
                }),
            );
            const txtAchiever = String((resAchiever.actions[0] as any).text);

            // Mentor
            const soulMentor = soul();
            soulMentor.frontmatter.archetype = 'mentor';
            const agentMentor = hybridAgent(llm, runtimeState(), soulMentor);
            const resMentor = await agentMentor.think(
                perception({
                    tick: 2,
                    events: [{ kind: 'chat', from: peer, text: 'agent go', to: 'public' }],
                }),
            );
            const txtMentor = String((resMentor.actions[0] as any).text);

            expect(txtAchiever).not.toBe(txtMentor);
            expect(txtAchiever).toContain('Go where');
            expect(txtMentor).toContain('Where should we walk');
        });

        it('F2-INT: A 5-tick sequence: idle -> peer says "nice day" -> idle -> peer asks ambiguous command -> idle.', async () => {
            const llm = scriptedLlm([{ text: 'Indeed it is!' }]);
            const state = runtimeState();
            state.cognition = {
                activeGoal: { id: 'catch-starter-fish', description: 'catch fish', createdAtTick: 1 },
                lastBrainTick: 999,
                lastBodyTick: 999,
            };
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            // Tick 1: Idle
            const res1 = await agent.think(perception({ tick: 1 }));
            expect(res1.actions).toEqual([]);

            // Tick 2: Peer says "nice day"
            const res2 = await agent.think(
                perception({
                    tick: 2,
                    events: [{ kind: 'chat', from: peer, text: 'nice day', to: 'public' }],
                }),
            );
            expect(res2.actions[0]).toEqual({
                kind: 'say',
                text: 'Indeed it is!',
                voiceSource: 'inference',
            });

            // Tick 3: Idle
            const res3 = await agent.think(perception({ tick: 3 }));
            expect(res3.actions).toEqual([]);

            // Tick 4: Peer asks ambiguous command "agent give"
            const res4 = await agent.think(
                perception({
                    tick: 4,
                    events: [{ kind: 'chat', from: peer, text: 'agent give', to: 'public' }],
                }),
            );
            expect(res4.actions[0].kind).toBe('say');
            expect((res4.actions[0] as any).text).toContain('Give what');
            expect(res4.actions[0].voiceSource).toBe('phrasebook');

            // Tick 5: Idle
            const res5 = await agent.think(perception({ tick: 5 }));
            expect(res5.actions).toEqual([]);
        });
    });
});

function hybridAgent(llm: MockLlm, state = runtimeState(), agentSoul = soul(), memoryStore = memory()): HybridAgentThinkingModule {
    return new HybridAgentThinkingModule({
        soul: agentSoul,
        state,
        memory: memoryStore,
        llm: llm as unknown as LlmClient,
    });
}

type MockLlm = { complete: jest.Mock<Promise<LlmResponse>, [LlmRequest]> };

function scriptedLlm(responses: Array<Partial<LlmResponse>>): MockLlm {
    const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>();
    for (const response of responses) {
        complete.mockResolvedValueOnce({
            text: response.text || JSON.stringify({ actions: [] }),
            model: response.model,
            nooped: response.nooped ?? false,
            cancelledBy: response.cancelledBy,
            promptTokens: response.promptTokens,
            completionTokens: response.completionTokens,
        });
    }
    complete.mockResolvedValue({ text: JSON.stringify({ actions: [] }), nooped: true });
    return { complete };
}

function soul(): Soul {
    return {
        sourcePath: '/tmp/res-agent.md',
        body: '# Agent\n\nAgent is steady, curious, and wants to survive by learning useful routines.',
        frontmatter: {
            name: 'res:agent',
            display: 'Agent',
            archetype: 'endurer',
            model: { endpoint: 'default', temperature: 0.6 },
            behavior: {
                kind: 'hybrid-agent',
                followPlayer: 'codex',
                commandPrefix: 'agent',
                brainEveryTicks: 50,
                bodyEveryTicks: 1,
                shareGoalsEveryTicks: 20,
                visibilityAnchor: { x: 3200, y: 3200, level: 0 },
                returnToAnchorEveryTicks: 10,
                returnToAnchorRadius: 6,
            },
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
        },
    };
}

function runtimeState(): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:agent',
        attention: 100,
        tick: 0,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function memory(retrieved: string[] = []): MemoryStore {
    return {
        ensureResident: jest.fn(() => '/tmp/agent-memory'),
        retrieve: jest.fn(() => retrieved),
        write: jest.fn(),
        upsertIndexPatch: jest.fn(),
    } as unknown as MemoryStore;
}

function perception(
    overrides: {
        tick?: number;
        resident?: Record<string, unknown>;
        players?: Array<Record<string, unknown>>;
        npcs?: Array<Record<string, unknown>>;
        worldItems?: Array<Record<string, unknown>>;
        objects?: Array<Record<string, unknown>>;
        events?: Array<Record<string, unknown>>;
    } = {},
): Perception {
    return {
        tick: overrides.tick ?? 1,
        resident: overrides.resident || residentAt(3200, 3200),
        nearby: {
            players: overrides.players || [],
            npcs: overrides.npcs || [],
            worldItems: overrides.worldItems || [],
            objects: overrides.objects || [],
        },
        events: overrides.events || [],
        availableActions: [],
    };
}

function residentAt(x: number, y: number): Record<string, unknown> {
    return {
        id: 'resident:res:agent',
        position: { x, y, level: 0 },
        hp: { current: 10, max: 10 },
        skills: {},
        inCombat: false,
        combatTarget: null,
        busy: false,
        inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
        equipment: [],
    };
}

function chatFromCodex(text: string, x: number, y: number): Record<string, unknown> {
    return {
        kind: 'chat',
        from: {
            id: 'player:codex',
            kind: 'player',
            name: 'codex',
            position: { x, y, level: 0 },
            hpFraction: 1,
        },
        text,
        to: 'public',
    };
}

function chatFromResidentPeer(text: string, x: number, y: number): Record<string, unknown> {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:bmk_codex',
            kind: 'resident',
            name: 'Codex',
            position: { x, y, level: 0 },
            hpFraction: 1,
        },
        text,
        to: 'public',
    };
}

function chatFromSelfResident(text: string, x: number, y: number): Record<string, unknown> {
    return {
        kind: 'chat',
        from: {
            id: 'resident:res:agent',
            kind: 'resident',
            name: 'res:agent',
            position: { x, y, level: 0 },
            hpFraction: 1,
        },
        text,
        to: 'public',
    };
}

function npc(name: string, x: number, y: number): Record<string, unknown> {
    return {
        id: `npc:${name.toLowerCase()}`,
        kind: 'npc',
        name,
        key: name.toLowerCase(),
        position: { x, y, level: 0 },
        hpFraction: 1,
    };
}

function player(name: string, x: number, y: number): Record<string, unknown> {
    return {
        id: `player:${name.toLowerCase()}`,
        kind: 'player',
        name,
        position: { x, y, level: 0 },
        hpFraction: 1,
    };
}
