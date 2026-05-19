import type { ItemOnObjectAction, itemOnObjectActionHandler } from '@engine/action/pipe/item-on-object.action';
import type { ObjectInteractionAction, objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { findItem, widgets } from '@engine/config/config-handler';
import { randomBetween } from '@engine/util/num';
/**
 * @Author NickNick
 */
import { Skill } from '@engine/world/actor/skills';
import { itemIds } from '@engine/world/config/item-ids';
import {
    altars,
    combinationRunes,
    getEntityByAttr,
    getEntityIds,
    runeMultiplier,
    runes,
    tiaras,
} from '@plugins/skills/runecrafting/runecrafting-constants';
import type { RunecraftingCombinationRune, RunecraftingRune, RunecraftingTiara } from '@plugins/skills/runecrafting/runecrafting-types';
import { logger } from '@runejs/common';

const combinationTalismanIds = () => [...combinationRunes.values()].flatMap(rune => rune.talisman.map(talisman => talisman.id));

function removeAmountFromSlot(player: ItemOnObjectAction['player'], slot: number, amount: number): void {
    const existing = player.inventory.items[slot];
    if (!existing) {
        return;
    }
    if (existing.amount > amount) {
        player.inventory.set(slot, { itemId: existing.itemId, amount: existing.amount - amount });
    } else {
        player.inventory.remove(slot);
    }
}

function removeItems(player: ItemOnObjectAction['player'], itemId: number, amount: number): void {
    let remaining = amount;
    while (remaining > 0) {
        const slot = player.inventory.findIndex(itemId);
        if (slot < 0) {
            return;
        }
        const stackAmount = player.inventory.amountInStack(slot);
        const removed = Math.min(remaining, stackAmount);
        removeAmountFromSlot(player, slot, removed);
        remaining -= removed;
    }
}

function findCraftableEssence(player: ItemOnObjectAction['player'], rune: RunecraftingRune): { essenceId: number; amount: number } {
    for (const essenceId of rune.essence) {
        const amount = player.inventory.amount(essenceId);
        if (amount > 0) {
            return { essenceId, amount };
        }
    }
    return { essenceId: -1, amount: 0 };
}

const craftRune: objectInteractionActionHandler = (details: ObjectInteractionAction) => {
    const { player, object } = details;
    const rune = getEntityByAttr(runes, 'altar.craftingId', object.objectId);

    if (!rune) {
        logger.error(`No rune [crafting] found for runecrafting plugin: ${object.objectId}`);
        return;
    }

    const runeDetails = findItem(rune.id);

    if (!runeDetails) {
        logger.warn(`Could not find rune details for rune id ${rune.id}`);
        return;
    }

    const level = player.skills.get(Skill.RUNECRAFTING).level;
    if (level < rune.level) {
        player.sendMessage(`You need a runecrafting level of ${rune.level} to craft ${runeDetails.name}.`);
        return;
    }
    const essence = findCraftableEssence(player, rune);

    if (essence.amount > 0) {
        const craftedRunes = runeMultiplier(rune.id, level) * essence.amount;
        // Remove essence from inventory.
        removeItems(player, essence.essenceId, essence.amount);
        // Add crafted runes to inventory.
        player.inventory.add({ itemId: rune.id, amount: craftedRunes });
        // Add experience
        player.skills.addExp(Skill.RUNECRAFTING, rune.xp * essence.amount);
        // Update widget items.
        player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
        player.sendMessage(`You bind the temple's power into ${runeDetails.name}.`);
        return;
    }

    player.sendMessage(`You do not have any rune essence to bind.`);
};

function getCombinationRuneByAltar(itemId: number, objectId: number): RunecraftingCombinationRune | undefined {
    for (const combinationRune of combinationRunes.values()) {
        const altarIndex = combinationRune.altar.findIndex(altar => altar.craftingId === objectId);
        if (altarIndex > -1 && combinationRune.talisman[altarIndex ^ 1].id === itemId) {
            return combinationRune;
        }
    }
    return undefined;
}

const craftCombinationRune: itemOnObjectActionHandler = (details: ItemOnObjectAction) => {
    const { player, object, item } = details;
    const rune = getCombinationRuneByAltar(item.itemId, object.objectId);
    if (!rune) {
        player.sendMessage('Nothing interesting happens.');
        return;
    }

    const altarIndex = rune.altar.findIndex(altar => object.objectId === altar.craftingId);
    const shouldBreakTalisman = randomBetween(0, 1) === 1;
    const requiredRunesIndex = player.inventory.findIndex(rune.runes[altarIndex ^ 1].id);
    if (requiredRunesIndex < 0) {
        player.sendMessage(`You don't have any runes to bind.`);
        return;
    }
    const runeDetails = findItem(rune.id);

    if (!runeDetails) {
        logger.warn(`Could not find rune details for rune id ${rune.id}`);
        return;
    }

    const level = player.skills.get(Skill.RUNECRAFTING).level;
    if (level < rune.level) {
        player.sendMessage(`You need a runecrafting level of ${rune.level} to craft ${runeDetails.name}.`);
        return;
    }

    const essenceAvailable = player.inventory.amount(itemIds.essence.pure);
    const requiredRunesAvailable = player.inventory.amountInStack(requiredRunesIndex);
    if (essenceAvailable > 0 && requiredRunesIndex >= 0) {
        const amountToCraft = Math.min(essenceAvailable, requiredRunesAvailable);

        // Remove runes from inventory
        if (amountToCraft === requiredRunesAvailable) {
            player.inventory.remove(requiredRunesIndex, false);
        } else {
            player.inventory.set(requiredRunesIndex, {
                itemId: rune.runes[altarIndex ^ 1].id,
                amount: requiredRunesAvailable - amountToCraft,
            });
        }
        // Remove essence from inventory.
        removeItems(player, itemIds.essence.pure, amountToCraft);
        // Add crafted runes to inventory.
        player.inventory.add({ itemId: rune.id, amount: amountToCraft });
        // Add experience
        player.skills.addExp(Skill.RUNECRAFTING, rune.xp[altarIndex] * amountToCraft);
        if (shouldBreakTalisman) {
            player.inventory.removeFirst(item.itemId);
        }
        // Update widget items.
        player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
        player.sendMessage(`You craft some ${runeDetails.name}.`);
        return;
    }
    //
    player.sendMessage(`You do not have any pure essence to bind.`);
};

function getTiaraByAltar(itemId: number, objectId: number): RunecraftingTiara | undefined {
    const rune = getEntityByAttr(runes, 'altar.craftingId', objectId);
    if (!rune) {
        return undefined;
    }
    return itemId === itemIds.tiaras.blank ? rune.tiara : undefined;
}

const craftTiara: itemOnObjectActionHandler = details => {
    const { player, object, item } = details;
    const tiara = getTiaraByAltar(item.itemId, object.objectId);
    if (!tiara) {
        player.sendMessage('Nothing interesting happens.');
        return;
    }

    const rune = getEntityByAttr(runes, 'tiara.id', tiara.id);
    const tiaraDetails = findItem(tiara.id);
    if (!rune || !tiaraDetails) {
        logger.warn(`Could not find tiara details for id ${tiara.id}`);
        return;
    }

    const level = player.skills.get(Skill.RUNECRAFTING).level;
    if (level < tiara.level) {
        player.sendMessage(`You need a runecrafting level of ${tiara.level} to craft ${tiaraDetails.name}.`);
        return;
    }

    const blankSlot = player.inventory.findIndex(itemIds.tiaras.blank);
    const talismanSlot = player.inventory.findIndex(rune.talisman.id);
    if (blankSlot < 0 || talismanSlot < 0) {
        player.sendMessage(`You need a tiara and the matching talisman to bind this altar's power.`);
        return;
    }

    player.inventory.remove(blankSlot);
    player.inventory.remove(talismanSlot === blankSlot ? player.inventory.findIndex(rune.talisman.id) : talismanSlot);
    if (!player.inventory.add({ itemId: tiara.id, amount: 1 })) {
        player.inventory.add({ itemId: itemIds.tiaras.blank, amount: 1 });
        player.inventory.add({ itemId: rune.talisman.id, amount: 1 });
        player.sendMessage('You do not have enough inventory space to make that.');
        return;
    }
    player.skills.addExp(Skill.RUNECRAFTING, tiara.xp);
    player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
    player.sendMessage(`You bind the talisman into the tiara.`);
};

export default {
    pluginId: 'rs:runecrafting',
    hooks: [
        {
            type: 'object_interaction',
            objectIds: getEntityIds(altars, 'craftingId'),
            walkTo: true,
            handler: craftRune,
        },
        {
            type: 'item_on_object',
            objectIds: getEntityIds(altars, 'craftingId'),
            itemIds: itemIds.tiaras.blank,
            walkTo: true,
            handler: craftTiara,
        },
        {
            type: 'item_on_object',
            objectIds: getEntityIds(altars, 'craftingId'),
            itemIds: combinationTalismanIds(),
            walkTo: true,
            handler: craftCombinationRune,
        },
    ],
};
