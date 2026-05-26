import type { NpcInteractionActionHook, npcInteractionActionHandler } from '@engine/action/pipe/npc-interaction.action';
import { soundIds } from '@engine/world/config/sound-ids';
import { getFishingMethod, getFishingOptions, getFishingRequirementIssue, getFishingSpotKeys } from './fishing-data';
import { FISHING_SPOT_INTERACTION_DISTANCE, FishingTask } from './fishing-task';

const action: npcInteractionActionHandler = details => {
    const method = getFishingMethod(details.npc.key, details.option);
    if (!method) {
        return;
    }

    const issue = getFishingRequirementIssue(details.player, method);
    if (issue) {
        details.player.sendMessage(issue.message, issue.inventoryFull);
        if (issue.inventoryFull) {
            details.player.playSound(soundIds.inventoryFull);
        }
        return;
    }

    details.player.enqueueTask(FishingTask, [details.npc, method]);
};

export default {
    pluginId: 'rs:fishing',
    hooks: [
        {
            type: 'npc_interaction',
            npcs: getFishingSpotKeys(),
            options: getFishingOptions(),
            walkTo: true,
            interactionDistance: FISHING_SPOT_INTERACTION_DISTANCE,
            handler: action,
        } as NpcInteractionActionHook,
    ],
};
