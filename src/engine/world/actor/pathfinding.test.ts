jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

jest.mock('@engine/world', () => ({
    activeWorld: {
        chunkManager: {
            getTile: jest.fn(),
            getChunkForWorldPosition: jest.fn(),
        },
    },
}));

import { Position } from '../position';
import { Pathfinding } from './pathfinding';

describe('Pathfinding.walkTo', () => {
    it('treats the positive search boundary as out of range instead of dereferencing an undefined point', () => {
        const pathfinding = new Pathfinding({
            position: new Position(0, 0, 0),
            walkingQueue: { clear: jest.fn(), add: jest.fn() },
        } as any);

        jest.spyOn(pathfinding as any, 'canPathNSEW').mockReturnValue(true);
        jest.spyOn(pathfinding as any, 'canPathDiagonally').mockReturnValue(true);

        expect(() => pathfinding.pathTo(2, 0, 2)).toThrow('Out of range.');
    });

    it('walks to an adjacent tile when ignoreDestination is set and the target tile itself is unreachable', () => {
        const walkingQueue = {
            valid: false,
            clear: jest.fn(),
            add: jest.fn(),
        };
        const pathfinding = new Pathfinding({
            position: new Position(0, 0, 0),
            walkingQueue,
        } as any);
        const directPath = jest.spyOn(pathfinding, 'pathTo').mockImplementation((x, y) => {
            if (x === 3 && y === 0) {
                return null;
            }
            if (x === 2 && y === 0) {
                return [
                    { x: 1, y: 0 },
                    { x: 2, y: 0 },
                ] as any;
            }
            return null;
        });

        pathfinding.walkTo(new Position(3, 0, 0), { pathingSearchRadius: 64, ignoreDestination: true });

        expect(directPath).toHaveBeenCalledWith(3, 0, 64);
        expect(directPath).toHaveBeenCalledWith(2, 0, 64);
        expect(walkingQueue.clear).toHaveBeenCalledTimes(1);
        expect(walkingQueue.valid).toBe(true);
        expect(walkingQueue.add).toHaveBeenNthCalledWith(1, 1, 0);
        expect(walkingQueue.add).toHaveBeenNthCalledWith(2, 2, 0);
    });

    it('trims the final destination tile when direct ignoreDestination pathing succeeds', () => {
        const walkingQueue = {
            valid: false,
            clear: jest.fn(),
            add: jest.fn(),
        };
        const pathfinding = new Pathfinding({
            position: new Position(0, 0, 0),
            walkingQueue,
        } as any);
        jest.spyOn(pathfinding, 'pathTo').mockReturnValue([
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
        ] as any);

        pathfinding.walkTo(new Position(3, 0, 0), { pathingSearchRadius: 64, ignoreDestination: true });

        expect(walkingQueue.add).toHaveBeenNthCalledWith(1, 1, 0);
        expect(walkingQueue.add).toHaveBeenNthCalledWith(2, 2, 0);
        expect(walkingQueue.add).toHaveBeenCalledTimes(2);
    });
});
