jest.mock('@server/game/game-server', () => ({
    filestore: {
        configStore: {
            npcStore: {
                getNpc: jest.fn((id: number) => ({ id, gameId: id, name: 'Cache NPC' })),
            },
        },
    },
}));

describe('findNpc', () => {
    const configHandler = require('@engine/config/config-handler');

    beforeEach(() => {
        configHandler.npcIdMap = { 494: 'rs:banker' };
        configHandler.npcMap = {
            'rs:banker': { key: 'rs:banker', gameId: 494, name: 'Banker' },
        };
        configHandler.npcPresetMap = {};
    });

    it('resolves configured NPCs by numeric game id', () => {
        expect(configHandler.findNpc(494)).toMatchObject({
            key: 'rs:banker',
            gameId: 494,
            name: 'Banker',
        });
    });

    it('resolves configured NPCs by numeric string game id', () => {
        expect(configHandler.findNpc('494')).toMatchObject({
            key: 'rs:banker',
            gameId: 494,
            name: 'Banker',
        });
    });
});
