import path from 'path';
import { objectIds } from '@engine/world/config/object-ids';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import { SoulLoader } from '../soul/soul-loader';
import type { Soul } from '../soul/soul-schema';
import { STARTER_FISHING_SPOT_DISCOVERY_RANGE, explorationPatrolCooldownKey } from '../spark/runescape-body-routines';
import { starterGpHarvestGoal } from '../spark/runescape-brain-planner';
import type { AgentAction, Perception } from '../transport/message-codecs';
import { DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS as CHAT_BRAIN_TIMEOUT_MS, latestAddressedChat } from './hybrid-agent-chat';
import { DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS as HELPERS_BRAIN_TIMEOUT_MS } from './hybrid-agent-helpers';
import { DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS as MODULE_BRAIN_TIMEOUT_MS, HybridAgentThinkingModule } from './hybrid-agent-thinking-module';
import { PatronRegistry } from '../patron/patron-registry';

describe('S-INFER-8: brain inference timeout is a generous server-broken alarm, not a thinking bound', () => {
    it('sets DEFAULT_BRAIN_INFERENCE_TIMEOUT_MS to 240_000 in all three brain-timeout sites', () => {
        // ~6x a real q4 qwopus ~40s deliberation, with headroom for the future
        // deliberative planner. NOT a thinking bound — a brain timeout firing means
        // "investigate the inference server" (see src/controller/llm/inference-health.ts).
        expect(CHAT_BRAIN_TIMEOUT_MS).toBe(240_000);
        expect(HELPERS_BRAIN_TIMEOUT_MS).toBe(240_000);
        expect(MODULE_BRAIN_TIMEOUT_MS).toBe(240_000);
    });
});

describe('S-INFER-10: cohort routes BOTH the Brain and the Body to q4 (tower); q8 dropped', () => {
    // S-INFER-10 reverts the S-INFER-9 brain→q8 routing: q8 proved unusable
    // (~1.4 tok/s, ~12 min/plan; full-envelope prompts timed out). BOTH tiers now
    // run the fast q4 (tower) model via behavior.brain/body.endpoint=body_q4. The
    // deliberate-planner Brain keeps thinking ON + the generous 240s ceiling; the
    // fast every-few-seconds Body keeps thinking OFF + the tight timeout — they just
    // share the same q4 endpoint now.
    // endpointFor(profile) = profile?.endpoint || soul.model?.endpoint || 'default',
    // so the per-soul behavior.brain.endpoint / behavior.body.endpoint both resolve
    // to body_q4 (q4 tower) without touching the shared `default`.
    // The hybrid-agent cohort — these run the deliberate-planner Brain + fast-executor
    // Body, both on q4 via behavior.brain/body.endpoint.
    const HYBRID_COHORT = [
        'res:agent',
        'res:qa-woodcutter',
        'res:qa-cook',
        'res:qa-survivor',
        'res:qa-guardian',
        'res:qa-trader',
        'res:qa-banker',
        'res:qa-social',
        'res:qa-scout',
    ] as const;

    function moduleFor(name: string): HybridAgentThinkingModule {
        const loader = new SoulLoader(path.join(__dirname, '..', 'soul', 'starter-souls'));
        const loaded = loader.load(name);
        return new HybridAgentThinkingModule({
            soul: loaded,
            state: runtimeState(),
            memory: memory(),
            llm: scriptedLlm([]) as unknown as LlmClient,
        });
    }

    it.each(HYBRID_COHORT)('routes %s Brain → body_q4 (q4) endpoint and Body → body_q4 endpoint', name => {
        const agent = moduleFor(name);
        const behavior = agent.behavior();

        // S-INFER-10: both tiers on q4 (tower); q8 dropped (unusable).
        expect(agent.endpointFor(behavior.brain)).toBe('body_q4');
        expect(agent.endpointFor(behavior.body)).toBe('body_q4');
    });

    it.each(HYBRID_COHORT)('keeps %s Brain thinking ON + the generous 240s ceiling and Body thinking OFF', name => {
        const agent = moduleFor(name);
        const behavior = agent.behavior();

        // Brain: deliberate planner — thinking ON, generous server-broken ceiling.
        expect(behavior.brain?.thinking ?? true).toBe(true);
        expect(agent.timeoutFor(behavior.brain, MODULE_BRAIN_TIMEOUT_MS)).toBe(240_000);
        // Body: fast executor — thinking OFF, short fail-fast timeout (not the brain's 240s).
        expect(behavior.body?.thinking ?? false).toBe(false);
        const bodyTimeout = agent.timeoutFor(behavior.body, 10_000);
        expect(bodyTimeout).toBeLessThanOrEqual(30_000);
    });

    it('routes the res:hans hero single thinking-off tier to the fast body_q4 endpoint', () => {
        // res:hans is a hook-driven hero (model.thinking:false, no behavior.brain/body
        // deliberative loop) — it does NOT run a slow q8 deliberative Brain. Its single
        // model tier routes to the FAST q4 (tower) via soul-level model.endpoint so the
        // hero stays snappy at the embassy. endpointFor(undefined-profile) falls back to
        // soul.model?.endpoint.
        const agent = moduleFor('res:hans');
        const behavior = agent.behavior();

        expect(behavior.brain).toBeUndefined();
        expect(behavior.body).toBeUndefined();
        expect(agent.options.soul.frontmatter.model?.thinking).toBe(false);
        expect(agent.endpointFor(behavior.body)).toBe('body_q4');
    });

    it('resolves the Body endpoint independently of the Brain endpoint (a rerouted brain cannot move the body)', () => {
        // The Body request (runBody) builds its endpoint from behavior.body alone —
        // there is no cross-reference to behavior.brain — so changing the brain's
        // endpoint never changes where the q4 body fires.
        const agent = moduleFor('res:agent');
        const behavior = agent.behavior();

        // Mutate the brain profile; the body endpoint must NOT move.
        const brainEndpointBefore = agent.endpointFor(behavior.brain);
        (behavior.brain as { endpoint?: string }).endpoint = 'some_other_host';

        expect(agent.endpointFor(behavior.body)).toBe('body_q4');
        // S-INFER-10: the brain now also resolves to q4 (body_q4); q8 dropped.
        expect(brainEndpointBefore).toBe('body_q4');
    });
});

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

    it('records a reflex-cancelled Brain think distinctly (not empty_completion) — S-INFER-2 D2', async () => {
        // A nervous reflex with interruptThinking fires mid-think; resident-runtime
        // calls stop(`nervous:<ruleId>`). The cancelled brain MUST surface that
        // reflex cause (bucket C), never fold into the empty-completion buckets.
        let capturedSignal: AbortSignal | undefined;
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(
            request =>
                new Promise(resolve => {
                    capturedSignal = request.signal;
                    request.signal?.addEventListener('abort', () =>
                        resolve({ text: '', nooped: true, cancelledBy: String(request.signal?.reason || 'aborted') }),
                    );
                }),
        );
        const agent = hybridAgent({ complete });

        const thinking = agent.think(perception({ tick: 1 }));
        for (let i = 0; i < 5 && !capturedSignal; i += 1) {
            await Promise.resolve();
        }
        expect(capturedSignal).toBeDefined();

        agent.stop('nervous:flee_combat');
        const result = await thinking;

        // Brain thinking stayed ON (the call was made); the interrupt cause is
        // preserved verbatim and is NOT any empty_completion / brain_* class.
        expect(result.cause).toBe('nervous:flee_combat');
        expect(result.cause).not.toBe('empty_completion');
        expect(result.cause?.startsWith('empty_completion')).toBe(false);
        expect(result.cause?.startsWith('brain_')).toBe(false);
        expect(result.nooped).toBe(true);
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

    it('seeds faction landmark work for flagship faction heroes and acts without Body inference', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const hero = {
            ...soul(),
            frontmatter: {
                ...soul().frontmatter,
                name: 'res:mother-anvil',
                display: 'Mother Anvil',
                archetype: 'achiever' as const,
                factionId: 'foundry',
                heroProfile: {
                    tier: 'hero' as const,
                    publicName: 'Mother Anvil',
                    signatureAction: 'works the forge',
                    anchor: [3015, 3357, 0] as [number, number, number],
                },
            },
        };
        const agent = hybridAgent(llm, state, hero);
        const tree = { objectId: 1278, position: { x: 3017, y: 3357, level: 0 }, orientation: 0 };

        const result = await agent.think(
            perception({
                tick: 12,
                resident: {
                    id: 'resident:res:mother-anvil',
                    position: { x: 3015, y: 3357, level: 0 },
                    hp: { current: 10, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(state.cognition?.activeGoal?.id).toBe('faction-landmark-work-foundry');
        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 1, cause: 'faction_foundry_fuel_work' }]);
        expect(result.cause).toBe('faction_foundry_fuel_work');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('honors target-failure cooldowns while executing active faction landmark work goals', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'faction-landmark-work-foundry',
                description: 'Work the Foundry post by gathering fuel and staying visible.',
                createdAtTick: 1,
                ttlTicks: 450,
            },
            lastBodyTick: 19,
            targetFailureCooldowns: {
                'target:3010,3355,0': 19,
            },
        };
        const hero = {
            ...soul(),
            frontmatter: {
                ...soul().frontmatter,
                name: 'res:mother-anvil',
                display: 'Mother Anvil',
                archetype: 'achiever' as const,
                factionId: 'foundry',
                heroProfile: {
                    tier: 'hero' as const,
                    publicName: 'Mother Anvil',
                    signatureAction: 'works the forge',
                    anchor: [3015, 3357, 0] as [number, number, number],
                },
            },
        };
        const failedTree = { objectId: 1278, position: { x: 3010, y: 3355, level: 0 }, orientation: 0 };
        const agent = hybridAgent(llm, state, hero);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: {
                    id: 'resident:res:mother-anvil',
                    position: { x: 3010, y: 3352, level: 0 },
                    hp: { current: 10, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [failedTree],
            }),
        );

        expect(result.cause).toBe('faction_foundry_fuel_work');
        expect(result.actions[0]).toEqual(
            expect.objectContaining({
                kind: 'move_to',
            }),
        );
        expect((result.actions[0] as { target?: unknown }).target).not.toEqual(failedTree.position);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('replaces an expired ordinary goal with faction landmark work for flagship heroes', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'old-local-errand',
                description: 'An old local errand from before restart.',
                createdAtTick: 1,
                ttlTicks: 5,
            },
            lastBodyTick: 19,
        };
        const hero = {
            ...soul(),
            frontmatter: {
                ...soul().frontmatter,
                name: 'res:mother-anvil',
                display: 'Mother Anvil',
                archetype: 'achiever' as const,
                factionId: 'foundry',
                heroProfile: {
                    tier: 'hero' as const,
                    publicName: 'Mother Anvil',
                    signatureAction: 'works the forge',
                    anchor: [3015, 3357, 0] as [number, number, number],
                },
            },
        };
        const tree = { objectId: 1278, position: { x: 3017, y: 3357, level: 0 }, orientation: 0 };
        const agent = hybridAgent(llm, state, hero);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: {
                    id: 'resident:res:mother-anvil',
                    position: { x: 3015, y: 3357, level: 0 },
                    hp: { current: 10, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(state.cognition?.activeGoal?.id).toBe('faction-landmark-work-foundry');
        expect(result.cause).toBe('faction_foundry_fuel_work');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('avoids target-failed generated patrol coordinates during normal scouting', async () => {
        const complete = jest.fn<Promise<LlmResponse>, [LlmRequest]>(async () => {
            throw new Error('Body inference should not gate local exploration');
        });
        const failedPatrolTarget = { x: 3200, y: 3197, level: 0 };
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
            targetFailureCooldowns: {
                'target:3200,3197,0': 119,
            },
        };
        const agent = hybridAgent({ complete }, state);

        const result = await agent.think(perception({ tick: 120, resident: residentAt(3200, 3200) }));

        expect(result.cause).toBe('exploration_fallback');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'explore_patrol' }));
        expect((result.actions[0] as { target?: unknown }).target).not.toEqual(failedPatrolTarget);
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
        // Brain timeout is a GENEROUS "inference server is broken" ALARM ceiling,
        // not a thinking bound (S-INFER-8). Real q4 qwopus thinking is ~40s; the
        // request timeout sits at 240s (~6x) so a legitimate deliberation — and the
        // future longer-thinking deliberative planner — is never cut. A brain timeout
        // firing now means: investigate the inference server (see inference-health.ts).
        expect(brainRequest.timeoutMs).toBe(240_000);
        // S-INFER-2 (D1) / S-INFER-4 (B): the THINKING brain call must carry an
        // explicit, generous completion-token ceiling so reasoning + the final
        // JSON answer both fit. Raised 1536 → 4096 because qwopus spends most of
        // its budget on the <think> trace before the compact goal/say JSON.
        expect(brainRequest.maxTokens).toBe(4096);
        expect(brainRequest.prompt).toContain('/think');
        expect(brainRequest.prompt).toContain('RuneBench-style loop');
        expect(brainRequest.prompt).toContain('Measurable goals');
        expect(bodyRequest.thinking).toBe(false);
        expect(bodyRequest.timeoutMs).toBe(10_000);
        expect(bodyRequest.prompt).toContain('/no_think');
        expect(bodyRequest.prompt).toContain('Walk outside, stay visible to Codex');
        expect(bodyRequest.prompt).toContain('AgentAction tool surface');
        expect(bodyRequest.prompt).toContain('Workflow cards');
    });

    it('lets due Brain speech beat the templated presence beacon so knowledge can surface', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'help-cook',
                        description: "Work toward Cook's Assistant by finding eggs, milk, and flour.",
                    },
                    say: 'Cook needs egg, milk, and flour; I am checking Lumbridge for the missing ingredients.',
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 180;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout Lumbridge for useful resources and stay findable.',
                createdAtTick: 1,
            },
            lastBrainTick: 0,
            lastBodyTick: 172,
            lastGoalShareTick: 0,
            lastPresenceBeaconTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 180,
                resident: residentAt(3218, 3201),
            }),
            {
                brainSection: "Relevant game knowledge: Cook's Assistant requires egg, milk, and flour.",
                bodySection: '',
            } as any,
        );

        expect(result.actions).toEqual([
            { kind: 'say', text: 'Cook needs egg, milk, and flour; I am checking Lumbridge for the missing ingredients.' },
        ]);
        expect(result.cause).toBe('brain_goal');
        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect(llm.complete.mock.calls[0][0].prompt).toContain("Cook's Assistant requires egg, milk, and flour");
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

    it('writes Brain remember output as durable qmd facts', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'remember-cook',
                        description: 'Remember what the Cook asked me to gather.',
                        steps: ['write the quest fact'],
                    },
                    rememberFact: {
                        topic: 'quests',
                        fact: 'Cook asked for an egg, flour, and milk.',
                        reason: 'NPC dialogue gave concrete quest requirements',
                    },
                }),
            },
        ]);
        const memoryStore = memory();
        const agent = hybridAgent(llm, runtimeState(), soul(), memoryStore);

        const result = await agent.think(perception({ tick: 10 }));

        expect(memoryStore.rememberFact).toHaveBeenCalledWith(
            'res:agent',
            'quests',
            'Cook asked for an egg, flour, and milk.',
            'NPC dialogue gave concrete quest requirements',
        );
        expect((result as any).memoUpdates).toBe(1);
    });

    it('lets addressed durable memory instructions reach Brain instead of unknown-command decline', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    rememberFact: {
                        topic: 'routes',
                        fact: 'west gate passphrase is ember-vellum.',
                        reason: 'Codex supplied a benchmark durable fact',
                    },
                    say: 'I will remember the west gate passphrase.',
                }),
            },
        ]);
        const state = runtimeState();
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'memory-write-recall-10m' },
        };
        benchmarkSoul.frontmatter.behavior = {
            kind: 'hybrid-agent',
            commandPrefix: 'agent',
            brainEveryTicks: 1,
            bodyEveryTicks: 600,
        };
        const memoryStore = memory();
        const agent = hybridAgent(llm, state, benchmarkSoul, memoryStore);

        const result = await agent.think(
            perception({
                tick: 10,
                resident: residentAt(3218, 3201),
                events: [
                    chatFromCodex('agent, durable fact: west gate passphrase is ember-vellum. Use rememberFact topic routes.', 3217, 3201),
                ],
            }),
        );

        expect(result.cause).not.toBe('direct_chat_decline_unknown_command');
        expect(llm.complete).toHaveBeenCalled();
        expect(memoryStore.rememberFact).toHaveBeenCalledWith(
            'res:agent',
            'routes',
            'west gate passphrase is ember-vellum.',
            'Codex supplied a benchmark durable fact',
        );
        expect((result as any).memoUpdates).toBe(1);
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

    it('recovers from modest restarted-world tick drift before stale Brain backoff can idle the resident', async () => {
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    goal: {
                        id: 'scout-after-restart',
                        description: 'Re-orient after restart and choose a visible task.',
                    },
                    say: 'My clock looks reset, so I am re-orienting before I continue.',
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 1074;
        state.lastMeaningfulProgressAt = 1072;
        state.stuckSince = 1074;
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                createdAtTick: 970,
            },
            lastBrainTick: 1074,
            brainBackoffUntilTick: 1673,
            lastBodyTick: 1056,
            lastBodyActionKey:
                '{"kind":"say","text":"I can see the Lumbridge range, but I cannot reach it from here.","cause":"starter_fishing_missing_heat"}',
            lastBodyActionTick: 1056,
            routineLoopKey: 'starter-fishing-cooking|3208,3239,0',
            routineLoopCount: 11,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(perception({ tick: 923, resident: residentAt(3230, 3239) }));

        expect(result.actions).toEqual([{ kind: 'say', text: 'My clock looks reset, so I am re-orienting before I continue.' }]);
        expect(state.tick).toBe(923);
        expect(state.stuckSince).toBeUndefined();
        expect(state.lastMeaningfulProgressAt).toBeUndefined();
        expect(state.cognition?.activeGoal?.id).toBe('scout-after-restart');
        expect(state.cognition?.lastBrainTick).toBe(923);
        expect(state.cognition?.lastBodyTick).toBeUndefined();
        expect(state.cognition?.lastBodyActionKey).toBeUndefined();
        expect(state.cognition?.brainBackoffUntilTick).toBeUndefined();
        expect(state.cognition?.routineLoopKey).toBeUndefined();
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

        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3211, y: 3247, level: 0 }, range: 0, cause: 'stuck_pre_inference_explore' },
        ]);
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
            { kind: 'move_to', target: { x: 3110, y: 3163, level: 0 }, range: 0, cause: 'stuck_pre_inference_explore' },
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

    it('routes to Bob for an axe when a fire goal has tinderbox and GP but no logs or axe', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                steps: ['Find a tree', 'Chop it for logs', 'Use tinderbox on logs'],
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
                    ...residentAt(3229, 3238),
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 995, key: 'rs:coins', amount: 50 },
                    ],
                },
                objects: [{ objectId: 1278, position: { x: 3230, y: 3238, level: 0 }, orientation: 0 }],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3230, y: 3203, level: 0 },
                range: 1,
                cause: 'acquire_axe_travel_to_shop',
            },
        ]);
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

    it('runs urgent body work under critical AP instead of waiting for the normal cadence', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3218, y: 3200, level: 0 } };
        const llm = scriptedLlm([]);
        const agentSoul = soul();
        agentSoul.frontmatter.behavior = {
            kind: 'hybrid-agent',
            commandPrefix: 'agent',
            bodyEveryTicks: 8,
        };
        const state = runtimeState();
        state.attention = 8;
        state.tick = 3;
        state.cognition = {
            activeGoal: {
                id: 'ap-gp-library-strategy',
                description: 'Find a way to make 100 GP/hour, stay alive on AP, and write the strategy into the Library.',
                steps: [
                    'If AP is low, secure attention support or a safe survival action first',
                    'Collect or preserve real RuneScape GP coins (item 995) with evidence',
                    'Say and memo one concrete Library strategy note from what worked',
                ],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 3,
        };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3218, 3200),
                worldItems: [coins],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(result.cause).toBe('opportunistic_pickup');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('narrates an AP/GP Library strategy once real GP is secured under critical AP', async () => {
        const llm = scriptedLlm([]);
        const agentSoul = soul();
        agentSoul.frontmatter.behavior = {
            kind: 'hybrid-agent',
            commandPrefix: 'agent',
            bodyEveryTicks: 8,
        };
        const state = runtimeState();
        state.attention = 8;
        state.tick = 4;
        state.cognition = {
            activeGoal: {
                id: 'ap-gp-library-strategy',
                description: 'Find a way to make 100 GP/hour, stay alive on AP, and write the strategy into the Library.',
                steps: [
                    'If AP is low, secure attention support or a safe survival action first',
                    'Collect or preserve real RuneScape GP coins (item 995) with evidence',
                    'Say and memo one concrete Library strategy note from what worked',
                ],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 4,
        };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 5,
                resident: {
                    ...residentAt(3218, 3200),
                    inventory: [{ itemId: 995, key: 'rs:coins', amount: 25 }],
                },
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: expect.stringMatching(/AP|Attention/i),
                cause: 'ap_gp_library_strategy',
            },
        ]);
        const text = String((result.actions[0] as Record<string, unknown> | undefined)?.text || '');
        expect(text).toMatch(/GP|coin/i);
        expect(text).toMatch(/Library|strategy|goal/i);
        expect(result.cause).toBe('ap_gp_library_strategy');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('retries AP/GP survival coin pickup even when a previous urgent attempt was cooldowned', async () => {
        const coins = { itemId: 995, key: 'rs:coins', amount: 25, position: { x: 3218, y: 3200, level: 0 } };
        const llm = scriptedLlm([]);
        const agentSoul = soul();
        agentSoul.frontmatter.behavior = {
            kind: 'hybrid-agent',
            commandPrefix: 'agent',
            bodyEveryTicks: 8,
        };
        const state = runtimeState();
        state.attention = 8;
        state.tick = 4;
        state.cognition = {
            activeGoal: {
                id: 'ap-gp-library-strategy',
                description: 'Find a way to make 100 GP/hour, stay alive on AP, and write the strategy into the Library.',
                steps: ['Collect real RuneScape GP coins (item 995) before spending AP on anything else'],
                createdAtTick: 1,
            },
            lastBrainTick: 1,
            lastBodyTick: 3,
            pickupCooldowns: { '995:rs:coins:3218,3200,0': 3 },
            explorationCooldowns: { 'item:995:rs:coins:3218,3200,0': 3 },
        };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 5,
                resident: residentAt(3218, 3200),
                worldItems: [coins],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'interact', target: coins, option: 'pick-up', cause: 'opportunistic_pickup' }]);
        expect(result.cause).toBe('opportunistic_pickup');
        expect(llm.complete).not.toHaveBeenCalled();
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
            { kind: 'move_to', target: { x: 3230, y: 3239, level: 0 }, range: 0, cause: 'stuck_pre_inference_explore' },
        ]);
        expect(result.cause).toBe('stuck_pre_inference_explore');
    });

    it('uses a one-tile probe before wider stuck patrol moves', async () => {
        const llm = scriptedLlm([]);
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
            { kind: 'move_to', target: { x: 3230, y: 3239, level: 0 }, range: 0, cause: 'stuck_pre_inference_explore' },
        ]);
        expect(result.cause).toBe('stuck_pre_inference_explore');
    });

    it('reuses a local stuck probe before widening when adjacent probes are cooling down', async () => {
        const here = { x: 3201, y: 3212, level: 0 };
        const adjacentProbes = [
            { x: here.x + 1, y: here.y, level: here.level },
            { x: here.x, y: here.y + 1, level: here.level },
            { x: here.x - 1, y: here.y, level: here.level },
            { x: here.x, y: here.y - 1, level: here.level },
        ];
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.tick = 200;
        state.stuckSince = 150;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover locally after blocked routes', 'stay visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 190,
            lastBodyTick: 190,
            explorationCooldowns: Object.fromEntries(adjacentProbes.map(probe => [explorationPatrolCooldownKey(probe), 200])),
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 201,
                resident: residentAt(here.x, here.y),
            }),
        );

        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        const action = result.actions[0] as { target?: { x: number; y: number; level: number } };
        if (!action.target) {
            throw new Error('Expected stuck pre-inference recovery to pick a movement target');
        }
        const stepDistance = Math.max(Math.abs(action.target.x - here.x), Math.abs(action.target.y - here.y));
        expect(stepDistance).toBe(1);
        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('steps away instead of repeating a landmark report while stuck before inference', async () => {
        const fountain = { objectId: 879, position: { x: 3201, y: 3212, level: 0 }, orientation: 0 };
        const blockedPatrolObjects = [3, 6, 9, 12].flatMap(step => [
            { objectId: 4735, position: { x: 3201 + step, y: 3212, level: 0 }, orientation: 0 },
            { objectId: 4735, position: { x: 3201, y: 3212 + step, level: 0 }, orientation: 0 },
            { objectId: 4735, position: { x: 3201 - step, y: 3212, level: 0 }, orientation: 0 },
            { objectId: 4735, position: { x: 3201, y: 3212 - step, level: 0 }, orientation: 0 },
        ]);
        const blockedPatrolKeys = new Set(
            blockedPatrolObjects.map(object => `${object.position.x},${object.position.y},${object.position.level}`),
        );
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.tick = 200;
        state.stuckSince = 150;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover locally after blocked routes', 'stay visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 190,
            lastBodyTick: 190,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 201,
                resident: residentAt(3201, 3212),
                objects: [fountain, ...blockedPatrolObjects],
            }),
        );

        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        const action = result.actions[0] as { target?: { x: number; y: number; level: number } };
        if (!action.target) {
            throw new Error('Expected stuck pre-inference recovery to pick a movement target');
        }
        expect(action.target).not.toEqual({ x: 3201, y: 3212, level: 0 });
        expect(blockedPatrolKeys.has(`${action.target.x},${action.target.y},${action.target.level}`)).toBe(false);
        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('avoids target-failed patrol coordinates while stuck before inference', async () => {
        const failedPatrolTarget = { x: 3204, y: 3212, level: 0 };
        const fountain = { objectId: 879, position: { x: 3201, y: 3212, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.tick = 200;
        state.stuckSince = 150;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover locally after blocked routes', 'stay visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 190,
            lastBodyTick: 190,
            targetFailureCooldowns: {
                'target:3204,3212,0': 190,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 201,
                resident: residentAt(3201, 3212),
                objects: [fountain],
            }),
        );

        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        expect((result.actions[0] as { target?: unknown }).target).not.toEqual(failedPatrolTarget);
        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('records NPC family cooldowns when a stuck exploration move blocks on a relocated NPC', async () => {
        const cook = {
            id: 'npc:85',
            kind: 'npc',
            key: 'rs:lumbridge_castle_cook',
            name: 'Cook',
            position: { x: 3206, y: 3215, level: 0 },
            hpFraction: 1,
        };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.tick = 201;
        state.stuckSince = 150;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover locally after blocked routes', 'stay visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 190,
            lastBodyTick: 190,
            activeMove: {
                target: cook.position,
                range: 1,
                cause: 'explore_talk_to_npc',
                startedAtTick: 190,
                lastTick: 200,
                lastPositionKey: '3204,3215,0',
                stationaryCount: 2,
                lastDistance: 2,
                bestDistance: 2,
                lastImprovedTick: 190,
                nonImprovingCount: 2,
            },
        };
        const agent = hybridAgent(llm, state);

        await agent.think(
            perception({
                tick: 201,
                resident: residentAt(3204, 3215),
                npcs: [cook],
                objects: [{ objectId: 879, position: { x: 3204, y: 3218, level: 0 }, orientation: 0 }],
            }),
        );

        expect(state.cognition?.targetFailureCooldowns).toEqual(
            expect.objectContaining({
                'actor:npc:85:3206,3215,0': 202,
                'actor-key:rs:lumbridge_castle_cook': 202,
                'actor-name:cook': 202,
            }),
        );
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('routes a stuck starter angler back toward Lumbridge fishing before generic stuck patrol', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.tick = 31920;
        state.stuckSince = 31900;
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                steps: ['Carry a small fishing net', 'Catch raw shrimp or anchovies', 'Cook the catch', 'Return to the river'],
                createdAtTick: 30200,
            },
            lastBrainTick: 31800,
            lastBodyTick: 31880,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 31928,
                resident: {
                    ...residentAt(3228, 3204),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 315, key: 'rs:shrimps', amount: 5 },
                    ],
                },
                npcs: [],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3241, y: 3242, level: 0 },
                range: STARTER_FISHING_SPOT_DISCOVERY_RANGE,
                cause: 'starter_fishing_seek_spot',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_seek_spot');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('uses Body inference instead of emitting an already-in-range stuck move when boxed in', async () => {
        const fountain = { objectId: 879, position: { x: 3201, y: 3212, level: 0 }, orientation: 0 };
        const boxedObjects = [1, 3, 6, 9, 12].flatMap(step => [
            { objectId: 4735, position: { x: 3201 + step, y: 3212, level: 0 }, orientation: 0 },
            { objectId: 4735, position: { x: 3201, y: 3212 + step, level: 0 }, orientation: 0 },
            { objectId: 4735, position: { x: 3201 - step, y: 3212, level: 0 }, orientation: 0 },
            { objectId: 4735, position: { x: 3201, y: 3212 - step, level: 0 }, orientation: 0 },
        ]);
        const llm = scriptedLlm([
            {
                text: JSON.stringify({
                    actions: [{ kind: 'say', text: 'I am boxed in and need a route.', cause: 'body_step' }],
                    cause: 'body_step',
                }),
            },
        ]);
        const state = runtimeState();
        state.tick = 200;
        state.stuckSince = 150;
        state.cognition = {
            activeGoal: {
                id: 'scout-lumbridge',
                description: 'Scout nearby landmarks while staying easy to find.',
                steps: ['recover locally after blocked routes', 'stay visible'],
                createdAtTick: 0,
            },
            lastBrainTick: 190,
            lastBodyTick: 190,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 201,
                resident: residentAt(3201, 3212),
                objects: [fountain, ...boxedObjects],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am boxed in and need a route.', cause: 'body_step' }]);
        expect(llm.complete).toHaveBeenCalledTimes(1);
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

    it('treats equal-distance tile changes as detour progress before stuck recovery', async () => {
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
                lastPositionKey: '3194,3259,0',
                stationaryCount: 0,
                lastDistance: 4,
                bestDistance: 3,
                lastImprovedTick: 20,
                nonImprovingCount: 0,
                equalDistanceDetourCount: 1,
            }),
        );
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('switches tactics after repeated equal-distance detours without closing distance', async () => {
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
                lastTick: 116,
                lastPositionKey: '3193,3259,0',
                stationaryCount: 0,
                lastDistance: 4,
                bestDistance: 3,
                lastImprovedTick: 20,
                nonImprovingCount: 0,
                equalDistanceDetourCount: 2,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 124,
                resident: {
                    ...residentAt(3194, 3259),
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                },
                objects: [tree],
            }),
        );

        expect(result.cause).toBe('stuck_move_recovery');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_move_recovery' }));
        expect(llm.complete).not.toHaveBeenCalled();
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online. Goal: Practice firemaking.' }]);
        expect(result.cause).toBe('direct_chat_status');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not reprocess the same retained addressed chat event on later perception ticks', () => {
        const event = chatFromCodex('What are you doing agent?', 3217, 3201);
        const first = latestAddressedChat(perception({ tick: 2, events: [event] }), 'agent', undefined);
        const second = latestAddressedChat(perception({ tick: 3, events: [event] }), 'agent', first?.key);

        expect(first).toBeDefined();
        expect(second).toBeUndefined();
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

    it('answers addressed route-memory questions from Library memories before Body stuck recovery', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(
            llm,
            state,
            soul(),
            memory(['Route memory: Lumbridge castle gate -> north road -> west road -> Varrock west bank booth.']),
        );

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent, please recall: how do I get from Lumbridge to Varrock west bank?', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'From Lumbridge castle gate, follow the north road, then the west road to Varrock west bank booth.',
                voiceSource: 'scripted',
            },
        ]);
        expect(result.cause).toBe('direct_chat_memory_recall');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers addressed world-event memory questions from durable LoreBus facts', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(
            llm,
            state,
            soul(),
            memory(['Fact memory (world-events.md): - 2026-05-30T10:56:01.115Z Observed res:duke lit a fire at 3243,3209,0.']),
        );

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent, what did res:duke do nearby?', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I remember res:duke lit a fire at 3243,3209,0.',
                voiceSource: 'scripted',
            },
        ]);
        expect(result.cause).toBe('direct_chat_memory_recall');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers addressed factual memory questions from durable taught facts', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(
            llm,
            state,
            soul(),
            memory([
                'Fact memory (social.md): - 2026-05-31T15:29:44.581Z res:bmk_codex_01gbxifw said: "agent, what do you remember about the west gate passphrase?"',
                'Fact memory (routes.md): - 2026-05-31T15:29:24.734Z res:bmk_codex_01gbxifw taught: "west gate passphrase is ember-vellum."',
            ]),
        );

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3218, 3201),
                events: [chatFromCodex('agent, what do you remember about the west gate passphrase?', 3217, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I remember west gate passphrase is ember-vellum.',
                voiceSource: 'scripted',
            },
        ]);
        expect(result.cause).toBe('direct_chat_memory_recall');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers addressed factual memory questions even when patron memories would crowd the normal prompt slice', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(
            llm,
            state,
            soul(),
            memory([
                'Patron memory: claude-e16-beta gave me 10 AP +20 attention.',
                'Patron memory: alice gave me 5 AP.',
                'Patron memory: bob gave me 5 AP.',
                'Patron memory: carol gave me 5 AP.',
                'Patron memory: dave gave me 5 AP.',
                'Patron memory: eve gave me 5 AP.',
                'Fact memory (routes.md): - 2026-05-31T16:25:45.576Z res:cmem162544 taught: "west gate passphrase is ember-vellum."',
            ]),
        );

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3187, 3220),
                events: [chatFromCodex('agent, what do you remember about the west gate passphrase?', 3187, 3222)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I remember west gate passphrase is ember-vellum.',
                voiceSource: 'scripted',
            },
        ]);
        expect(result.cause).toBe('direct_chat_memory_recall');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('answers addressed factual memory questions from plain qmd fact lines', async () => {
        const llm = scriptedLlm([]);
        const agent = hybridAgent(
            llm,
            runtimeState(),
            soul(),
            memory(['Fact memory (routes.md): - 2026-05-31T16:35:45.576Z west gate passphrase is ember-vellum.']),
        );

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3187, 3220),
                events: [chatFromCodex('agent, what do you remember about the west gate passphrase?', 3187, 3222)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I remember west gate passphrase is ember-vellum.',
                voiceSource: 'scripted',
            },
        ]);
        expect(result.cause).toBe('direct_chat_memory_recall');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps direct memory recall retrieval focused on the question instead of ambient nearby chatter', async () => {
        const llm = scriptedLlm([]);
        const memoryStore = memory();
        (memoryStore.retrieve as jest.Mock).mockImplementation((_resident: string, query: string) => {
            if (/scouting|nearby|goal/i.test(query)) {
                return ['Patron memory: claude-e16-beta gave me 10 AP +20 attention.'];
            }
            return ['Fact memory (routes.md): - 2026-05-31T16:35:45.576Z res:cmem taught: "west gate passphrase is ember-vellum."'];
        });
        const agent = hybridAgent(llm, runtimeState(), soul(), memoryStore);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3187, 3220),
                events: [
                    chatFromCodex('agent, what do you remember about the west gate passphrase?', 3187, 3222),
                    chatFromResidentPeer(
                        'I am scouting. Nearby I see 15 trees and 2 players. Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                        3197,
                        3216,
                    ),
                ],
            }),
        );

        expect(memoryStore.retrieve).toHaveBeenCalledWith(
            'res:agent',
            'agent, what do you remember about the west gate passphrase?',
            expect.any(Number),
        );
        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I remember west gate passphrase is ember-vellum.',
                voiceSource: 'scripted',
            },
        ]);
        expect(result.cause).toBe('direct_chat_memory_recall');
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
                text: 'Don\'t get what "can you enchant my sword?" means. I can only: follow, stop, wait, come, train, fight, eat, drop, trade, explore, make fire, or cook.',
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

    it('uses the configured follow player when an anonymous paused target would otherwise suppress QA follow', async () => {
        const codex = player('codex', 3225, 3213);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'follow-codex',
                description: 'Follow codex and stay close enough to be seen.',
                createdAtTick: 1,
            },
            followTarget: { paused: true, setAtTick: 1 },
            lastBrainTick: 1,
            lastBodyTick: 1,
        };
        const agent = hybridAgent(llm, state, socialSoul());

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
        expect(state.cognition?.followTarget).toMatchObject({ name: 'codex', paused: true });
        expect(state.cognition?.activeGoal).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not immediately resume trader starter offers after a stop-following command', async () => {
        const codex = player('codex', 3200, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state, traderSoul());

        const stop = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3200, 3200),
                players: [codex],
                events: [chatFromCodex('trade stop following', 3200, 3201)],
            }),
        );

        expect(stop.cause).toBe('direct_chat_stop_following');
        expect(state.cognition?.followTarget).toEqual(expect.objectContaining({ name: 'codex', paused: true }));

        const next = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 1511, key: 'rs:logs', amount: 5 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    ],
                },
                players: [codex],
            }),
        );

        expect(next.cause).not.toBe('trade_starter_offer');
        expect(next.cause).not.toBe('follow_player_active');
        expect(next.actions).not.toContainEqual(expect.objectContaining({ kind: 'trade_request' }));
        expect(next.actions).not.toContainEqual(expect.objectContaining({ cause: 'follow_player_active' }));
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'Stopping.', voiceSource: 'phrasebook' }]);
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

        expect(result.actions).toEqual([{ kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }]);
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

        expect(result.actions).toEqual([{ kind: 'equip', slot: 0, cause: 'combat_equip_useful_gear' }]);
        expect(result.cause).toBe('combat_equip_useful_gear');
    });

    it('does not replay a failed combat waypoint for an active combat training goal', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs and retreat if hurt.',
                steps: ['find a chicken or rat', 'attack when healthy', 'eat or stop when hurt'],
                createdAtTick: 0,
            },
            targetFailureCooldowns: {
                'target:3249,3238,0': 2,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3234, 3236),
                    hp: { current: 10, max: 10 },
                    inventory: [],
                    equipment: [],
                },
                npcs: [],
            }),
        );

        expect(result.actions).not.toContainEqual({
            kind: 'move_to',
            target: { x: 3249, y: 3238, level: 0 },
            range: 1,
            cause: 'combat_seek_safe_target',
        });
        expect(result.actions).toContainEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3218, level: 0 },
            range: 1,
            cause: 'combat_seek_safe_target',
        });
        expect(result.cause).toBe('combat_seek_safe_target');
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

    it('holds the active fight instead of burying bones or issuing a duplicate attack while already in combat', async () => {
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

        expect(result.actions).toEqual([]);
        expect(result.cause).toBe('combat_hold');
        expect(result.nooped).toBe(true);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('still eats before continuing an active fight when hurt and carrying food', async () => {
        const chicken = npc('Chicken', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3218, 3201),
                    hp: { current: 3, max: 10 },
                    combatLevel: 10,
                    inCombat: true,
                    combatTarget: chicken,
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [chicken],
                events: [{ kind: 'hit_taken', from: chicken }],
            }),
        );

        expect(result.actions).toEqual([
            { kind: 'eat', slot: 0, cause: 'combat_eat_before_retaliating' },
            { kind: 'say', text: "A bit of food, and I'm ready for more." },
        ]);
        expect(result.cause).toBe('combat_eat_before_retaliating');
        expect(llm.complete).not.toHaveBeenCalled();
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

    it('returns to safety during combat training when hurt and carrying no food', async () => {
        const chicken = npc('Chicken', 3220, 3201);
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
                    inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }],
                    inCombat: false,
                },
                npcs: [chicken],
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

    it('continues to the recovery waypoint after escaping visible goblins during combat training', async () => {
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
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = {
            ...behavior,
            visibilityAnchor: { x: 3254, y: 3230, level: 0 },
        };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3236, 3221),
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3222, y: 3218, level: 0 },
                range: 6,
                cause: 'low_health_seek_safe_recovery',
            },
        ]);
        expect(result.cause).toBe('low_health_seek_safe_recovery');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('holds at the recovery waypoint instead of returning to the combat anchor while still hurt', async () => {
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
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = {
            ...behavior,
            visibilityAnchor: { x: 3254, y: 3230, level: 0 },
        };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3223, 3219),
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'noop', cause: 'low_health_heal_wait' }]);
        expect(result.cause).toBe('low_health_stranded');
        expect(result.nooped).toBe(false);
        expect(llm.complete).not.toHaveBeenCalled();
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

    it('does not replay a failed combat waypoint from a direct training command', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = { targetFailureCooldowns: { 'target:3249,3238,0': 1 } };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: { ...residentAt(3234, 3236), inventory: [], equipment: [] },
                npcs: [],
                events: [chatFromCodex('agent train combat', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3222, y: 3218, level: 0 },
                range: 1,
                cause: 'combat_seek_safe_target',
            },
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

    it('refuses AP-for-GP exchange commands when no RuneScape GP coins are carried', async () => {
        const codex = player('codex', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    inventory: [{ itemId: 1511, key: 'rs:logs', amount: 3 }],
                },
                players: [codex],
                events: [chatFromCodex('agent trade AP for GP', 3219, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I cannot promise GP right now because I do not carry RuneScape coins. I can gather coins first or ask for AP support.',
            },
        ]);
        expect(result.cause).toBe('direct_chat_trade_exchange_no_gp');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('proposes a safe AP-for-GP exchange command when RuneScape GP coins are carried', async () => {
        const codex = player('codex', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: {
                    ...residentAt(3218, 3201),
                    attention: 8,
                    inventory: [{ itemId: 995, key: 'rs:coins', amount: 120 }],
                },
                players: [codex],
                events: [chatFromCodex('agent trade AP for GP', 3219, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'AP is low. I can safely trade up to 120 GP coins for AP through a trusted exchange.',
            },
        ]);
        expect(result.cause).toBe('direct_chat_trade_exchange_proposal');
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

    it('seeds the trader benchmark as a trade hold instead of an exploration patrol when no tester is visible', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = { lastBodyTick: 1 };
        const agent = hybridAgent(llm, state, traderSoul());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3227, 3230),
            }),
        );

        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'trade-with-res-qa-social',
                description: expect.stringContaining('trade'),
            }),
        );
        expect(result.actions).toEqual([]);
        expect(result.cause).toBe('follow_listen_hold');
        expect(result.nooped).toBe(true);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('moves the trader toward its configured follow player under the seeded trade benchmark when visible', async () => {
        // The trade goal now targets a present resident (trade-with-res-qa-social),
        // but the trader still follows its configured followPlayer (codex) to stay in range.
        const codex = player('codex', 3229, 3230);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = { lastBodyTick: 1 };
        const agent = hybridAgent(llm, state, traderSoul());

        const result = await agent.think(
            perception({
                tick: 2,
                resident: residentAt(3227, 3230),
                players: [codex],
            }),
        );

        expect(state.cognition?.activeGoal?.id).toBe('trade-with-res-qa-social');
        expect(result.actions).toEqual([{ kind: 'move_to', target: codex.position, range: 1, cause: 'follow_player_active' }]);
        expect(result.cause).toBe('follow_player_active');
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

        expect(result.actions).toEqual([{ kind: 'equip', slot: 0, cause: 'prayer_equip_useful_gear' }]);
        expect(result.cause).toBe('direct_chat_train_prayer');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not replay a failed prayer waypoint from a direct training command', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            targetFailureCooldowns: {
                'target:3222,3218,0': 1,
                'target:3249,3238,0': 1,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 2,
                resident: { ...residentAt(3234, 3236), inventory: [], equipment: [] },
                npcs: [],
                events: [chatFromCodex('agent train prayer', 3218, 3201)],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I will look for a safe creature, collect bones, then bury them. Goal: Pick up bones and bury them to train Prayer after safe combat.',
            },
        ]);
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

        expect(result.actions).toEqual([{ kind: 'equip', slot: 0, cause: 'prayer_equip_useful_gear' }]);
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

        expect(result.actions).toEqual([{ kind: 'equip', slot: 0, cause: 'prayer_equip_useful_gear' }]);
        expect(result.cause).toBe('prayer_equip_useful_gear');
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

        expect(result.actions).toEqual([{ kind: 'equip', slot: 0, cause: 'prayer_equip_useful_gear' }]);
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

    it('continues consecutive dialogue pages even when the action repeats', async () => {
        const hans = npc('Hans', 3219, 3201);
        const llm = scriptedLlm([]);
        const agent = hybridAgent(llm, runtimeState());

        const first = await agent.think(
            perception({
                tick: 3,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [{ kind: 'dialogue_opened', npc: hans, prompt: 'Hello there.' }],
            }),
        );
        const second = await agent.think(
            perception({
                tick: 4,
                resident: residentAt(3218, 3201),
                npcs: [hans],
                events: [{ kind: 'dialogue_updated', npc: hans, prompt: 'Please continue.' }],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'dialogue_continue', cause: 'dialogue_continue' }]);
        expect(second.actions).toEqual([{ kind: 'dialogue_continue', cause: 'dialogue_continue' }]);
        expect(second.cause).toBe('dialogue_continue');
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

    it("continues Cook's Assistant starter dialogue after talking to the Cook even without dialogue events", async () => {
        const cook = { ...npc('Cook', 3210, 3215), id: 'npc:cook', key: 'rs:lumbridge_castle_cook' };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'start-cooks-assistant',
                description: "Start Cook's Assistant by asking the Lumbridge Cook what is wrong.",
                steps: ['Find the Lumbridge Cook', 'Talk to the Cook', 'Continue the dialogue', 'Choose the helpful first option'],
                success: "Cook's Assistant reaches quest progress stage 50.",
                createdAtTick: 1,
                ttlTicks: 450,
            },
        };
        const agent = hybridAgent(llm, state);

        const first = await agent.think(
            perception({
                tick: 8,
                resident: residentAt(3209, 3215),
                npcs: [cook],
            }),
        );
        const second = await agent.think(
            perception({
                tick: 16,
                resident: residentAt(3209, 3215),
                npcs: [cook],
            }),
        );
        const third = await agent.think(
            perception({
                tick: 24,
                resident: residentAt(3209, 3215),
                npcs: [cook],
            }),
        );

        expect(first.actions).toEqual([{ kind: 'interact', target: cook, option: 'talk-to', cause: 'cooks_assistant_talk_to_cook' }]);
        expect(second.actions).toEqual([{ kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' }]);
        expect(third.actions).toEqual([{ kind: 'dialogue_choice', optionIndex: 0, cause: 'cooks_assistant_dialogue_step' }]);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it("exits Cook's Assistant ingredient hint dialogue after starting the quest", async () => {
        const cook = { ...npc('Cook', 3210, 3215), id: 'npc:cook', key: 'rs:lumbridge_castle_cook' };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'start-cooks-assistant',
                description: "Start Cook's Assistant by asking the Lumbridge Cook what is wrong.",
                steps: ['Find the Lumbridge Cook', 'Talk to the Cook', 'Continue the dialogue', 'Choose the helpful first option'],
                success: "Cook's Assistant reaches quest progress stage 50.",
                createdAtTick: 1,
                ttlTicks: 450,
            },
        };
        const agent = hybridAgent(llm, state);
        const actions: AgentAction[] = [];

        for (let i = 0; i < 12; i += 1) {
            const result = await agent.think(
                perception({
                    tick: 8 + i * 8,
                    resident: {
                        ...residentAt(3209, 3215),
                        quests: i >= 6 ? { 'rs:cooks_assistant': { progress: 50, complete: false } } : {},
                    },
                    npcs: [cook],
                }),
            );
            actions.push(result.actions[0]);
        }

        expect(actions[7]).toEqual({ kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' });
        expect(actions[10]).toEqual({ kind: 'dialogue_choice', optionIndex: 3, cause: 'cooks_assistant_dialogue_step' });
        expect(actions[11]).toEqual({ kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' });
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it("clears stale Cook target failures when Cook's Assistant starter dialogue ends", async () => {
        const cook = { ...npc('Cook', 3210, 3215), id: 'npc:cook', key: 'rs:lumbridge_castle_cook' };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'start-cooks-assistant',
                description: "Start Cook's Assistant by asking the Lumbridge Cook what is wrong.",
                steps: ['Find the Lumbridge Cook', 'Talk to the Cook', 'Continue the dialogue', 'Choose the helpful first option'],
                success: "Cook's Assistant reaches quest progress stage 50.",
                createdAtTick: 1,
                ttlTicks: 450,
            },
            targetFailureCooldowns: {
                'actor-key:rs:lumbridge_castle_cook': 100,
                'actor-name:cook': 100,
                'object:1530:3208,3211,0': 100,
            },
            pendingQuestDialogue: {
                questId: 'rs:cooks_assistant',
                phase: 'start',
                step: 10,
                startedAtTick: 8,
                updatedAtTick: 8,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 96,
                resident: {
                    ...residentAt(3209, 3215),
                    quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                },
                npcs: [cook],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'dialogue_continue', cause: 'cooks_assistant_dialogue_step' }]);
        expect(state.cognition?.targetFailureCooldowns).toEqual({ 'object:1530:3208,3211,0': 100 });
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it("keeps advancing Cook's Assistant hand-in dialogue long enough to reach quest completion", async () => {
        const cook = { ...npc('Cook', 3210, 3215), id: 'npc:cook', key: 'rs:lumbridge_castle_cook' };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'complete-cooks-assistant',
                description: "Complete Cook's Assistant with the ingredients already in inventory.",
                steps: ['Talk to the Cook', 'Hand in milk, flour, and egg', 'Continue until the quest completes'],
                success: "Cook's Assistant is complete.",
                createdAtTick: 1,
                ttlTicks: 900,
            },
        };
        const agent = hybridAgent(llm, state);
        const actions: AgentAction[] = [];

        for (let i = 0; i < 16; i += 1) {
            const result = await agent.think(
                perception({
                    tick: 8 + i * 8,
                    resident: {
                        ...residentAt(3209, 3215),
                        inventory: [{ itemId: 1927 }, { itemId: 1933 }, { itemId: 1944 }],
                        quests: { 'rs:cooks_assistant': { progress: 50, complete: false } },
                    },
                    npcs: [cook],
                }),
            );
            actions.push(result.actions[0]);
        }

        expect(actions[0]).toEqual({ kind: 'interact', target: cook, option: 'talk-to', cause: 'cooks_assistant_hand_in_ingredients' });
        expect(actions.slice(1, 15)).toEqual(
            Array.from({ length: 14 }, () => ({ kind: 'dialogue_continue', cause: 'cooks_assistant_hand_in_dialogue_step' })),
        );
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

        expect(result.actions).toEqual([{ kind: 'interact', target: fishingSpot, option: 'net', cause: 'starter_fishing_net' }]);
        expect(result.cause).toBe('starter_fishing_net');
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

        expect(result.actions).toEqual([{ kind: 'interact', target: fishingSpot, option: 'net', cause: 'starter_fishing_net' }]);
        expect(result.cause).toBe('starter_fishing_net');
        expect(state.cognition?.activeGoal?.id).toBe('catch-starter-fish');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    // --- S-AUDIT-FIX-3 needs-hierarchy wiring (F3 / QA-20260530-013) -----
    // These two tests are the live proof that selectCandidateGoals is no
    // longer dead code: under low AP the planner picks the SURVIVE-aligned
    // goal (collect-visible-gp) over the PURSUE-aligned benchmark
    // (catch-starter-fish), and under healthy AP the benchmark wins.
    //
    // Live-verify recipe: in a hot stack, drain a resident's AP below
    // attentionProfile.floor + 5 with a benchmarkTask configured —
    // restart think loop and inspect state.cognition.activeGoal.id; it
    // should be 'collect-visible-gp', not the benchmark id.

    it('low-AP residents pick the survival candidate (collect-visible-gp) over the benchmark', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        // Sit at floor+buffer = 10+5 = 15; anything <=15 is survive band.
        // attention=12 → survive band.
        state.attention = 12;
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.attentionProfile = {
            startingAttention: 100,
            decayCurve: 'standard',
            floor: 10,
        };
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3000, 3000),
                    inventory: [],
                },
            }),
        );

        // The needs-hierarchy ranker fires inside ensureBenchmarkGoal and
        // picks the survival fallback over the PURSUE-tagged benchmark.
        expect(state.cognition?.activeGoal?.id).toBe('collect-visible-gp');
    });

    it('healthy-AP residents keep the benchmark goal (catch-starter-fish) — ranker only fires in survive band', async () => {
        // Pair test for the low-AP case above. With ap=100 well above
        // floor(10)+buffer(5)=15, currentTier(needsContext) === 'pursue'
        // (or 'earn' when gp is unknown). The conservative wire-up keeps
        // the benchmark verbatim in those tiers so existing benchmark
        // residents continue to pursue their soul-aligned goal. Only the
        // survive band lets the gp-pickup survival candidate win.
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.attention = 100;
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.attentionProfile = {
            startingAttention: 100,
            decayCurve: 'standard',
            floor: 10,
        };
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3000, 3000),
                    inventory: [],
                },
            }),
        );

        expect(state.cognition?.activeGoal?.id).toBe('catch-starter-fish');
    });

    // --- S-GOAL-1 orientation goal wiring (S-GOAL-1) ---------------------
    // These two tests are the live proof that soul.orientationGoal biases
    // ensureBenchmarkGoal beyond the F3 survive-only behavior. With a
    // pursue-tier orientation set, healthy-AP residents pick the
    // orientation candidate over the generic benchmark. Low-AP residents
    // still pick the survival candidate — orientation never overrides
    // survival.
    //
    // Live-verify recipe: configure a hot-stack resident with
    // `soul.frontmatter.orientationGoal = { id: 'master-woodcutting',
    // description: '...', tier: 'pursue' }` and any benchmarkTask. Trigger
    // `think()` with healthy AP — `state.cognition.activeGoal.id` should
    // be 'master-woodcutting'. Drain AP below floor+5 and re-trigger —
    // should flip to 'collect-visible-gp' (survival wins).

    it('healthy-AP resident with pursue orientation picks the orientation candidate over the benchmark', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.attention = 200; // well above floor+buffer
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const orientedSoul = soul();
        orientedSoul.frontmatter.attentionProfile = {
            startingAttention: 100,
            decayCurve: 'standard',
            floor: 10,
        };
        orientedSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        // The north-star: orient toward woodcutting mastery. The
        // benchmark task remains starter-fishing-5m so we can see the
        // override land — without orientation, ensureBenchmarkGoal would
        // pick catch-starter-fish at this AP.
        orientedSoul.frontmatter.orientationGoal = {
            id: 'master-woodcutting',
            description: 'Master woodcutting and supply the city with logs.',
            tier: 'pursue',
        };
        const agent = hybridAgent(llm, state, orientedSoul);

        await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3000, 3000),
                    inventory: [],
                },
            }),
        );

        // Orientation candidate (master-woodcutting) wins thanks to
        // ORIENTATION_ID_MATCH_SCORE on top of pursue tier-alignment.
        expect(state.cognition?.activeGoal?.id).toBe('master-woodcutting');
    });

    it('low-AP resident with pursue orientation still picks the survival candidate — survival overrides orientation', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        // floor=10, buffer=5 → ap=12 sits in survive band.
        state.attention = 12;
        state.cognition = {
            lastPresenceBeaconTick: 0,
            lastGoalShareTick: 0,
        };
        const orientedSoul = soul();
        orientedSoul.frontmatter.attentionProfile = {
            startingAttention: 100,
            decayCurve: 'standard',
            floor: 10,
        };
        orientedSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        orientedSoul.frontmatter.orientationGoal = {
            id: 'master-woodcutting',
            description: 'Master woodcutting and supply the city with logs.',
            tier: 'pursue',
        };
        const agent = hybridAgent(llm, state, orientedSoul);

        await agent.think(
            perception({
                tick: 3,
                resident: {
                    ...residentAt(3000, 3000),
                    inventory: [],
                },
            }),
        );

        // Survive tier: the survival candidate (collect-visible-gp) has
        // 'survive' tag → +10 alignment. Orientation candidate has
        // 'pursue' tag → -1 misaligned + 6 id-match = +5. Survival wins.
        expect(state.cognition?.activeGoal?.id).toBe('collect-visible-gp');
    });

    // --- S-GOAL-FOLLOW-1 D2: goal-selection hysteresis (anti-thrash) -----
    // Proves currentActiveGoalId is forwarded into the ranker (the
    // hysteresis seam). An EARN-tier oriented resident already working its
    // earn-aligned orientation goal keeps following it across re-thinks
    // rather than thrashing. The orientation candidate wins on score here,
    // and the forwarded currentActiveGoalId keeps it pinned tick over tick —
    // this is the goal-follow-through guarantee the benchmark measures. The
    // pure within-delta sticky promotion is exhaustively covered by the
    // needs-hierarchy unit tests; this asserts the live wiring carries the
    // id through ensureBenchmarkGoal.
    it('keeps the current active goal pinned across re-thinks (D2 hysteresis wiring)', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }, { text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.attention = 200; // healthy AP; gpEstimate=0 -> EARN tier
        const orientedSoul = soul();
        orientedSoul.frontmatter.attentionProfile = {
            startingAttention: 100,
            decayCurve: 'standard',
            floor: 10,
        };
        orientedSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'starter-fishing-5m' },
        };
        orientedSoul.frontmatter.orientationGoal = {
            id: 'fund-the-treasury',
            description: 'Earn a steady GP income for the faction treasury.',
            tier: 'earn',
        };
        state.cognition = { lastPresenceBeaconTick: 0, lastGoalShareTick: 0 };
        const agent = hybridAgent(llm, state, orientedSoul);

        await agent.think(perception({ tick: 4, resident: { ...residentAt(3000, 3000), inventory: [] } }));
        expect(state.cognition?.activeGoal?.id).toBe('fund-the-treasury');

        // Re-think: currentActiveGoalId is now 'fund-the-treasury'. The
        // resident keeps following it rather than thrashing to another goal.
        await agent.think(perception({ tick: 5, resident: { ...residentAt(3000, 3000), inventory: [] } }));
        expect(state.cognition?.activeGoal?.id).toBe('fund-the-treasury');
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

    it('routes around an unreachable Lumbridge range move after a fishing-cooking timeout', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 20,
            lastGoalShareTick: 20,
            targetFailureCooldowns: {
                'target:3208,3213,0': 12,
            },
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'fishing-cooking-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: {
                    ...residentAt(3204, 3210),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3217, y: 3218, level: 0 },
                range: 0,
                cause: 'starter_fishing_reach_castle_entrance',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_reach_castle_entrance');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('tries another visible starter fishing spot after one Lumbridge spot times out', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                steps: ['Carry a small fishing net', 'Catch raw shrimp or anchovies', 'Find or make a fire'],
                createdAtTick: 0,
            },
            lastBrainTick: 20,
            lastBodyTick: 20,
            targetFailureCooldowns: {
                'actor:npc:69:3239,3244,0': 20,
            },
        };
        const agent = hybridAgent(llm, state);
        const failedSpot = npc('Fishing spot', 3239, 3244);
        const alternateSpot = npc('Fishing spot', 3241, 3242);

        const result = await agent.think(
            perception({
                tick: 28,
                resident: {
                    ...residentAt(3235, 3242),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
                npcs: [failedSpot, alternateSpot],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'interact',
                target: alternateSpot,
                option: 'net',
                cause: 'starter_fishing_net',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_net');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('abandons a persisted starter fishing move after that coordinate times out', async () => {
        const failedSpot = { x: 3239, y: 3244, level: 0 };
        const alternateSpot = { x: 3241, y: 3242, level: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                steps: ['Carry a small fishing net', 'Catch raw shrimp or anchovies', 'Find or make a fire'],
                createdAtTick: 1,
            },
            lastBrainTick: 405,
            lastBodyTick: 405,
            targetFailureCooldowns: {
                'target:3239,3244,0': 397,
            },
            activeMove: {
                target: failedSpot,
                range: STARTER_FISHING_SPOT_DISCOVERY_RANGE,
                cause: 'starter_fishing_seek_spot',
                startedAtTick: 402,
                lastTick: 405,
                lastPositionKey: '3216,3223,0',
                stationaryCount: 0,
                lastDistance: 23,
                bestDistance: 23,
                lastImprovedTick: 402,
                nonImprovingCount: 0,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 417,
                resident: {
                    ...residentAt(3216, 3223),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: alternateSpot,
                range: STARTER_FISHING_SPOT_DISCOVERY_RANGE,
                cause: 'starter_fishing_reposition_to_bank',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_reposition_to_bank');
        expect(state.cognition?.activeMove?.target).toEqual(alternateSpot);
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('scouts instead of retrying starter fishing route targets when all are cooling down', async () => {
        const failedSpot = { x: 3239, y: 3244, level: 0 };
        const alternateSpot = { x: 3241, y: 3242, level: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                steps: ['Carry a small fishing net', 'Catch raw shrimp or anchovies', 'Find or make a fire'],
                createdAtTick: 1,
            },
            lastBrainTick: 255,
            lastBodyTick: 255,
            targetFailureCooldowns: {
                'target:3239,3244,0': 163,
                'target:3241,3242,0': 255,
            },
            activeMove: {
                target: alternateSpot,
                range: STARTER_FISHING_SPOT_DISCOVERY_RANGE,
                cause: 'starter_fishing_reposition_to_bank',
                startedAtTick: 218,
                lastTick: 255,
                lastPositionKey: '3215,3225,0',
                stationaryCount: 0,
                lastDistance: 26,
                bestDistance: 25,
                lastImprovedTick: 218,
                nonImprovingCount: 1,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 256,
                resident: {
                    ...residentAt(3215, 3225),
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                },
            }),
        );

        expect(result.actions[0]).toMatchObject({
            kind: 'move_to',
            cause: 'starter_fishing_route_blocked',
        });
        const target = (result.actions[0] as { target?: unknown }).target;
        expect(target).not.toEqual(failedSpot);
        expect(target).not.toEqual(alternateSpot);
        expect(result.cause).toBe('starter_fishing_route_blocked');
        expect(state.cognition?.activeMove?.target).not.toEqual(failedSpot);
        expect(state.cognition?.activeMove?.target).not.toEqual(alternateSpot);
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('does not repeat the castle entrance cooking route after that route times out', async () => {
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 20,
            lastGoalShareTick: 20,
            targetFailureCooldowns: {
                'target:3208,3213,0': 12,
                'target:3217,3218,0': 12,
            },
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'fishing-cooking-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: {
                    ...residentAt(3204, 3210),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I can see the Lumbridge range, but I cannot reach it from here. I need logs, an axe, or someone to open a path.',
                cause: 'starter_fishing_missing_heat',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_missing_heat');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('scouts for supplies instead of endlessly repeating a starter-fishing missing-heat blocker', async () => {
        const tree = { objectId: 1278, position: { x: 3209, y: 3213, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                steps: [
                    'Carry a small fishing net',
                    'Catch raw shrimp or anchovies',
                    'Find or make a fire',
                    'Use raw fish on the fire or range',
                ],
                success: 'Raw fish turn into cooked food or a clear blocker is explained.',
                ttlTicks: 900,
                createdAtTick: 1,
            },
            lastPresenceBeaconTick: 39,
            lastGoalShareTick: 39,
            targetFailureCooldowns: {
                'target:3208,3213,0': 12,
                'target:3217,3218,0': 12,
            },
            routineLoopKey: 'starter-fishing-cooking|3204,3213,0',
            routineLoopCount: 2,
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'fishing-cooking-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 40,
                resident: {
                    ...residentAt(3204, 3213),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
                npcs: [
                    {
                        id: 'npc:85',
                        kind: 'npc',
                        key: 'rs:lumbridge_castle_cook',
                        name: 'Cook',
                        position: { x: 3206, y: 3215, level: 0 },
                    },
                ],
                objects: [tree],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'move_to', target: tree.position, range: 2, cause: 'routine_loop_break' }]);
        expect(result.cause).toBe('routine_loop_break');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('tries the castle entrance route before declaring the range unreachable', async () => {
        const door = { objectId: 1530, position: { x: 3208, y: 3211, level: 0 } };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            lastPresenceBeaconTick: 20,
            lastGoalShareTick: 20,
            targetFailureCooldowns: {
                'target:3208,3213,0': 12,
            },
        };
        const benchmarkSoul = soul();
        benchmarkSoul.frontmatter.legacy = {
            kind: 'endurer',
            parameters: { benchmarkTask: 'fishing-cooking-10m' },
        };
        const agent = hybridAgent(llm, state, benchmarkSoul);

        const result = await agent.think(
            perception({
                tick: 20,
                resident: {
                    ...residentAt(3204, 3213),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
                objects: [door],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'move_to',
                target: { x: 3217, y: 3218, level: 0 },
                range: 0,
                cause: 'starter_fishing_reach_castle_entrance',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_reach_castle_entrance');
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

        expect(result.actions).toEqual([{ kind: 'interact', target: fishingSpot, option: 'net', cause: 'starter_fishing_net' }]);
        expect(result.cause).toBe('starter_fishing_net');
    });

    it('frees inventory space before retrying starter fishing when the benchmark pack is full', async () => {
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
                    inventory: fullInventory([
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 7954, key: 'rs:burnt_shrimp', amount: 1 },
                        { itemId: 315, key: 'rs:shrimps', amount: 1 },
                    ]),
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'drop', slot: 2, cause: 'starter_fishing_clear_burnt_fish' }]);
        expect(result.cause).toBe('starter_fishing_clear_burnt_fish');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('frees inventory space even when the starter fishing spot is temporarily out of view', async () => {
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
                    ...residentAt(3234, 3237),
                    inventory: fullInventory([
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 7954, key: 'rs:burnt_shrimp', amount: 1 },
                    ]),
                },
                npcs: [],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'drop', slot: 1, cause: 'starter_fishing_clear_burnt_fish' }]);
        expect(result.cause).toBe('starter_fishing_clear_burnt_fish');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('routes toward starter fishing instead of firemaking before any raw fish is caught', async () => {
        const normalTree = { objectId: 1278, position: { x: 3243, y: 3242, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
                steps: ['Carry a small fishing net', 'Catch raw shrimp or anchovies', 'Find or make a fire'],
                createdAtTick: 0,
            },
            lastBrainTick: 1,
            lastBodyTick: 0,
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
                    ...residentAt(3242, 3242),
                    inventory: [
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                        { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                    ],
                },
                objects: [normalTree],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am at the Lumbridge fishing water and looking for a net spot.',
                cause: 'starter_fishing_seek_spot',
            },
        ]);
        expect(result.cause).toBe('starter_fishing_seek_spot');
        expect(llm.complete).toHaveBeenCalledTimes(0);
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

    it('routes an ordinary starter GP harvest goal into safe combat before LLM inference', async () => {
        const goblin = npc('Goblin', 3254, 3231);
        goblin.key = 'rs:goblin';
        const llm = scriptedLlm([{ text: JSON.stringify({ actions: [] }) }]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: starterGpHarvestGoal(100),
            lastBrainTick: 100,
            lastBodyTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 101,
                resident: {
                    ...residentAt(3254, 3230),
                    inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
                },
                npcs: [goblin],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'attack', target: goblin, cause: 'combat_attack_safe_target' }]);
        expect(result.cause).toBe('combat_attack_safe_target');
        expect(state.cognition?.activeGoal?.id).toBe('earn-starter-gp-via-combat');
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online. Goal: Practice firemaking.' }]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('beacons a due active goal before stuck recovery even when Brain is due', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.stuckSince = 80;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Practice firemaking.',
                createdAtTick: 1,
            },
            lastBrainTick: 60,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            lastAgentKeepaliveTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3218, 3201),
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online. Goal: Practice firemaking.' }]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('lets res:agent keepalive beat a due presence beacon when stuck', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:agent';
        state.stuckSince = 80;
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Practice firemaking.',
                createdAtTick: 1,
            },
            lastBrainTick: 60,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            lastAgentKeepaliveTick: 60,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'Agent online. No tester visible. Say "agent status" or "agent help" to check my goal, location, and next step.',
                cause: 'agent_keepalive',
            },
        ]);
        expect(result.cause).toBe('agent_keepalive');
        expect(state.cognition?.lastAgentKeepaliveTick).toBe(121);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not let res:agent keepalive interrupt an active anchor return', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:agent';
        state.stuckSince = 80;
        state.cognition = {
            activeMove: {
                target: { x: 3200, y: 3200, level: 0 },
                range: 1,
                cause: 'return_to_visibility_anchor',
                startedAtTick: 90,
                lastTick: 100,
                lastPositionKey: '3198,3200,0',
                stationaryCount: 0,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastAgentKeepaliveTick: 60,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3198, 3200),
            }),
        );

        expect(result.cause).not.toBe('agent_keepalive');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to' }));
        expect(state.cognition?.lastAgentKeepaliveTick).toBe(60);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not emit res:agent keepalive while a tester is visible', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:agent';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastAgentKeepaliveTick: 60,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
                players: [player('Codex', 3201, 3200)],
            }),
        );

        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        expect(state.cognition?.lastAgentKeepaliveTick).toBe(60);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('lets the social QA resident announce capabilities before no-human idle becomes stuck recovery', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:qa-social';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastSocialKeepaliveTick: 84,
        };
        const agentSoul = socialSoul();
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'No tester visible. Say "social help" for follow, status, wait, stop, trade, or where I am.',
                cause: 'social_keepalive',
            },
        ]);
        expect(result.cause).toBe('social_keepalive');
        expect(state.cognition?.lastSocialKeepaliveTick).toBe(121);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('emits the social QA keepalive before the progress tracker has to mark it stuck', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:qa-social';
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastSocialKeepaliveTick: 84,
        };
        const agent = hybridAgent(llm, state, socialSoul());

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.cause).toBe('social_keepalive');
        expect(result.actions).toEqual([
            expect.objectContaining({
                kind: 'say',
                cause: 'social_keepalive',
            }),
        ]);
        expect(state.stuckSince).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps ordinary stuck recovery active when social keepalive is not due', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:qa-social';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastSocialKeepaliveTick: 100,
        };
        const agent = hybridAgent(llm, state, socialSoul());

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('lets res:agent announce operator status before no-human idle becomes stuck recovery', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:agent';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastAgentKeepaliveTick: 60,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'Agent online. No tester visible. Say "agent status" or "agent help" to check my goal, location, and next step.',
                cause: 'agent_keepalive',
            },
        ]);
        expect(result.cause).toBe('agent_keepalive');
        expect(state.cognition?.lastAgentKeepaliveTick).toBe(121);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps ordinary stuck recovery active when res:agent keepalive is not due', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:agent';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastAgentKeepaliveTick: 100,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('lets the trade QA resident advertise starter trades before idle scouting becomes stuck recovery', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:qa-trader';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastTradeKeepaliveTick: 60,
        } as any;
        const agent = hybridAgent(llm, state, traderSoul());

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 1511, key: 'rs:logs', amount: 5 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    ],
                },
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I have starter supplies ready. Say "trade trade me" to trade, or "trade inventory" to inspect them.',
                cause: 'trade_keepalive',
            },
        ]);
        expect(result.cause).toBe('trade_keepalive');
        expect(state.cognition?.lastTradeKeepaliveTick).toBe(121);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('emits hero_keepalive for a named hero when stuck and cooldown elapsed', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:hans';
        state.stuckSince = 60;
        state.cognition = {
            lastBrainTick: 60,
            lastBodyTick: 60,
            lastHeroKeepaliveTick: 60,
        };
        const hansSoul: Soul = {
            sourcePath: '/tmp/res-hans.md',
            body: '# Hans\n\nHans is a courtyard guard.',
            frontmatter: {
                name: 'res:hans',
                display: 'Hans',
                archetype: 'endurer',
                model: { endpoint: 'default', temperature: 0.6 },
                behavior: {
                    kind: 'hybrid-agent',
                    brainEveryTicks: 50,
                    bodyEveryTicks: 1,
                    shareGoalsEveryTicks: 60,
                },
                attentionProfile: { startingAttention: 14000, decayCurve: 'standard' },
            },
        };
        const agent = hybridAgent(llm, state, hansSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.cause).toBe('hero_keepalive');
        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'Hans here. No observers visible. Here if you need me.',
                cause: 'hero_keepalive',
            },
        ]);
        expect(state.cognition?.lastHeroKeepaliveTick).toBe(121);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not emit hero_keepalive for res:agent (uses agent_keepalive instead)', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:agent';
        state.stuckSince = 60;
        state.cognition = {
            lastBrainTick: 60,
            lastBodyTick: 60,
            lastAgentKeepaliveTick: 60,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.cause).toBe('agent_keepalive');
        expect(result.cause).not.toBe('hero_keepalive');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not emit hero_keepalive when a player is visible', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:hans';
        state.stuckSince = 60;
        state.cognition = {
            lastBrainTick: 60,
            lastBodyTick: 60,
            lastHeroKeepaliveTick: 60,
        };
        const hansSoul: Soul = {
            sourcePath: '/tmp/res-hans.md',
            body: '# Hans',
            frontmatter: {
                name: 'res:hans',
                display: 'Hans',
                archetype: 'endurer',
                model: { endpoint: 'default', temperature: 0.6 },
                behavior: { kind: 'hybrid-agent', brainEveryTicks: 50, bodyEveryTicks: 1, shareGoalsEveryTicks: 60 },
                attentionProfile: { startingAttention: 14000, decayCurve: 'standard' },
            },
        };
        const agent = hybridAgent(llm, state, hansSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
                players: [player('Claude', 3201, 3200)],
            }),
        );

        expect(result.cause).not.toBe('hero_keepalive');
        expect(state.cognition?.lastHeroKeepaliveTick).toBe(60);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('keeps ordinary stuck recovery when hero_keepalive cooldown is not elapsed', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:father-aereck';
        state.stuckSince = 80;
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastHeroKeepaliveTick: 100,
        };
        const aereckSoul: Soul = {
            sourcePath: '/tmp/res-father-aereck.md',
            body: '# Father Aereck',
            frontmatter: {
                name: 'res:father-aereck',
                display: 'Father Aereck',
                archetype: 'mentor',
                model: { endpoint: 'default', temperature: 0.6 },
                behavior: { kind: 'hybrid-agent', brainEveryTicks: 50, bodyEveryTicks: 1, shareGoalsEveryTicks: 60 },
                attentionProfile: { startingAttention: 14000, decayCurve: 'gentle' },
            },
        };
        const agent = hybridAgent(llm, state, aereckSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3200, 3200),
            }),
        );

        expect(result.cause).toBe('stuck_pre_inference_explore');
        expect(result.actions[0]).toEqual(expect.objectContaining({ kind: 'move_to', cause: 'stuck_pre_inference_explore' }));
        expect(state.cognition?.lastHeroKeepaliveTick).toBe(100);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('proactively requests a starter trade from the configured tester when adjacent and stocked', async () => {
        const codex = player('codex', 3200, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.resident = 'res:qa-trader';
        state.cognition = {
            lastBrainTick: 120,
            lastBodyTick: 120,
        };
        const agent = hybridAgent(llm, state, traderSoul());

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3200, 3200),
                    inventory: [
                        { itemId: 1511, key: 'rs:logs', amount: 5 },
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    ],
                },
                players: [codex],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'trade_request', target: codex, cause: 'trade_starter_offer' }]);
        expect(result.cause).toBe('trade_starter_offer');
        expect(state.hookCooldowns?.['trade-starter-offer:codex']).toBe(241);
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

        expect(result.actions).toEqual([{ kind: 'noop', cause: 'low_health_heal_wait' }]);
        expect(result.cause).toBe('low_health_hold_position');
        expect(result.nooped).toBe(false);
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

    it('uses low_health_stranded cause and speaks once when at the recovery waypoint with no food', async () => {
        // Anchor at 3254,3230 is Chebyshev-32 from waypoint 3222,3218 — exceeds the 28-tile combat-area
        // threshold, so lowHealthRecoveryAction yields to lowHealthHoldPositionAction.
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
        };
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = { ...behavior, visibilityAnchor: { x: 3254, y: 3230, level: 0 } };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3222, 3218),
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        expect(result.cause).toBe('low_health_stranded');
        expect(result.actions).toEqual([{ kind: 'say', text: 'I am hurt at 3222,3218. Holding near safety until I find food or heal.' }]);
        expect(result.nooped).toBe(false);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('routes a stranded combat resident with a small net toward starter fishing instead of heal-waiting forever', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 110,
            lastGoalShareTick: 110,
        };
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = { ...behavior, visibilityAnchor: { x: 3254, y: 3230, level: 0 } };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3222, 3218),
                    hp: { current: 1, max: 10 },
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        expect(result.cause).toBe('low_health_fish_food');
        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3241, y: 3242, level: 0 }, range: 7, cause: 'low_health_fish_food' },
        ]);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('routes a stranded net-carrying resident toward starter fishing near passive Lumbridge NPCs', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 110,
            lastGoalShareTick: 110,
        };
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = { ...behavior, visibilityAnchor: { x: 3254, y: 3230, level: 0 } };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3222, 3218),
                    hp: { current: 1, max: 10 },
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                    inCombat: false,
                },
                npcs: [
                    {
                        id: 'npc:man',
                        kind: 'npc',
                        key: 'rs:man',
                        name: 'Man',
                        position: { x: 3226, y: 3218, level: 0 },
                        hpFraction: 0.7,
                        combatLevel: 2,
                    },
                ],
            }),
        );

        expect(result.cause).toBe('low_health_fish_food');
        expect(result.actions).toEqual([
            { kind: 'move_to', target: { x: 3241, y: 3242, level: 0 }, range: 7, cause: 'low_health_fish_food' },
        ]);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('emits a heal-wait action when low_health_stranded speech is deduped', async () => {
        // Beacon fires (lastPresenceBeaconTick gap >= interval) but lastLowHealthSpeechTick is recent.
        // Same custom anchor as the "speaks once" test to ensure anchorLooksLikeCombatArea is true.
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            lastLowHealthSpeechTick: 110,
        };
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = { ...behavior, visibilityAnchor: { x: 3254, y: 3230, level: 0 } };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3222, 3218),
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        // Beacon consumed but speech is deduped (dedup window = interval * 10 = 200 ticks, gap = 11 < 200).
        expect(result.cause).toBe('low_health_heal_wait');
        expect(result.actions).toEqual([{ kind: 'noop', cause: 'low_health_heal_wait' }]);
        expect(result.nooped).toBe(false);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('emits a heal-wait action when low_health_stranded beacon is not due', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 110,
            lastGoalShareTick: 110,
        };
        const agentSoul = soul();
        const behavior = agentSoul.frontmatter.behavior;
        if (!behavior || behavior.kind !== 'hybrid-agent') {
            throw new Error('Expected hybrid-agent test soul');
        }
        agentSoul.frontmatter.behavior = { ...behavior, visibilityAnchor: { x: 3254, y: 3230, level: 0 } };
        const agent = hybridAgent(llm, state, agentSoul);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: {
                    ...residentAt(3222, 3218),
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        expect(result.cause).toBe('low_health_stranded');
        expect(result.actions).toEqual([{ kind: 'noop', cause: 'low_health_heal_wait' }]);
        expect(result.nooped).toBe(false);
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('re-emits low_health_hold_position speech after the dedup window expires', async () => {
        // lastLowHealthSpeechTick = 0, speechDedup = 200; tick 201 clears the dedup.
        const tree = { objectId: 1278, position: { x: 3201, y: 3200, level: 0 }, orientation: 1 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'woodcutting-practice',
                description: 'Practice woodcutting on ordinary trees and gather logs.',
                createdAtTick: 1,
            },
            lastBrainTick: 180,
            lastBodyTick: 180,
            lastPresenceBeaconTick: 0,
            lastLowHealthSpeechTick: 0,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 201,
                resident: {
                    ...residentAt(3200, 3200),
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
                    inCombat: false,
                },
                objects: [tree],
            }),
        );

        // Dedup window expired (201 - 0 = 201 >= 200); speech fires again.
        expect(result.cause).toBe('low_health_hold_position');
        expect(result.actions).toEqual([{ kind: 'say', text: 'I am hurt at 3200,3200. Holding near safety until I find food or heal.' }]);
        expect(result.nooped).toBe(false);
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

    it('prepares food instead of retreating from a stale combat target after combat drops', async () => {
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3201, level: 0 }, orientation: 0 };
        const staleTarget = npc('Man', 3221, 3218);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
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
                    combatTarget: staleTarget,
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

    it('prepares food while busy from prior fishing when low on health and carrying raw fish', async () => {
        const fire = { objectId: objectIds.fire, position: { x: 3218, y: 3201, level: 0 }, orientation: 0 };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
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
                    busy: true,
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

    it('does not route repeated low-health recovery moves while busy', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'train-combat-safely',
                description: 'Train combat on safe low-level NPCs.',
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
                    ...residentAt(3222, 3218),
                    busy: true,
                    hp: { current: 3, max: 10 },
                    inventory: [{ itemId: 303, key: 'rs:small_fishing_net', amount: 1 }],
                    inCombat: false,
                },
                npcs: [],
            }),
        );

        expect(result.actions).toEqual([]);
        expect(result.cause).toBe('resident_busy');
        expect(result.nooped).toBe(true);
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
                text: 'I am online. Goal: Catch shrimp with a small fishing net at a visible Fishing spot. Next: fish at 3219,3201 with my small net.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).toHaveBeenCalledTimes(0);
    });

    it('beacons cooking as the next starter-fishing step once raw fish is carried', async () => {
        const fishingSpot = npc('Fishing spot', 3219, 3201);
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'catch-and-cook-starter-fish',
                description: 'Catch shrimp with a small fishing net, then cook the catch on a fire or range.',
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
                        { itemId: 303, key: 'rs:small_fishing_net', amount: 1 },
                        { itemId: 317, key: 'rs:raw_shrimp', amount: 1 },
                    ],
                },
                npcs: [fishingSpot],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online. Goal: Catch shrimp with a small fishing net, then cook the catch on a fire or range. Next: find a fire or range to cook my raw fish.',
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
            { kind: 'say', text: 'I am online. Goal: Practice scouting. Next: pick up coins at 3219,3201.' },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not beacon dropped burnt fish as a useful nearby opportunity', async () => {
        const burnt = { itemId: 7954, key: 'rs:burnt_shrimp', amount: 1, position: { x: 3219, y: 3201, level: 0 } };
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
                worldItems: [burnt],
            }),
        );

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online. Goal: Practice scouting.' }]);
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
                text: 'I am online. Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find. Next: scout the tree stand at 3224,3201.',
            },
        ]);
        expect(result.cause).toBe('presence_beacon');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('beacons an active return to the visibility anchor so observers know why it is walking back', async () => {
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: {
                id: 'scout-nearby-area',
                description: 'Scout nearby landmarks, creatures, and useful items while staying easy to find.',
                createdAtTick: 1,
            },
            lastBrainTick: 120,
            lastBodyTick: 120,
            lastPresenceBeaconTick: 100,
            activeMove: {
                target: { x: 3192, y: 3229, level: 0 },
                range: 1,
                cause: 'return_to_visibility_anchor',
                startedAtTick: 119,
                lastTick: 120,
                lastPositionKey: '3185,3229,0',
                stationaryCount: 0,
                lastDistance: 29,
                bestDistance: 29,
                lastImprovedTick: 120,
                nonImprovingCount: 0,
            },
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(
            perception({
                tick: 121,
                resident: residentAt(3192, 3229),
                objects: [{ objectId: objectIds.tree.normal[0].default, position: { x: 3191, y: 3229, level: 0 }, orientation: 0 }],
            }),
        );

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'I am online. Goal: Scout nearby landmarks, creatures, and useful items while staying easy to find. Next: return toward my findable point at 3200,3200.',
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
        // phase 2 (Math.floor(2522/20)%4=2): Goal shown, Next suppressed for variety
        expect(text).toBe('I am scouting. Nearby I see 1 tree, 1 item, and 1 NPC. Goal: Practice scouting.');
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
            { kind: 'say', text: 'I am online. Goal: Practice scouting. Next: chop the tree at 3219,3200.' },
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
            { kind: 'say', text: 'I am online. Goal: Practice scouting. Next: chop the tree at 3219,3200.' },
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
            { kind: 'say', text: 'I am online. Goal: Practice scouting. Next: chop the tree at 3219,3200.' },
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
                text: 'I am online. Goal: Practice scouting.',
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
                text: 'I am online. Goal: Move to a visible tree and chop it to gather logs and gain Woodcutting XP. Next: chop the tree at 3221,3201.',
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

        expect(result.actions).toEqual([{ kind: 'say', text: 'I am online. Goal: Practice scouting.' }]);
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
                text: 'I am online. Goal: Gather ordinary logs and light a fire with the tinderbox. Next: chop the tree at 3219,3200.',
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
                text: 'I am online. Goal: Gather logs from a nearby ordinary tree and light a fire with the tinderbox. Next: chop the tree at 3219,3200.',
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
                text: 'I am online. Goal: Catch shrimp with a small fishing net. Next: fish at 3219,3201 with my small net.',
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
                text: 'I am online. Goal: Move to a visible tree and chop it to gather logs and gain Woodcutting XP. Next: look for an ordinary tree to chop.',
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

    it('F9a: phase-1 beacon shows Goal but omits Next step (variety suffix)', async () => {
        // tick=1060 → phase Math.floor(1060/20)%4 = 53%4 = 1; interval from soul.shareGoalsEveryTicks=20
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: { id: 'scout-lumbridge', description: 'Practice scouting.', createdAtTick: 1 },
            lastBrainTick: 1059,
            lastBodyTick: 1059,
            lastPresenceBeaconTick: 1040,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(perception({ tick: 1060, resident: residentAt(3218, 3201), worldItems: [coins] }));

        expect(result.cause).toBe('presence_beacon');
        const text = String((result.actions[0] as { text?: string }).text);
        expect(text).toContain('Goal: Practice scouting.');
        expect(text).not.toContain('Next:');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('F9a: phase-2 beacon shows Goal but omits Next step (scouting variety)', async () => {
        // tick=1080 → phase Math.floor(1080/20)%4 = 54%4 = 2
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: { id: 'scout-lumbridge', description: 'Practice scouting.', createdAtTick: 1 },
            lastBrainTick: 1079,
            lastBodyTick: 1079,
            lastPresenceBeaconTick: 1060,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(perception({ tick: 1080, resident: residentAt(3218, 3201), worldItems: [coins] }));

        expect(result.cause).toBe('presence_beacon');
        const text = String((result.actions[0] as { text?: string }).text);
        expect(text).toContain('Goal: Practice scouting.');
        expect(text).not.toContain('Next:');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('F9a: phase-3 beacon shows only prefix and nearby summary (no Goal, no Next, no raw coordinates)', async () => {
        // tick=1100 → phase Math.floor(1100/20)%4 = 55%4 = 3
        const coins = { itemId: 995, key: 'rs:coins', amount: 8, position: { x: 3219, y: 3201, level: 0 } };
        const llm = scriptedLlm([]);
        const state = runtimeState();
        state.cognition = {
            activeGoal: { id: 'scout-lumbridge', description: 'Practice scouting.', createdAtTick: 1 },
            lastBrainTick: 1099,
            lastBodyTick: 1099,
            lastPresenceBeaconTick: 1080,
        };
        const agent = hybridAgent(llm, state);

        const result = await agent.think(perception({ tick: 1100, resident: residentAt(3218, 3201), worldItems: [coins] }));

        expect(result.cause).toBe('presence_beacon');
        const text = String((result.actions[0] as { text?: string }).text);
        expect(text).not.toContain('Goal:');
        expect(text).not.toContain('Next:');
        // Toned down for human viewers: no raw tile coordinates in the chat feed.
        expect(text).not.toMatch(/\d{3,4}\s*,\s*\d{3,4}/);
        expect(text).toMatch(/Nearby I see|working my route|checking|scouting/);
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
                    combatTarget: goblinHurt,
                },
                npcs: [goblinHurt],
                events: [{ kind: 'hit_taken', from: goblinHurt }],
            }),
        );

        // Should neither re-issue the active attack nor repeat narration while already engaged.
        expect(result2.actions).toEqual([]);
        expect(result2.cause).toBe('combat_hold');
        expect(result2.nooped).toBe(true);
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
            // Brain timeout is a generous 240s "server broken" alarm ceiling (S-INFER-8),
            // not a thinking bound (real q4 qwopus ~40s).
            expect(llm.complete.mock.calls[0]?.[0].timeoutMs).toBe(240_000);
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
            expect(prompt).toContain('Memory:');
            expect(prompt).toContain('Persistent resident memory');
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

    describe('Proactive trade action', () => {
        it('proactively offers a resource to a nearby patron when carrying logs or bones', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            state.tick = 10;
            const soulHero = soul();
            soulHero.frontmatter.heroProfile = {
                tier: 'hero',
                publicName: 'Hero Agent',
                signatureAction: 'helps patrons',
                anchor: [3200, 3200, 0],
            };
            const patronRegistry = new PatronRegistry([{ handle: 'alice', role: 'sponsor', isPatron: true } as any]);
            const agent = new HybridAgentThinkingModule({
                soul: soulHero,
                state,
                memory: memory(),
                llm: llm as unknown as LlmClient,
                patronRegistry,
            });

            // 1. Tick with a patron nearby and logs in inventory -> should trigger trade
            const result = await agent.think(
                perception({
                    tick: 10,
                    resident: {
                        ...residentAt(3200, 3200),
                        inventory: [{ itemId: 1511, key: 'rs:logs', amount: 5 }],
                    },
                    players: [player('alice', 3200, 3201)],
                }),
            );

            expect(result.actions).toEqual([
                {
                    kind: 'trade_resource',
                    target: { humanHandle: 'alice' },
                    artifact: 'logs',
                    quantity: 1,
                    note: 'hero_gift',
                    cause: 'proactive_patron_gift',
                },
            ]);
            expect(result.cause).toBe('proactive_patron_gift');
            expect(state.hookCooldowns?.['proactive-trade:alice']).toBe(111);

            // 2. Next tick, proactive trade should be on cooldown
            state.cognition!.lastBodyTick = 10;
            const resultCooldown = await agent.think(
                perception({
                    tick: 11,
                    resident: {
                        ...residentAt(3200, 3200),
                        inventory: [{ itemId: 1511, key: 'rs:logs', amount: 5 }],
                    },
                    players: [player('alice', 3200, 3201)],
                }),
            );

            expect(resultCooldown.actions).toEqual([]);
        });
    });

    describe('G5: Broader command vocabulary and safety gating', () => {
        it('G5-T1: Peer says "agent come here". Assert move_to speaker tile + say ack.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3205, 3205); // 5 tiles away

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: residentAt(3200, 3200),
                    players: [peer],
                    events: [chatFromCodex('agent come here', 3205, 3205)],
                }),
            );

            expect(result.actions).toEqual([
                { kind: 'move_to', target: { x: 3205, y: 3205, level: 0 }, range: 1, cause: 'direct_chat_come_here' },
                { kind: 'say', text: 'On my way.', voiceSource: 'phrasebook' },
            ]);
            expect(result.cause).toBe('direct_chat_come_here');
            expect(state.cognition?.waitResumeTick).toBeUndefined();
        });

        it('G5-T2: Peer says "agent wait". Assert active goal paused + say ack.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            state.cognition = {
                activeGoal: { id: 'chop-wood', description: 'Chop wood', createdAtTick: 1 },
                followTarget: { name: 'codex', setAtTick: 1 },
            };
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: residentAt(3200, 3200),
                    players: [peer],
                    events: [chatFromCodex('agent wait', 3202, 3202)],
                }),
            );

            expect(result.actions).toEqual([{ kind: 'say', text: 'Waiting.', voiceSource: 'phrasebook' }]);
            expect(result.cause).toBe('direct_chat_wait');
            expect(state.cognition?.waitResumeTick).toBe(62);
            expect(state.cognition?.activeGoal).toBeUndefined();
            expect(state.cognition?.pausedGoal?.id).toBe('chop-wood');
            expect(state.cognition?.pausedFollowTarget?.name).toBe('codex');
        });

        it('G5-T3: Peer says "agent wait" while already waiting. Assert timer extended.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            state.cognition = {
                waitResumeTick: 50,
                pausedGoal: { id: 'chop-wood', description: 'Chop wood', createdAtTick: 1 },
            };
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 30, // Tick 30, waitResumeTick is 50
                    resident: residentAt(3200, 3200),
                    players: [peer],
                    events: [chatFromCodex('agent wait', 3202, 3202)],
                }),
            );

            expect(result.actions).toEqual([{ kind: 'say', text: 'Still waiting.', voiceSource: 'phrasebook' }]);
            expect(result.cause).toBe('direct_chat_wait_extend');
            expect(state.cognition?.waitResumeTick).toBe(90); // 30 + 60
            expect(state.cognition?.pausedGoal?.id).toBe('chop-wood');
        });

        it('G5-T4: Wait timer expires. Assert goal resumed + say resuming.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            state.cognition = {
                waitResumeTick: 60,
                pausedGoal: { id: 'chop-wood', description: 'Chop wood', createdAtTick: 1 },
                pausedFollowTarget: { name: 'codex', setAtTick: 1 },
            };
            const agent = hybridAgent(llm, state);

            const result = await agent.think(
                perception({
                    tick: 60, // timer expires at tick 60
                    resident: residentAt(3200, 3200),
                }),
            );

            expect(result.actions).toEqual([{ kind: 'say', text: 'Resuming.', voiceSource: 'phrasebook' }]);
            expect(result.cause).toBe('direct_chat_wait_resume');
            expect(state.cognition?.waitResumeTick).toBeUndefined();
            expect(state.cognition?.activeGoal?.id).toBe('chop-wood');
            expect(state.cognition?.followTarget?.name).toBe('codex');
        });

        it('G5-T9: Peer says "agent stop" while in combat. Assert goal cleared + combat reaction wins.', async () => {
            const goblin = npc('Goblin', 3201, 3201);
            goblin.combatLevel = 2;
            goblin.hpFraction = 1.0;
            const llm = scriptedLlm([]);
            const state = runtimeState();
            state.cognition = {
                activeGoal: { id: 'chop-wood', description: 'Chop wood', createdAtTick: 1 },
            };
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: {
                        ...residentAt(3200, 3200),
                        inCombat: true,
                        hp: { current: 10, max: 10 },
                        combatLevel: 10,
                    },
                    npcs: [goblin],
                    players: [peer],
                    events: [{ kind: 'hit_taken', from: goblin }, chatFromCodex('agent stop', 3202, 3202)],
                }),
            );

            // Expect both: combat attack and stop say
            expect(result.actions).toEqual([
                { kind: 'attack', target: goblin, cause: 'combat_retaliate' },
                { kind: 'say', text: 'You think you can break me, Goblin? Think again.' },
                { kind: 'say', text: 'Stopping.', voiceSource: 'phrasebook' },
            ]);
            expect(state.cognition?.activeGoal).toBeUndefined();
        });

        it('G5-T10: HP 20% in combat, peer says "agent come here". Assert polite decline with command_unsafe.', async () => {
            const goblin = npc('Goblin', 3201, 3201);
            goblin.combatLevel = 2;
            goblin.hpFraction = 1.0;
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: {
                        ...residentAt(3200, 3200),
                        inCombat: true,
                        hp: { current: 2, max: 10 }, // 20% HP
                        combatLevel: 10,
                    },
                    npcs: [goblin],
                    players: [peer],
                    events: [{ kind: 'hit_taken', from: goblin }, chatFromCodex('agent come here', 3202, 3202)],
                }),
            );

            // Expect the survival reflex plus decline; no patron command move should override combat.
            expect(result.actions).toContainEqual({ kind: 'move_to', target: { x: 3196, y: 3196, level: 0 }, cause: 'combat_retreat' });
            expect(result.actions).toContainEqual({ kind: 'say', text: "Hold on — I'm in combat.", voiceSource: 'phrasebook' });
            expect(result.actions).not.toContainEqual({ kind: 'move_to', target: peer.position, range: 1, cause: 'direct_chat_come_here' });
            expect(result.refusalReason).toBe('command_unsafe');
        });

        it('G5-T10b: Mid-trade with accepted offer, peer says "agent come here". Assert polite decline with command_unsafe.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: {
                        ...residentAt(3200, 3200),
                        activeTrade: {
                            partner: peer,
                            ours: [{ itemId: 1511, amount: 1 }],
                            theirs: [{ itemId: 995, amount: 1 }],
                            ourStage: 'accepted_1',
                            theirStage: 'unaccepted',
                        },
                    },
                    players: [peer],
                    events: [chatFromCodex('agent come here', 3202, 3202)],
                }),
            );

            // Command is declined without moving away from the active trade.
            expect(result.actions).toEqual([{ kind: 'say', text: 'Mid-trade, give me a sec.', voiceSource: 'phrasebook' }]);
            expect(result.refusalReason).toBe('command_unsafe');
        });

        it('G5-T8: Peer says unknown command "agent dance". Assert polite decline listing capabilities.', async () => {
            const llm = scriptedLlm([]);
            const state = runtimeState();
            const agent = hybridAgent(llm, state);
            const peer = player('codex', 3202, 3202);

            const result = await agent.think(
                perception({
                    tick: 2,
                    resident: residentAt(3200, 3200),
                    players: [peer],
                    events: [chatFromCodex('agent dance', 3202, 3202)],
                }),
            );

            expect(result.actions).toEqual([
                {
                    kind: 'say',
                    text: 'Don\'t get what "dance" means. I can only: follow, stop, wait, come, train, fight, eat, drop, trade, explore, make fire, or cook.',
                    voiceSource: 'phrasebook',
                },
            ]);
            expect(result.refusalReason).toBe('unknown_command');
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

function socialSoul(): Soul {
    const base = soul();
    return {
        ...base,
        sourcePath: '/tmp/res-qa-social.md',
        body: '# QA Social\n\nWhen no human is visible, stay near the Lumbridge test anchor and announce useful capabilities occasionally.',
        frontmatter: {
            ...base.frontmatter,
            name: 'res:qa-social',
            display: 'QA Social',
            behavior: {
                kind: 'hybrid-agent',
                followPlayer: 'codex',
                commandPrefix: 'social',
                brainEveryTicks: 50,
                bodyEveryTicks: 1,
                shareGoalsEveryTicks: 80,
                visibilityAnchor: { x: 3200, y: 3200, level: 0 },
                returnToAnchorEveryTicks: 10,
                returnToAnchorRadius: 6,
            },
        },
    };
}

function traderSoul(): Soul {
    const base = soul();
    return {
        ...base,
        sourcePath: '/tmp/res-qa-trader.md',
        body: '# QA Trader\n\nStay close to Codex when visible and make trade readiness obvious without wandering into scouting loops.',
        frontmatter: {
            ...base.frontmatter,
            name: 'res:qa-trader',
            display: 'QA Trader',
            legacy: {
                kind: 'mentor',
                parameters: {
                    benchmarkTask: 'trading-giving-5m',
                },
            },
            behavior: {
                kind: 'hybrid-agent',
                followPlayer: 'codex',
                followRadius: 1,
                commandPrefix: 'trade',
                brainEveryTicks: 50,
                bodyEveryTicks: 1,
                shareGoalsEveryTicks: 90,
                visibilityAnchor: { x: 3227, y: 3230, level: 0 },
                returnToAnchorEveryTicks: 10,
                returnToAnchorRadius: 6,
            },
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
        rememberFact: jest.fn(),
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

function fullInventory(seed: Array<Record<string, unknown> | null>): Array<Record<string, unknown> | null> {
    const inventory = [...seed];
    while (inventory.length < 28) {
        inventory.push({ itemId: 995, key: 'rs:coins', amount: 1 });
    }
    return inventory;
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
    const key = name.toLowerCase() === 'fishing spot' ? 'rs:fishing_spot_net_bait' : name.toLowerCase();
    return {
        id: `npc:${name.toLowerCase()}`,
        kind: 'npc',
        name,
        key,
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
