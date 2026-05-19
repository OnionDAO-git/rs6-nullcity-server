import { getPatchState, patchKey, setPatchState } from './farming-state';

describe('farming state', () => {
    it('stores patch state in player saved metadata', () => {
        const player = { savedMetadata: {} } as any;
        const key = patchKey({ x: 1, y: 2, level: 0 });

        expect(getPatchState(player, key).status).toBe('weeds');
        setPatchState(player, key, { status: 'empty' });
        expect(getPatchState(player, key).status).toBe('empty');
    });
});
