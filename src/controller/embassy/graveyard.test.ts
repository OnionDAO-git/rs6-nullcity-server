import fs from 'fs';
import path from 'path';
import os from 'os';
import { getTombstoneAt, refreshGraveyard, resetGraveyard, GRAVEYARD_SPOTS } from './graveyard';
import { loadControllerConfig } from '../config';
import { activeWorld } from '@engine/world';

jest.mock('../config', () => ({
    loadControllerConfig: jest.fn(),
}));

jest.mock('@engine/world', () => ({
    activeWorld: {
        globalInstance: {
            spawnGameObject: jest.fn(),
            despawnGameObject: jest.fn(),
        },
    },
}));

describe('Graveyard Substrate & Allocator (Workstream N3)', () => {
    let tempDir: string;
    let libraryDir: string;
    let soulsDir: string;

    beforeEach(() => {
        jest.clearAllMocks();
        resetGraveyard();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs6-graveyard-test-'));
        libraryDir = path.join(tempDir, 'library');
        soulsDir = path.join(tempDir, 'souls');
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.mkdirSync(soulsDir, { recursive: true });

        (loadControllerConfig as jest.Mock).mockReturnValue({
            memory: { dir: tempDir },
            souls: { dir: soulsDir, discoverResidents: true },
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function writeDeceasedResident(slug: string, name: string, updatedAt: string, lives: number, cause: string, factionAffinity: any = {}) {
        const resDir = path.join(libraryDir, slug);
        fs.mkdirSync(resDir, { recursive: true });

        fs.writeFileSync(
            path.join(resDir, 'index.json'),
            JSON.stringify({
                resident: name,
                currentState: 'ended',
                updatedAt,
                createdAt: updatedAt,
                lives,
            }),
        );

        fs.writeFileSync(
            path.join(resDir, 'portrait.json'),
            JSON.stringify({
                schemaVersion: 1,
                residentName: name,
                epithet: 'The quiet life',
                lives: [
                    {
                        index: lives,
                        epithet: 'The quiet life',
                        bornTick: 0,
                        durationTicks: 12000,
                        deathCause: cause,
                    },
                ],
            }),
        );

        // Write soul markdown file
        const soulName = name.replace(/^res:/, '');
        fs.writeFileSync(
            path.join(soulsDir, `${soulName}.md`),
            `---
name: ${name}
archetype: mentor
factionAffinity:
  saradomin: ${factionAffinity.saradomin || 0}
  guthix: ${factionAffinity.guthix || 0}
  zamorak: ${factionAffinity.zamorak || 0}
---
`,
        );
    }

    it('spawns tombstones deterministically sorted by updatedAt ascending', () => {
        // res:hans died at 10:00
        writeDeceasedResident('res-hans', 'res:hans', '2026-05-25T10:00:00.000Z', 1, 'attention exhaustion', { saradomin: 100 });
        // res:pip died at 09:00
        writeDeceasedResident('res-pip', 'res:pip', '2026-05-25T09:00:00.000Z', 2, 'combat death', { zamorak: 100 });
        // res:thrand died at 11:00
        writeDeceasedResident('res-thrand', 'res:thrand', '2026-05-25T11:00:00.000Z', 1, 'old age');

        refreshGraveyard();

        // Check if spawnGameObject was called 3 times
        expect(activeWorld.globalInstance.spawnGameObject).toHaveBeenCalledTimes(3);

        // Earliest death should be res:pip (09:00) -> first spot
        const pipSpot = GRAVEYARD_SPOTS[0];
        const pipTombstone = getTombstoneAt(pipSpot.x, pipSpot.y);
        expect(pipTombstone).not.toBeNull();
        expect(pipTombstone?.resident).toBe('res:pip');
        expect(pipTombstone?.name).toBe('res:pip'); // display fallback if display not set
        expect(pipTombstone?.faction).toBe('Zamorak');
        expect(pipTombstone?.cause).toBe('combat death');

        // Second death should be res:hans (10:00) -> second spot
        const hansSpot = GRAVEYARD_SPOTS[1];
        const hansTombstone = getTombstoneAt(hansSpot.x, hansSpot.y);
        expect(hansTombstone?.resident).toBe('res:hans');
        expect(hansTombstone?.faction).toBe('Saradomin');
        expect(hansTombstone?.cause).toBe('attention exhaustion');

        // Third death should be res:thrand (11:00) -> third spot
        const thrandSpot = GRAVEYARD_SPOTS[2];
        const thrandTombstone = getTombstoneAt(thrandSpot.x, thrandSpot.y);
        expect(thrandTombstone?.resident).toBe('res:thrand');
        expect(thrandTombstone?.faction).toBe('Unaligned');
    });

    it('clears previous tombstones on refresh', () => {
        writeDeceasedResident('res-hans', 'res:hans', '2026-05-25T10:00:00.000Z', 1, 'exhaustion');

        refreshGraveyard();
        expect(activeWorld.globalInstance.spawnGameObject).toHaveBeenCalledTimes(1);

        // Add a second deceased resident
        writeDeceasedResident('res-pip', 'res:pip', '2026-05-25T09:00:00.000Z', 1, 'combat');

        refreshGraveyard();
        // Should despawn the previous one (res:hans)
        expect(activeWorld.globalInstance.despawnGameObject).toHaveBeenCalledTimes(1);
        // And spawn two new ones
        expect(activeWorld.globalInstance.spawnGameObject).toHaveBeenCalledTimes(3); // 1 first time, 2 second time
    });
});
