import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Player } from './player';
import { type ResidentSave, defaultAppearance, defaultSettings, loadPlayerSave, savePlayerData } from './player-data';

describe('player save data', () => {
    let saveDir: string;

    beforeEach(() => {
        saveDir = mkdtempSync(join(tmpdir(), 'nullcity-saves-'));
    });

    afterEach(() => {
        rmSync(saveDir, { recursive: true, force: true });
    });

    it('persists resident agent metadata as an optional save extension', () => {
        const player = {
            username: 'res:pip',
            passwordHash: '',
            position: { x: 3200, y: 3201, level: 0 },
            loginDate: new Date('2026-01-01T00:00:00.000Z'),
            lastAddress: '127.0.0.1',
            rights: 0,
            appearance: defaultAppearance(),
            inventory: { items: [] },
            bank: { items: [] },
            equipment: { items: [] },
            skills: { values: [] },
            settings: defaultSettings(),
            savedMetadata: { tutorialComplete: true },
            quests: [],
            musicTracks: [],
            achievements: [],
            friendsList: [],
            ignoreList: [],
            agentMetadata: {
                createdAt: '2026-01-01T00:00:00.000Z',
                lastControllerId: 'controller:test',
            },
        } as unknown as Player;

        expect(savePlayerData(player, { saveDir })).toBe(true);

        const save = loadPlayerSave('res:pip', { saveDir }) as ResidentSave;
        expect(save.savedMetadata.tutorialComplete).toBe(true);
        expect(save.agentMetadata).toEqual({
            createdAt: '2026-01-01T00:00:00.000Z',
            lastControllerId: 'controller:test',
        });
    });

    it('loads legacy player saves without resident agent metadata', () => {
        writeFileSync(
            join(saveDir, 'legacy.json'),
            JSON.stringify({
                username: 'legacy',
                passwordHash: '',
                rights: 0,
                position: { x: 3200, y: 3201, level: 0 },
                lastLogin: { date: '2026-01-01T00:00:00.000Z', address: '127.0.0.1' },
                appearance: defaultAppearance(),
                inventory: [],
                bank: [],
                equipment: [],
                skills: [],
                settings: defaultSettings(),
                savedMetadata: {},
                questList: [],
                musicTracks: [],
                achievements: [],
                friendsList: [],
                ignoreList: [],
            }),
        );

        const save = loadPlayerSave('legacy', { saveDir });
        expect(save).not.toBeNull();
        expect((save as Partial<ResidentSave>).agentMetadata).toBeUndefined();
    });

    it('returns null for malformed save json', () => {
        const savePath = join(saveDir, 'corrupt.json');
        writeFileSync(savePath, '{');

        expect(loadPlayerSave('corrupt', { saveDir })).toBeNull();
        expect(existsSync(savePath)).toBe(false);
        expect(existsSync(`${savePath}.bak`)).toBe(true);
    });
});
