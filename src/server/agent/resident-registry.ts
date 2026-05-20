import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { findItem } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import { loadPlayerSaveResult, playerExists } from '@engine/world/actor/player/player-data';
import { IdleBrain } from '@engine/world/actor/resident/brain/idle-brain';
import { RESIDENT_SAVE_DIR, Resident } from '@engine/world/actor/resident/resident';
import type { Item } from '@engine/world/items/item';
import { Position } from '@engine/world/position';
import type { DisconnectPolicy, ResidentSummary } from './protocol/messages';

export const RESIDENT_NAME_PATTERN = /^res:[a-z0-9_]{1,20}$/;

export const normalizeResidentName = (name: string): string => name.toLowerCase();

export const isValidResidentName = (name: string): boolean => RESIDENT_NAME_PATTERN.test(name);

export type InitialContainerItem = number | string | { itemId: number; amount?: number } | null | undefined;

export interface ResidentCreateOptions {
    initialInventory?: InitialContainerItem[];
    initialEquipment?: InitialContainerItem[];
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
        for (const name of this.online.keys()) {
            names.add(name);
        }

        return [...names].sort().map(name => this.summary(name));
    }

    public create(name: string, spawnPosition?: { x: number; y: number; level?: number }, options: ResidentCreateOptions = {}): ResidentSummary {
        name = this.assertValidName(name);
        if (playerExists(name, { saveDir: this.saveDir })) {
            throw new Error('ENAME_TAKEN');
        }

        const resident = new Resident(name, new IdleBrain());
        if (spawnPosition) {
            resident.position = new Position(spawnPosition.x, spawnPosition.y, spawnPosition.level);
        }
        this.applyInitialItems(resident.inventory, 28, options.initialInventory, 'inventory');
        this.applyInitialItems(resident.equipment, 14, options.initialEquipment, 'equipment');
        resident.save();
        return this.summary(name);
    }

    public async connect(name: string, controllerId: string, onDisconnect: DisconnectPolicy = 'logout'): Promise<Resident> {
        name = this.assertValidName(name);
        const existing = this.online.get(name);
        if (existing) {
            const controller = this.controllers.get(name);
            if (controller && controller.controllerId !== controllerId) {
                throw new Error('ECONTROL_HELD');
            }
            this.controllers.set(name, { controllerId, onDisconnect });
            existing.markControllerAttached(controllerId);
            existing.save();
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
        this.controllers.set(name, { controllerId, onDisconnect });
        resident.markControllerAttached(controllerId);
        resident.save();
        return resident;
    }

    public disconnect(name: string, cause?: string): void {
        name = normalizeResidentName(name);
        const resident = this.online.get(name);
        if (!resident) {
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
        const filePath = join(this.saveDir, `${name}.json`);
        if (existsSync(filePath)) {
            rmSync(filePath);
        }
    }

    public get(name: string): Resident | null {
        return this.online.get(normalizeResidentName(name)) || null;
    }

    public controllerFor(name: string): string | undefined {
        return this.controllers.get(normalizeResidentName(name))?.controllerId;
    }

    public releaseController(controllerId: string): string[] {
        const disconnected: string[] = [];
        for (const [name, controller] of this.controllers.entries()) {
            if (controller.controllerId === controllerId) {
                if (controller.onDisconnect === 'logout') {
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
        const controller = this.controllers.get(name);
        return {
            name,
            online: this.online.has(name),
            controllerId: controller?.controllerId,
            controlHeld: Boolean(controller),
        };
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
}
