import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { HybridAgentThinkingModule } from './hybrid-agent-thinking-module';

describe('HybridAgentThinkingModule', () => {
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
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                objects: [normalTree],
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

        expect(result.actions).toEqual([{ kind: 'interact', target: nearestTree, option: 'chop down', cause: 'woodcutting_level1_routine' }]);
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
        expect(result.cause).toBe('firemaking_gather_logs');
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
        expect(state.cognition?.activeGoal?.id).toBe('scout-nearby-area');
    });

    it('breaks out of alternating stationary firemaking and woodcutting work', async () => {
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
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: landmark.position, range: 2, cause: 'routine_loop_break' }]);
        expect(result.cause).toBe('routine_loop_break');
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
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: firstLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: secondLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
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

    it('switches to a nearby patrol when a committed move makes no visible progress', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const llm = scriptedLlm([
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3229, y: 3247, level: 0 }, range: 1, cause: 'stuck_move_recovery' }]);
        expect(result.cause).toBe('stuck_move_recovery');
    });

    it('tries to open a nearby door or gate before abandoning a stuck move', async () => {
        const blockedLandmark = { x: 3243, y: 3242, level: 0 };
        const door = { objectId: 1530, position: { x: 3233, y: 3244, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
            { text: JSON.stringify({ actions: [{ kind: 'move_to', target: blockedLandmark, range: 1, cause: 'approach_interaction_target' }] }) },
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3222, y: 3213, level: 0 }, range: 2, cause: 'direct_chat_follow' }]);
        expect(result.cause).toBe('direct_chat_follow');
        expect(llm.complete).not.toHaveBeenCalled();
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3200, y: 3200, level: 0 }, range: 2, cause: 'direct_chat_return_home' }]);
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'I will pause here and wait for a new goal.' }]);
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

        expect(result.actions).toEqual([{ kind: 'attack', target: goblin, cause: 'combat_retaliate' }]);
        expect(result.cause).toBe('combat_retaliate');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('retreats from NPC combat when hurt and carrying no recognizable food', async () => {
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
                events: [{ kind: 'hit_taken', from: goblin }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3214, y: 3205, level: 0 }, cause: 'combat_retreat' }]);
        expect(result.cause).toBe('combat_retreat');
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'Alice is attacking me. Tell me "agent attack Alice" if I should fight back.' }]);
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: chicken.position, range: 1, cause: 'combat_approach_safe_target' }]);
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
        const bones = { itemId: 526, key: 'rs:bones', amount: 1, position: { x: 3218, y: 3201, level: 0 } };
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

        expect(result.actions).toEqual([{ kind: 'attack', target: rat, cause: 'combat_retaliate' }]);
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am too hurt to start combat without food. I need to heal or get food first.' }]);
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: goblin.position, range: 1, cause: 'prayer_approach_safe_bone_source' }]);
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: chicken.position, range: 1, cause: 'prayer_approach_safe_bone_source' }]);
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3222, y: 3218, level: 0 }, range: 6, cause: 'prayer_seek_safe_bone_source' }]);
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: logs.position, range: 1, cause: 'opportunistic_pickup' }]);
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
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                objects: [normalTree],
                events: [chatFromCodex('agent make a fire', 3224, 3230)],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: normalTree.position, range: 1, cause: 'woodcutting_level1_routine' }]);
        expect(result.cause).toBe('direct_chat_make_fire');
        expect(llm.complete).not.toHaveBeenCalled();
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
});

function hybridAgent(llm: MockLlm, state = runtimeState()): HybridAgentThinkingModule {
    return new HybridAgentThinkingModule({
        soul: soul(),
        state,
        memory: memory(),
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

function memory(): MemoryStore {
    return {
        ensureResident: jest.fn(() => '/tmp/agent-memory'),
        retrieve: jest.fn(() => []),
        write: jest.fn(),
        upsertIndexPatch: jest.fn(),
    } as unknown as MemoryStore;
}

function perception(overrides: {
    tick?: number;
    resident?: Record<string, unknown>;
    players?: Array<Record<string, unknown>>;
    npcs?: Array<Record<string, unknown>>;
    worldItems?: Array<Record<string, unknown>>;
    objects?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
} = {}): Perception {
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
        inventory: [],
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
