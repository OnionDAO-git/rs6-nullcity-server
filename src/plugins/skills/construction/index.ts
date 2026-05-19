import type { PlayerCommandAction } from '@engine/action/pipe/player-command.action';
import type { PlayerInitAction } from '@engine/action/pipe/player-init.action';
import { activeWorld } from '@engine/world';
import { Position } from '@engine/world/position';
import {
    buildFurnitureHandler,
    builtFurnitureObjectIds,
    furnitureHotspotObjectIds,
    removeFurnitureHandler,
} from '@plugins/skills/construction/furniture-builder';
import { saveHouse } from '@plugins/skills/construction/home-saver';
import { openHouse } from '@plugins/skills/construction/house';
import { doorHotspotHandler, roomBuilderWidgetHandler } from '@plugins/skills/construction/room-builder';
import { instance1, instance1Max, instance2, instance2Max, roomBuilderButtonMap } from './con-constants';

export default {
    pluginId: 'rs:construction',
    hooks: [
        {
            type: 'button',
            widgetIds: 402,
            buttonIds: Object.keys(roomBuilderButtonMap).map(key => parseInt(key, 10)),
            handler: roomBuilderWidgetHandler,
        },
        {
            type: 'object_interaction',
            objectIds: [15313, 15314],
            options: 'build',
            walkTo: true,
            handler: doorHotspotHandler,
        },
        {
            type: 'object_interaction',
            objectIds: furnitureHotspotObjectIds,
            options: ['build', 'build mode'],
            walkTo: true,
            handler: buildFurnitureHandler,
        },
        {
            type: 'object_interaction',
            objectIds: builtFurnitureObjectIds,
            options: ['remove', 'build'],
            walkTo: true,
            handler: removeFurnitureHandler,
        },
        {
            type: 'player_command',
            commands: ['con', 'poh', 'house'],
            handler: ({ player }: PlayerCommandAction): void => {
                player.metadata.constructionBuildMode = true;
                openHouse(player);
            },
        },
        {
            type: 'player_command',
            commands: ['buildmode', 'buildingmode'],
            handler: ({ player }: PlayerCommandAction): void => {
                player.metadata.constructionBuildMode = player.metadata.constructionBuildMode === false;
                player.sendMessage(`Building mode ${player.metadata.constructionBuildMode ? 'enabled' : 'disabled'}.`);
                saveHouse(player);
                if (player.metadata.customMap) {
                    openHouse(player);
                }
            },
        },
        {
            type: 'player_command',
            commands: ['leavehouse', 'leavepoh'],
            handler: ({ player }: PlayerCommandAction): void => {
                saveHouse(player);
                player.metadata.customMap = undefined;
                player.metadata.constructionBuildMode = undefined;
                player.personalInstance.chunkModifications.clear();
                player.teleport(new Position(2953, 3224, 0));
                player.instance = activeWorld.globalInstance;
                player.sendMessage('You leave your house.');
            },
        },
        {
            type: 'player_command',
            commands: ['savepoh', 'savehouse'],
            handler: ({ player }: PlayerCommandAction): void => {
                player.sendMessage(`Saving house data...`);
                saveHouse(player);
            },
        },
        {
            type: 'player_init',
            handler: ({ player }: PlayerInitAction): void => {
                if (player.position.within(instance1, instance1Max, false) || player.position.within(instance2, instance2Max, false)) {
                    openHouse(player);
                }
            },
        },
    ],
};
