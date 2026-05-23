import { z } from 'zod';

export type ResidentFilter = 'online' | 'offline' | 'all';
export type DisconnectPolicy = 'logout' | 'idle';
export const AGENT_PROTOCOL_VERSION = 1;

export interface GatewayEnvelope<TType extends string = string, TPayload = unknown> {
    v: typeof AGENT_PROTOCOL_VERSION;
    id?: string | number;
    kind: TType;
    payload?: TPayload;
}

export interface ControllerHelloPayload {
    controllerId: string;
    version: string;
    capabilities: string[];
}

export interface AuthPayload {
    token: string;
}

export interface ResidentSummary {
    name: string;
    online: boolean;
    controllerId?: string;
    controllingClientId?: string;
}

/**
 * G4 trading verbs — controller-facing typed forms.
 *
 * Distinct from the engine wire types in
 * `src/engine/world/actor/resident/action/agent-action.ts`, which use
 * `inventorySlot`+`amount`+`ActorRef` and the two-stage accept. The
 * controller form is what brain/body code constructs; the body adapter is
 * responsible for translating to the engine form when needed.
 *
 * Spec: docs/superpowers/specs/2026-05-22-smarter-behavior-design.md § G4.
 */
export interface TradeActionTarget {
    residentId?: string;
    playerHandle?: string;
}

export type AgentAction = (
    | { kind: 'noop'; cause?: string }
    | { kind: 'logout'; cause?: string }
    | { kind: 'trade_request'; cause?: string; target: TradeActionTarget }
    | { kind: 'trade_offer_item'; cause?: string; itemId: number; quantity: number; slot?: number }
    | { kind: 'trade_accept'; cause?: string }
    | { kind: 'trade_decline'; cause?: string; reason?: string }
    | ({ kind: string; cause?: string } & Record<string, unknown>)
) & {
    voiceSource?: 'phrasebook' | 'inference' | 'scripted';
    helpRequestReason?: string;
};

export interface ActionResult {
    ok: boolean;
    cause?: string;
    [key: string]: unknown;
}

export interface Perception {
    tick?: number;
    [key: string]: unknown;
}

export interface PerceptionEvent {
    kind?: string;
    [key: string]: unknown;
}

export type InitialContainerItem = number | string | { itemId: number; amount?: number } | null;

export interface CreateResidentPayload {
    name: string;
    spawnPosition?: unknown;
    initialInventory?: InitialContainerItem[];
    initialEquipment?: InitialContainerItem[];
}

export interface ConnectResidentPayload {
    name: string;
    observe: boolean;
    control: boolean;
    onDisconnect?: DisconnectPolicy;
}

export interface SubmitActionPayload {
    name: string;
    action: AgentAction;
}

export interface ResidentNamePayload {
    name: string;
    cause?: string;
}

export type ClientMessage =
    | GatewayEnvelope<'auth', AuthPayload>
    | GatewayEnvelope<'controller_hello', ControllerHelloPayload>
    | GatewayEnvelope<'list_residents', { filter?: ResidentFilter }>
    | GatewayEnvelope<'create_resident', CreateResidentPayload>
    | GatewayEnvelope<'connect_resident', ConnectResidentPayload>
    | GatewayEnvelope<'attach', ConnectResidentPayload>
    | GatewayEnvelope<'submit_action', SubmitActionPayload>
    | GatewayEnvelope<'detach', ResidentNamePayload>
    | GatewayEnvelope<'disconnect_resident', ResidentNamePayload>
    | GatewayEnvelope<'pause_resident', ResidentNamePayload>
    | GatewayEnvelope<'delete_resident', ResidentNamePayload>;

export type ServerMessage =
    | GatewayEnvelope<'resident_list', { residents: ResidentSummary[] }>
    | GatewayEnvelope<'resident_created', { resident: ResidentSummary }>
    | GatewayEnvelope<'resident_connected', { resident: ResidentSummary; perception?: Perception | null }>
    | GatewayEnvelope<'resident_disconnected', ResidentNamePayload & { cause?: string }>
    | GatewayEnvelope<'resident_paused', ResidentNamePayload & { cause?: string }>
    | GatewayEnvelope<'perception', { resident_id: string; perception: Perception }>
    | GatewayEnvelope<'action_result', { resident_id: string; request_id?: string | number; result: ActionResult; cause?: string }>
    | GatewayEnvelope<'event', { resident_id: string; event: PerceptionEvent }>
    | GatewayEnvelope<'ok', { ok: true }>
    | GatewayEnvelope<'error', { request_id?: string | number; code: string; message: string; cause?: string }>
    | GatewayEnvelope<string, unknown>;

export const hookConditionSchema = z.object({ kind: z.string().min(1) }).passthrough();

const posSchema = z.object({
    x: z.number(),
    y: z.number(),
    level: z.number().optional(),
});

const actorRefSchema = z.object({
    id: z.string(),
    kind: z.enum(['player', 'npc', 'resident']),
    key: z.string().optional(),
    name: z.string().optional(),
    position: posSchema.required(),
    hpFraction: z.number().optional(),
});

const itemRefSchema = z.object({
    itemId: z.number().int(),
    key: z.string().optional(),
    amount: z.number().int().positive(),
    noted: z.boolean().optional(),
});

const worldItemRefSchema = itemRefSchema.extend({
    position: posSchema.required(),
    ownerId: z.string().optional(),
});

const objectRefSchema = z.object({
    objectId: z.number().int(),
    position: posSchema.required(),
    orientation: z.number().optional(),
});

/** Controller-facing trade target. See {@link TradeActionTarget}. */
export const tradeActionTargetSchema = z
    .object({
        residentId: z.string().min(1).optional(),
        playerHandle: z.string().min(1).optional(),
    })
    .refine(value => value.residentId !== undefined || value.playerHandle !== undefined, {
        message: 'trade target must include residentId or playerHandle',
    });

export const agentActionSchema: z.ZodType<AgentAction> = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('noop'), cause: z.string().optional() }),
    z.object({ kind: z.literal('logout'), cause: z.string().optional() }),
    z.object({ kind: z.literal('move_to'), target: posSchema, range: z.number().int().min(0).max(32).optional() }),
    z.object({ kind: z.literal('face'), target: z.union([actorRefSchema, posSchema]) }),
    z.object({ kind: z.literal('interact'), target: z.union([actorRefSchema, objectRefSchema, worldItemRefSchema]), option: z.string() }),
    z.object({
        kind: z.literal('use_item_on'),
        itemSlot: z.number().int().nonnegative(),
        target: z.union([actorRefSchema, objectRefSchema, worldItemRefSchema]),
    }),
    z.object({ kind: z.literal('use_item_on_item'), itemSlot: z.number().int().nonnegative(), targetSlot: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('attack'), target: actorRefSchema }),
    z.object({ kind: z.literal('cast_spell'), spellKey: z.string(), target: actorRefSchema.optional() }),
    z.object({ kind: z.literal('item_action'), slot: z.number().int().nonnegative(), option: z.string().min(1) }),
    z.object({ kind: z.literal('equip'), slot: z.number().int().nonnegative() }),
    z.object({
        kind: z.literal('unequip'),
        equipmentSlot: z.enum(['head', 'back', 'neck', 'main_hand', 'off_hand', 'torso', 'legs', 'hands', 'feet', 'ring', 'quiver', '2h']),
    }),
    z.object({ kind: z.literal('drop'), slot: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('eat'), slot: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('say'), text: z.string().min(1).max(240) }),
    z.object({ kind: z.literal('whisper'), to: z.string().min(1), text: z.string().min(1).max(240) }),
    z.object({ kind: z.literal('dialogue_continue') }),
    z.object({ kind: z.literal('dialogue_choice'), optionIndex: z.number().int().nonnegative() }),
    // G4: controller-side trade_request accepts the controller-facing target
    // shape OR the legacy engine-side ActorRef. Action adapter translates.
    z.object({
        kind: z.literal('trade_request'),
        cause: z.string().optional(),
        target: z.union([tradeActionTargetSchema, actorRefSchema]),
    }),
    // G4: controller-side `trade_offer_item` is itemId + quantity (+ optional
    // slot). Existing engine-side `inventorySlot` + `amount` form is still
    // accepted via the union; adapter resolves itemId↔slot.
    z.object({
        kind: z.literal('trade_offer_item'),
        cause: z.string().optional(),
        itemId: z.number().int().positive().optional(),
        quantity: z.number().int().positive().optional(),
        slot: z.number().int().nonnegative().optional(),
        inventorySlot: z.number().int().nonnegative().optional(),
        amount: z.number().int().positive().optional(),
    }),
    z.object({ kind: z.literal('trade_remove_item'), offerSlot: z.number().int().nonnegative(), amount: z.number().int().positive() }),
    z.object({ kind: z.literal('trade_accept_stage_1') }),
    z.object({ kind: z.literal('trade_accept_stage_2') }),
    // G4: collapsed single-step accept verb for brain/body authoring.
    z.object({ kind: z.literal('trade_accept'), cause: z.string().optional() }),
    z.object({ kind: z.literal('trade_decline'), cause: z.string().optional(), reason: z.string().optional() }),
]) as z.ZodType<AgentAction>;

export const gatewayEnvelopeSchema = z.object({
    v: z.literal(AGENT_PROTOCOL_VERSION),
    id: z.union([z.string(), z.number()]).optional(),
    kind: z.string().min(1),
    payload: z.unknown().optional(),
});

export function encodeMessage(message: GatewayEnvelope<string, unknown>): string {
    return JSON.stringify(message);
}

export function decodeMessage(raw: string | Buffer | ArrayBuffer | Buffer[]): ServerMessage {
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as Buffer).toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    const envelope = gatewayEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
        throw new Error(`Gateway message schema error: ${envelope.error.issues.map(issue => issue.message).join('; ')}`);
    }

    return envelope.data as unknown as ServerMessage;
}

export function makeRequest<TType extends string, TPayload>(
    kind: TType,
    requestId: string,
    payload?: TPayload,
): GatewayEnvelope<TType, TPayload> {
    return payload === undefined
        ? { v: AGENT_PROTOCOL_VERSION, kind, id: requestId }
        : { v: AGENT_PROTOCOL_VERSION, kind, id: requestId, payload };
}

export function readError(message: ServerMessage): { request_id?: string; code: string; message: string; cause?: string } | undefined {
    if (message.kind !== 'error' || !isRecord(message.payload)) {
        return undefined;
    }

    const payload = message.payload;
    const requestId = typeof payload.request_id === 'string' || typeof payload.request_id === 'number' ? payload.request_id : message.id;
    return {
        request_id: requestId === undefined ? undefined : String(requestId),
        code: typeof payload.code === 'string' ? payload.code : 'EUNKNOWN',
        message: typeof payload.message === 'string' ? payload.message : 'Unknown gateway error',
        cause: typeof payload.cause === 'string' ? payload.cause : undefined,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
