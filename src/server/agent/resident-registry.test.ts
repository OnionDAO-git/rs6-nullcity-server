import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Resident } from '@engine/world/actor/resident/resident';
import { ResidentRegistry, isValidResidentName, normalizeResidentName } from './resident-registry';

jest.mock('chokidar', () => ({
    watch: jest.fn(),
}));

describe('ResidentRegistry', () => {
    let saveDir: string;
    let playerSaveDir: string;

    beforeEach(() => {
        saveDir = mkdtempSync(join(tmpdir(), 'nullcity-residents-'));
        playerSaveDir = mkdtempSync(join(tmpdir(), 'nullcity-player-saves-'));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        rmSync(saveDir, { recursive: true, force: true });
        rmSync(playerSaveDir, { recursive: true, force: true });
    });

    it('normalizes and validates only strict resident names', () => {
        expect(normalizeResidentName('res:test_bot')).toBe('res:test_bot');
        expect(isValidResidentName('res:test_bot')).toBe(true);
        expect(isValidResidentName('Res:test_bot')).toBe(false);
        expect(isValidResidentName('player')).toBe(false);
        expect(isValidResidentName('res:')).toBe(false);
        expect(isValidResidentName('res:test bot')).toBe(false);
        expect(isValidResidentName('res:test-bot')).toBe(false);
        expect(isValidResidentName('res:test/bot')).toBe(false);
        expect(isValidResidentName(`res:${'a'.repeat(21)}`)).toBe(false);
    });

    it('rejects create names that are missing the reserved prefix or are not normalized', () => {
        jest.spyOn(Resident.prototype, 'save').mockReturnValue(true);
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.create('test_bot')).toThrow('EBAD_NAME');
        expect(() => registry.create('Res:test_bot')).toThrow('EBAD_NAME');
        expect(() => registry.create('res:test bot')).toThrow('EBAD_NAME');
    });

    it('rejects resident creation when a real player save already owns the reserved name', () => {
        jest.spyOn(Resident.prototype, 'save').mockReturnValue(true);
        writeFileSync(join(playerSaveDir, 'res:taken.json'), '{}');

        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.create('res:taken')).toThrow('ERESERVED_NAME');
    });

    it('ignores non-resident files when listing resident saves', () => {
        writeFileSync(join(saveDir, 'res:valid.json'), '{}');
        writeFileSync(join(saveDir, 'player.json'), '{}');
        writeFileSync(join(saveDir, 'res:bad name.json'), '{}');

        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(registry.list()).toEqual([{ name: 'res:valid', online: false, controllerId: undefined, controlHeld: false }]);
    });

    it('does not connect residents with malformed save data', async () => {
        const savePath = join(saveDir, 'res:corrupt.json');
        writeFileSync(savePath, '{');

        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        await expect(registry.connect('res:corrupt', 'controller:test')).rejects.toThrow('ESAVE_CORRUPT');
        expect(existsSync(savePath)).toBe(false);
        expect(existsSync(`${savePath}.bak`)).toBe(true);
    });
});
