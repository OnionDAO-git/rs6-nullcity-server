import type { EquipmentSlot } from '@engine/config/item-config';
import type { TradePerceptionState, TradeStage } from '@engine/world/actor/trade/trade-events';
import type { DamageType } from '@engine/world/actor/update-flags';
import { z } from 'zod';

export interface Pos {
    x: number;
    y: number;
    level?: number;
}

export interface ActorRef {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    key?: string;
    name?: string;
    position: Required<Pos>;
    hpFraction?: number;
}

export interface ItemRef {
    itemId: number;
    key?: string;
    amount: number;
    noted?: boolean;
}

export interface WorldItemRef extends ItemRef {
    position: Required<Pos>;
    ownerId?: string;
}

export interface ObjectRef {
    objectId: number;
    position: Required<Pos>;
    orientation?: number;
}

export type AgentAction =
    | { kind: 'move_to'; target: Pos }
    | { kind: 'face'; target: ActorRef | Pos }
    | { kind: 'interact'; target: ActorRef | ObjectRef | WorldItemRef; option: string }
    | { kind: 'use_item_on'; itemSlot: number; target: ActorRef | ObjectRef | WorldItemRef }
    | { kind: 'attack'; target: ActorRef }
    | { kind: 'cast_spell'; spellKey: string; target?: ActorRef }
    | { kind: 'equip'; slot: number }
    | { kind: 'unequip'; equipmentSlot: EquipmentSlot }
    | { kind: 'drop'; slot: number }
    | { kind: 'eat'; slot: number }
    | { kind: 'say'; text: string }
    | { kind: 'whisper'; to: string; text: string }
    | { kind: 'dialogue_continue' }
    | { kind: 'dialogue_choice'; optionIndex: number }
    | { kind: 'trade_request'; target: ActorRef }
    | { kind: 'trade_offer_item'; inventorySlot: number; amount: number }
    | { kind: 'trade_remove_item'; offerSlot: number; amount: number }
    | { kind: 'trade_accept_stage_1' }
    | { kind: 'trade_accept_stage_2' }
    | { kind: 'trade_decline' }
    | { kind: 'logout'; cause?: string }
    | { kind: 'noop' };

export type ActionResult = { ok: true; cause?: string } | { ok: false; reason: string; cause?: string };

export type AgentActionShape =
    | { kind: 'move_to' }
    | { kind: 'interact'; target: ActorRef | ObjectRef | WorldItemRef; options: string[] }
    | { kind: 'attack'; target: ActorRef }
    | { kind: 'equip'; slots: number[] }
    | { kind: 'drop'; slots: number[] }
    | { kind: 'trade_request'; targets: ActorRef[] }
    | { kind: 'trade_offer_item'; slots: number[] }
    | { kind: 'trade_remove_item'; slots: number[] }
    | { kind: 'trade_accept_stage_1' }
    | { kind: 'trade_accept_stage_2' }
    | { kind: 'trade_decline' }
    | { kind: 'say' }
    | { kind: 'logout' }
    | { kind: 'noop' };

export type PerceptionEvent =
    | { kind: 'hit_taken'; from: ActorRef; damage: number; type: DamageType }
    | { kind: 'hit_dealt'; to: ActorRef; damage: number; type: DamageType }
    | { kind: 'chat'; from: ActorRef; text: string; to?: ActorRef | 'public' }
    | { kind: 'item_received'; item: ItemRef }
    | { kind: 'item_lost'; item: ItemRef }
    | { kind: 'died'; attacker: ActorRef | null }
    | { kind: 'dialogue_opened'; npc: ActorRef; prompt?: string; options?: string[] }
    | { kind: 'dialogue_updated'; prompt?: string; options?: string[] }
    | { kind: 'dialogue_closed' }
    | { kind: 'trade_requested'; from: ActorRef }
    | { kind: 'trade_opened'; partner: ActorRef; sessionId: string }
    | {
          kind: 'trade_offer_updated';
          ours: ItemRef[];
          theirs: ItemRef[];
          ourStage: TradeStage;
          theirStage: TradeStage;
      }
    | { kind: 'trade_completed'; received: ItemRef[]; given: ItemRef[] }
    | { kind: 'trade_cancelled'; reason: string }
    | { kind: 'arrived' }
    | { kind: 'level_up'; skill: string; level: number };

export type ActiveTrade = TradePerceptionState;

export const PosSchema = z.object({
    x: z.number().int(),
    y: z.number().int(),
    level: z.number().int().optional(),
});

export const ActorRefSchema = z.object({
    id: z.string().min(1),
    kind: z.enum(['player', 'npc', 'resident']),
    key: z.string().optional(),
    name: z.string().optional(),
    position: PosSchema.required({ level: true }),
    hpFraction: z.number().min(0).max(1).optional(),
});

export const ItemRefSchema = z.object({
    itemId: z.number().int().nonnegative(),
    key: z.string().optional(),
    amount: z.number().int().positive(),
    noted: z.boolean().optional(),
});

export const WorldItemRefSchema = ItemRefSchema.extend({
    position: PosSchema.required({ level: true }),
    ownerId: z.string().optional(),
});

export const ObjectRefSchema = z.object({
    objectId: z.number().int().nonnegative(),
    position: PosSchema.required({ level: true }),
    orientation: z.number().int().optional(),
});

const targetSchema = z.union([ActorRefSchema, ObjectRefSchema, WorldItemRefSchema]);
const equipmentSlotSchema = z.enum([
    'head',
    'back',
    'neck',
    'main_hand',
    'off_hand',
    'torso',
    'legs',
    'hands',
    'feet',
    'ring',
    'quiver',
    '2h',
]);

export const AgentActionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('move_to'), target: PosSchema }),
    z.object({ kind: z.literal('face'), target: z.union([ActorRefSchema, PosSchema]) }),
    z.object({ kind: z.literal('interact'), target: targetSchema, option: z.string().min(1) }),
    z.object({ kind: z.literal('use_item_on'), itemSlot: z.number().int().nonnegative(), target: targetSchema }),
    z.object({ kind: z.literal('attack'), target: ActorRefSchema }),
    z.object({ kind: z.literal('cast_spell'), spellKey: z.string().min(1), target: ActorRefSchema.optional() }),
    z.object({ kind: z.literal('equip'), slot: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('unequip'), equipmentSlot: equipmentSlotSchema }),
    z.object({ kind: z.literal('drop'), slot: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('eat'), slot: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('say'), text: z.string() }),
    z.object({ kind: z.literal('whisper'), to: z.string().min(1), text: z.string() }),
    z.object({ kind: z.literal('dialogue_continue') }),
    z.object({ kind: z.literal('dialogue_choice'), optionIndex: z.number().int() }),
    z.object({ kind: z.literal('trade_request'), target: ActorRefSchema }),
    z.object({ kind: z.literal('trade_offer_item'), inventorySlot: z.number().int().nonnegative(), amount: z.number().int().positive() }),
    z.object({ kind: z.literal('trade_remove_item'), offerSlot: z.number().int().nonnegative(), amount: z.number().int().positive() }),
    z.object({ kind: z.literal('trade_accept_stage_1') }),
    z.object({ kind: z.literal('trade_accept_stage_2') }),
    z.object({ kind: z.literal('trade_decline') }),
    z.object({ kind: z.literal('logout'), cause: z.string().optional() }),
    z.object({ kind: z.literal('noop') }),
]) satisfies z.ZodType<AgentAction>;

export const isWorldItemRef = (value: ActorRef | ObjectRef | WorldItemRef): value is WorldItemRef =>
    'itemId' in value && 'position' in value;

export const isObjectRef = (value: ActorRef | ObjectRef | WorldItemRef): value is ObjectRef => 'objectId' in value && 'position' in value;

export const isActorRef = (value: ActorRef | ObjectRef | WorldItemRef | Pos): value is ActorRef => 'kind' in value && 'id' in value;
