import { itemIds } from '@engine/world/config/item-ids';
import type { RoomType } from './con-constants';

export interface RoomDefinition {
    type: RoomType;
    name: string;
    level: number;
    coins: number;
    xp: number;
}

export interface FurnitureDefinition {
    id: string;
    name: string;
    hotspotObjectIds: number[];
    builtObjectId: number;
    roomTypes: RoomType[];
    level: number;
    xp: number;
    materials: { itemId: number; amount: number }[];
}

export const roomDefinitions: Record<RoomType, RoomDefinition> = {
    empty: { type: 'empty', name: 'Empty', level: 1, coins: 0, xp: 0 },
    empty_grass: { type: 'empty_grass', name: 'Empty grass', level: 1, coins: 0, xp: 0 },
    garden: { type: 'garden', name: 'Garden', level: 1, coins: 1000, xp: 0 },
    parlor: { type: 'parlor', name: 'Parlour', level: 1, coins: 1000, xp: 0 },
    kitchen: { type: 'kitchen', name: 'Kitchen', level: 5, coins: 5000, xp: 0 },
    dining_room: { type: 'dining_room', name: 'Dining room', level: 10, coins: 5000, xp: 0 },
    workshop: { type: 'workshop', name: 'Workshop', level: 15, coins: 10000, xp: 0 },
    bedroom: { type: 'bedroom', name: 'Bedroom', level: 20, coins: 10000, xp: 0 },
    skill_hall: { type: 'skill_hall', name: 'Skill hall', level: 25, coins: 15000, xp: 0 },
    games_room: { type: 'games_room', name: 'Games room', level: 30, coins: 25000, xp: 0 },
    combat_room: { type: 'combat_room', name: 'Combat room', level: 32, coins: 25000, xp: 0 },
    quest_hall: { type: 'quest_hall', name: 'Quest hall', level: 35, coins: 25000, xp: 0 },
    study: { type: 'study', name: 'Study', level: 40, coins: 50000, xp: 0 },
    costume_room: { type: 'costume_room', name: 'Costume room', level: 42, coins: 50000, xp: 0 },
    chapel: { type: 'chapel', name: 'Chapel', level: 45, coins: 50000, xp: 0 },
    portal_chamber: { type: 'portal_chamber', name: 'Portal chamber', level: 50, coins: 100000, xp: 0 },
    formal_garden: { type: 'formal_garden', name: 'Formal garden', level: 55, coins: 75000, xp: 0 },
    throne_room: { type: 'throne_room', name: 'Throne room', level: 60, coins: 150000, xp: 0 },
    oubliette: { type: 'oubliette', name: 'Oubliette', level: 65, coins: 150000, xp: 0 },
    treasure_room: { type: 'treasure_room', name: 'Treasure room', level: 75, coins: 250000, xp: 0 },
};

export const constructionItemIds = {
    saw: 8794,
    plank: 960,
    oakPlank: 8778,
    cloth: 8790,
};

export const furnitureDefinitions: FurnitureDefinition[] = [
    {
        id: 'garden_exit_portal',
        name: 'Exit portal',
        hotspotObjectIds: [15478, 15479, 15480],
        builtObjectId: 13405,
        roomTypes: ['garden', 'formal_garden'],
        level: 1,
        xp: 100,
        materials: [],
    },
    {
        id: 'wooden_chair',
        name: 'Wooden chair',
        hotspotObjectIds: [15410, 15411, 15412],
        builtObjectId: 13581,
        roomTypes: ['parlor'],
        level: 1,
        xp: 58,
        materials: [{ itemId: constructionItemIds.plank, amount: 2 }],
    },
    {
        id: 'wooden_bookcase',
        name: 'Wooden bookcase',
        hotspotObjectIds: [15416, 15417],
        builtObjectId: 13597,
        roomTypes: ['parlor'],
        level: 4,
        xp: 115,
        materials: [{ itemId: constructionItemIds.plank, amount: 4 }],
    },
    {
        id: 'wooden_table',
        name: 'Wooden table',
        hotspotObjectIds: [15405, 15406, 15407],
        builtObjectId: 13577,
        roomTypes: ['kitchen', 'dining_room'],
        level: 12,
        xp: 87,
        materials: [{ itemId: constructionItemIds.plank, amount: 3 }],
    },
];

export function furnitureByHotspot(objectId: number): FurnitureDefinition | undefined {
    return furnitureDefinitions.find(definition => definition.hotspotObjectIds.includes(objectId));
}

export function hasMaterials(inventory: { amount(itemId: number): number }, materials: { itemId: number; amount: number }[]): boolean {
    return materials.every(material => inventory.amount(material.itemId) >= material.amount);
}

export function removeMaterials(inventory: { findIndex(itemId: number): number; amountInStack(slot: number): number; set(slot: number, item: any): void; remove(slot: number): void }, materials: { itemId: number; amount: number }[]): void {
    for (const material of materials) {
        let remaining = material.amount;
        while (remaining > 0) {
            const slot = inventory.findIndex(material.itemId);
            if (slot < 0) {
                return;
            }
            const amount = inventory.amountInStack(slot);
            const removed = Math.min(amount, remaining);
            if (amount > removed) {
                inventory.set(slot, { itemId: material.itemId, amount: amount - removed });
            } else {
                inventory.remove(slot);
            }
            remaining -= removed;
        }
    }
}

export function hasHammerAndSaw(player: { inventory: { has(itemId: number): boolean } }): boolean {
    return player.inventory.has(itemIds.hammer) && player.inventory.has(constructionItemIds.saw);
}
