import { findItem } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import type { Actor } from '@engine/world/actor/actor';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import type { ActorRef, AgentActionShape, ItemRef, ObjectRef, WorldItemRef } from '@engine/world/actor/resident/action/agent-action';
import type { Resident } from '@engine/world/actor/resident/resident';
import { Skill, skillDetails } from '@engine/world/actor/skills';
import { TradeEngine } from '@engine/world/actor/trade/trade-engine';
import { isResident } from '@engine/world/actor/util';
import type { Item } from '@engine/world/items/item';
import type { WorldItem } from '@engine/world/items/world-item';
import { Position } from '@engine/world/position';
import type { LandscapeObject } from '@runejs/filestore';
import type { Perception } from './perception-types';

export interface PerceptionBuilderOptions {
    visionRange?: number;
}

const itemRef = (item: Item | null): ItemRef | null => {
    if (!item) {
        return null;
    }

    const details = findItem(item.itemId);
    return {
        itemId: item.itemId,
        key: details?.key,
        amount: item.amount,
    };
};

const actorRef = (actor: Actor): ActorRef => {
    const maxHp = actor.skills.getMaxLevel('hitpoints');
    const hp = actor.skills.hitpoints.level;
    const asPlayer = actor as Player;
    const asNpc = actor as Npc;

    return {
        id: actor.type === 'player' ? `player:${asPlayer.username.toLowerCase()}` : `npc:${asNpc.worldIndex}`,
        kind: actor.type === 'player' ? (isResident(actor) ? 'resident' : 'player') : 'npc',
        key: actor.type === 'npc' ? asNpc.key : undefined,
        name: actor.type === 'player' ? asPlayer.username : asNpc.name,
        position: { x: actor.position.x, y: actor.position.y, level: actor.position.level },
        hpFraction: maxHp <= 0 ? 0 : hp / maxHp,
    };
};

const worldItemRef = (worldItem: WorldItem): WorldItemRef => ({
    itemId: worldItem.itemId,
    key: findItem(worldItem.itemId)?.key,
    amount: worldItem.amount,
    position: {
        x: worldItem.position.x,
        y: worldItem.position.y,
        level: worldItem.position.level,
    },
    ownerId: worldItem.owner ? `player:${worldItem.owner.username.toLowerCase()}` : undefined,
});

const objectRef = (object: LandscapeObject): ObjectRef => ({
    objectId: object.objectId,
    position: { x: object.x, y: object.y, level: object.level },
    orientation: object.orientation,
});

export class PerceptionBuilder {
    public constructor(private readonly options: PerceptionBuilderOptions = {}) {}

    public build(resident: Resident): Perception {
        const visionRange = this.options.visionRange ?? 15;
        const position = resident.position;
        const instanceId = resident.instance.instanceId;
        const players = activeWorld
            .findNearbyPlayers(position, visionRange, instanceId)
            .filter(player => !player.equals(resident))
            .map(player => actorRef(player));
        const npcs = activeWorld.findNearbyNpcs(position, visionRange, instanceId).map(npc => actorRef(npc));
        const worldItems = this.findNearbyWorldItems(resident, visionRange).map(worldItemRef);
        const objects = this.findNearbyObjects(resident, visionRange).map(objectRef);
        const combatTarget = resident.metadata.combatTarget ? actorRef(resident.metadata.combatTarget) : null;
        const activeTrade = TradeEngine.activeSessionFor(resident)?.perceptionFor(resident) || undefined;

        return {
            tick: activeWorld.tickCount,
            resident: {
                id: resident.residentId,
                position: { x: position.x, y: position.y, level: position.level },
                hp: {
                    current: resident.skills.hitpoints.level,
                    max: resident.skills.getMaxLevel('hitpoints'),
                },
                skills: Object.fromEntries(
                    resident.skills.values.map((skill, index) => [
                        skillDetails[index]?.name?.toLowerCase() || Skill[index]?.toLowerCase() || `skill_${index}`,
                        {
                            level: resident.skills.getLevel(index),
                            xp: skill.exp,
                        },
                    ]),
                ),
                inCombat: resident.inCombat,
                combatTarget,
                busy: resident.busy,
                inventory: resident.inventory.items.map(itemRef),
                equipment: resident.equipment.items.map(itemRef),
                activeTrade,
            },
            nearby: {
                players,
                npcs,
                worldItems,
                objects,
            },
            events: resident.drainPerceptionEvents(),
            availableActions: this.availableActions(resident, players, npcs, worldItems, objects),
        };
    }

    private findNearbyWorldItems(resident: Resident, visionRange: number): WorldItem[] {
        const items: WorldItem[] = [];
        const instances = [resident.instance, resident.personalInstance];
        for (const instance of instances) {
            for (const instancedChunk of instance.chunkModifications.values()) {
                for (const mods of instancedChunk.mods.values()) {
                    for (const worldItem of mods.worldItems) {
                        if (
                            !worldItem.removed &&
                            (!worldItem.owner || worldItem.owner.equals(resident)) &&
                            worldItem.position.distanceBetween(resident.position) <= visionRange
                        ) {
                            items.push(worldItem);
                        }
                    }
                }
            }
        }
        return items;
    }

    private findNearbyObjects(resident: Resident, visionRange: number): LandscapeObject[] {
        const objects: LandscapeObject[] = [];
        const nearbyChunks = activeWorld.chunkManager.getSurroundingChunks(
            activeWorld.chunkManager.getChunkForWorldPosition(resident.position),
        );
        for (const chunk of nearbyChunks) {
            for (const object of chunk.filestoreLandscapeObjects.values()) {
                if (resident.position.distanceBetween(new Position(object.x, object.y, object.level)) <= visionRange) {
                    objects.push(object);
                }
            }
        }
        for (const instance of [resident.instance, resident.personalInstance]) {
            for (const instancedChunk of instance.chunkModifications.values()) {
                for (const mods of instancedChunk.mods.values()) {
                    for (const object of mods.spawnedObjects) {
                        if (resident.position.distanceBetween(new Position(object.x, object.y, object.level)) <= visionRange) {
                            objects.push(object);
                        }
                    }
                }
            }
        }
        return objects;
    }

    private availableActions(
        resident: Resident,
        players: ActorRef[],
        npcs: ActorRef[],
        worldItems: WorldItemRef[],
        objects: ObjectRef[],
    ): AgentActionShape[] {
        const occupiedInventorySlots = resident.inventory.items.map((item, slot) => (item ? slot : -1)).filter(slot => slot !== -1);
        const activeTrade = TradeEngine.activeSessionFor(resident)?.perceptionFor(resident) || null;
        const offerSlots = activeTrade ? activeTrade.ours.map((_item, slot) => slot) : [];

        return [
            { kind: 'move_to' },
            ...npcs.map(target => ({ kind: 'interact' as const, target, options: ['talk-to', 'attack'] })),
            ...npcs.map(target => ({ kind: 'attack' as const, target })),
            ...players.map(target => ({ kind: 'interact' as const, target, options: ['follow', 'trade'] })),
            { kind: 'trade_request', targets: players },
            ...worldItems.map(target => ({ kind: 'interact' as const, target, options: ['pick-up'] })),
            ...objects.map(target => ({ kind: 'interact' as const, target, options: ['action-1'] })),
            { kind: 'equip', slots: occupiedInventorySlots },
            { kind: 'drop', slots: occupiedInventorySlots },
            { kind: 'trade_offer_item', slots: occupiedInventorySlots },
            { kind: 'trade_remove_item', slots: offerSlots },
            { kind: 'trade_accept_stage_1' },
            { kind: 'trade_accept_stage_2' },
            { kind: 'trade_decline' },
            { kind: 'say' },
            { kind: 'logout' },
            { kind: 'noop' },
        ];
    }
}
