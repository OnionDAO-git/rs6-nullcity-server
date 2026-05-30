jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

import { Position } from '@engine/world/position';
import { CombatTask } from './combat-task';
import type { CombatStrategy } from './combat-strategy';

describe('CombatTask', () => {
    it('uses a pathing radius large enough for tracked-but-out-of-range defenders', () => {
        const attacker = actorAt(0, 0);
        const defender = actorAt(8, 0);
        const strategy: CombatStrategy = {
            kind: 'melee',
            attackRange: 1,
            attackSpeedTicks: 4,
            canActivate: jest.fn(() => ({ ok: true })),
            consumeResources: jest.fn(() => true),
            play: jest.fn(() => ({ hitDelay: 0 })),
            rollHit: jest.fn(() => ({ damage: 0, type: 'no_damage' as any })),
            xpAwards: jest.fn(() => []),
        };

        new CombatTask(attacker as any, defender as any, strategy).execute();

        expect(attacker.pathfinding.walkTo).toHaveBeenCalledWith(defender.position, {
            pathingSearchRadius: 10,
            ignoreDestination: true,
        });
        expect(strategy.canActivate).not.toHaveBeenCalled();
    });
});

function actorAt(x: number, y: number): Record<string, any> {
    return {
        active: true,
        position: new Position(x, y, 0),
        metadata: {},
        skills: {
            hitpoints: { level: 10 },
        },
        pathfinding: {
            walkTo: jest.fn(),
        },
        walkingQueue: {
            clear: jest.fn(),
        },
        actionsCancelled: {
            pipe: jest.fn(() => ({
                subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
            })),
        },
        face: jest.fn(),
        applyHit: jest.fn(),
    };
}
