import { canLight } from './chance';

describe('canLight', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('fails when the player is below the log level', () => {
        expect(canLight(15, 14)).toBe(false);
    });

    it('passes when the player roll beats the log roll', () => {
        jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1);

        expect(canLight(1, 99)).toBe(true);
    });
});
