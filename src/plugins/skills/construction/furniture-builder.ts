import type { objectInteractionActionHandler } from '@engine/action/pipe/object-interaction.action';
import { widgets } from '@engine/config/config-handler';
import { Skill } from '@engine/world/actor/skills';
import {
    furnitureByHotspot,
    furnitureDefinitions,
    hasHammerAndSaw,
    hasMaterials,
    removeMaterials,
} from '@plugins/skills/construction/construction-data';
import { saveHouse } from '@plugins/skills/construction/home-saver';
import { Room } from '@plugins/skills/construction/house';
import { getCurrentRoom } from '@plugins/skills/construction/util';
import type { LandscapeObject } from '@runejs/filestore';

function furnitureKey(object: LandscapeObject): string {
    return `${object.level}:${object.x}:${object.y}:${object.type}`;
}

export const buildFurnitureHandler: objectInteractionActionHandler = ({ player, object, position }) => {
    if (player.metadata.constructionBuildMode === false) {
        player.sendMessage('You can only build furniture in building mode.');
        return;
    }

    const furniture = furnitureByHotspot(object.objectId);
    if (!furniture) {
        player.sendMessage('Nothing interesting happens.');
        return;
    }

    if (!player.skills.hasLevel(Skill.CONSTRUCTION, furniture.level)) {
        player.sendMessage(`You need a Construction level of ${furniture.level} to build ${furniture.name}.`);
        return;
    }

    if (!hasHammerAndSaw(player)) {
        player.sendMessage('You need a hammer and saw to build that.');
        return;
    }

    if (!hasMaterials(player.inventory, furniture.materials)) {
        player.sendMessage(`You do not have the materials to build ${furniture.name}.`);
        return;
    }

    const currentRoom = getCurrentRoom(player);
    const room = currentRoom ? (player.metadata.customMap?.chunks[currentRoom.level][currentRoom.x][currentRoom.y] as Room | null) : null;
    if (!room || !furniture.roomTypes.includes(room.type)) {
        player.sendMessage(`You cannot build ${furniture.name} here.`);
        return;
    }

    const builtObject = {
        objectId: furniture.builtObjectId,
        x: position.x,
        y: position.y,
        level: position.level,
        type: object.type,
        orientation: object.orientation,
    } as LandscapeObject;

    removeMaterials(player.inventory, furniture.materials);
    player.outgoingPackets.sendUpdateAllWidgetItems(widgets.inventory, player.inventory);
    player.personalInstance.hideGameObject(object);
    player.personalInstance.spawnGameObject(builtObject);
    player.outgoingPackets.removeLocationObject(object, position);
    player.outgoingPackets.setLocationObject(builtObject, position);

    room.builtFurniture[furnitureKey(object)] = { id: furniture.id, object: builtObject, hotspotObject: object };
    player.skills.addExp(Skill.CONSTRUCTION, furniture.xp);
    saveHouse(player);
    player.sendMessage(`You build ${furniture.name}.`);
};

export const removeFurnitureHandler: objectInteractionActionHandler = ({ player, object, position }) => {
    const currentRoom = getCurrentRoom(player);
    const room = currentRoom ? (player.metadata.customMap?.chunks[currentRoom.level][currentRoom.x][currentRoom.y] as Room | null) : null;
    if (!room) {
        return;
    }

    const key = Object.keys(room.builtFurniture).find(key => {
        const built = room.builtFurniture[key]?.object;
        return built?.objectId === object.objectId && built.x === object.x && built.y === object.y && built.type === object.type;
    });
    if (!key) {
        return;
    }

    const builtFurniture = room.builtFurniture[key];
    player.personalInstance.despawnGameObject(object);
    player.outgoingPackets.removeLocationObject(object, position);
    if (builtFurniture?.hotspotObject) {
        player.personalInstance.showGameObject(builtFurniture.hotspotObject);
        player.outgoingPackets.setLocationObject(builtFurniture.hotspotObject, position);
    }
    delete room.builtFurniture[key];
    saveHouse(player);
    player.sendMessage('You remove the furniture.');
};

export const furnitureHotspotObjectIds = [...new Set(furnitureDefinitions.flatMap(definition => definition.hotspotObjectIds))];
export const builtFurnitureObjectIds = [...new Set(furnitureDefinitions.map(definition => definition.builtObjectId))];
