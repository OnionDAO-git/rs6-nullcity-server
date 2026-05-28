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
    lastIdleInitiativeTick?: number;
    lastIdleInitiativeAt?: string;
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
    deceased?: {
        date: string;
        tick: number;
        cause: string;
        processed?: boolean;
    };
    activeTradeResource?: ActiveTradeResourceState;
}

export interface CognitiveState {
    activeGoal?: ActiveGoalState;
    activeMove?: ActiveMoveState;
    followTarget?: FollowTargetState;
    pendingDirectTrade?: PendingDirectTradeState;
    pendingQuestDialogue?: PendingQuestDialogueState;
    pendingCombatNarration?: PendingCombatNarrationState;
    lastBrainTick?: number;
    brainBackoffUntilTick?: number;
    lastBodyTick?: number;
    lastGoalShareTick?: number;
    lastAnchorReturnTick?: number;
    lastBodyActionKey?: string;
    lastBodyActionTick?: number;
    lastDirectChatKey?: string;
    manualPauseSinceTick?: number;
    lastPresenceBeaconTick?: number;
    lastLowHealthSpeechTick?: number;
    routineLoopKey?: string;
    routineLoopCount?: number;
    lastRoutineLoopBreakTick?: number;
    lastExplorationReportTick?: number;
    lastScoutingSkillOpportunityTick?: number;
    pickupCooldowns?: Record<string, number>;
    explorationCooldowns?: Record<string, number>;
    targetFailureCooldowns?: Record<string, number>;
    consecutiveNonCombatTicks?: number;
    combatEpisodeActive?: boolean;
    combatEpisodeNarrated?: boolean;
    combatEndCelebrated?: boolean;
    tickTelemetry?: Record<string, any>;
    chatReplyTicks?: number[];
    waitResumeTick?: number;
    pausedGoal?: ActiveGoalState;
    pausedFollowTarget?: FollowTargetState;
}

export interface FollowTargetState {
    name?: string;
    id?: string;
    kind?: string;
    paused?: boolean;
    setAtTick: number;
}

export interface PendingDirectTradeState {
    target: {
        id: string;
        kind: string;
        name?: string;
        key?: string;
        position: { x: number; y: number; level: number };
        hpFraction?: number;
        combatLevel?: number;
    };
    setAtTick: number;
}

export interface PendingQuestDialogueState {
    questId: string;
    step: number;
    startedAtTick: number;
    updatedAtTick: number;
}

export interface ActiveTradeResourceState {
    targetHandle: string;
    artifact: string;
    quantity: number;
    note?: string;
    cause?: string;
    startTick: number;
    status: 'initiating' | 'offering' | 'accepting_stage_1' | 'accepting_stage_2' | 'completed' | 'cancelled';
    attemptId: string;
    producer: string;
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
    lastDistance?: number;
    bestDistance?: number;
    lastImprovedTick?: number;
    nonImprovingCount?: number;
    equalDistanceDetourCount?: number;
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

        let parsed: RuntimeState;
        try {
            parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as RuntimeState;
        } catch {
            this.quarantineCorruptState(statePath);
            return this.create(resident, initialAttention, legacyKind);
        }
        return {
            ...this.create(resident, initialAttention, legacyKind),
            ...parsed,
            resident,
        };
    }

    save(state: RuntimeState): void {
        const statePath = this.statePath(state.resident);
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
        fs.renameSync(tmpPath, statePath);
    }

    /**
     * Returns true when the resident's on-disk state exists and has no
     * `deceased` entry. Used by the sibling-epitaph-sender seam (HD-012)
     * to pick the first living sibling at death-time without loading the
     * full state into memory.
     */
    isAlive(resident: string): boolean {
        const statePath = this.statePath(resident);
        if (!fs.existsSync(statePath)) {
            return false;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<RuntimeState>;
            return !raw.deceased;
        } catch {
            return false;
        }
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

    private quarantineCorruptState(statePath: string): void {
        const suffix = new Date()
            .toISOString()
            .replace(/[^0-9A-Za-z]+/g, '-')
            .replace(/-$/g, '');
        fs.renameSync(statePath, `${statePath}.corrupt-${suffix}`);
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

export function addAttention(state: RuntimeState, amount: number): void {
    state.attention = Math.max(0, state.attention + amount);
    if (state.attention > 0 && state.deceased?.cause === 'attention_exhausted') {
        delete state.deceased;
    }
}
