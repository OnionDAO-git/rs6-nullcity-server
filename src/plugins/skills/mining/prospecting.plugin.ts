import type { objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { getAllOreIds } from '@engine/world/config/harvestable-object';
import { ProspectingTask } from './prospecting-task';

const action: objectInteractionActionHandler = details => {
    details.player.enqueueTask(ProspectingTask, [
        details.object,
        details.objectConfig.rendering.sizeX,
        details.objectConfig.rendering.sizeY,
    ]);
};

export default {
    pluginId: 'rs:prospecting',
    hooks: [
        {
            type: 'object_interaction',
            options: ['prospect'],
            objectIds: getAllOreIds(),
            walkTo: true,
            handler: action,
        },
    ],
};
