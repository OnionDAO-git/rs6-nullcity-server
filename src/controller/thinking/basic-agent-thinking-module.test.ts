import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { BasicAgentThinkingModule } from './basic-agent-thinking-module';

describe('BasicAgentThinkingModule', () => {
    it('starts following the command sender and moves toward them on later ticks', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3210, 3208);

        const acknowledged = await agent.think(
            perception({
                resident: residentAt(3200, 3200),
                players: [codex],
                events: [chatFrom(codex, 'agent follow me')],
            }),
        );

        expect(acknowledged.actions).toEqual([{ kind: 'say', text: 'Following you, Codex.' }]);

        const follow = await agent.think(
            perception({
                resident: residentAt(3200, 3200),
                players: [codex],
            }),
        );

        expect(follow.actions).toEqual([{ kind: 'move_to', target: codex.position }]);
    });

    it('backs off duplicate follow moves to the same destination', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3210, 3208);
        const resident = residentAt(3200, 3200);

        const first = await agent.think(
            perception({
                tick: 10,
                resident,
                players: [codex],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'move_to', target: codex.position }]);

        const duplicate = await agent.think(
            perception({
                tick: 11,
                resident,
                players: [codex],
            }),
        );

        expect(duplicate).toMatchObject({ actions: [], cause: 'idle', nooped: true });

        const backedOff = await agent.think(
            perception({
                tick: 15,
                resident,
                players: [codex],
            }),
        );

        expect(backedOff).toMatchObject({ actions: [], cause: 'idle', nooped: true });

        const retry = await agent.think(
            perception({
                tick: 70,
                resident,
                players: [codex],
            }),
        );

        expect(retry.actions).toEqual([{ kind: 'move_to', target: codex.position }]);
    });

    it('describes visible surroundings when asked what it sees', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);
        const hans = actor('npc:1', 'npc', 'Hans', 3202, 3202);

        const result = await agent.think(
            perception({
                players: [codex],
                npcs: [hans],
                events: [chatFrom(codex, 'agent what do you see')],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I see Hans nearby. You can tell me "agent talk to Hans" or lead me somewhere else.' },
        ]);
    });

    it('describes unknown scenery without leaking raw object ids', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);

        const result = await agent.think(
            perception({
                players: [codex],
                objects: [{ objectId: 980, position: { x: 3201, y: 3201, level: 0 }, orientation: 1 }],
                events: [chatFrom(codex, 'agent what do you see')],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'I see nearby scenery we may be able to inspect. Lead me closer if you want to try it.' },
        ]);
    });

    it('talks to a named NPC when commanded', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);
        const hans = actor('npc:1', 'npc', 'Hans', 3202, 3202);

        const result = await agent.think(
            perception({
                players: [codex],
                npcs: [hans],
                events: [chatFrom(codex, 'agent talk to Hans')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: hans, option: 'talk-to' }]);
    });

    it('picks up a named visible ground item', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);
        const logs = { itemId: 1511, key: 'rs:logs', amount: 1, position: { x: 3201, y: 3200, level: 0 } };
        const bones = { itemId: 526, key: 'rs:bones', amount: 1, position: { x: 3202, y: 3200, level: 0 } };

        const result = await agent.think(
            perception({
                players: [codex],
                worldItems: [bones, logs],
                events: [chatFrom(codex, 'agent pick up logs')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: logs, option: 'pick-up' }]);
    });

    it('drops a named carried item', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);

        const result = await agent.think(
            perception({
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                players: [codex],
                events: [chatFrom(codex, 'agent drop logs')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'drop', slot: 1 }]);
    });

    it('summarizes carried inventory when asked', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);

        const result = await agent.think(
            perception({
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 2 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                players: [codex],
                events: [chatFrom(codex, 'agent inventory')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am carrying tinderbox, logs x3.' }]);
    });

    it('uses a tinderbox on logs when commanded to make a fire', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);

        const result = await agent.think(
            perception({
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                players: [codex],
                events: [chatFrom(codex, 'agent make a fire')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 }]);
    });

    it('explains when asked to make a fire without logs', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);

        const result = await agent.think(
            perception({
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                },
                players: [codex],
                events: [chatFrom(codex, 'agent make a fire')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I have a tinderbox, but I need logs before I can make a fire.' }]);
    });

    it('explains when asked to make a fire without a tinderbox', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);

        const result = await agent.think(
            perception({
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [{ itemId: 1511, key: 'rs:logs', amount: 1 }],
                },
                players: [codex],
                events: [chatFrom(codex, 'agent make a fire')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I have logs, but I need a tinderbox before I can make a fire.' }]);
    });

    it('does not follow or comment while a firemaking attempt is in progress', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3210, 3208);

        await agent.think(
            perception({
                tick: 10,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                players: [codex],
                events: [chatFrom(codex, 'agent make a fire')],
            }),
        );

        const paused = await agent.think(
            perception({
                tick: 11,
                resident: residentAt(3200, 3200),
                players: [codex],
            }),
        );

        expect(paused).toMatchObject({ actions: [], cause: 'idle', nooped: true });
    });

    it('eats food before any other action when health is low', async () => {
        const agent = basicAgent();

        const result = await agent.think(
            perception({
                resident: {
                    ...residentAt(3200, 3200),
                    hp: { current: 3, max: 10 },
                    inventory: [null, { itemId: 333, key: 'rs:trout', amount: 1 }],
                },
            }),
        );

        expect(result.actions).toEqual([{ kind: 'eat', slot: 1 }]);
    });

    it('retaliates against NPC attackers when healthy enough', async () => {
        const agent = basicAgent();
        const goblin = actor('npc:7', 'npc', 'Goblin', 3201, 3200);

        const result = await agent.think(
            perception({
                npcs: [goblin],
                events: [{ kind: 'hit_taken', from: goblin, damage: 1, type: 'melee' }],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: goblin }]);
    });

    it('does not retaliate against human players unless explicitly commanded', async () => {
        const agent = basicAgent();
        const attacker = actor('player:alice', 'player', 'Alice', 3201, 3200);

        const result = await agent.think(
            perception({
                players: [attacker],
                events: [{ kind: 'hit_taken', from: attacker, damage: 1, type: 'melee' }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'Alice is attacking me. Tell me "agent attack Alice" if I should fight back.' },
        ]);
    });

    it('attacks a named player when explicitly commanded', async () => {
        const agent = basicAgent();
        const codex = actor('player:codex', 'player', 'Codex', 3200, 3201);
        const alice = actor('player:alice', 'player', 'Alice', 3201, 3200);

        const result = await agent.think(
            perception({
                players: [codex, alice],
                events: [chatFrom(codex, 'agent attack Alice')],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: alice }]);
    });

    it('does not repeat the same ambient observation until the scene changes', async () => {
        const agent = basicAgent();
        const man = actor('npc:1', 'npc', 'Man', 3202, 3202);
        const hans = actor('npc:2', 'npc', 'Hans', 3203, 3202);

        const first = await agent.think(perception({ tick: 50, npcs: [man] }));

        expect(first.actions).toEqual([{ kind: 'say', text: 'I can see Man nearby. Maybe walk us closer and we can talk.' }]);

        const repeated = await agent.think(perception({ tick: 100, npcs: [man] }));

        expect(repeated).toMatchObject({ actions: [], cause: 'idle', nooped: true });

        const changed = await agent.think(perception({ tick: 150, npcs: [hans] }));

        expect(changed.actions).toEqual([{ kind: 'say', text: 'I can see Hans nearby. Maybe walk us closer and we can talk.' }]);
    });

    it('does not repeat an ambient observation after perception briefly loses it', async () => {
        const agent = basicAgent();
        const bob = actor('npc:1', 'npc', 'Bob', 3202, 3202);

        const first = await agent.think(perception({ tick: 50, npcs: [bob] }));

        expect(first.actions).toEqual([{ kind: 'say', text: 'I can see Bob nearby. Maybe walk us closer and we can talk.' }]);

        await agent.think(perception({ tick: 100, npcs: [] }));

        const flicker = await agent.think(perception({ tick: 150, npcs: [bob] }));

        expect(flicker).toMatchObject({ actions: [], cause: 'idle', nooped: true });
    });
});

function basicAgent(): BasicAgentThinkingModule {
    return new BasicAgentThinkingModule({ soul: soul(), state: runtimeState() });
}

function soul(): Soul {
    return {
        sourcePath: '/tmp/res-agent.md',
        body: '# Agent',
        frontmatter: {
            name: 'res:agent',
            archetype: 'endurer',
            behavior: { kind: 'basic-agent', followPlayer: 'codex', commandPrefix: 'agent', followRadius: 2, commentEveryTicks: 50 },
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
        inventory: [],
        equipment: [],
    };
}

function actor(id: string, kind: 'player' | 'npc' | 'resident', name: string, x: number, y: number): Record<string, unknown> {
    return {
        id,
        kind,
        name,
        position: { x, y, level: 0 },
        hpFraction: 1,
    };
}

function chatFrom(from: Record<string, unknown>, text: string): Record<string, unknown> {
    return { kind: 'chat', from, text, to: 'public' };
}
