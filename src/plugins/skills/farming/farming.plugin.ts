import type { ItemOnObjectActionHook, itemOnObjectActionHandler } from '@engine/action/pipe/item-on-object.action';
import type { ObjectInteractionActionHook, objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { FarmingTask } from './farming-task';
import { farmingPatchObjectIds, farmingSeedItemIds, farmingTools, getCropBySeed, isFarmingPatchObject } from './farming-config';
import { syncPatchObject } from './farming-patches';
import { unixGrowthTick } from './farming-clock';

const inspectPatch: objectInteractionActionHandler = ({ player, object }) => {
    syncPatchObject(player, object, unixGrowthTick());
    player.sendMessage('You inspect the farming patch.');
};

const harvestPatch: objectInteractionActionHandler = ({ player, object }) => {
    syncPatchObject(player, object, unixGrowthTick());
    player.enqueueBaseTask(new FarmingTask(player, object, 'harvest'));
};

const itemOnPatch: itemOnObjectActionHandler = ({ player, object, item }) => {
    if (!isFarmingPatchObject(object.objectId)) {
        return;
    }

    syncPatchObject(player, object, unixGrowthTick());

    if (item.itemId === farmingTools.rake) {
        player.enqueueBaseTask(new FarmingTask(player, object, 'rake'));
        return;
    }
    if (item.itemId === farmingTools.compost) {
        player.enqueueBaseTask(new FarmingTask(player, object, 'compost'));
        return;
    }
    if (item.itemId === farmingTools.spade) {
        player.enqueueBaseTask(new FarmingTask(player, object, 'clear'));
        return;
    }
    if (farmingTools.wateringCans.includes(item.itemId)) {
        player.enqueueBaseTask(new FarmingTask(player, object, 'water'));
        return;
    }
    const crop = getCropBySeed(item.itemId);
    if (crop) {
        player.enqueueBaseTask(new FarmingTask(player, object, 'plant', crop));
    }
};

export default {
    pluginId: 'rs:farming',
    hooks: [
        {
            type: 'object_interaction',
            objectIds: farmingPatchObjectIds,
            options: ['inspect', 'check'],
            walkTo: true,
            handler: inspectPatch,
        } as ObjectInteractionActionHook,
        {
            type: 'object_interaction',
            objectIds: farmingPatchObjectIds,
            options: ['harvest', 'pick', 'pick-from', 'pick from'],
            walkTo: true,
            handler: harvestPatch,
        } as ObjectInteractionActionHook,
        {
            type: 'item_on_object',
            objectIds: farmingPatchObjectIds,
            itemIds: [
                ...farmingSeedItemIds,
                farmingTools.rake,
                farmingTools.seedDibber,
                farmingTools.spade,
                farmingTools.compost,
                ...farmingTools.wateringCans,
            ],
            walkTo: true,
            handler: itemOnPatch,
        } as ItemOnObjectActionHook,
    ],
};
