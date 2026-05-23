import { objectIds } from '@engine/world/config/object-ids';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import { MemoryStore } from '../memory/memory-store';
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

    it('threads retrieved Library memories into both Brain and Body LLM prompts', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'cook-for-codex',
                        description: 'Cook shrimp for Codex because I promised it earlier.',
                        steps: ['remember the promise', 'catch shrimp', 'cook shrimp'],
                    },
                }),
            },
            {
                text: JSON.stringify({
                    cause: 'body_step',
                    actions: [{ kind: 'say', text: 'I remember the shrimp promise.' }],
                }),
            },
        ]);
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-library-memory-'));
        const timelineDir = path.join(memoryRoot, 'library', 'res-agent');
        fs.mkdirSync(timelineDir, { recursive: true });
        fs.writeFileSync(
            path.join(timelineDir, 'timeline.jsonl'),
            [
                JSON.stringify({
                    kind: 'patron_gift',
                    patronHandle: 'alice@onion',
                    artifact: 'rs:tinderbox',
                    ts: '2026-05-22T10:00:00.000Z',
                }),
                JSON.stringify({ kind: 'say', note: 'I promised to cook shrimp for Codex.', ts: '2026-05-22T11:00:00.000Z' }),
            ].join('\n') + '\n',
        );
        const residentMemory = new MemoryStore(memoryRoot, '');
        const retrieveSpy = jest.spyOn(residentMemory, 'retrieve');
        const agent = hybridAgent(llm, runtimeState(), soul(), residentMemory);

        try {
            await agent.think(perception({ tick: 1 }));

            expect(llm.complete).toHaveBeenCalledTimes(2);
            expect(llm.complete.mock.calls[0][0].prompt).toContain('alice@onion');
            expect(llm.complete.mock.calls[0][0].prompt).toContain('cook shrimp for Codex');
            expect(llm.complete.mock.calls[1][0].prompt).toContain('alice@onion');
            expect(llm.complete.mock.calls[1][0].prompt).toContain('cook shrimp for Codex');
            expect(retrieveSpy).toHaveBeenCalledWith('res:agent', expect.stringContaining('brain'), expect.any(Number));
            expect(retrieveSpy).toHaveBeenCalledWith('res:agent', expect.stringContaining('body'), expect.any(Number));
        } finally {
            fs.rmSync(memoryRoot, { recursive: true, force: true });
        }
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

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3233, y: 3238, level: 0 }, range: 1, cause: 'explore_patrol' }]);
        expect(result.cause).toBe('exploration_fallback');
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'I will pause here and wait for a new goal.' }]);
        expect(result.cause).toBe('direct_chat_stop');
        expect(state.cognition?.activeGoal).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('holds a direct stop pause on later ticks until a new direct goal arrives', async () => {
        const codex = player('codex', 3228, 3201);
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: { id: 'wander', description: 'Resume wandering without a direct command.' },
                    say: 'I am resuming on my own.',
                }),
            },
        ]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'follow-codex',
                description: 'Follow codex and stay visible.',
                createdAtTick: 1,
            },
            followTarget: { name: 'codex', id: 'player:codex', kind: 'player', setAtTick: 1 },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state);

        const stop = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent wait', 3218, 3201)],
            }),
        );
        expect(stop.actions).toEqual([{ kind: 'say', text: 'I will pause here and wait for a new goal.' }]);

        const held = await agent.think(
            perception({
                tick: 100,
                resident: residentAt(3218, 3201),
                players: [codex],
            }),
        );

        expect(held.actions).toEqual([]);
        expect(held.cause).toBe('direct_chat_pause_hold');
        expect(state.cognition?.followTarget).toMatchObject({ paused: true });
        expect(state.cognition?.activeGoal).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();

        const resumed = await agent.think(
            perception({
                tick: 101,
                resident: residentAt(3218, 3201),
                players: [codex],
                events: [chatFromCodex('agent follow me', 3228, 3201)],
            }),
        );
        expect(resumed.actions).toEqual([
            { kind: 'move_to', target: { x: 3228, y: 3201, level: 0 }, range: 2, cause: 'direct_chat_follow' },
        ]);
        expect(state.cognition?.manualPauseSinceTick).toBeUndefined();
        expect(state.cognition?.followTarget).toMatchObject({ paused: false });
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

        expect(narration.actions).toEqual([]);
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

        expect(result.actions).toEqual([
            { kind: 'move_to', target: chicken.position, range: 1, cause: 'prayer_approach_safe_bone_source' },
        ]);
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
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(llm.complete.mock.calls[0][0].thinking).toBe(false);
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
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(llm.complete.mock.calls[0][0].thinking).toBe(false);
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
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(llm.complete.mock.calls[0][0].thinking).toBe(false);
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
        expect(llm.complete).toHaveBeenCalledTimes(1);
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

        it('F2-T4b: Nearby small talk during combat does not preempt survival actions.', async () => {
            const chickenTarget = npc('Chicken', 3201, 3201);
            chickenTarget.combatLevel = 1;
            chickenTarget.hpFraction = 1.0;
            const llm = scriptedLlm([{ text: 'Lovely weather for not dying.' }]);
            const agent = hybridAgent(llm, runtimeState());
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
                            text: 'what a nice day',
                            to: 'public',
                        },
                    ],
                }),
            );

            expect(result.actions).toEqual([
                { kind: 'attack', target: chickenTarget, cause: 'combat_retaliate' },
                { kind: 'say', text: 'You think you can break me, Chicken? Think again.' },
            ]);
            expect(llm.complete).not.toHaveBeenCalled();
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

function hybridAgent(llm: MockLlm, state = runtimeState(), agentSoul = soul(), residentMemory = memory()): HybridAgentThinkingModule {
    return new HybridAgentThinkingModule({
        soul: agentSoul,
        state,
        memory: residentMemory,
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
