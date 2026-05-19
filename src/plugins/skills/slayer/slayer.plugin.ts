import type { NpcInitActionHook } from '@engine/action/pipe/npc-init.action';
import type { NpcInteractionActionHook, npcInteractionActionHandler } from '@engine/action/pipe/npc-interaction.action';
import { handleSlayerMasterInteraction } from './slayer-dialogue';
import { registerSlayerKillListener } from './slayer-kill-listener';
import { getSlayerMaster, slayerMasterNpcKeys } from './slayer-config';

const talkToMaster: npcInteractionActionHandler = ({ player, npc }) => {
    const master = getSlayerMaster(npc.key);
    if (!master) {
        return;
    }
    handleSlayerMasterInteraction(player, npc, master);
};

export default {
    pluginId: 'rs:slayer',
    hooks: [
        {
            type: 'npc_init',
            handler: ({ npc }) => registerSlayerKillListener(npc),
        } as NpcInitActionHook,
        {
            type: 'npc_interaction',
            npcs: slayerMasterNpcKeys,
            options: ['talk-to', 'assignment', 'task'],
            walkTo: true,
            handler: talkToMaster,
        } as NpcInteractionActionHook,
    ],
};
