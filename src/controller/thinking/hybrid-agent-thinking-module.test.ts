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
        expect(bodyRequest.thinking).toBe(false);
        expect(bodyRequest.prompt).toContain('/no_think');
        expect(bodyRequest.prompt).toContain('Walk outside, stay visible to Codex');
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
