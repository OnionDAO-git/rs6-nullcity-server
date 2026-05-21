import { GameSkillService } from './game-skill-context';

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
        expect(context.bodySection).toContain('Skill: Firemaking');
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
