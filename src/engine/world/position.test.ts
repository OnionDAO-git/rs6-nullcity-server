jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            objectStore: {
                getObject: jest.fn(),
            },
        },
    },
}));

import { Position } from './position';

const { filestore } = jest.requireMock('@server/game/game-server') as {
    filestore: { configStore: { objectStore: { getObject: jest.Mock } } };
};

describe('Position.withinInteractionDistance', () => {
    beforeEach(() => {
        filestore.configStore.objectStore.getObject.mockReset();
        filestore.configStore.objectStore.getObject.mockReturnValue({
            gameId: 1,
            name: 'Range',
            solid: true,
            options: [],
            configChangeDest: undefined,
            rendering: {
                modelSizeX: 1,
                modelSizeY: 1,
            },
        });
    });

    it('treats diagonal tile adjacency as within one interaction tile', () => {
        expect(new Position(3240, 3243, 0).withinInteractionDistance(new Position(3241, 3242, 0), 1)).toBe(true);
    });

    it('treats diagonal object adjacency as within one interaction tile', () => {
        const object = { objectId: 1, x: 3241, y: 3242, level: 0, type: 10, orientation: 0 };

        expect(new Position(3240, 3243, 0).withinInteractionDistance(object, 1)).toBe(true);
    });
});
