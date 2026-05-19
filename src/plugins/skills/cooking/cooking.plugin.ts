import type { ItemOnObjectActionHook, itemOnObjectActionHandler } from '@engine/action/pipe/item-on-object.action';
import { findItem } from '@engine/config/config-handler';
import { logger } from '@runejs/common';
import { COOKABLE_BY_RAW, OBJECT_HEAT_SOURCES } from './cooking-data';
import { CookingTask } from './cooking-task';

const rawCookableIds = Array.from(COOKABLE_BY_RAW.keys());
const objectHeatSourceIds = Array.from(OBJECT_HEAT_SOURCES.keys());

const cookOnObject: itemOnObjectActionHandler = details => {
    const cookable = COOKABLE_BY_RAW.get(details.item.itemId);
    const heatSource = OBJECT_HEAT_SOURCES.get(details.object.objectId);

    if (!cookable || !heatSource) {
        logger.warn(`Missing cooking recipe or heat source for item ${details.item.itemId} on object ${details.object.objectId}.`);
        details.player.sendMessage("You can't cook that here.");
        return;
    }

    if (!findItem(cookable.cookedItemId)) {
        details.player.sendMessage(`Could not find cooking output ${cookable.cookedItemId}. Please tell a dev.`);
        return;
    }

    details.player.face(details.position, false);
    details.player.enqueueTask(CookingTask, [cookable, heatSource, 1]);
};

export default {
    pluginId: 'rs:cooking',
    hooks: [
        {
            type: 'item_on_object',
            itemIds: rawCookableIds,
            objectIds: objectHeatSourceIds,
            walkTo: true,
            cancelOtherActions: true,
            handler: cookOnObject,
        } as ItemOnObjectActionHook,
    ],
};
