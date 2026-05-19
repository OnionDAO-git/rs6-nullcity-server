import { clearSlayerAssignment, decrementSlayerAssignment, getSlayerAssignment, setSlayerAssignment } from './slayer-state';

describe('slayer state', () => {
    it('stores assignment state in saved metadata', () => {
        const player = { savedMetadata: {} } as any;
        setSlayerAssignment(player, { group: 'goblins', displayName: 'goblins', remaining: 2 });

        expect(getSlayerAssignment(player)?.remaining).toBe(2);
        decrementSlayerAssignment(player);
        expect(getSlayerAssignment(player)?.remaining).toBe(1);
        decrementSlayerAssignment(player);
        expect(getSlayerAssignment(player)).toBeUndefined();
    });

    it('can clear assignment state', () => {
        const player = { savedMetadata: {} } as any;
        setSlayerAssignment(player, { group: 'men', displayName: 'men', remaining: 1 });
        clearSlayerAssignment(player);

        expect(getSlayerAssignment(player)).toBeUndefined();
    });
});
