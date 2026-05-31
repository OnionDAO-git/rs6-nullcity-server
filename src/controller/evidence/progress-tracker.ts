export interface ProgressSnapshot {
    tick: number;
    xpBySkill: Record<string, number>;
    inventoryCount: number;
    positionHash: string;
    hp: number;
}

export interface ProgressDelta {
    meaningful: boolean;
    reasons: string[];
    newStuck: boolean;
    stuckSince: number | null;
}

export interface ProgressThresholds {
    xpDelta: number;
    inventoryDelta: number;
    hpDelta: number;
    stuckThresholdTicks: number;
}

const DEFAULT_THRESHOLDS: ProgressThresholds = {
    xpDelta: 1,
    inventoryDelta: 1,
    hpDelta: 1,
    stuckThresholdTicks: 45,
};

export class ProgressTracker {
    private previous: ProgressSnapshot | null = null;
    private lastMeaningfulTick: number | null = null;
    private stuckSinceTick: number | null = null;
    private readonly thresholds: ProgressThresholds;

    constructor(thresholds: Partial<ProgressThresholds> = {}) {
        this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    }

    observe(snapshot: ProgressSnapshot): ProgressDelta {
        const previous = this.previous;
        this.previous = cloneSnapshot(snapshot);

        if (!previous) {
            this.lastMeaningfulTick = snapshot.tick;
            this.stuckSinceTick = null;
            return { meaningful: true, reasons: ['initial_sample'], newStuck: false, stuckSince: null };
        }

        const reasons = progressReasons(previous, snapshot, this.thresholds);
        const meaningful = reasons.length > 0;
        if (meaningful) {
            this.lastMeaningfulTick = snapshot.tick;
            this.stuckSinceTick = null;
            return { meaningful, reasons, newStuck: false, stuckSince: null };
        }

        const lastMeaningfulTick = this.lastMeaningfulTick ?? previous.tick;
        const isStuck = snapshot.tick - lastMeaningfulTick >= this.thresholds.stuckThresholdTicks;
        const newStuck = isStuck && this.stuckSinceTick === null;
        if (newStuck) {
            this.stuckSinceTick = snapshot.tick;
        }

        return { meaningful: false, reasons: [], newStuck, stuckSince: this.stuckSinceTick };
    }

    recordMeaningful(tick: number, reason: string): ProgressDelta {
        this.lastMeaningfulTick = tick;
        this.stuckSinceTick = null;
        return { meaningful: true, reasons: [reason], newStuck: false, stuckSince: null };
    }

    reset(): void {
        this.previous = null;
        this.lastMeaningfulTick = null;
        this.stuckSinceTick = null;
    }

    current(): ProgressSnapshot | null {
        return this.previous ? cloneSnapshot(this.previous) : null;
    }
}

function progressReasons(previous: ProgressSnapshot, current: ProgressSnapshot, thresholds: ProgressThresholds): string[] {
    const reasons: string[] = [];
    const skills = new Set([...Object.keys(previous.xpBySkill), ...Object.keys(current.xpBySkill)]);
    for (const skill of [...skills].sort()) {
        const delta = (current.xpBySkill[skill] || 0) - (previous.xpBySkill[skill] || 0);
        if (delta >= thresholds.xpDelta) {
            reasons.push(`xp_gain:${skill}:${delta}`);
        }
    }

    const inventoryDelta = current.inventoryCount - previous.inventoryCount;
    if (Math.abs(inventoryDelta) >= thresholds.inventoryDelta) {
        reasons.push(`inventory:${formatDelta(inventoryDelta)}`);
    }

    if (current.positionHash !== previous.positionHash) {
        reasons.push('position_changed');
    }

    const hpDelta = current.hp - previous.hp;
    if (Math.abs(hpDelta) >= thresholds.hpDelta) {
        reasons.push(`hp:${formatDelta(hpDelta)}`);
    }

    return reasons;
}

function formatDelta(delta: number): string {
    return delta > 0 ? `+${delta}` : `${delta}`;
}

function cloneSnapshot(snapshot: ProgressSnapshot): ProgressSnapshot {
    return {
        ...snapshot,
        xpBySkill: { ...snapshot.xpBySkill },
    };
}
