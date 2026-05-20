export interface Position {
    x: number;
    y: number;
    level?: number;
}

export interface ActorRef {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    key?: string;
    name?: string;
    position: Required<Position>;
    hpFraction?: number;
}

export interface ItemRef {
    itemId: number;
    key?: string;
    amount: number;
    noted?: boolean;
}

export interface WorldItemRef extends ItemRef {
    position: Required<Position>;
    ownerId?: string;
}

export interface ObjectRef {
    objectId: number;
    position: Required<Position>;
    orientation?: number;
}

export type AgentAction =
    | { kind: 'move_to'; target: Position }
    | { kind: 'face'; target: ActorRef | Position }
    | { kind: 'interact'; target: ActorRef | ObjectRef | WorldItemRef; option: string }
    | { kind: 'use_item_on'; itemSlot: number; target: ActorRef | ObjectRef | WorldItemRef }
    | { kind: 'attack'; target: ActorRef }
    | { kind: 'cast_spell'; spellKey: string; target?: ActorRef }
    | { kind: 'equip'; slot: number }
    | { kind: 'unequip'; equipmentSlot: string }
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
    | { kind: 'noop'; cause?: string };

export interface ActionResult {
    ok: boolean;
    reason?: string;
    cause?: string;
    [key: string]: unknown;
}

export interface PerceptionEvent {
    kind?: string;
    [key: string]: unknown;
}

export interface Perception {
    tick?: number;
    resident?: {
        id?: string;
        position?: Required<Position>;
        hp?: { current: number; max: number };
        busy?: boolean;
        inCombat?: boolean;
        inventory?: ReadonlyArray<ItemRef | null>;
        equipment?: ReadonlyArray<ItemRef | null>;
        [key: string]: unknown;
    };
    nearby?: {
        players?: ReadonlyArray<ActorRef>;
        npcs?: ReadonlyArray<ActorRef>;
        worldItems?: ReadonlyArray<WorldItemRef>;
        objects?: ReadonlyArray<ObjectRef>;
        [key: string]: unknown;
    };
    events?: ReadonlyArray<PerceptionEvent>;
    availableActions?: ReadonlyArray<unknown>;
    [key: string]: unknown;
}

export interface ResidentSummary {
    name: string;
    online: boolean;
    controllerId?: string;
    controlHeld?: boolean;
}

export interface ResidentAssignment {
    name: string;
    goal: GoalName;
    home?: Position;
    bornAt?: string;
    assignedAt: string;
    notes?: string;
}

export type GoalName = 'wander' | 'collect_items' | 'talk_to_npcs' | 'socialize' | 'work_loop' | 'survive';

export interface SimulationState {
    version: 1;
    residents: ResidentAssignment[];
}

export interface SimulationConfig {
    gateway: {
        url: string;
        authToken?: string;
        controllerId: string;
        requestTimeoutMs: number;
    };
    residents: {
        prefix: string;
        count: number;
        spawnPosition?: Position;
    };
    runtime: {
        durationMs: number;
        actionIntervalTicks: number;
        autoBirth: boolean;
        disconnectOnStop: boolean;
        logFullPerceptions: boolean;
    };
    paths: {
        stateDir: string;
        logDir: string;
    };
    goals: GoalName[];
}

export interface CliOptions {
    configPath?: string;
    count?: number;
    prefix?: string;
    durationMs?: number;
    goal?: GoalName;
    resident?: string[];
    spawnPosition?: Position;
    outPath?: string;
}

export interface NormalizedFrame {
    id?: string | number;
    kind: string;
    payload: Record<string, unknown>;
}
