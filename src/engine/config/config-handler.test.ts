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

describe('item configuration', () => {
    const { loadItemConfigurations } = require('@engine/config/item-config');

    it('registers burnt shrimp so residents can drop failed starter-cooking output', async () => {
        const config = await loadItemConfigurations('data/config/items/');

        expect(config.itemIds[7954]).toBe('rs:burnt_shrimp');
        expect(config.items['rs:burnt_shrimp']).toMatchObject({ gameId: 7954 });
    });

    it('registers ashes so firemaking residue does not flood the game log', async () => {
        const config = await loadItemConfigurations('data/config/items/');

        expect(config.itemIds[592]).toBe('rs:ashes');
        expect(config.items['rs:ashes']).toMatchObject({ gameId: 592 });
    });

    it("registers Cook's Assistant ingredients used by resident quest benchmarks", async () => {
        const config = await loadItemConfigurations('data/config/items/');

        expect(config.itemIds[1927]).toBe('rs:bucket_of_milk');
        expect(config.itemIds[1933]).toBe('rs:pot_of_flour');
        expect(config.itemIds[1944]).toBe('rs:egg');
    });
});
