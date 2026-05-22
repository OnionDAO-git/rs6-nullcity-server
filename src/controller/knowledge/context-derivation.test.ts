import { derivePerceptionContext, deriveGoalContext } from './context-derivation';

describe('Context Derivation', () => {
    describe('derivePerceptionContext', () => {
        it('handles null or undefined perception gracefully', () => {
            expect(derivePerceptionContext(null)).toEqual({
                nearbyNpcKeys: [],
                nearbyObjectKeys: [],
                currentRegion: undefined,
                recentActionKinds: [],
            });
        });

        it('derives context from compressed string perception', () => {
            const perception = {
                compressed: 'Nearby NPC: Chicken. Object: Tree. Position: Lumbridge.',
            };
            const context = derivePerceptionContext(perception);
            expect(context.nearbyNpcKeys).toContain('rs:chicken');
            expect(context.nearbyObjectKeys).toContain('tree');
            expect(context.currentRegion).toBe('lumbridge');
        });

        it('derives context from structured perception', () => {
            const perception = {
                nearby: {
                    npcs: [
                        { key: 'rs:chicken', name: 'Chicken' },
                        { name: 'Cow' },
                    ],
                    objects: [
                        { key: 'tree', objectId: 1276 },
                        { objectId: 590 },
                    ],
                },
                tile: { region: 'lumbridge' },
                recentActions: [
                    { kind: 'use_item_on_item' },
                    'attack',
                ],
            };
            const context = derivePerceptionContext(perception);
            expect(context.nearbyNpcKeys).toEqual(['rs:chicken', 'cow']);
            expect(context.nearbyObjectKeys).toEqual(['tree', '1276', '590']);
            expect(context.currentRegion).toBe('lumbridge');
            expect(context.recentActionKinds).toEqual(['use_item_on_item', 'attack']);
        });
    });

    describe('deriveGoalContext', () => {
        it('handles null or undefined goal gracefully', () => {
            expect(deriveGoalContext(null)).toEqual({});
        });

        it('derives goal context from structured goal fields', () => {
            const goal = {
                id: 'train-woodcutting',
                description: 'Chop trees in Lumbridge using an axe.',
                steps: ['walk to tree', 'chop tree'],
            };
            const context = deriveGoalContext(goal);
            expect(context.targetSkill).toBe('woodcutting');
            expect(context.targetItem).toBe('rs:axe');
            expect(context.targetPlace).toBe('lumbridge');
        });

        it('identifies explicit item keywords', () => {
            const goal = {
                id: 'make-fire',
                description: 'Light a campfire with rs:logs and rs:tinderbox',
            };
            const context = deriveGoalContext(goal);
            expect(context.targetItem).toBe('rs:logs');
        });
    });
});
