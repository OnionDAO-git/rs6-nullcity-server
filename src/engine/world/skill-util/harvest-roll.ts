// Note if adding hunter, Strung rabbit foot makes this out of 94 instead of 99
import { findItem } from '@engine/config/config-handler';
import { randomBetween } from '@engine/util/num';
import type { Item } from '@engine/world/items/item';

export function rollBirdsNestType(): Item {
    const roll = randomBetween(0, 99);

    if (roll === 0) {
        return { itemId: 5076, amount: 1 }; // Red bird's egg
    }
    if (roll === 1) {
        return { itemId: 5077, amount: 1 }; // Green bird's egg
    }
    if (roll <= 3) {
        return { itemId: 5078, amount: 1 }; // Blue bird's egg
    }
    if (roll <= 34) {
        return { itemId: 5074, amount: 1 }; // Ring nest
    }

    return { itemId: 5070, amount: 1 }; // Seed nest
}

export function rollGemType(): Item {
    const roll = randomBetween(0, 3);
    let itemConfigId;

    if (roll === 0) {
        itemConfigId = 'rs:uncut_diamond';
    } else if (roll === 1) {
        itemConfigId = 'rs:uncut_ruby';
    } else if (roll === 2) {
        itemConfigId = 'rs:uncut_emerald';
    } else {
        itemConfigId = 'rs:uncut_sapphire';
    }

    const item = findItem(itemConfigId);
    if (!item) {
        throw new Error(`Could not find item config for ${itemConfigId}`);
    }

    return { itemId: item.gameId, amount: 1 };
}
