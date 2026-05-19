import { findItem } from '@engine/config/config-handler';
import { widgets } from '@engine/config/config-handler';
import { activeWorld } from '@engine/world';
import { findSpellByKey } from '@engine/world/actor/magic';
import type { Npc } from '@engine/world/actor/npc';
import type { Player } from '@engine/world/actor/player/player';
import type { Resident } from '@engine/world/actor/resident/resident';
import { TradeEngine } from '@engine/world/actor/trade/trade-engine';
import type { WorldItem } from '@engine/world/items/world-item';
import { Position } from '@engine/world/position';
import type { LandscapeObject } from '@runejs/filestore';
import { filestore } from '@server/game/game-server';
import {
    type ActionResult,
    type ActorRef,
    type AgentAction,
    type ObjectRef,
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
                return this.moveTo(resident, action.target);
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
                resident.emitPerceptionEvent({ kind: 'chat', from: resident.toActorRef(), text: action.text, to: 'public' });
                resident.playerEvents.emit('chat', action.text);
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
            case 'cast_spell':
                return this.castSpell(resident, action.spellKey, action.target);
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

    private moveTo(resident: Resident, target: Pos): ActionResult {
        const targetPosition = new Position(target.x, target.y, target.level ?? resident.position.level);
        resident.pathfinding.walkTo(targetPosition, {
            pathingSearchRadius: Math.max(2, Math.floor(resident.position.distanceBetween(targetPosition)) + 2),
            ignoreDestination: true,
        });
        return { ok: true };
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
                option.toLowerCase(),
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
            const index = Number(ref.id.replace(/^npc:/, ''));
            return activeWorld.npcList[index] || null;
        }

        const username = ref.id.replace(/^player:/, '').replace(/^resident:/, '');
        return activeWorld.findActivePlayerByUsername(username);
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
