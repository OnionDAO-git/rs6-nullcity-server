import { type ActionResult, type AgentAction, AgentActionSchema } from '@engine/world/actor/resident/action/agent-action';
import type { Perception } from '@engine/world/actor/resident/perception/perception-types';
import { z } from 'zod';

export const AGENT_PROTOCOL_VERSION = 1;

export type ResidentFilter = 'online' | 'offline' | 'all';
export type DisconnectPolicy = 'logout' | 'idle';

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

export type ClientMessage =
    | AgentFrame<'auth', { token?: string }>
    | AgentFrame<'controller_hello', { controllerId: string; version: string; capabilities?: string[] }>
    | AgentFrame<'list_residents', { filter?: ResidentFilter }>
    | AgentFrame<
          'create_resident',
          {
              name: string;
              spawnPosition?: { x: number; y: number; level?: number };
              initialInventory?: unknown[];
              initialEquipment?: unknown[];
          }
      >
    | AgentFrame<'connect_resident', { name: string; observe?: boolean; control?: boolean; onDisconnect?: DisconnectPolicy }>
    | AgentFrame<'attach', { name: string; observe?: boolean; control?: boolean }>
    | AgentFrame<'submit_action', { name: string; action: AgentAction }>
    | AgentFrame<'detach', { name: string }>
    | AgentFrame<'disconnect_resident', { name: string; cause?: string }>
    | AgentFrame<'delete_resident', { name: string }>;

export type ServerMessage =
    | AgentFrame<'resident_list', { residents: ResidentSummary[] }>
    | AgentFrame<'resident_created', { resident: ResidentSummary }>
    | AgentFrame<'resident_connected', { resident: ResidentSummary; perception: Perception | null }>
    | AgentFrame<'resident_disconnected', { name: string; cause?: string }>
    | AgentFrame<'perception', { resident_id: string; perception: Perception }>
    | AgentFrame<'action_result', { resident_id: string; request_id?: string | number; result: ActionResult; cause?: string }>
    | AgentFrame<'event', { resident_id: string; event: unknown }>
    | AgentFrame<'ok', { ok: true }>
    | AgentFrame<'error', { request_id?: string | number; code: string; message: string; cause?: string }>;

const requestIdSchema = z.union([z.string(), z.number()]).optional();
const residentFilterSchema = z.enum(['online', 'offline', 'all']).optional();
const disconnectPolicySchema = z.enum(['logout', 'idle']).optional();
const positionSchema = z.object({ x: z.number().int(), y: z.number().int(), level: z.number().int().optional() });

const clientPayloadSchemas = {
    auth: z.object({ token: z.string().optional() }),
    controller_hello: z.object({
        controllerId: z.string().min(1),
        version: z.string().min(1),
        capabilities: z.array(z.string()).optional(),
    }),
    list_residents: z.object({ filter: residentFilterSchema }).default({}),
    create_resident: z.object({
        name: z.string().min(1),
        spawnPosition: positionSchema.optional(),
        initialInventory: z.array(z.unknown()).optional(),
        initialEquipment: z.array(z.unknown()).optional(),
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
