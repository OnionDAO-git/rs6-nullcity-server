import type { itemOnNpcActionHandler } from '@engine/action/pipe/item-on-npc.action';
import type { npcInitActionHandler } from '@engine/action/pipe/npc-init.action';
import { itemIds } from '@engine/world/config/item-ids';
import { ShearingTask } from './shearing-task';

const initAction: npcInitActionHandler = ({ npc }) => {
    // this used to use `setInterval` but will need rewriting to be synced with ticks
    // see https://github.com/runejs/server/issues/417
    // setInterval(() => {
    //     if(Math.random() >= 0.66) {
    //         npc.say(`Baa!`);
    //         npc.playSound(soundIds.sheepBaa, 4);
    //     }
    // }, (Math.floor(Math.random() * 20) + 10) * World.TICK_LENGTH);
};

export const shearAction: itemOnNpcActionHandler = ({ player, npc }) => {
    player.enqueueTask(ShearingTask, [npc]);
};

export default {
    pluginId: 'rs:sheep_shearing',
    hooks: [
        {
            type: 'npc_init',
            npcs: 'rs:sheep',
            handler: initAction,
        },
        {
            type: 'item_on_npc',
            npcs: 'rs:sheep',
            itemIds: [itemIds.shears, itemIds.recruitmentDrive.shears],
            walkTo: true,
            handler: shearAction,
        },
    ],
};
