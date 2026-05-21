import { type ActionResult, type AgentAction, AgentActionSchema } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import type { Appearance } from '@engine/world/actor/player/player-data';
import { z } from 'zod';

export const AGENT_PROTOCOL_VERSION = 1;

export type ResidentFilter = 'online' | 'offline' | 'all';
export type DisconnectPolicy = 'logout' | 'idle';
export type SpectatorMode = 'follow' | 'free-camera' | 'picture-in-picture';
export type SpectatorSubject = { kind: 'resident'; name: string } | { kind: 'player'; username: string };
export type InitialContainerItem = number | string | { itemId: number; amount?: number } | null;
export type SpectatorPacketType = 'FIXED' | 'DYNAMIC_SMALL' | 'DYNAMIC_LARGE';

export interface SpectatorRsPacketFrame {
    opcode: number;
    type: SpectatorPacketType;
    updateTask: boolean;
    payloadLength: number;
    payloadBase64: string;
    frameLength: number;
    frameBase64: string;
}

export interface AgentFrame<TKind extends string = string, TPayload = unknown> {
    v: 1;
    id?: string | number;
    kind: TKind;
    payload: TPayload;
}

export interface ResidentSummary {
    name: string;
    online: boolean;
    controllerId?: string;
    controlHeld?: boolean;
}

export interface ObservableSubjectSummary {
    subject: SpectatorSubject;
    online: boolean;
    position?: { x: number; y: number; level: number };
}

export type ClientMessage =
    | AgentFrame<'auth', { token?: string }>
    | AgentFrame<'controller_hello', { controllerId: string; version: string; capabilities?: string[] }>
    | AgentFrame<'gateway_status', Record<string, never>>
    | AgentFrame<'list_residents', { filter?: ResidentFilter }>
    | AgentFrame<'list_observable_subjects', { includeResidents?: boolean; includePlayers?: boolean }>
    | AgentFrame<'observe_subject', { subject: SpectatorSubject; mode?: SpectatorMode }>
    | AgentFrame<'unobserve_subject', { sessionId: string }>
    | AgentFrame<
          'create_resident',
          {
              name: string;
              spawnPosition?: { x: number; y: number; level?: number };
              appearance?: Appearance;
              initialInventory?: InitialContainerItem[];
              initialEquipment?: InitialContainerItem[];
          }
      >
    | AgentFrame<'connect_resident', { name: string; observe?: boolean; control?: boolean; onDisconnect?: DisconnectPolicy }>
    | AgentFrame<'attach', { name: string; observe?: boolean; control?: boolean }>
    | AgentFrame<'submit_action', { name: string; action: AgentAction }>
    | AgentFrame<'detach', { name: string }>
    | AgentFrame<'disconnect_resident', { name: string; cause?: string }>
    | AgentFrame<'pause_resident', { name: string; cause?: string }>
    | AgentFrame<'delete_resident', { name: string }>;

export type ServerMessage =
    | AgentFrame<'gateway_status', { allowDelete: boolean }>
    | AgentFrame<'resident_list', { residents: ResidentSummary[] }>
    | AgentFrame<'observable_subject_list', { subjects: ObservableSubjectSummary[] }>
    | AgentFrame<'resident_created', { resident: ResidentSummary }>
    | AgentFrame<'resident_connected', { resident: ResidentSummary; perception: Perception | null }>
    | AgentFrame<'resident_disconnected', { name: string; cause?: string }>
    | AgentFrame<'resident_paused', { name: string; cause?: string }>
    | AgentFrame<'spectator_connected', { sessionId: string; subject: SpectatorSubject; initialState: unknown }>
    | AgentFrame<'spectator_rebuild', { sessionId: string; payload: unknown }>
    | AgentFrame<'spectator_packet', { sessionId: string; opcode: number; payload: SpectatorRsPacketFrame }>
    | AgentFrame<
          'spectator_perception',
          { sessionId: string; perception: Perception; position?: { x: number; y: number; level: number }; regionId?: number }
      >
    | AgentFrame<'spectator_disconnected', { sessionId: string; cause?: string }>
    | AgentFrame<'perception', { resident_id: string; perception: Perception }>
    | AgentFrame<'action_result', { resident_id: string; request_id?: string | number; result: ActionResult; cause?: string }>
    | AgentFrame<'event', { resident_id: string; event: unknown }>
    | AgentFrame<'ok', { ok: true; result?: ActionResult }>
    | AgentFrame<'error', { request_id?: string | number; code: string; message: string; cause?: string }>;

const requestIdSchema = z.union([z.string(), z.number()]).optional();
const residentFilterSchema = z.enum(['online', 'offline', 'all']).optional();
const disconnectPolicySchema = z.enum(['logout', 'idle']).optional();
const spectatorModeSchema = z.enum(['follow', 'free-camera', 'picture-in-picture']).optional();
const positionSchema = z.object({ x: z.number().int(), y: z.number().int(), level: z.number().int().optional() });
const appearanceSchema = z.object({
    gender: z.number().int(),
    head: z.number().int(),
    torso: z.number().int(),
    arms: z.number().int(),
    legs: z.number().int(),
    hands: z.number().int(),
    feet: z.number().int(),
    facialHair: z.number().int(),
    hairColor: z.number().int(),
    torsoColor: z.number().int(),
    legColor: z.number().int(),
    feetColor: z.number().int(),
    skinColor: z.number().int(),
});
const initialContainerItemSchema = z.union([
    z.number().int().positive(),
    z.string().min(1),
    z.object({ itemId: z.number().int().positive(), amount: z.number().int().positive().optional() }),
    z.null(),
]);
const spectatorSubjectSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('resident'), name: z.string().min(1) }),
    z.object({ kind: z.literal('player'), username: z.string().min(1) }),
]);

const clientPayloadSchemas = {
    auth: z.object({ token: z.string().optional() }),
    controller_hello: z.object({
        controllerId: z.string().min(1),
        version: z.string().min(1),
        capabilities: z.array(z.string()).optional(),
    }),
    gateway_status: z.object({}).default({}),
    list_residents: z.object({ filter: residentFilterSchema }).default({}),
    list_observable_subjects: z.object({ includeResidents: z.boolean().optional(), includePlayers: z.boolean().optional() }).default({}),
    observe_subject: z.object({ subject: spectatorSubjectSchema, mode: spectatorModeSchema }),
    unobserve_subject: z.object({ sessionId: z.string().min(1) }),
    create_resident: z.object({
        name: z.string().min(1),
        spawnPosition: positionSchema.optional(),
        appearance: appearanceSchema.optional(),
        initialInventory: z.array(initialContainerItemSchema).optional(),
        initialEquipment: z.array(initialContainerItemSchema).optional(),
    }),
    connect_resident: z.object({
        name: z.string().min(1),
        observe: z.boolean().optional(),
        control: z.boolean().optional(),
        onDisconnect: disconnectPolicySchema,
    }),
    attach: z.object({
        name: z.string().min(1),
        observe: z.boolean().optional(),
        control: z.boolean().optional(),
    }),
    submit_action: z.object({ name: z.string().min(1), action: AgentActionSchema }),
    detach: z.object({ name: z.string().min(1) }),
    disconnect_resident: z.object({ name: z.string().min(1), cause: z.string().optional() }),
    pause_resident: z.object({ name: z.string().min(1), cause: z.string().optional() }),
    delete_resident: z.object({ name: z.string().min(1) }),
} satisfies Record<ClientMessage['kind'], z.ZodTypeAny>;

const agentFrameSchema = z.object({
    v: z.literal(AGENT_PROTOCOL_VERSION),
    id: requestIdSchema,
    kind: z.string(),
    payload: z.unknown(),
});

export const frame = <TKind extends ServerMessage['kind']>(
    kind: TKind,
    payload: Extract<ServerMessage, { kind: TKind }>['payload'],
    id?: string | number,
): Extract<ServerMessage, { kind: TKind }> =>
    ({
        v: AGENT_PROTOCOL_VERSION,
        id,
        kind,
        payload,
    }) as Extract<ServerMessage, { kind: TKind }>;

export const parseClientMessage = (raw: string | Buffer): ClientMessage => {
    const parsed = agentFrameSchema.parse(JSON.parse(raw.toString()));
    const payloadSchema = clientPayloadSchemas[parsed.kind as ClientMessage['kind']];
    if (!payloadSchema) {
        throw new Error(`Unsupported agent protocol message kind: ${parsed.kind}`);
    }
    return { ...parsed, payload: payloadSchema.parse(parsed.payload) } as ClientMessage;
};
