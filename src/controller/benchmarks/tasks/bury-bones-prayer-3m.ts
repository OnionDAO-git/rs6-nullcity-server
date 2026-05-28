import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const BURY_BONES_PRAYER_3M_TASK_ID = 'bury-bones-prayer-3m';
export const BURY_BONES_PRAYER_3M_TASK_VERSION = '0.1.0';
export const BURY_BONES_PRAYER_3M_BUDGET_MS = 3 * 60 * 1000;

export interface BuryBonesPrayer3mActionAttempt {
    action: AgentAction;
}

export interface BuryBonesPrayer3mVerificationInput {
    elapsedMs: number;
    actions: BuryBonesPrayer3mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeBuryBonesPrayer3mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: BURY_BONES_PRAYER_3M_TASK_ID,
        version: BURY_BONES_PRAYER_3M_TASK_VERSION,
        timeoutMs: BURY_BONES_PRAYER_3M_BUDGET_MS,
        resident: {
            spawnPosition: { x: 3242, y: 3208, level: 0 },
            initialInventory: [{ itemId: 526 }],
        },
        run: async context => {
            const startedAt = now();
            const actions: BuryBonesPrayer3mActionAttempt[] = [];
            const action: AgentAction = { kind: 'item_action', slot: 0, option: 'bury', cause: 'benchmark_bury_bones_prayer_3m' };
            actions.push({ action });
            await context.submitAction(action);
            context.recordSummary('Submitted bury action for carried bones.');

            while (!context.signal.aborted && now() - startedAt < BURY_BONES_PRAYER_3M_BUDGET_MS) {
                const outcome = verifyBuryBonesPrayer3m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }

            return verifyBuryBonesPrayer3m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for bury-bones-prayer-3m.');

            while (!context.signal.aborted && now() - startedAt < BURY_BONES_PRAYER_3M_BUDGET_MS) {
                const outcome = verifyBuryBonesPrayer3m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }

            return verifyBuryBonesPrayer3m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyBuryBonesPrayer3m(input: BuryBonesPrayer3mVerificationInput): BenchmarkTaskOutcome {
    const metrics = buryBonesPrayerMetrics(input);
    if (input.elapsedMs > BURY_BONES_PRAYER_3M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'bury-bones-prayer-3m exceeded the 3 minute budget before success was observed',
        };
    }
    if (metrics.buryActions === 0) {
        return { status: 'failed', score: 0, metrics, failureReason: 'No bury bones action was attempted' };
    }
    if (metrics.bonesConsumed === 0) {
        return { status: 'failed', score: 0.4, metrics, failureReason: 'Bury action was attempted, but bones were not consumed' };
    }
    if (metrics.prayerXpIncreased === 0 && metrics.prayerLevelEvents === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Bones were consumed, but no Prayer XP or level progress was observed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['bury-bones-prayer-3m observed carried bones consumed for Prayer progress.'],
    };
}

function buryBonesPrayerMetrics(input: BuryBonesPrayer3mVerificationInput): Record<string, number> {
    const events = allEvents(input);
    return {
        actionsAttempted: input.actions.length,
        buryActions: input.actions.filter(attempt => isBuryAction(attempt.action)).length,
        bonesConsumed: bonesConsumed(input.perceptions) || events.some(isBonesLostEvent) ? 1 : 0,
        prayerXpIncreased: prayerXpIncreased(input.perceptions) ? 1 : 0,
        prayerLevelEvents: events.filter(isPrayerLevelEvent).length,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): BuryBonesPrayer3mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function isBuryAction(action: AgentAction): boolean {
    return action.kind === 'item_action' && /^bury$/i.test(stringField(action, 'option') || '');
}

function bonesConsumed(perceptions: Perception[]): boolean {
    if (perceptions.length < 2 || bonesCount(perceptions[0]) <= 0) {
        return false;
    }
    return perceptions.slice(1).some(perception => bonesCount(perception) < bonesCount(perceptions[0]));
}

function bonesCount(perception: Perception): number {
    return inventory(perception).reduce<number>((total, item) => total + (isBones(item) ? numericField(item, 'amount', 1) : 0), 0);
}

function prayerXpIncreased(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    const first = prayerXp(perceptions[0]);
    if (first === undefined) {
        return false;
    }
    return perceptions.slice(1).some(perception => {
        const xp = prayerXp(perception);
        return xp !== undefined && xp > first;
    });
}

function prayerXp(perception: Perception): number | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const skills = isRecord(resident.skills) ? resident.skills : {};
    const prayer = isRecord(skills.prayer) ? skills.prayer : undefined;
    if (!prayer) {
        return undefined;
    }
    const xp = numericField(prayer, 'xp', Number.NaN);
    return Number.isFinite(xp) ? xp : undefined;
}

function allEvents(input: BuryBonesPrayer3mVerificationInput): unknown[] {
    return [...input.events, ...input.perceptions.flatMap(perception => (Array.isArray(perception.events) ? perception.events : []))];
}

function isBonesLostEvent(event: unknown): boolean {
    return isRecord(event) && event.kind === 'item_lost' && isBones(event.item);
}

function isPrayerLevelEvent(event: unknown): boolean {
    return isRecord(event) && event.kind === 'level_up' && event.skill === 'prayer';
}

function isBones(item: unknown): boolean {
    if (!isRecord(item)) {
        return false;
    }
    const key = stringField(item, 'key') || '';
    return numericField(item, 'itemId', -1) === 526 || /^rs:(bones|bones_.+|.+_bones)$/i.test(key);
}

function inventory(perception: Perception): unknown[] {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? resident.inventory : [];
}

function stringField(value: unknown, field: string): string | undefined {
    return isRecord(value) && typeof value[field] === 'string' ? value[field] : undefined;
}

function numericField(value: unknown, field: string, fallback: number): number {
    return isRecord(value) && typeof value[field] === 'number' ? value[field] : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const timeout = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout);
                resolve();
            },
            { once: true },
        );
    });
}
