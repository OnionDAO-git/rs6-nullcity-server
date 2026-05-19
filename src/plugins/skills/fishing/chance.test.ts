import { canCatchFish } from './chance';

describe('canCatchFish', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('fails when the player is below the catch level', () => {
        expect(canCatchFish(255, 20, 19)).toBe(false);
    });

    it('passes when the roll is inside the method and level chance', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0);

        expect(canCatchFish(10, 1, 1)).toBe(true);
    });

    it('fails when the roll exceeds the method and level chance', () => {
        jest.spyOn(Math, 'random').mockReturnValue(1);

        expect(canCatchFish(10, 1, 1)).toBe(false);
    });
});
