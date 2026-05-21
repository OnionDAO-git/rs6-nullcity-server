import { activeWorld } from '@engine/world';
import type { Player } from '@engine/world/actor/player/player';
import type { ConstructedRegion } from '@engine/world/map/region';
import { ConstructedChunk } from '@engine/world/map/region';
import type { Position } from '@engine/world/position';
import type { RoomType } from '@plugins/skills/construction/con-constants';
import type { LandscapeObject } from '@runejs/filestore';
import {
    MAP_SIZE,
    instance1,
    instance1Max,
    instance1PohSpawn,
    instance2,
    instance2Max,
    roomTemplates,
} from '@plugins/skills/construction/con-constants';
import { loadHouse } from '@plugins/skills/construction/home-saver';

export interface BuiltFurniture {
    id: string;
    object: LandscapeObject;
    hotspotObject?: LandscapeObject;
}

export const openHouse = (player: Player): void => {
    let pohPosition: Position = instance1;
    let playerSpawn: Position = instance1PohSpawn;

    if (player.position.within(instance1, instance1Max, false)) {
        playerSpawn = player.position.copy().setY(player.position.y + 64);
        pohPosition = instance2;
    } else if (player.position.within(instance2, instance2Max, false)) {
        playerSpawn = player.position.copy().setY(player.position.y - 64);
    }

    const playerHouse = loadHouse(player);

    if (playerHouse) {
        player.metadata.constructionBuildMode = player.metadata.constructionBuildMode ?? playerHouse.buildMode;
        player.metadata.customMap = {
            renderPosition: pohPosition,
            chunks: playerHouse.rooms,
        } as ConstructedRegion;
    }

    player.teleport(playerSpawn);

    if (!player.metadata.customMap) {
        const house = new House();
        player.metadata.constructionBuildMode = player.metadata.constructionBuildMode ?? house.buildMode;
        house.rooms[0][6][6] = new Room('garden');

        player.metadata.customMap = {
            renderPosition: pohPosition,
            chunks: house.rooms,
        } as ConstructedRegion;
    } else {
        player.metadata.customMap.renderPosition = pohPosition;
    }

    for (let plane = 0; plane < 3; plane++) {
        for (let chunkX = 0; chunkX < 13; chunkX++) {
            for (let chunkY = 0; chunkY < 13; chunkY++) {
                const room = player.metadata.customMap.chunks[plane][chunkX][chunkY];
                if (!room) {
                    continue;
                }

                const templatePosition = room.templatePosition;

                // load all the PoH template maps into memory so that their collision maps are generated
                activeWorld.chunkManager.getChunk(templatePosition);
            }
        }
    }

    spawnBuiltFurniture(player);

    player.sendMessage(`Welcome home.`);
};

export const spawnBuiltFurniture = (player: Player): void => {
    const customMap = player.metadata.customMap;
    if (!customMap) {
        return;
    }

    for (const plane of customMap.chunks) {
        for (const row of plane) {
            for (const room of row) {
                if (!room || !(room instanceof Room)) {
                    continue;
                }
                for (const furniture of Object.values(room.builtFurniture)) {
                    const position = furniture.object;
                    if (furniture.hotspotObject) {
                        player.personalInstance.hideGameObject(furniture.hotspotObject);
                        player.outgoingPackets.removeLocationObject(furniture.hotspotObject, {
                            x: furniture.hotspotObject.x,
                            y: furniture.hotspotObject.y,
                            level: furniture.hotspotObject.level,
                        } as Position);
                    }
                    player.personalInstance.spawnGameObject(furniture.object);
                    player.outgoingPackets.setLocationObject(furniture.object, {
                        x: position.x,
                        y: position.y,
                        level: position.level,
                    } as Position);
                }
            }
        }
    }
};

export class House {
    public version = 2;
    public rooms: (Room | null)[][][];
    public buildMode = true;

    public constructor() {
        this.rooms = new Array(4);
        for (let level = 0; level < 4; level++) {
            this.rooms[level] = new Array(MAP_SIZE);
            for (let x = 0; x < MAP_SIZE; x++) {
                this.rooms[level][x] = new Array(MAP_SIZE).fill(null);

                if (level === 0) {
                    for (let y = 0; y < MAP_SIZE; y++) {
                        this.rooms[level][x][y] = new Room('empty_grass');
                    }
                }
            }
        }
    }

    public copyRooms(rooms: (Room | null)[][][]): void {
        for (let level = 0; level < 4; level++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                for (let y = 0; y < MAP_SIZE; y++) {
                    const existingRoom = rooms?.[level]?.[x]?.[y] ?? null;

                    this.rooms[level][x][y] = existingRoom
                        ? new Room(existingRoom.type, existingRoom.orientation, (existingRoom as Room).builtFurniture)
                        : null;
                }
            }
        }
    }
}

export class Room extends ConstructedChunk {
    public readonly type: RoomType;
    public builtFurniture: Record<string, BuiltFurniture>;

    public constructor(type: RoomType, orientation: number = 0, builtFurniture: Record<string, BuiltFurniture> = {}) {
        super(orientation);
        this.type = type;
        this.builtFurniture = builtFurniture || {};
    }

    public getTemplatePosition(): Position {
        return roomTemplates[this.type];
    }
}
