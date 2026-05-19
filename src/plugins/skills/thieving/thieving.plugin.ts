import type { NpcInteractionActionHook, npcInteractionActionHandler } from '@engine/action/pipe/npc-interaction.action';
import type { ObjectInteractionActionHook, objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { PickpocketTask } from './pickpocket-task';
import { StallTask } from './stall-task';
import { getStallTarget, stallObjectIds } from './thieving-stalls';
import { getPickpocketTarget, pickpocketNpcKeys } from './thieving-targets';

const pickpocket: npcInteractionActionHandler = ({ player, npc }) => {
    const target = getPickpocketTarget(npc.key);
    if (!target) {
        return;
    }
    player.enqueueBaseTask(new PickpocketTask(player, npc, target));
};

const stealFromStall: objectInteractionActionHandler = details => {
    const stall = getStallTarget(details.object.objectId, details.option);
    if (!stall) {
        return;
    }
    details.player.enqueueBaseTask(new StallTask(details.player, details.object, stall));
};

export default {
    pluginId: 'rs:thieving',
    hooks: [
        {
            type: 'npc_interaction',
            npcs: pickpocketNpcKeys,
            options: ['pickpocket'],
            walkTo: true,
            handler: pickpocket,
        } as NpcInteractionActionHook,
        {
            type: 'object_interaction',
            objectIds: stallObjectIds,
            options: ['steal-from', 'steal from', 'steal'],
            walkTo: true,
            handler: stealFromStall,
        } as ObjectInteractionActionHook,
    ],
};
