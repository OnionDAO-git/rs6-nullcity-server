import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { findItem } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import type { SkillName } from '@engine/world/actor/skills';
import { type Appearance, loadPlayerSaveResult, playerExists } from '@engine/world/actor/player/player-data';
import { IdleBrain } from '@engine/world/actor/resident/brain/idle-brain';
import { RESIDENT_SAVE_DIR, Resident } from '@engine/world/actor/resident/resident';
import type { Item } from '@engine/world/items/item';
import { Position } from '@engine/world/position';
import type { DisconnectPolicy, ResidentSummary } from './protocol/messages';

export const RESIDENT_NAME_PATTERN = /^res:[a-z0-9_-]{1,20}$/;
export const RESIDENT_GOLD_ITEM_ID = 995;
const MAX_INITIAL_SKILL_EXP = 200_000_000;
const KNOWN_SKILL_NAMES: ReadonlySet<SkillName> = new Set([
    'attack',
    'defence',
    'strength',
    'hitpoints',
    'ranged',
    'prayer',
    'magic',
    'cooking',
    'woodcutting',
    'fletching',
    'fishing',
    'firemaking',
    'crafting',
    'smithing',
    'mining',
    'herblore',
    'agility',
    'thieving',
    'slayer',
    'farming',
    'runecrafting',
    'construction',
]);

export const normalizeResidentName = (name: string): string => name.toLowerCase();

export const isValidResidentName = (name: string): boolean => RESIDENT_NAME_PATTERN.test(name);

export type InitialContainerItem = number | string | { itemId: number; amount?: number } | null | undefined;
export type InitialSkillSeed = number | { exp?: number; level?: number };

export interface ResidentCreateOptions {
    appearance?: Appearance;
    initialInventory?: InitialContainerItem[];
    initialEquipment?: InitialContainerItem[];
    initialSkills?: Record<string, InitialSkillSeed>;
}

export interface ResidentGoldSummary {
    resident: string;
    itemId: typeof RESIDENT_GOLD_ITEM_ID;
    amount: number;
}

export class ResidentRegistry {
    private readonly online = new Map<string, Resident>();
    private readonly controllers = new Map<string, { controllerId: string; onDisconnect: DisconnectPolicy }>();

    public constructor(
        private readonly saveDir: string = RESIDENT_SAVE_DIR,
        private readonly playerSaveDir: string = 'data/saves',
    ) {
        mkdirSync(this.saveDir, { recursive: true });
    }

    public list(): ResidentSummary[] {
        const names = new Set<string>();
        if (existsSync(this.saveDir)) {
            for (const file of readdirSync(this.saveDir)) {
                if (file.endsWith('.json') && isValidResidentName(file.slice(0, -5))) {
                    names.add(file.slice(0, -5));
                }
            }
        }
        for (const name of [...this.online.keys()]) {
            if (this.activeResident(name)) {
                names.add(name);
            }
        }

        return [...names].sort().map(name => this.summary(name));
    }

    public create(
        name: string,
        spawnPosition?: { x: number; y: number; level?: number },
        options: ResidentCreateOptions = {},
    ): ResidentSummary {
        name = this.assertValidName(name);
        if (playerExists(name, { saveDir: this.saveDir })) {
            throw new Error('ENAME_TAKEN');
        }

        const resident = new Resident(name, new IdleBrain());
        if (spawnPosition) {
            resident.position = new Position(spawnPosition.x, spawnPosition.y, spawnPosition.level);
        }
        if (options.appearance) {
            resident.appearance = options.appearance;
        }
        this.applyInitialItems(resident.inventory, 28, options.initialInventory, 'inventory');
        this.applyInitialItems(resident.equipment, 14, options.initialEquipment, 'equipment');
        this.applyInitialSkills(resident, options.initialSkills);
        resident.save();
        return this.summary(name);
    }

    public async connect(name: string, controllerId: string | null, onDisconnect: DisconnectPolicy = 'logout'): Promise<Resident> {
        name = this.assertValidName(name);
        const existing = this.activeResident(name);
        if (existing) {
            if (controllerId) {
                const controller = this.controllers.get(name);
                if (controller && controller.controllerId !== controllerId) {
                    throw new Error('ECONTROL_HELD');
                }
                this.controllers.set(name, { controllerId, onDisconnect });
                existing.markControllerAttached(controllerId);
                existing.save();
            }
            return existing;
        }

        const playerSave = loadPlayerSaveResult(name, { saveDir: this.saveDir });
        if (playerSave.status === 'corrupt') {
            throw new Error('ESAVE_CORRUPT');
        }
        if (playerSave.status !== 'ok') {
            throw new Error('ENO_SUCH_RESIDENT');
        }
        if (activeWorld.playerSlotsRemaining() <= 0) {
            throw new Error('EWORLD_FULL');
        }

        const resident = new Resident(name, new IdleBrain());
        if (!activeWorld.registerPlayer(resident)) {
            throw new Error('EWORLD_FULL');
        }
        await resident.init();
        this.online.set(name, resident);
        if (controllerId) {
            this.controllers.set(name, { controllerId, onDisconnect });
            resident.markControllerAttached(controllerId);
        }
        resident.save();
        return resident;
    }

    public disconnect(name: string, cause?: string): void {
        name = normalizeResidentName(name);
        const resident = this.activeResident(name);
        if (!resident) {
            this.controllers.delete(name);
            return;
        }
        resident.markControllerDetached();
        resident.logout();
        this.online.delete(name);
        this.controllers.delete(name);
    }

    public delete(name: string): void {
        name = this.assertValidName(name);
        this.disconnect(name, 'delete_resident');
        const saveFile = `${name}.json`;
        for (const file of readdirSync(this.saveDir)) {
            if (file === saveFile || file.startsWith(`${saveFile}.`)) {
                rmSync(join(this.saveDir, file), { force: true });
            }
        }
    }

    public get(name: string): Resident | null {
        return this.activeResident(name);
    }

    public inspectGold(name: string): ResidentGoldSummary {
        name = this.assertValidName(name);
        const resident = this.activeResident(name);
        if (resident) {
            return {
                resident: name,
                itemId: RESIDENT_GOLD_ITEM_ID,
                amount: resident.inventory.amount(RESIDENT_GOLD_ITEM_ID),
            };
        }

        const save = this.loadOfflineResidentSave(name);
        return {
            resident: name,
            itemId: RESIDENT_GOLD_ITEM_ID,
            amount: this.containerAmount(save.inventory || [], RESIDENT_GOLD_ITEM_ID),
        };
    }

    public burnGold(name: string, amount: number): ResidentGoldSummary {
        name = this.assertValidName(name);
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new Error('EBAD_AMOUNT');
        }

        const resident = this.activeResident(name);
        if (resident) {
            const before = resident.inventory.amount(RESIDENT_GOLD_ITEM_ID);
            if (before < amount) {
                throw new Error('EINSUFFICIENT_GOLD');
            }
            this.removeFromContainer(resident.inventory.items, RESIDENT_GOLD_ITEM_ID, amount, (slot, item) =>
                resident.inventory.set(slot, item, false),
            );
            resident.emitPerceptionEvent({ kind: 'item_lost', item: { itemId: RESIDENT_GOLD_ITEM_ID, key: 'rs:coins', amount } });
            resident.save();
            return { resident: name, itemId: RESIDENT_GOLD_ITEM_ID, amount: before - amount };
        }

        const save = this.loadOfflineResidentSave(name);
        const before = this.containerAmount(save.inventory || [], RESIDENT_GOLD_ITEM_ID);
        if (before < amount) {
            throw new Error('EINSUFFICIENT_GOLD');
        }
        this.removeFromContainer(save.inventory || [], RESIDENT_GOLD_ITEM_ID, amount, (slot, item) => {
            save.inventory[slot] = item;
        });
        this.writeOfflineResidentSave(name, save);
        return { resident: name, itemId: RESIDENT_GOLD_ITEM_ID, amount: before - amount };
    }

    public controllerFor(name: string): string | undefined {
        name = normalizeResidentName(name);
        if (!this.activeResident(name)) {
            this.controllers.delete(name);
            return undefined;
        }
        return this.controllers.get(name)?.controllerId;
    }

    public releaseController(controllerId: string): string[] {
        const disconnected: string[] = [];
        for (const [name, controller] of [...this.controllers.entries()]) {
            if (controller.controllerId === controllerId) {
                const resident = this.activeResident(name);
                if (resident && controller.onDisconnect === 'logout') {
                    this.disconnect(name, 'controller_disconnect');
                } else {
                    this.controllers.delete(name);
                }
                disconnected.push(name);
            }
        }
        return disconnected;
    }

    public summary(name: string): ResidentSummary {
        name = normalizeResidentName(name);
        const resident = this.activeResident(name);
        if (!resident) {
            this.controllers.delete(name);
        }
        const controller = resident ? this.controllers.get(name) : undefined;
        return {
            name,
            online: Boolean(resident),
            controllerId: controller?.controllerId,
            controlHeld: Boolean(controller),
        };
    }

    private activeResident(name: string): Resident | null {
        name = normalizeResidentName(name);
        const resident = this.online.get(name);
        if (!resident) {
            return null;
        }
        if (resident.isActive) {
            return resident;
        }
        this.online.delete(name);
        this.controllers.delete(name);
        return null;
    }

    private assertValidName(name: string): string {
        const normalized = normalizeResidentName(name);
        if (name !== normalized || !isValidResidentName(normalized)) {
            throw new Error('EBAD_NAME');
        }
        if (playerExists(normalized, { saveDir: this.playerSaveDir })) {
            throw new Error('ERESERVED_NAME');
        }
        return normalized;
    }

    private applyInitialItems(
        container: { setAll(items: Array<Item | null>, fireEvent?: boolean): void },
        size: number,
        items: InitialContainerItem[] | undefined,
        label: string,
    ): void {
        if (!items) {
            return;
        }
        if (items.length > size) {
            throw new Error(`EINITIAL_${label.toUpperCase()}_TOO_LARGE`);
        }

        container.setAll(
            Array.from({ length: size }, (_unused, slot) => this.normalizeInitialItem(items[slot], `${label}[${slot}]`)),
            false,
        );
    }

    private normalizeInitialItem(item: InitialContainerItem, label: string): Item | null {
        if (item === null || item === undefined) {
            return null;
        }

        if (typeof item === 'number') {
            return { itemId: this.requirePositiveInt(item, `${label}.itemId`), amount: 1 };
        }

        if (typeof item === 'string') {
            const itemDetails = findItem(item);
            if (!itemDetails) {
                throw new Error(`EUNKNOWN_INITIAL_ITEM:${label}`);
            }
            return { itemId: itemDetails.gameId, amount: 1 };
        }

        if (typeof item === 'object') {
            return {
                itemId: this.requirePositiveInt(item.itemId, `${label}.itemId`),
                amount: this.requirePositiveInt(item.amount ?? 1, `${label}.amount`),
            };
        }

        throw new Error(`EBAD_INITIAL_ITEM:${label}`);
    }

    private requirePositiveInt(value: unknown, label: string): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            throw new Error(`EBAD_INITIAL_ITEM:${label}`);
        }
        return value;
    }

    private applyInitialSkills(resident: Resident, skills: Record<string, InitialSkillSeed> | undefined): void {
        if (!skills) {
            return;
        }
        for (const [skillName, seed] of Object.entries(skills)) {
            const skill = this.normalizeInitialSkillName(skillName);
            const exp = this.initialSkillExp(seed, skill, resident);
            const level = this.initialSkillLevel(seed, skill, resident.skills.getLevelForExp(exp));
            resident.skills.setExp(skill, exp);
            resident.skills.setLevel(skill, level);
        }
    }

    private normalizeInitialSkillName(skillName: string): SkillName {
        const normalized = skillName.trim().toLowerCase();
        if (!KNOWN_SKILL_NAMES.has(normalized as SkillName)) {
            throw new Error(`EUNKNOWN_INITIAL_SKILL:${skillName}`);
        }
        return normalized as SkillName;
    }

    private initialSkillExp(seed: InitialSkillSeed, skill: SkillName, resident: Resident): number {
        const exp =
            typeof seed === 'number'
                ? seed
                : (seed.exp ?? (typeof seed.level === 'number' ? resident.skills.getExpForLevel(seed.level) : 0));
        if (typeof exp !== 'number' || !Number.isFinite(exp) || exp < 0 || exp > MAX_INITIAL_SKILL_EXP) {
            throw new Error(`EBAD_INITIAL_SKILL:${skill}.exp`);
        }
        return exp;
    }

    private initialSkillLevel(seed: InitialSkillSeed, skill: SkillName, levelForExp: number): number {
        const level = typeof seed === 'number' ? levelForExp : (seed.level ?? levelForExp);
        if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 99) {
            throw new Error(`EBAD_INITIAL_SKILL:${skill}.level`);
        }
        return level;
    }

    private loadOfflineResidentSave(name: string): { inventory: Array<Item | null>; [key: string]: unknown } {
        const savePath = this.residentSavePath(name);
        if (!existsSync(savePath)) {
            throw new Error('ENO_SUCH_RESIDENT');
        }
        try {
            const parsed = JSON.parse(readFileSync(savePath, 'utf8')) as { inventory?: Array<Item | null>; [key: string]: unknown };
            if (!Array.isArray(parsed.inventory)) {
                parsed.inventory = [];
            }
            return parsed as { inventory: Array<Item | null>; [key: string]: unknown };
        } catch {
            throw new Error('ESAVE_CORRUPT');
        }
    }

    private writeOfflineResidentSave(name: string, save: Record<string, unknown>): void {
        const savePath = this.residentSavePath(name);
        const tmpPath = `${savePath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmpPath, `${JSON.stringify(save, null, 4)}\n`);
        renameSync(tmpPath, savePath);
    }

    private residentSavePath(name: string): string {
        return join(this.saveDir, `${name.toLowerCase()}.json`);
    }

    private containerAmount(items: Array<Item | null>, itemId: number): number {
        return items.reduce((total, item) => total + (item?.itemId === itemId ? item.amount || 0 : 0), 0);
    }

    private removeFromContainer(
        items: Array<Item | null>,
        itemId: number,
        amount: number,
        setSlot: (slot: number, item: Item | null) => void,
    ): void {
        let remaining = amount;
        for (let slot = 0; slot < items.length && remaining > 0; slot += 1) {
            const item = items[slot];
            if (!item || item.itemId !== itemId) {
                continue;
            }
            if (item.amount > remaining) {
                setSlot(slot, { ...item, amount: item.amount - remaining });
                remaining = 0;
            } else {
                remaining -= item.amount;
                setSlot(slot, null);
            }
        }
    }
}
