import { findItem } from '@engine/config/config-handler';
import { widgets } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import { findSpellByKey } from '@engine/world/actor/magic';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import type { Resident } from '@engine/world/actor/resident/resident';
import { isResident } from '@engine/world/actor/util';
import { TradeEngine } from '@engine/world/actor/trade/trade-engine';
import type { WorldItem } from '@engine/world/items/world-item';
import { Position } from '@engine/world/position';
import type { LandscapeObject, ObjectConfig } from '@runejs/filestore';
import { filestore } from '@server/game/game-server';
import {
    type ActionResult,
    type ActorRef,
    type AgentAction,
    type ObjectRef,
    type PerceptionEvent,
    type Pos,
    type WorldItemRef,
    isActorRef,
    isObjectRef,
    isWorldItemRef,
} from './agent-action';

export class ActionAdapter {
    public apply(resident: Resident, action: AgentAction): ActionResult {
        switch (action.kind) {
            case 'noop':
                return { ok: true };
            case 'move_to':
                return this.moveTo(resident, action.target, action.range);
            case 'face':
                return this.face(resident, action.target);
            case 'interact':
                return this.interact(resident, action.target, action.option);
            case 'attack':
                return this.interact(resident, action.target, 'attack');
            case 'equip':
                return this.itemAction(resident, action.slot, 'wield');
            case 'drop':
                return this.itemAction(resident, action.slot, 'drop');
            case 'eat':
                return this.itemAction(resident, action.slot, 'eat');
            case 'unequip':
                return resident.unequipItem(action.equipmentSlot) ? { ok: true } : { ok: false, reason: 'empty_equipment_slot' };
            case 'say':
                const event: PerceptionEvent = { kind: 'chat', from: resident.toActorRef(), text: action.text, to: 'public' };
                resident.emitPerceptionEvent(event);
                resident.playerEvents.emit('chat', action.text);
                this.broadcastSpeechToNearbyResidents(resident, event);
                this.echoSpeechToNearbyPlayers(resident, action.text);
                return { ok: true };
            case 'whisper':
                resident.playerEvents.emit('chat', action.text);
                return { ok: true };
            case 'dialogue_continue':
                resident.dialogueInteractionEvent.next(-1);
                return { ok: true };
            case 'dialogue_choice':
                resident.dialogueInteractionEvent.next(action.optionIndex);
                return { ok: true };
            case 'use_item_on':
                return this.useItemOn(resident, action.itemSlot, action.target);
            case 'use_item_on_item':
                return this.useItemOnItem(resident, action.itemSlot, action.targetSlot);
            case 'cast_spell':
                return this.castSpell(resident, action.spellKey, action.target);
            case 'item_action':
                return this.itemAction(resident, action.slot, action.option);
            case 'trade_request':
                return this.tradeRequest(resident, action.target);
            case 'trade_offer_item':
                return this.withActiveTrade(resident, (session, side) => session.addItem(side, action.inventorySlot, action.amount));
            case 'trade_remove_item':
                return this.withActiveTrade(resident, (session, side) => session.removeItem(side, action.offerSlot, action.amount));
            case 'trade_accept_stage_1':
                return this.acceptTradeStage(resident, 'accepted_1');
            case 'trade_accept_stage_2':
                return this.acceptTradeStage(resident, 'accepted_2');
            case 'trade_decline':
                return this.withActiveTrade(resident, (session, side) => session.decline(side, 'declined'));
            case 'logout':
                resident.logout();
                return { ok: true, cause: action.cause };
            default:
                return { ok: false, reason: 'unknown_action' };
        }
    }

    private moveTo(resident: Resident, target: Pos, range = 0): ActionResult {
        const targetPosition = new Position(target.x, target.y, target.level ?? resident.position.level);
        const normalizedRange = Math.max(0, Math.floor(range || 0));
        if (tileDistance(resident.position, targetPosition) <= normalizedRange) {
            return { ok: true };
        }

        for (const destination of this.directMoveDestinations(resident, targetPosition, normalizedRange)) {
            if (sameTile(resident.position, destination)) {
                return { ok: true };
            }
            if (this.queueMove(resident, destination)) {
                return { ok: true };
            }
        }

        for (const destination of this.localMoveCandidates(resident, targetPosition, normalizedRange)) {
            if (this.queueMove(resident, destination)) {
                return { ok: true };
            }
        }

        return { ok: false, reason: 'no_path' };
    }

    private directMoveDestinations(resident: Resident, targetPosition: Position, range: number): Position[] {
        if (range <= 0) {
            return [targetPosition];
        }

        const destinations: Position[] = [];
        for (let x = targetPosition.x - range; x <= targetPosition.x + range; x += 1) {
            for (let y = targetPosition.y - range; y <= targetPosition.y + range; y += 1) {
                const destination = new Position(x, y, targetPosition.level);
                if (sameTile(destination, targetPosition) || tileDistance(destination, targetPosition) > range) {
                    continue;
                }
                destinations.push(destination);
            }
        }

        return destinations.sort(
            (a, b) =>
                tileDistance(resident.position, a) - tileDistance(resident.position, b) ||
                tileDistance(a, targetPosition) - tileDistance(b, targetPosition),
        );
    }

    private localMoveCandidates(resident: Resident, targetPosition: Position, range: number): Position[] {
        const here = resident.position;
        const stepX = Math.sign(targetPosition.x - here.x);
        const stepY = Math.sign(targetPosition.y - here.y);
        const preferred = [
            stepX !== 0 || stepY !== 0 ? new Position(here.x + stepX, here.y + stepY, here.level) : null,
            stepX !== 0 ? new Position(here.x + stepX, here.y, here.level) : null,
            stepY !== 0 ? new Position(here.x, here.y + stepY, here.level) : null,
        ].filter((candidate): candidate is Position => {
            if (!candidate) {
                return false;
            }
            return !sameTile(candidate, here);
        });
        const fallback: Position[] = [];
        for (let x = here.x - 1; x <= here.x + 1; x += 1) {
            for (let y = here.y - 1; y <= here.y + 1; y += 1) {
                const candidate = new Position(x, y, here.level);
                if (!sameTile(candidate, here)) {
                    fallback.push(candidate);
                }
            }
        }
        fallback.sort(
            (a, b) =>
                approachScore(a, targetPosition, range) - approachScore(b, targetPosition, range) ||
                tileDistance(a, targetPosition) - tileDistance(b, targetPosition),
        );

        const seen = new Set<string>();
        return [...preferred, ...fallback].filter(candidate => {
            const key = `${candidate.x},${candidate.y},${candidate.level}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    private queueMove(resident: Resident, destination: Position): boolean {
        const distance = tileDistance(resident.position, destination);
        if (!Number.isFinite(distance)) {
            return false;
        }

        resident.walkingQueue.clear();
        resident.walkingQueue.valid = false;
        resident.pathfinding.walkTo(destination, {
            pathingSearchRadius: Math.max(2, distance + 2),
            ignoreDestination: false,
        });
        if (!resident.walkingQueue.valid || !resident.walkingQueue.moving()) {
            resident.walkingQueue.clear();
            resident.walkingQueue.valid = false;
            return false;
        }
        return true;
    }

    private echoSpeechToNearbyPlayers(resident: Resident, text: string): void {
        for (const player of nearbyPlayers(resident, 15)) {
            if (!player || player === resident || !player.isActive || typeof player.sendMessage !== 'function') {
                continue;
            }
            if (!isNearby(resident.position, player.position, 15)) {
                continue;
            }
            void player.sendMessage(`${resident.username}: ${text}`);
        }
    }

    private broadcastSpeechToNearbyResidents(resident: Resident, event: PerceptionEvent): void {
        for (const player of nearbyPlayers(resident, 15)) {
            if (!player || sameActor(player, resident) || !player.isActive || !isResident(player)) {
                continue;
            }
            if (!isNearby(resident.position, player.position, 15)) {
                continue;
            }
            player.emitPerceptionEvent(event);
        }
    }

    private face(resident: Resident, target: ActorRef | Pos): ActionResult {
        if (isActorRef(target)) {
            const actor = this.findActor(target);
            if (!actor) {
                return { ok: false, reason: 'target_not_found' };
            }
            resident.face(actor);
        } else {
            resident.face(new Position(target.x, target.y, target.level ?? resident.position.level));
        }
        return { ok: true };
    }

    private interact(resident: Resident, target: ActorRef | ObjectRef | WorldItemRef, option: string): ActionResult {
        if (isActorRef(target)) {
            const actor = this.findActor(target);
            if (!actor) {
                return { ok: false, reason: 'target_not_found' };
            }
            if (actor.type === 'npc') {
                resident.actionPipeline.call('npc_interaction', resident, actor, actor.position, option.toLowerCase());
            } else {
                resident.actionPipeline.call('player_interaction', resident, actor, actor.position, option.toLowerCase());
            }
            return { ok: true };
        }

        if (isObjectRef(target)) {
            const position = new Position(target.position.x, target.position.y, target.position.level);
            const found = activeWorld.findObjectAtLocation(resident, target.objectId, position);
            if (!found.object) {
                return { ok: false, reason: 'target_not_found' };
            }

            const config = filestore.configStore.objectStore.getObject(target.objectId);
            if (!config) {
                return { ok: false, reason: 'object_config_not_found' };
            }

            resident.actionPipeline.call(
                'object_interaction',
                resident,
                found.object,
                config,
                position,
                resolveObjectOption(option, config),
                found.cacheOriginal,
            );
            return { ok: true };
        }

        if (isWorldItemRef(target)) {
            const worldItem = this.findWorldItem(resident, target);
            if (!worldItem) {
                return { ok: false, reason: 'target_not_found' };
            }
            resident.actionPipeline.call('spawned_item_interaction', resident, worldItem, option.toLowerCase());
            return { ok: true };
        }

        return { ok: false, reason: 'target_not_found' };
    }

    private itemAction(resident: Resident, slot: number, option: string): ActionResult {
        const item = resident.inventory.items[slot];
        if (!item) {
            return { ok: false, reason: 'empty_inventory_slot' };
        }

        if (!findItem(item.itemId)) {
            return { ok: false, reason: 'item_config_not_found' };
        }

        resident.actionPipeline.call(
            'item_interaction',
            resident,
            item.itemId,
            slot,
            widgets.inventory.widgetId,
            widgets.inventory.containerId,
            option,
        );
        return { ok: true };
    }

    private useItemOn(resident: Resident, itemSlot: number, target: ActorRef | ObjectRef | WorldItemRef): ActionResult {
        const item = resident.inventory.items[itemSlot];
        if (!item) {
            return { ok: false, reason: 'empty_inventory_slot' };
        }

        if (!findItem(item.itemId)) {
            return { ok: false, reason: 'item_config_not_found' };
        }

        if (isActorRef(target)) {
            const actor = this.findActor(target);
            if (!actor) {
                return { ok: false, reason: 'target_not_found' };
            }

            if (actor.type === 'npc') {
                resident.actionPipeline.call(
                    'item_on_npc',
                    resident,
                    actor,
                    actor.position,
                    item,
                    widgets.inventory.widgetId,
                    widgets.inventory.containerId,
                );
            } else {
                resident.actionPipeline.call(
                    'item_on_player',
                    resident,
                    actor,
                    actor.position,
                    item,
                    widgets.inventory.widgetId,
                    widgets.inventory.containerId,
                );
            }
            return { ok: true };
        }

        if (isObjectRef(target)) {
            const position = new Position(target.position.x, target.position.y, target.position.level);
            const found = activeWorld.findObjectAtLocation(resident, target.objectId, position);
            if (!found.object) {
                return { ok: false, reason: 'target_not_found' };
            }

            const config = filestore.configStore.objectStore.getObject(target.objectId);
            if (!config) {
                return { ok: false, reason: 'object_config_not_found' };
            }

            resident.actionPipeline.call(
                'item_on_object',
                resident,
                found.object,
                config,
                position,
                item,
                widgets.inventory.widgetId,
                widgets.inventory.containerId,
                found.cacheOriginal,
            );
            return { ok: true };
        }

        if (isWorldItemRef(target)) {
            const worldItem = this.findWorldItem(resident, target);
            if (!worldItem) {
                return { ok: false, reason: 'target_not_found' };
            }

            resident.actionPipeline.call(
                'item_on_world_item',
                resident,
                item,
                worldItem,
                widgets.inventory.widgetId,
                widgets.inventory.containerId,
                itemSlot,
            );
            return { ok: true };
        }

        return { ok: false, reason: 'target_not_found' };
    }

    private useItemOnItem(resident: Resident, itemSlot: number, targetSlot: number): ActionResult {
        if (itemSlot === targetSlot) {
            return { ok: false, reason: 'same_inventory_slot' };
        }

        const item = resident.inventory.items[itemSlot];
        const targetItem = resident.inventory.items[targetSlot];
        if (!item || !targetItem) {
            return { ok: false, reason: 'empty_inventory_slot' };
        }

        if (!findItem(item.itemId) || !findItem(targetItem.itemId)) {
            return { ok: false, reason: 'item_config_not_found' };
        }

        resident.actionPipeline.call(
            'item_on_item',
            resident,
            item,
            itemSlot,
            widgets.inventory.widgetId,
            targetItem,
            targetSlot,
            widgets.inventory.widgetId,
        );
        return { ok: true };
    }

    private castSpell(resident: Resident, spellKey: string, target?: ActorRef): ActionResult {
        const spell = findSpellByKey(spellKey);
        if (!spell) {
            return { ok: false, reason: 'spell_not_found' };
        }

        if (!target) {
            return { ok: false, reason: 'target_required' };
        }

        if (target.kind !== 'npc') {
            return { ok: false, reason: 'unsupported_spell_target' };
        }

        const actor = this.findActor(target);
        if (!actor || actor.type !== 'npc') {
            return { ok: false, reason: 'target_not_found' };
        }

        resident.actionPipeline.call('magic_on_npc', actor, resident, spell.widget_id, spell.button_id);
        return { ok: true };
    }

    private tradeRequest(resident: Resident, target: ActorRef): ActionResult {
        if (target.kind === 'npc') {
            return { ok: false, reason: 'target_not_player' };
        }

        const actor = this.findActor(target);
        if (!actor || actor.type !== 'player') {
            return { ok: false, reason: 'target_not_found' };
        }

        return TradeEngine.beginRequest(resident, actor as Player);
    }

    private acceptTradeStage(resident: Resident, stage: 'accepted_1' | 'accepted_2'): ActionResult {
        const session = this.activeTrade(resident);
        const side = session?.sideFor(resident);
        if (!session || !side) {
            return { ok: false, reason: 'no_active_trade' };
        }

        return session.requestStage(side, stage);
    }

    private activeTrade(resident: Resident) {
        return TradeEngine.activeSessionFor(resident);
    }

    private withActiveTrade(
        resident: Resident,
        handler: (session: NonNullable<ReturnType<typeof TradeEngine.activeSessionFor>>, side: 'a' | 'b') => ActionResult,
    ): ActionResult {
        const session = this.activeTrade(resident);
        const side = session?.sideFor(resident);
        if (!session || !side) {
            return { ok: false, reason: 'no_active_trade' };
        }

        return handler(session, side);
    }

    private findActor(ref: ActorRef): Player | Npc | null {
        if (ref.kind === 'npc') {
            return this.findNpc(ref);
        }

        const username = ref.id.replace(/^player:/, '').replace(/^resident:/, '');
        return activeWorld.findActivePlayerByUsername(username);
    }

    private findNpc(ref: ActorRef): Npc | null {
        const index = Number(ref.id.replace(/^npc:/, ''));
        const indexed = activeWorld.npcList[index] || null;
        if (indexed && npcMatchesRef(indexed, ref)) {
            return indexed;
        }

        return (activeWorld.npcList as Array<Npc | null | undefined>).find(npc => Boolean(npc) && npcMatchesRef(npc as Npc, ref)) || null;
    }

    private findWorldItem(resident: Resident, ref: WorldItemRef): WorldItem | null {
        const position = new Position(ref.position.x, ref.position.y, ref.position.level);
        for (const instance of [resident.instance, resident.personalInstance]) {
            const chunk = instance.getInstancedChunk(position);
            const mods = chunk.mods.get(position.key);
            const worldItem = mods?.worldItems.find(item => item.itemId === ref.itemId && !item.removed) || null;
            if (worldItem) {
                return worldItem;
            }
        }
        return null;
    }
}

function isNearby(a: { x: number; y: number; level?: number }, b: { x: number; y: number; level?: number }, maxDistance: number): boolean {
    return (a.level ?? 0) === (b.level ?? 0) && Math.abs(a.x - b.x) <= maxDistance && Math.abs(a.y - b.y) <= maxDistance;
}

function nearbyPlayers(resident: Resident, maxDistance: number): Player[] {
    const instanceId = resident.instance?.instanceId;
    if (instanceId && typeof activeWorld?.findNearbyPlayers === 'function') {
        return activeWorld.findNearbyPlayers(resident.position, maxDistance * 2 + 2, instanceId);
    }
    return (activeWorld?.playerList || []).filter((player): player is Player => Boolean(player));
}

function sameActor(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (a && typeof (a as { equals?: unknown }).equals === 'function') {
        return (a as { equals(other: unknown): boolean }).equals(b);
    }
    return false;
}

function sameTile(a: { x: number; y: number; level?: number }, b: { x: number; y: number; level?: number }): boolean {
    return a.x === b.x && a.y === b.y && (a.level ?? 0) === (b.level ?? 0);
}

function npcMatchesRef(npc: Npc, ref: ActorRef): boolean {
    if (ref.key && typeof npc.key === 'string' && npc.key !== ref.key) {
        return false;
    }
    if (ref.position && npc.position && !sameTile(npc.position, ref.position)) {
        return false;
    }
    if (!ref.key && ref.name && typeof npc.name === 'string' && npc.name !== ref.name) {
        return false;
    }
    return true;
}

function tileDistance(a: { x: number; y: number; level?: number }, b: { x: number; y: number; level?: number }): number {
    if ((a.level ?? 0) !== (b.level ?? 0)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function approachScore(
    candidate: { x: number; y: number; level?: number },
    target: { x: number; y: number; level?: number },
    range: number,
): number {
    return Math.max(0, tileDistance(candidate, target) - range);
}

function resolveObjectOption(option: string, config: ObjectConfig): string {
    const normalized = option.toLowerCase();
    const actionMatch = /^(?:action|option)[-_ ]?(\d+)$/.exec(normalized);
    if (!actionMatch) {
        return normalized;
    }

    const optionIndex = Number(actionMatch[1]) - 1;
    const configuredOption = config.options?.[optionIndex];
    return configuredOption ? configuredOption.toLowerCase() : normalized;
}
