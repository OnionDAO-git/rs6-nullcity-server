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
});

function goal(id: string, description: string) {
    return { id, description, createdAtTick: 1 };
}

function perception(compressed: string) {
    return { tick: 1, compressed } as any;
}
