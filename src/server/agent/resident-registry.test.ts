import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Resident } from '@engine/world/actor/resident/resident';
import { ResidentRegistry, isValidResidentName, normalizeResidentName } from './resident-registry';

jest.mock('chokidar', () => ({
    watch: jest.fn(),
}));

jest.mock('@engine/world', () => ({
    activeWorld: {
        playerTree: {
            push: jest.fn(),
            remove: jest.fn(),
        },
        playerSlotsRemaining: jest.fn(() => 2000),
        registerPlayer: jest.fn(() => true),
    },
}));

jest.mock('@engine/config/config-handler', () => ({
    findItem: jest.fn((item: number | string) => {
        const itemId = typeof item === 'number' ? item : item === 'coins' ? 995 : Number(item);
        if (!Number.isInteger(itemId) || itemId <= 0) {
            return null;
        }
        return {
            gameId: itemId,
            key: `item:${itemId}`,
            stackable: itemId === 995,
            bankNoteId: null,
        };
    }),
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

    it('normalizes and validates strict resident names, including soul-style hyphens', () => {
        expect(normalizeResidentName('res:test_bot')).toBe('res:test_bot');
        expect(isValidResidentName('res:test_bot')).toBe(true);
        expect(isValidResidentName('res:test-bot')).toBe(true);
        expect(isValidResidentName('Res:test_bot')).toBe(false);
        expect(isValidResidentName('player')).toBe(false);
        expect(isValidResidentName('res:')).toBe(false);
        expect(isValidResidentName('res:test bot')).toBe(false);
        expect(isValidResidentName('res:test/bot')).toBe(false);
        expect(isValidResidentName(`res:${'a'.repeat(21)}`)).toBe(false);
    });

    it('rejects create names that are missing the reserved prefix or are not normalized', () => {
        jest.spyOn(Resident.prototype, 'save').mockReturnValue(true);
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.create('test_bot')).toThrow('EBAD_NAME');
        expect(() => registry.create('Res:test_bot')).toThrow('EBAD_NAME');
        expect(() => registry.create('res:test bot')).toThrow('EBAD_NAME');
        expect(() => registry.create('res:test/bot')).toThrow('EBAD_NAME');
    });

    it('rejects resident creation when a real player save already owns the reserved name', () => {
        jest.spyOn(Resident.prototype, 'save').mockReturnValue(true);
        writeFileSync(join(playerSaveDir, 'res:taken.json'), '{}');

        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.create('res:taken')).toThrow('ERESERVED_NAME');
    });

    it('applies initial inventory and equipment before saving new residents', () => {
        let savedInventory: unknown[] | undefined;
        let savedEquipment: unknown[] | undefined;
        let savedSkills: unknown[] | undefined;
        let savedAppearance: unknown;
        const appearance = {
            gender: 0,
            head: 5,
            torso: 22,
            arms: 30,
            legs: 38,
            hands: 35,
            feet: 44,
            facialHair: 15,
            hairColor: 6,
            torsoColor: 10,
            legColor: 11,
            feetColor: 4,
            skinColor: 1,
        };
        jest.spyOn(Resident.prototype, 'save').mockImplementation(function save(this: Resident) {
            savedInventory = this.inventory.items.map(item => (item ? { ...item } : null));
            savedEquipment = this.equipment.items.map(item => (item ? { ...item } : null));
            savedSkills = this.skills.values.map(skill => ({ ...skill }));
            savedAppearance = { ...this.appearance };
            return true;
        });
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(
            registry.create('res:firepal', undefined, {
                appearance,
                initialInventory: [{ itemId: 590, amount: 1 }, 1511, null, { itemId: 1511, amount: 3 }],
                initialEquipment: [{ itemId: 1, amount: 1 }],
                initialSkills: { firemaking: { exp: 82, level: 1 }, cooking: 81 },
            }),
        ).toEqual({ name: 'res:firepal', online: false, controllerId: undefined, controlHeld: false });

        expect(savedInventory?.slice(0, 5)).toEqual([
            { itemId: 590, amount: 1 },
            { itemId: 1511, amount: 1 },
            null,
            { itemId: 1511, amount: 3 },
            null,
        ]);
        expect(savedEquipment?.slice(0, 2)).toEqual([{ itemId: 1, amount: 1 }, null]);
        expect(savedSkills?.[11]).toEqual({ exp: 82, level: 1 });
        expect(savedSkills?.[7]).toEqual({ exp: 81, level: 1 });
        expect(savedAppearance).toEqual(appearance);
    });

    it('rejects unknown or invalid initial skill seeds', () => {
        jest.spyOn(Resident.prototype, 'save').mockReturnValue(true);
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.create('res:badskill', undefined, { initialSkills: { sailing: 1 } })).toThrow(
            'EUNKNOWN_INITIAL_SKILL:sailing',
        );
        expect(() => registry.create('res:badxp', undefined, { initialSkills: { firemaking: -1 } })).toThrow(
            'EBAD_INITIAL_SKILL:firemaking.exp',
        );
        expect(() => registry.create('res:toomuchxp', undefined, { initialSkills: { firemaking: 200_000_001 } })).toThrow(
            'EBAD_INITIAL_SKILL:firemaking.exp',
        );
        expect(() => registry.create('res:badlevel', undefined, { initialSkills: { firemaking: { level: 100 } } })).toThrow(
            'EBAD_INITIAL_SKILL:firemaking.level',
        );
        expect(Resident.prototype.save).not.toHaveBeenCalled();
    });

    it('rejects oversized initial containers', () => {
        jest.spyOn(Resident.prototype, 'save').mockReturnValue(true);
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.create('res:stuffed', undefined, { initialInventory: new Array(29).fill(null) })).toThrow(
            'EINITIAL_INVENTORY_TOO_LARGE',
        );
        expect(Resident.prototype.save).not.toHaveBeenCalled();
    });

    it('ensures a missing item in an offline resident inventory without duplicating it on later calls', () => {
        writeFileSync(join(saveDir, 'res:offline.json'), JSON.stringify({ inventory: [null, { itemId: 315, amount: 1 }] }));
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(registry.ensureInventoryItem('res:offline', 303, 1)).toEqual({
            resident: 'res:offline',
            itemId: 303,
            requestedAmount: 1,
            previousAmount: 0,
            amount: 1,
            addedAmount: 1,
        });
        expect(registry.ensureInventoryItem('res:offline', 303, 1)).toEqual({
            resident: 'res:offline',
            itemId: 303,
            requestedAmount: 1,
            previousAmount: 1,
            amount: 1,
            addedAmount: 0,
        });

        const save = JSON.parse(readFileSync(join(saveDir, 'res:offline.json'), 'utf8')) as { inventory: Array<{ itemId: number } | null> };
        expect(save.inventory.filter(item => item?.itemId === 303)).toHaveLength(1);
    });

    it('stacks an ensured coin amount in an offline resident inventory', () => {
        writeFileSync(join(saveDir, 'res:coins.json'), JSON.stringify({ inventory: [{ itemId: 995, amount: 5 }] }));
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(registry.ensureInventoryItem('res:coins', 995, 25)).toMatchObject({
            previousAmount: 5,
            amount: 25,
            addedAmount: 20,
        });

        const save = JSON.parse(readFileSync(join(saveDir, 'res:coins.json'), 'utf8')) as {
            inventory: Array<{ itemId: number; amount: number } | null>;
        };
        expect(save.inventory[0]).toEqual({ itemId: 995, amount: 25 });
    });

    it('refuses to ensure a non-stackable item when the offline inventory is full', () => {
        writeFileSync(join(saveDir, 'res:full.json'), JSON.stringify({ inventory: new Array(28).fill({ itemId: 315, amount: 1 }) }));
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.ensureInventoryItem('res:full', 303, 1)).toThrow('EINVENTORY_FULL');
    });

    it('refuses to rewrite oversized offline inventories instead of truncating save data', () => {
        writeFileSync(
            join(saveDir, 'res:oversized.json'),
            JSON.stringify({ inventory: new Array(29).fill(null).map((_, index) => ({ itemId: 315 + index, amount: 1 })) }),
        );
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.ensureInventoryItem('res:oversized', 303, 1)).toThrow('EINVENTORY_OVERSIZED');
        const save = JSON.parse(readFileSync(join(saveDir, 'res:oversized.json'), 'utf8')) as { inventory: unknown[] };
        expect(save.inventory).toHaveLength(29);
        expect(save.inventory[28]).toEqual({ itemId: 343, amount: 1 });
    });

    it('refuses impossible stack-size ensures before mutating a resident save', () => {
        writeFileSync(join(saveDir, 'res:stack-cap.json'), JSON.stringify({ inventory: [{ itemId: 995, amount: 5 }] }));
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(() => registry.ensureInventoryItem('res:stack-cap', 995, 2_147_483_648)).toThrow('EBAD_AMOUNT');
        const save = JSON.parse(readFileSync(join(saveDir, 'res:stack-cap.json'), 'utf8')) as {
            inventory: Array<{ itemId: number; amount: number }>;
        };
        expect(save.inventory[0]).toEqual({ itemId: 995, amount: 5 });
    });

    it('ensures a missing item for an online resident and emits observable item evidence', () => {
        const registry = new ResidentRegistry(saveDir, playerSaveDir);
        const inventory: {
            items: Array<{ itemId: number; amount: number } | null>;
            amount: jest.Mock;
            add: jest.Mock;
            getOpenSlotCount: jest.Mock;
            hasSpace: jest.Mock;
        } = {
            items: [null],
            amount: jest.fn(() => 0),
            add: jest.fn((item: { itemId: number; amount: number }) => {
                inventory.items[0] = item;
                return { item, slot: 0 };
            }),
            getOpenSlotCount: jest.fn(() => 1),
            hasSpace: jest.fn(() => true),
        };
        const resident = {
            isActive: true,
            inventory,
            emitPerceptionEvent: jest.fn(),
            save: jest.fn(),
        };
        const internals = registry as unknown as { online: Map<string, Resident> };
        internals.online.set('res:online', resident as unknown as Resident);

        expect(registry.ensureInventoryItem('res:online', 303, 1)).toMatchObject({
            resident: 'res:online',
            itemId: 303,
            previousAmount: 0,
            amount: 1,
            addedAmount: 1,
        });
        expect(inventory.add).toHaveBeenCalledWith({ itemId: 303, amount: 1 }, false);
        expect(resident.emitPerceptionEvent).toHaveBeenCalledWith({
            kind: 'item_received',
            item: { itemId: 303, key: 'item:303', amount: 1 },
        });
        expect(resident.save).toHaveBeenCalled();
    });

    it('ignores non-resident files when listing resident saves', () => {
        writeFileSync(join(saveDir, 'res:valid.json'), '{}');
        writeFileSync(join(saveDir, 'player.json'), '{}');
        writeFileSync(join(saveDir, 'res:bad name.json'), '{}');

        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        expect(registry.list()).toEqual([{ name: 'res:valid', online: false, controllerId: undefined, controlHeld: false }]);
    });

    it('deletes resident save files and quarantined backups', () => {
        writeFileSync(join(saveDir, 'res:gone.json'), '{}');
        writeFileSync(join(saveDir, 'res:gone.json.bak'), '{}');
        writeFileSync(join(saveDir, 'res:gone_extra.json'), '{}');
        const registry = new ResidentRegistry(saveDir, playerSaveDir);

        registry.delete('res:gone');

        expect(existsSync(join(saveDir, 'res:gone.json'))).toBe(false);
        expect(existsSync(join(saveDir, 'res:gone.json.bak'))).toBe(false);
        expect(existsSync(join(saveDir, 'res:gone_extra.json'))).toBe(true);
    });

    it('prunes inactive residents before reporting online or controller state', () => {
        const registry = new ResidentRegistry(saveDir, playerSaveDir);
        const internals = registry as unknown as {
            online: Map<string, Resident>;
            controllers: Map<string, { controllerId: string; onDisconnect: 'idle' }>;
        };
        internals.online.set('res:stale', { isActive: false } as Resident);
        internals.controllers.set('res:stale', { controllerId: 'controller:test', onDisconnect: 'idle' });

        expect(registry.summary('res:stale')).toEqual({
            name: 'res:stale',
            online: false,
            controllerId: undefined,
            controlHeld: false,
        });
        expect(registry.get('res:stale')).toBeNull();
        expect(registry.controllerFor('res:stale')).toBeUndefined();
        expect(internals.online.has('res:stale')).toBe(false);
        expect(internals.controllers.has('res:stale')).toBe(false);
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
