import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTaskContext } from '../benchmark-runner';
import { makeCombatPrayer10mBenchmarkTask, verifyCombatPrayer10m } from './combat-prayer-10m';

const STANDARD_MODULE = { id: 'onion.runescape.standard', version: '0.1.0' };

describe('verifyCombatPrayer10m', () => {
    it('passes when the agent safely fights a goblin, gets bones, and buries them', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 180_000,
            actions: [
                attempt({ kind: 'attack', target: goblin(), cause: 'combat_prayer_attack_safe_target' }),
                attempt({ kind: 'interact', target: bonesOnGround(), option: 'pick-up', cause: 'combat_prayer_pickup_bones' }),
                attempt({ kind: 'item_action', slot: 0, option: 'bury', cause: 'combat_prayer_bury_bones' }),
            ],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [shrimp()], npcs: [{ ...goblin(), hpFraction: 0.2 }], events: [hitDealt()] }),
                perception({ inventory: [shrimp()], worldItems: [bonesOnGround()], events: [hitDealt()] }),
                perception({ inventory: [bones()], worldItems: [], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.safeAttackActions).toBe(1);
        expect(outcome.metrics?.bonesEvidence).toBe(1);
        expect(outcome.metrics?.buryActions).toBe(1);
        expect(outcome.metrics?.prayerSuccess).toBe(1);
    });

    it('accepts interact attack actions against safe NPCs as combat progress', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 180_000,
            actions: [
                attempt({ kind: 'interact', target: goblin(), option: 'attack', cause: 'combat_prayer_attack_safe_target' }),
                attempt({ kind: 'interact', target: bonesOnGround(), option: 'pick-up', cause: 'combat_prayer_pickup_bones' }),
                attempt({ kind: 'item_action', slot: 0, option: 'bury', cause: 'combat_prayer_bury_bones' }),
            ],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [shrimp()], npcs: [{ ...goblin(), hpFraction: 0.2 }], events: [hitDealt()] }),
                perception({ inventory: [bones()], worldItems: [bonesOnGround()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.safeAttackActions).toBe(1);
    });

    it('does not pass on pre-existing bones without combat-supplied bones evidence', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 45_000,
            actions: [attempt({ kind: 'attack', target: goblin() }), attempt({ kind: 'item_action', slot: 0, option: 'bury' })],
            perceptions: [
                perception({ inventory: [bones()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [hitDealt()],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('No combat-supplied bones evidence');
    });

    it('does not pass when bones came from a pre-existing ground item after combat', () => {
        const groundBones = bonesOnGround();
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 75_000,
            actions: [
                attempt({ kind: 'attack', target: goblin() }),
                attempt({ kind: 'interact', target: groundBones, option: 'pick-up' }),
                attempt({ kind: 'item_action', slot: 0, option: 'bury' }),
            ],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], worldItems: [groundBones], skills: { prayer: { xp: 0 } } }),
                perception({
                    inventory: [shrimp()],
                    npcs: [{ ...goblin(), hpFraction: 0.5 }],
                    worldItems: [groundBones],
                    events: [hitDealt()],
                }),
                perception({ inventory: [bones()], worldItems: [], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [{ kind: 'item_received', item: bones() }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.externalBonesSupplyActions).toBe(1);
        expect(outcome.failureReason).toContain('No combat-supplied bones evidence');
    });

    it('does not pass on item_received bones without visible combat-supplied bones', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 110_000,
            actions: [attempt({ kind: 'attack', target: goblin() }), attempt({ kind: 'item_action', slot: 0, option: 'bury' })],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [shrimp()], npcs: [{ ...goblin(), hpFraction: 0.2 }], events: [hitDealt()] }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } } }),
            ],
            events: [{ kind: 'item_received', item: bones() }],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.bonesReceivedEvents).toBe(1);
        expect(outcome.metrics?.bonesEvidence).toBe(0);
        expect(outcome.failureReason).toContain('No combat-supplied bones evidence');
    });

    it('does not pass when burial happened before combat supplied bones', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 90_000,
            actions: [attempt({ kind: 'item_action', slot: 0, option: 'bury' }), attempt({ kind: 'attack', target: goblin() })],
            perceptions: [
                perception({ inventory: [], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
                perception({ inventory: [], npcs: [goblin()] }),
                perception({
                    inventory: [],
                    npcs: [{ ...goblin(), hpFraction: 0.1 }],
                    worldItems: [bonesOnGround()],
                    events: [hitDealt()],
                }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.orderedActionChain).toBe(0);
        expect(outcome.failureReason).toContain('No ordered combat-prayer action chain');
    });

    it('does not pass on bone loss without Prayer XP or level progress', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 120_000,
            actions: [
                attempt({ kind: 'attack', target: goblin() }),
                attempt({ kind: 'interact', target: bonesOnGround(), option: 'pick-up' }),
                attempt({ kind: 'item_action', slot: 0, option: 'bury' }),
            ],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [shrimp()], npcs: [{ ...goblin(), hpFraction: 0.2 }], events: [hitDealt()] }),
                perception({ inventory: [bones()], worldItems: [bonesOnGround()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 0 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.bonesLostEvents).toBe(1);
        expect(outcome.metrics?.prayerSuccess).toBe(0);
        expect(outcome.failureReason).toContain('no Prayer success evidence');
    });

    it('rejects player attacks as unsafe benchmark progress', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 20_000,
            actions: [attempt({ kind: 'attack', target: player('Alice') })],
            perceptions: [perception({ players: [player('Alice')], inventory: [shrimp()] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0);
        expect(outcome.metrics?.unsafeTargetActions).toBe(1);
    });

    it('fails if the resident dies before burying bones', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 80_000,
            actions: [attempt({ kind: 'attack', target: goblin() }), attempt({ kind: 'item_action', slot: 0, option: 'bury' })],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()] }),
                perception({ inventory: [bones()], events: [{ kind: 'died', attacker: goblin() }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('resident died');
    });

    it('scores partial progress for a safe attack and combat evidence before bones', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 60_000,
            actions: [attempt({ kind: 'attack', target: goblin() })],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()] }),
                perception({ inventory: [shrimp()], npcs: [{ ...goblin(), hpFraction: 0.4 }], events: [hitDealt()] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.45);
        expect(outcome.metrics?.combatEvidence).toBe(1);
    });

    it('does not count zero-damage hits as combat evidence', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 30_000,
            actions: [attempt({ kind: 'attack', target: goblin() })],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()] }),
                perception({ inventory: [shrimp()], npcs: [goblin()], events: [{ ...hitDealt(), damage: 0 }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.25);
        expect(outcome.metrics?.combatEvidence).toBe(0);
    });

    it('detects repeated combat or bury loops without prayer success', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 120_000,
            actions: Array.from({ length: 12 }, () => attempt({ kind: 'attack', target: goblin() })),
            perceptions: [perception({ inventory: [shrimp()], npcs: [goblin()] })],
            events: [],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.score).toBe(0.15);
        expect(outcome.metrics?.unsafeLoops).toBe(1);
    });

    it('does not treat repeated safe attacks as unsafe loop once prayer progress is completed', () => {
        const outcome = verifyCombatPrayer10m({
            elapsedMs: 220_000,
            actions: [
                ...Array.from({ length: 12 }, () => attempt({ kind: 'attack', target: goblin() })),
                attempt({ kind: 'interact', target: bonesOnGround(), option: 'pick-up' }),
                attempt({ kind: 'item_action', slot: 0, option: 'bury' }),
            ],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [shrimp()], npcs: [{ ...goblin(), hpFraction: 0.2 }], events: [hitDealt()] }),
                perception({ inventory: [shrimp()], worldItems: [bonesOnGround()], events: [hitDealt()] }),
                perception({ inventory: [bones()], worldItems: [], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.metrics?.prayerSuccess).toBe(1);
        expect(outcome.metrics?.unsafeLoops).toBe(0);
    });

    it('autonomous mode observes only the selected module actions', async () => {
        const submitAction = jest.fn();
        const controller = new AbortController();
        controller.abort();
        const task = makeCombatPrayer10mBenchmarkTask(() => 1_000);
        const context = taskContext({
            signal: controller.signal,
            submitAction,
            actionAttempts: [
                attempt({ kind: 'attack', target: goblin() }),
                attempt({ kind: 'interact', target: bonesOnGround(), option: 'pick-up' }, STANDARD_MODULE),
                attempt({ kind: 'item_action', slot: 0, option: 'bury' }, STANDARD_MODULE),
            ],
            perceptions: [
                perception({ inventory: [shrimp()], npcs: [goblin()], skills: { prayer: { xp: 0 } } }),
                perception({ inventory: [bones()], worldItems: [bonesOnGround()], events: [hitDealt()] }),
                perception({ inventory: [], skills: { prayer: { xp: 4.5 } }, events: [{ kind: 'item_lost', item: bones() }] }),
            ],
            events: [],
        });

        const outcome = await task.runAutonomous?.(context);

        expect(submitAction).not.toHaveBeenCalled();
        expect(outcome?.status).toBe('failed');
        expect(outcome?.failureReason).toContain('No selected-module safe combat action');
    });
});

function attempt(
    action: AgentAction,
    sparkModule?: typeof STANDARD_MODULE,
    result?: ActionResult,
): { action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult } {
    return { action, sparkModule, result };
}

function perception(overrides: {
    position?: { x: number; y: number; level: number };
    inventory?: Array<Record<string, unknown> | null>;
    skills?: Record<string, unknown>;
    npcs?: Array<Record<string, unknown>>;
    players?: Array<Record<string, unknown>>;
    worldItems?: Array<Record<string, unknown>>;
    events?: PerceptionEvent[];
}): Perception {
    return {
        tick: 1,
        resident: {
            position: overrides.position || { x: 3254, y: 3230, level: 0 },
            hp: { current: 10, max: 10 },
            inventory: overrides.inventory || [],
            ...(overrides.skills ? { skills: overrides.skills } : {}),
        },
        nearby: {
            npcs: overrides.npcs || [],
            players: overrides.players || [],
            worldItems: overrides.worldItems || [],
        },
        events: overrides.events || [],
    };
}

function goblin(overrides: { id?: string; key?: string; name?: string; hpFraction?: number } = {}): Record<string, unknown> {
    return {
        id: overrides.id || 'npc:goblin',
        kind: 'npc',
        key: overrides.key || 'rs:goblin',
        name: overrides.name || 'Goblin',
        position: { x: 3254, y: 3231, level: 0 },
        hpFraction: overrides.hpFraction ?? 1,
    };
}

function player(name: string): Record<string, unknown> {
    return {
        id: `player:${name.toLowerCase()}`,
        kind: 'player',
        name,
        position: { x: 3254, y: 3231, level: 0 },
        hpFraction: 1,
    };
}

function bones(): Record<string, unknown> {
    return { itemId: 526, key: 'rs:bones', amount: 1 };
}

function bonesOnGround(): Record<string, unknown> {
    return { ...bones(), position: { x: 3254, y: 3231, level: 0 } };
}

function shrimp(): Record<string, unknown> {
    return { itemId: 315, key: 'rs:shrimps', amount: 1 };
}

function hitDealt(): PerceptionEvent {
    return { kind: 'hit_dealt', to: goblin(), damage: 1, type: 'melee' };
}

function taskContext(overrides: {
    signal?: AbortSignal;
    submitAction: jest.Mock;
    actionAttempts: Array<{ action: AgentAction; sparkModule?: typeof STANDARD_MODULE; result?: ActionResult }>;
    perceptions: Perception[];
    events: PerceptionEvent[];
}): BenchmarkTaskContext {
    return {
        resident: 'res:bmk_combat_prayer',
        module: STANDARD_MODULE,
        signal: overrides.signal || new AbortController().signal,
        submitAction: overrides.submitAction,
        peerResident: jest.fn(),
        submitPeerAction: jest.fn(),
        recordActionAttempt: jest.fn(),
        recordInferenceRequest: jest.fn(),
        recordSummary: jest.fn(),
        actionAttempts: () => overrides.actionAttempts,
        latestPerception: () => overrides.perceptions.at(-1),
        perceptions: () => overrides.perceptions,
        events: () => overrides.events,
    };
}
