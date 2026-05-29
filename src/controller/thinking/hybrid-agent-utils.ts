import type { AgentAction } from '../transport/message-codecs';
import type { RuntimeState } from '../memory/runtime-state';

// --- Shared Types ---

export type Pos = { x: number; y: number; level: number };
export type Item = { itemId: number; key?: string; amount: number };
export type WorldItem = Item & { position: Pos; ownerId?: string };
export type Actor = {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    name?: string;
    key?: string;
    position: Pos;
    hpFraction?: number;
    combatLevel?: number;
};
export type ActiveTrade = {
    partner?: Actor;
    ours?: Item[];
    theirs?: Item[];
    ourStage?: string;
    theirStage?: string;
};
export type HybridPerception = {
    tick?: number;
    resident?: {
        id?: string;
        position?: Pos;
        hp?: { current?: number; max?: number };
        combatLevel?: number;
        inCombat?: boolean;
        combatTarget?: Actor | null;
        busy?: boolean;
        inventory?: Array<Item | null>;
        quests?: Record<string, { progress?: number | string; complete?: boolean }>;
        activeTrade?: ActiveTrade;
    };
    nearby?: {
        players?: Actor[];
        npcs?: Actor[];
        worldItems?: WorldItem[];
        objects?: Array<{ objectId: number; position: Pos; orientation?: number }>;
    };
    events?: Array<Record<string, unknown>>;
};

export const TARGET_FAILURE_COOLDOWN_TICKS = 600;

// --- Utility Functions ---

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function positionLike(value: unknown): Pos | undefined {
    if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        return undefined;
    }
    return { x: value.x, y: value.y, level: typeof value.level === 'number' ? value.level : 0 };
}

export function actorLike(value: unknown): Actor | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
        return undefined;
    }
    const position = positionLike(value.position);
    if (!position || !['player', 'npc', 'resident'].includes(value.kind)) {
        return undefined;
    }
    return {
        id: value.id,
        kind: value.kind as Actor['kind'],
        name: typeof value.name === 'string' ? value.name : undefined,
        key: typeof value.key === 'string' ? value.key : undefined,
        position,
        hpFraction: typeof value.hpFraction === 'number' ? value.hpFraction : undefined,
        combatLevel: typeof value.combatLevel === 'number' ? value.combatLevel : undefined,
    };
}

export function worldItemLike(value: unknown): WorldItem | undefined {
    if (!isRecord(value) || typeof value.itemId !== 'number' || typeof value.amount !== 'number') {
        return undefined;
    }

    const position = positionLike(value.position);
    if (!position) {
        return undefined;
    }

    return {
        itemId: value.itemId,
        key: typeof value.key === 'string' ? value.key : undefined,
        amount: value.amount,
        position,
        ownerId: typeof value.ownerId === 'string' ? value.ownerId : undefined,
    };
}

export function positionsEqual(a: Pos, b: Pos): boolean {
    return a.x === b.x && a.y === b.y && a.level === b.level;
}

export function isMoveTo(action: AgentAction, target: Pos | undefined): boolean {
    if (!target || action.kind !== 'move_to' || !isRecord(action.target)) {
        return false;
    }
    return action.target.x === target.x && action.target.y === target.y && (action.target.level ?? 0) === target.level;
}

export function actionTargetPosition(action: AgentAction): Pos | undefined {
    if (
        !['interact', 'use_item_on', 'attack', 'trade_request'].includes(action.kind) ||
        !('target' in action) ||
        !isRecord(action.target)
    ) {
        return undefined;
    }

    return positionLike(action.target.position);
}

export function objectTileMoveTarget(action: AgentAction, perception: HybridPerception): Pos | undefined {
    if (action.kind !== 'move_to' || !('target' in action)) {
        return undefined;
    }

    const target = positionLike(action.target);
    if (!target || !(perception.nearby?.objects || []).some(object => positionsEqual(object.position, target))) {
        return undefined;
    }

    return target;
}

export function stepToward(here: Pos, target: Pos, maxStep: number): Pos {
    const dx = target.x - here.x;
    const dy = target.y - here.y;
    if (Math.abs(dy) > maxStep) {
        return {
            x: here.x,
            y: here.y + clampStep(dy, maxStep),
            level: target.level ?? here.level ?? 0,
        };
    }

    if (Math.abs(dx) > maxStep) {
        return {
            x: here.x + clampStep(dx, maxStep),
            y: here.y,
            level: target.level ?? here.level ?? 0,
        };
    }

    return {
        x: target.x,
        y: here.y + clampStep(dy, maxStep),
        level: target.level ?? here.level ?? 0,
    };
}

export function clampStep(delta: number, maxStep: number): number {
    if (delta === 0) {
        return 0;
    }
    return Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
}

export function countPhrase(count: number, singular: string, plural = `${singular}s`): string | undefined {
    if (count <= 0) {
        return undefined;
    }
    return `${count} ${count === 1 ? singular : plural}`;
}

export function joinSpeechList(parts: string[]): string | undefined {
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    if (parts.length === 2) {
        return `${parts[0]} and ${parts[1]}`;
    }
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function displayName(name: string): string {
    return name.replace(/^res:/i, '');
}

export function normalizeText(text: string): string {
    return text
        .replace(/^res:/i, '')
        .replace(/^player:/i, '')
        .trim()
        .toLowerCase();
}

export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function targetFailureKey(target: unknown): string | undefined {
    return targetFailureKeys(target)[0];
}

export function targetFailureKeys(target: unknown): string[] {
    if (!isRecord(target)) {
        return [];
    }
    const targetRecord = target;
    const position = positionLike(target) || positionLike(targetRecord.position);
    if (!position) {
        return [];
    }
    const coordinate = positionKey(position);
    const keys: string[] = [];
    if (typeof targetRecord.objectId === 'number') {
        keys.push(`object:${targetRecord.objectId}:${coordinate}`);
    }
    if (typeof targetRecord.itemId === 'number') {
        keys.push(`item:${targetRecord.itemId}:${coordinate}`);
    }
    if (typeof targetRecord.id === 'string') {
        keys.push(`actor:${targetRecord.id}:${coordinate}`);
        if (isNpcTarget(targetRecord)) {
            keys.push(...npcFamilyFailureKeys(targetRecord));
        }
    }
    keys.push(`target:${coordinate}`);
    return keys;
}

export function isTargetFailureCooldownActive(
    target: unknown,
    cooldowns: Record<string, number> | undefined,
    currentTick: number,
): boolean {
    if (!cooldowns) {
        return false;
    }
    const keys = new Set(targetFailureKeys(target));
    const position = isRecord(target) ? positionLike(target) || positionLike(target.position) : positionLike(target);
    const coordinate = position ? positionKey(position) : undefined;
    return Object.entries(cooldowns).some(([key, failedAt]) => {
        if (currentTick - failedAt >= TARGET_FAILURE_COOLDOWN_TICKS) {
            return false;
        }
        return keys.has(key) || Boolean(coordinate && (key === `target:${coordinate}` || key.endsWith(`:${coordinate}`)));
    });
}

export function withoutTargetFailedPerception(
    perception: HybridPerception,
    cooldowns: Record<string, number> | undefined,
    currentTick: number,
): HybridPerception {
    if (!cooldowns || Object.keys(cooldowns).length === 0) {
        return perception;
    }

    const keepTarget = (target: unknown): boolean => !isTargetFailureCooldownActive(target, cooldowns, currentTick);
    const nearby = perception.nearby || {};
    return {
        ...perception,
        nearby: {
            ...nearby,
            objects: (nearby.objects || []).filter(keepTarget),
            worldItems: (nearby.worldItems || []).filter(keepTarget),
            npcs: (nearby.npcs || []).filter(keepTarget),
            players: (nearby.players || []).filter(keepTarget),
        },
    };
}

export function shouldRememberNpcFamilyTargetFailure(target: unknown, cause?: string): boolean {
    if (!isRecord(target) || !isNpcTarget(target)) {
        return false;
    }
    const normalizedCause = (cause || '').toLowerCase();
    return normalizedCause.includes('explore') || normalizedCause.includes('scout') || normalizedCause.includes('stuck');
}

export function isNpcTarget(targetRecord: Record<string, unknown>): boolean {
    const kind = typeof targetRecord.kind === 'string' ? targetRecord.kind.toLowerCase() : undefined;
    return kind === 'npc' || (typeof targetRecord.id === 'string' && targetRecord.id.startsWith('npc:'));
}

export function npcFamilyFailureKeys(targetRecord: Record<string, unknown>): string[] {
    const keys: string[] = [];
    const key = failureKeyFragment(targetRecord.key);
    if (key) {
        keys.push(`actor-key:${key}`);
    }
    const name = failureKeyFragment(targetRecord.name);
    if (name) {
        keys.push(`actor-name:${name}`);
    }
    return keys;
}

export function failureKeyFragment(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
}

export function positionKey(position: Pos): string {
    return `${position.x},${position.y},${position.level}`;
}

export function resetClockSensitiveCognition(state: RuntimeState, perceptionTick: number): void {
    const cognition = state.cognition || {};
    const followTarget = cognition.followTarget ? { ...cognition.followTarget, setAtTick: perceptionTick } : undefined;
    state.cognition = { followTarget };
    state.lastMeaningfulProgressAt = undefined;
    state.stuckSince = undefined;
    state.budgets.lastTick = undefined;
    state.budgets.requestsThisTick = undefined;
}
