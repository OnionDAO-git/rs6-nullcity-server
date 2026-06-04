import path from 'path';
import { GameSkillService } from './game-skill-context';
import { createDefaultGameSkillEntries } from './game-skill-entries';

describe('GameSkillService', () => {
    it('builds can-do-now firemaking context from inventory evidence', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('make-fire', 'Make a fire with tinderbox and logs.'),
            perception: perception('Inventory: rs:tinderbox, rs:logs. Nearby open ground.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'make-fire',
                    status: 'can_do_now',
                    nextActionHint: expect.stringContaining('use_item_on_item'),
                }),
            ]),
        );
        expect(context.bodySection).toContain('can_do_now');
        expect(context.bodySection).toContain('use_item_on_item');
        // Either the per-skill entry or the new multi-skill workflow chain entry
        // is acceptable firemaking grounding for the LLM. Both reach the prompt via
        // ENGINE_KNOWLEDGE_ENTRIES; the workflow chain often outranks the per-skill
        // entry for "tinderbox + logs" queries because it captures the end-to-end
        // sequence the resident actually needs to execute.
        expect(context.bodySection).toMatch(/Skill: Firemaking|Workflow: Woodcutting → Firemaking Chain/);
    });

    it('reports missing logs but visible tree as a preparation hint', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('make-fire', 'Make a fire nearby.'),
            perception: perception('Inventory: rs:tinderbox. Nearby object: Tree with option chop down.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'make-fire',
                    status: 'missing_item',
                    nextActionHint: expect.stringContaining('chop'),
                }),
            ]),
        );
    });

    it('does not claim firemaking can happen now from goal text alone', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('make-fire', 'Make a fire with tinderbox and logs.'),
            perception: perception('Inventory is empty. No visible useful items.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'make-fire',
                    status: 'missing_item',
                }),
            ]),
        );
        expect(context.workflowAvailability).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ workflowId: 'make-fire', status: 'can_do_now' })]),
        );
    });

    it('does not claim starter fishing can happen now from goal text alone', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('catch-shrimp', 'Catch shrimp with a small fishing net at a fishing spot.'),
            perception: perception('Inventory is empty. Nearby NPCs: Hans.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'fishing-starter',
                    status: 'missing_item',
                }),
            ]),
        );
    });

    it('injects AP/GP hierarchy + Library strategy knowledge for broad goal planning under low AP', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('earn-100-gp-hour', 'Find a way to make 100 gp/hour and write the strategy into the Library.'),
            perception: perception('Attention 6/100. Inventory has no rs:coins. Nearby: chicken, tree.'),
        });

        const knowledgeIds = context.knowledgeResults.map(result => result.entry.id);
        expect(knowledgeIds).toContain('economy-ap-gp-goal-hierarchy');
        const hierarchy = context.knowledgeResults.find(result => result.entry.id === 'economy-ap-gp-goal-hierarchy')?.entry;
        expect(hierarchy?.summary).toMatch(/library/i);
        expect(context.brainSection).toMatch(/attention points|ap/i);
    });

    it('uses structured inventory slots for firemaking action hints', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('make-fire', 'Make a fire with tinderbox and logs.'),
            perception: {
                tick: 1,
                resident: {
                    inventory: [
                        { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                        { itemId: 1511, key: 'rs:logs', amount: 1 },
                    ],
                },
                nearby: { objects: [] },
                events: [],
            } as any,
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'make-fire',
                    status: 'can_do_now',
                    nextActionHint: 'use_item_on_item itemSlot=0 targetSlot=1',
                }),
            ]),
        );
    });

    it('does not mark woodcutting actionable without an axe even when a tree action is visible', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('woodcutting', 'Chop a tree for logs.'),
            perception: {
                tick: 1,
                resident: { inventory: [] },
                nearby: {
                    objects: [{ objectId: 1276, position: { x: 3201, y: 3201, level: 0 } }],
                },
                availableActions: [
                    {
                        kind: 'interact',
                        target: { objectId: 1276, position: { x: 3201, y: 3201, level: 0 } },
                        options: ['chop down'],
                    },
                ],
                events: [],
            } as any,
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'train-woodcutting',
                    status: 'missing_item',
                }),
            ]),
        );
        expect(context.workflowAvailability).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ workflowId: 'train-woodcutting', status: 'can_do_now' })]),
        );
    });

    it('marks structured low-health combat unsafe even if a chicken is nearby', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('safe-combat', 'Fight a chicken and bury bones.'),
            perception: {
                tick: 1,
                resident: {
                    hp: { current: 2, max: 10 },
                    inventory: [],
                },
                nearby: {
                    npcs: [{ id: 'npc:1', kind: 'npc', key: 'rs:chicken', name: 'Chicken', position: { x: 3201, y: 3201, level: 0 } }],
                },
                events: [],
            } as any,
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'safe-combat',
                    status: 'unsafe',
                }),
            ]),
        );
        expect(context.workflowAvailability).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ workflowId: 'safe-combat', status: 'can_do_now' })]),
        );
    });

    it('marks carried bones as an immediately actionable prayer workflow', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('train-prayer', 'Bury bones to train Prayer.'),
            perception: {
                tick: 1,
                resident: {
                    inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }],
                },
                nearby: { npcs: [] },
                events: [],
            } as any,
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'train-prayer',
                    status: 'can_do_now',
                    nextActionHint: 'item_action slot=0 option=bury',
                }),
            ]),
        );
    });

    it('marks combat unsafe when health is low and no food is visible', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('safe-combat', 'Fight a chicken and bury bones.'),
            perception: perception('HP 2/10. No food. Nearby NPC: chicken.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'safe-combat',
                    status: 'unsafe',
                }),
            ]),
        );
        expect(context.bodySection).toContain('unsafe');
    });

    it('includes fishing starter context for small net and fishing spot', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('catch-shrimp', 'Catch shrimp with a small fishing net.'),
            perception: perception('Inventory: rs:small_fishing_net. Nearby NPC: fishing spot with net option.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'fishing-starter',
                    status: 'can_do_now',
                }),
            ]),
        );
        expect(context.bodySection).toContain('Skill: Fishing');
    });

    it('does not claim follow is actionable from goal text alone', () => {
        const service = new GameSkillService();

        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Follow Codex and stay visible.'),
            perception: perception('No players visible. No chat events.'),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'follow-codex',
                    status: 'missing_target',
                }),
            ]),
        );
        expect(context.workflowAvailability).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ workflowId: 'follow-codex', status: 'can_do_now' })]),
        );
    });

    it('turns failed action attempts into deduped review suggestions', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('make-fire', 'Make a fire with tinderbox and logs.'),
            perception: perception('Inventory: rs:tinderbox, rs:logs.'),
        });
        const event = {
            resident: 'res:agent',
            producer: 'body' as const,
            perception: perception('Inventory: rs:tinderbox, rs:logs.'),
            context,
            attempt: {
                attemptId: 'attempt-1',
                resident: 'res:agent',
                producer: 'body' as const,
                action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 },
                submittedAt: new Date(0).toISOString(),
                evidence: [],
                finalStatus: 'timeout' as const,
                finalReason: 'timeout',
            },
        };

        service.observeAttempt(event);
        service.observeAttempt(event);

        expect(append).toHaveBeenCalledTimes(1);
        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                resident: 'res:agent',
                workflowId: 'make-fire',
                evidence: expect.objectContaining({
                    attemptId: 'attempt-1',
                    outcome: 'blocked',
                    retrievedKnowledgeIds: expect.arrayContaining(['skill-firemaking-basic']),
                }),
            }),
        );
    });

    it('turns successful attempts with effect evidence into deduped review suggestions', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('make-fire', 'Make a fire with tinderbox and logs.'),
            perception: perception('Inventory: rs:tinderbox, rs:logs.'),
        });
        const event = {
            resident: 'res:agent',
            producer: 'body' as const,
            perception: perception('Inventory: rs:tinderbox. Nearby object: fire.'),
            context,
            attempt: {
                attemptId: 'attempt-success-1',
                resident: 'res:agent',
                producer: 'body' as const,
                action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 },
                submittedAt: new Date(0).toISOString(),
                evidence: [
                    { source: 'perception' as const, detail: { kind: 'action_effect_observed', changed: ['inventory', 'nearbyObjects'] } },
                ],
                finalStatus: 'success' as const,
            },
        };

        service.observeAttempt(event);
        service.observeAttempt(event);

        expect(append).toHaveBeenCalledTimes(1);
        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'make-fire',
                trust: 'runtime_observed',
                evidence: expect.objectContaining({
                    outcome: 'success',
                    attemptId: 'attempt-success-1',
                }),
            }),
        );
    });

    it('attributes bury-bones attempts to prayer even when woodcutting is also available', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = {
            tick: 1,
            resident: {
                inventory: [
                    { itemId: 526, key: 'rs:bones', amount: 1 },
                    { itemId: 1351, key: 'rs:bronze_axe', amount: 1 },
                ],
            },
            nearby: {
                objects: [{ objectId: 1278, name: 'Tree', position: { x: 3213, y: 3238, level: 0 } }],
                npcs: [{ id: 'npc:1', kind: 'npc', key: 'rs:chicken', name: 'Chicken', position: { x: 3214, y: 3238, level: 0 } }],
            },
            availableActions: [
                {
                    kind: 'interact',
                    target: { objectId: 1278, position: { x: 3213, y: 3238, level: 0 } },
                    options: ['chop down'],
                },
            ],
            events: [],
        } as any;
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('combat-prayer', 'Fight a chicken, bury bones, and chop nearby trees if useful.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-bury-bones',
                resident: 'res:agent',
                producer: 'body',
                action: { kind: 'item_action', slot: 0, option: 'bury', cause: 'combat_bury_looted_bones' },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'prayer_xp_changed' } }],
                finalStatus: 'success',
            },
        });

        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'train-prayer',
                proposedChange: expect.objectContaining({
                    targetId: 'train-prayer',
                }),
            }),
        );
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'train-woodcutting' }));
    });

    it('attributes combat movement attempts to safe combat when woodcutting is also available', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = combatAndWoodcuttingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('safe-combat', 'Train safe combat near trees.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-combat-move',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'move_to',
                    target: { x: 3214, y: 3238, level: 0 },
                    range: 2,
                    cause: 'combat_seek_safe_target',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'derived', detail: { kind: 'position_reached' } }],
                finalStatus: 'success',
            },
        });

        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'safe-combat',
                proposedChange: expect.objectContaining({
                    targetId: 'safe-combat',
                }),
            }),
        );
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'train-woodcutting' }));
    });

    it('attributes prayer-driven attack attempts to safe combat instead of prayer or woodcutting', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = combatAndWoodcuttingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('combat-prayer', 'Fight a chicken for bones, bury them, and chop nearby trees if useful.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-prayer-combat-attack',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'attack',
                    target: { id: 'npc:1', kind: 'npc', key: 'rs:chicken', name: 'Chicken', position: { x: 3214, y: 3238, level: 0 } },
                    cause: 'prayer_attack_safe_bone_source',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'hit_dealt' } }],
                finalStatus: 'success',
            },
        });

        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'safe-combat',
                proposedChange: expect.objectContaining({
                    targetId: 'safe-combat',
                }),
            }),
        );
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'train-prayer' }));
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'train-woodcutting' }));
    });

    it('attributes underscore follow causes to follow-codex when other workflows are visible', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = {
            tick: 1,
            resident: {
                inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
            },
            nearby: {
                objects: [{ objectId: 1278, name: 'Tree', position: { x: 3213, y: 3238, level: 0 } }],
                players: [{ id: 'player:Codex', kind: 'player', name: 'Codex', position: { x: 3215, y: 3238, level: 0 } }],
            },
            availableActions: [
                {
                    kind: 'interact',
                    target: { objectId: 1278, position: { x: 3213, y: 3238, level: 0 } },
                    options: ['chop down'],
                },
            ],
            events: [],
        } as any;
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Follow Codex while trees are nearby.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-follow-codex',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'move_to',
                    target: { x: 3215, y: 3238, level: 0 },
                    range: 2,
                    cause: 'direct_chat_follow',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'derived', detail: { kind: 'position_reached' } }],
                finalStatus: 'success',
            },
        });

        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'follow-codex',
                proposedChange: expect.objectContaining({
                    targetId: 'follow-codex',
                }),
            }),
        );
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'train-woodcutting' }));
    });

    it('adds trade-request availability when a nearby player asks to trade', () => {
        const service = new GameSkillService();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Stay near Codex and respond to direct commands.'),
            perception: tradeAndFiremakingPerception(),
        });

        expect(context.workflowAvailability).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    workflowId: 'trade-request',
                    status: 'can_do_now',
                }),
            ]),
        );
        expect(context.bodySection).toContain('trade-request [can_do_now]');
        expect(context.bodySection).toContain('trade_request');
    });

    it('attributes trade attempts to trade-request when firemaking is also available', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Stay near Codex and respond to direct commands.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-trade-request',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'trade_request',
                    target: { id: 'resident:codex', kind: 'resident', name: 'Codex', position: { x: 3215, y: 3238, level: 0 } },
                    cause: 'direct_chat_trade',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'trade_requested' } }],
                finalStatus: 'success',
            },
        });

        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'trade-request',
                proposedChange: expect.objectContaining({
                    targetId: 'trade-request',
                }),
            }),
        );
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'make-fire' }));
    });

    it('does not turn successful speech-only attempts into workflow hints', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('train-woodcutting', 'Chop a tree and report progress.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-status-say-noise',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'say',
                    text: 'I am online and gathering logs.',
                    cause: 'presence_beacon',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'chat_observed' } }],
                finalStatus: 'success',
            },
        });

        expect(append).not.toHaveBeenCalled();
    });

    it('does not fallback generic movement, noop, or logout attempts to the first visible workflow', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('scout-nearby-area', 'Scout nearby landmarks.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-generic-move-noise',
                resident: 'res:agent',
                producer: 'body',
                action: { kind: 'move_to', target: { x: 3215, y: 3235, level: 0 }, cause: 'explore_patrol' },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'perception', detail: { kind: 'position_reached' } }],
                finalStatus: 'success',
            },
        });
        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-generic-move-timeout-noise',
                resident: 'res:agent',
                producer: 'body',
                action: { kind: 'move_to', target: { x: 3215, y: 3225, level: 0 }, cause: 'explore_patrol' },
                submittedAt: new Date(0).toISOString(),
                evidence: [],
                finalStatus: 'timeout',
                finalReason: 'timeout',
            },
        });
        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-noop-noise',
                resident: 'res:agent',
                producer: 'body',
                action: { kind: 'noop', cause: 'body_wait' },
                submittedAt: new Date(0).toISOString(),
                evidence: [],
                finalStatus: 'success',
            },
        });
        service.observeAttempt({
            resident: 'res:agent',
            producer: 'nervous-system',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-logout-noise',
                resident: 'res:agent',
                producer: 'nervous-system',
                action: { kind: 'logout', cause: 'attention_exhausted' },
                submittedAt: new Date(0).toISOString(),
                evidence: [],
                finalStatus: 'failure',
                finalReason: 'session_closed',
            },
        });

        expect(append).not.toHaveBeenCalled();
    });

    it('still attributes woodcutting chop attempts after removing generic workflow fallback', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = combatAndWoodcuttingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('train-woodcutting', 'Chop a tree for logs.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-woodcutting-chop',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'interact',
                    target: { objectId: 1278, position: { x: 3213, y: 3238, level: 0 }, orientation: 1 },
                    option: 'chop down',
                    cause: 'woodcutting_level1_routine',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'perception', detail: { kind: 'action_effect_observed', changed: ['skills', 'inventory'] } }],
                finalStatus: 'success',
            },
        });

        expect(append).toHaveBeenCalledWith(
            expect.objectContaining({
                workflowId: 'train-woodcutting',
                proposedChange: expect.objectContaining({
                    targetId: 'train-woodcutting',
                }),
            }),
        );
        expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'make-fire' }));
    });

    it('does not turn follow status speech into workflow hints', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Follow Codex and report what I am doing.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-follow-say',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'say',
                    text: 'I will follow res:bmk_codex_005yen67 at 3225,3230.',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'chat_observed' } }],
                finalStatus: 'success',
            },
        });

        expect(append).not.toHaveBeenCalled();
    });

    it('does not turn direct help speech into workflow hints', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Follow Codex and answer direct commands.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-help-say',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'say',
                    text: 'Try: follow me, status, look around, inventory, make fire, fish, cook, fight safely, bury bones, trade me, offer logs, wait, stop.',
                    cause: 'direct_chat_help',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'chat_observed' } }],
                finalStatus: 'success',
            },
        });

        expect(append).not.toHaveBeenCalled();
    });

    it('does not turn direct wait speech into workflow hints', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('follow-codex', 'Follow Codex and wait for direct commands.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-wait-say',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'say',
                    text: 'I will pause here and wait for a new goal.',
                    cause: 'direct_chat_stop',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'chat_observed' } }],
                finalStatus: 'success',
            },
        });

        expect(append).not.toHaveBeenCalled();
    });

    it('does not turn woodcutting status speech into workflow hints', () => {
        const append = jest.fn();
        const service = new GameSkillService({
            controllerId: 'controller-1',
            instanceId: 'instance-1',
            suggestionStore: { append },
        });
        const mixedPerception = tradeAndFiremakingPerception();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            activeGoal: goal('train-woodcutting', 'Chop a tree for logs.'),
            perception: mixedPerception,
        });

        service.observeAttempt({
            resident: 'res:agent',
            producer: 'body',
            perception: mixedPerception,
            context,
            attempt: {
                attemptId: 'attempt-woodcutting-say',
                resident: 'res:agent',
                producer: 'body',
                action: {
                    kind: 'say',
                    text: 'Chopping a tree for logs. Steady progress.',
                },
                submittedAt: new Date(0).toISOString(),
                evidence: [{ source: 'event', detail: { kind: 'chat_observed' } }],
                finalStatus: 'success',
            },
        });

        expect(append).not.toHaveBeenCalled();
    });

    // E22 / HD-034 regression: knowledge retrieval recall was raised
    // (limit 5→8, minScore 4→2) because E21 measured only 2/52 (3.8%)
    // of res:agent's recent says reference any knowledge entry despite
    // the substrate wiring being intact. The wider recall admits more
    // entries when the brain prompt has token budget, prioritized by
    // the existing perception (1.5x) and goal (3x) score boosts.
    it('returns more than the legacy 5-entry cap when many low-score matches are eligible (HD-034)', () => {
        const service = new GameSkillService();
        const context = service.buildContext({
            resident: 'res:agent',
            tick: 10,
            // Goal text mentions many distinct knowledge topics so that
            // multiple lower-score (but still ≥2) entries become eligible.
            // Pre-fix behavior would clamp at 5 results; post-fix should
            // be able to return up to 8.
            activeGoal: goal(
                'broad-survey',
                'Survey woodcutting trees, firemaking tinderbox, cooking shrimp, fishing net, smithing copper, mining ore, magic runes, ranged bows, prayer bones, quests cook assistant and sheep shearer, places lumbridge varrock falador, NPCs hans bob, monsters chicken goblin cow.',
            ),
            perception: perception('Inventory: rs:tinderbox, rs:logs. Nearby Tree, Chicken.'),
        });

        // The context should include MORE than the legacy 5-entry cap.
        // We deliberately don't pin an exact number because retrieval
        // depends on scoring math; we just guard the regression direction.
        expect(context.knowledgeResults.length).toBeGreaterThan(5);
        expect(context.knowledgeResults.length).toBeLessThanOrEqual(8);
    });
});

function goal(id: string, description: string) {
    return { id, description, createdAtTick: 1 };
}

function perception(compressed: string) {
    return { tick: 1, compressed } as any;
}

function combatAndWoodcuttingPerception() {
    return {
        tick: 1,
        resident: {
            inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
        },
        nearby: {
            objects: [{ objectId: 1278, name: 'Tree', position: { x: 3213, y: 3238, level: 0 } }],
            npcs: [{ id: 'npc:1', kind: 'npc', key: 'rs:chicken', name: 'Chicken', position: { x: 3214, y: 3238, level: 0 } }],
        },
        availableActions: [
            {
                kind: 'interact',
                target: { objectId: 1278, position: { x: 3213, y: 3238, level: 0 } },
                options: ['chop down'],
            },
        ],
        events: [],
    } as any;
}

function tradeAndFiremakingPerception() {
    return {
        tick: 1,
        resident: {
            inventory: [
                { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                { itemId: 1511, key: 'rs:logs', amount: 2 },
            ],
            hp: { current: 10, max: 10 },
        },
        nearby: {
            players: [{ id: 'resident:codex', kind: 'resident', name: 'Codex', position: { x: 3215, y: 3238, level: 0 } }],
        },
        availableActions: [
            {
                kind: 'trade_request',
                targets: [{ id: 'resident:codex', kind: 'resident', name: 'Codex', position: { x: 3215, y: 3238, level: 0 } }],
            },
        ],
        events: [
            {
                kind: 'chat',
                from: { id: 'resident:codex', kind: 'resident', name: 'Codex', position: { x: 3215, y: 3238, level: 0 } },
                text: 'agent trade me',
                to: 'public',
            },
        ],
    } as any;
}

// ---------------------------------------------------------------------------
// RIQ-1-1-C: GameSkillContext.wikiSearch presence
// ---------------------------------------------------------------------------

describe('GameSkillContext.wikiSearch — RIQ-1-1-C', () => {
    const simplePerception = () => ({ tick: 1, resident: { inventory: [], hp: { current: 10, max: 10 } }, nearby: {}, events: [] }) as any;

    it('wikiSearch is undefined when no wiki dir is configured (engine-only mode)', () => {
        const service = new GameSkillService(); // no entries override → ENGINE_KNOWLEDGE_ENTRIES only
        const ctx = service.buildContext({
            resident: 'res:agent',
            tick: 1,
            perception: simplePerception(),
        });
        expect(ctx.wikiSearch).toBeUndefined();
    });

    it('wikiSearch is a function when wiki entries are loaded', () => {
        const wikiDir = path.resolve(process.cwd(), 'docs/runescape-skill');
        const entries = createDefaultGameSkillEntries(wikiDir);
        const service = new GameSkillService({ entries });
        const ctx = service.buildContext({
            resident: 'res:agent',
            tick: 1,
            perception: simplePerception(),
        });
        expect(typeof ctx.wikiSearch).toBe('function');
    });

    it('wikiSearch returns a non-empty string for a wiki-relevant query', () => {
        const wikiDir = path.resolve(process.cwd(), 'docs/runescape-skill');
        const entries = createDefaultGameSkillEntries(wikiDir);
        const service = new GameSkillService({ entries });
        const ctx = service.buildContext({
            resident: 'res:agent',
            tick: 1,
            perception: simplePerception(),
        });
        const result = ctx.wikiSearch!('goblins lumbridge monsters');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('wikiSearch returns a not-found message for an unmatched query', () => {
        const wikiDir = path.resolve(process.cwd(), 'docs/runescape-skill');
        const entries = createDefaultGameSkillEntries(wikiDir);
        const service = new GameSkillService({ entries });
        const ctx = service.buildContext({
            resident: 'res:agent',
            tick: 1,
            perception: simplePerception(),
        });
        const result = ctx.wikiSearch!('xyzzy nonexistent 99999');
        expect(result).toContain('No wiki pages matched');
    });
});
