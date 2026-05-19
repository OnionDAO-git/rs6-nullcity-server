import { randomBetween } from '@engine/util/num';
import { rollBirdsNestType } from '@engine/world/skill-util/harvest-roll';

jest.mock('@engine/config/config-handler', () => ({
    findItem: jest.fn(),
}));

jest.mock('@engine/util/num', () => ({
    randomBetween: jest.fn(),
}));

describe('rollBirdsNestType', () => {
    const randomBetweenMock = randomBetween as jest.Mock;

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('can roll bird egg nests', () => {
        randomBetweenMock.mockReturnValue(0);

        expect(rollBirdsNestType()).toEqual({ itemId: 5076, amount: 1 });
    });

    it('can roll ring nests', () => {
        randomBetweenMock.mockReturnValue(4);

        expect(rollBirdsNestType()).toEqual({ itemId: 5074, amount: 1 });
    });

    it('can roll seed nests', () => {
        randomBetweenMock.mockReturnValue(35);

        expect(rollBirdsNestType()).toEqual({ itemId: 5070, amount: 1 });
    });
});
