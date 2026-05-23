import fs from 'fs';
import path from 'path';

export interface RuntimeState {
    resident: string;
    attention: number;
    tick: number;
    cognition?: CognitiveState;
    legacy: {
        kind: string;
        progress: Record<string, unknown>;
        complete: boolean;
    };
    budgets: {
        minuteStartedAt: string;
        dayStartedAt: string;
        requestsThisMinute: number;
        requestsToday: number;
        lastTick?: number;
        requestsThisTick?: number;
        noInferenceUntil?: string;
    };
    variables?: Record<string, number>;
    hookCooldowns?: Record<string, number>;
    shadowedHooks?: Array<{ tick: number; id: string; priority: number; shadowedBy: string }>;
    previousIntent?: unknown;
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
    deceased?: {
        date: string;
        tick: number;
        cause: string;
    };
}

export interface CognitiveState {
    activeGoal?: ActiveGoalState;
    activeMove?: ActiveMoveState;
    followTarget?: FollowTargetState;
    pendingCombatNarration?: PendingCombatNarrationState;
    lastBrainTick?: number;
    lastBodyTick?: number;
    lastGoalShareTick?: number;
    lastAnchorReturnTick?: number;
    lastBodyActionKey?: string;
    lastBodyActionTick?: number;
    lastDirectChatKey?: string;
    lastPresenceBeaconTick?: number;
    routineLoopKey?: string;
    routineLoopCount?: number;
    lastRoutineLoopBreakTick?: number;
    lastExplorationReportTick?: number;
    pickupCooldowns?: Record<string, number>;
    explorationCooldowns?: Record<string, number>;
    consecutiveNonCombatTicks?: number;
    combatEpisodeActive?: boolean;
    combatEpisodeNarrated?: boolean;
    combatEndCelebrated?: boolean;
}

export interface FollowTargetState {
    name?: string;
    id?: string;
    kind?: string;
    paused?: boolean;
    setAtTick: number;
}

export interface PendingCombatNarrationState {
    text: string;
    cause: string;
    setAtTick: number;
}

export interface ActiveMoveState {
    target: { x: number; y: number; level: number };
    range?: number;
    cause?: string;
    startedAtTick: number;
    lastTick: number;
    lastPositionKey?: string;
    stationaryCount?: number;
}

export interface ActiveGoalState {
    id: string;
    description: string;
    steps?: string[];
    success?: string;
    createdAtTick: number;
    ttlTicks?: number;
}

export class RuntimeStateStore {
    constructor(private readonly memoryRoot: string) {}

    load(resident: string, initialAttention: number, legacyKind: string): RuntimeState {
        const statePath = this.statePath(resident);
        if (!fs.existsSync(statePath)) {
            return this.create(resident, initialAttention, legacyKind);
        }

        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as RuntimeState;
        return {
            ...this.create(resident, initialAttention, legacyKind),
            ...parsed,
            resident,
        };
    }

    save(state: RuntimeState): void {
        const statePath = this.statePath(state.resident);
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }

    private create(resident: string, attention: number, legacyKind: string): RuntimeState {
        const now = new Date().toISOString();
        return {
            resident,
            attention,
            tick: 0,
            legacy: {
                kind: legacyKind,
                progress: {},
                complete: false,
            },
            budgets: {
                minuteStartedAt: now,
                dayStartedAt: now,
                requestsThisMinute: 0,
                requestsToday: 0,
            },
            variables: {},
            hookCooldowns: {},
            shadowedHooks: [],
        };
    }

    private statePath(resident: string): string {
        return path.join(this.memoryRoot, residentSlug(resident), 'runtime-state.json');
    }
}

export function residentSlug(resident: string): string {
    return resident
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();
}

export function markDeceased(state: RuntimeState, cause: string): void {
    state.deceased = {
        date: new Date().toISOString(),
        tick: state.tick,
        cause,
    };
}
