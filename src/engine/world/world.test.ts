import type { Player } from '@engine/world/actor/player/player';

jest.mock('chokidar', () => ({
    watch: jest.fn(),
}));

describe('World player slots', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('reuses player slots after repeated deregistration', () => {
        const { World } = require('@engine/world/world') as typeof import('@engine/world/world');
        const world = new World();

        for (let i = 0; i < 1000; i++) {
            const player = {
                worldIndex: -1,
                username: `resident_${i}`,
                equals(other: Player) {
                    return other === this;
                },
            } as unknown as Player;

            expect(world.registerPlayer(player)).toBe(true);
            expect(player.worldIndex).toBe(0);

            world.deregisterPlayer(player);
            expect(world.playerList[0]).toBeNull();
        }
    });

    it('uses player logout during shutdown so active players save through their logout path', () => {
        const { World } = require('@engine/world/world') as typeof import('@engine/world/world');
        const world = new World();
        let logoutCalls = 0;

        const player = {
            worldIndex: -1,
            username: 'res:persist',
            logout() {
                logoutCalls++;
            },
            equals(other: Player) {
                return other === this;
            },
        } as unknown as Player;

        expect(world.registerPlayer(player)).toBe(true);

        world.kickAllPlayers();

        expect(logoutCalls).toBe(1);
    });
});
