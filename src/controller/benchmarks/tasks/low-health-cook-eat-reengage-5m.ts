import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const LOW_HEALTH_COOK_EAT_REENGAGE_5M_TASK_ID = 'low-health-cook-eat-reengage-5m';
export const LOW_HEALTH_COOK_EAT_REENGAGE_5M_TASK_VERSION = '0.1.0';
export const LOW_HEALTH_COOK_EAT_REENGAGE_5M_BUDGET_MS = 5 * 60 * 1000;
const LOW_HEALTH_COOK_EAT_REENGAGE_5M_TIMEOUT_MS = LOW_HEALTH_COOK_EAT_REENGAGE_5M_BUDGET_MS + 30_000;

const START_POSITION = { x: 3222, y: 3218, level: 0 };
const RAW_SHRIMP_ITEM_ID = 317;
const COOKED_SHRIMP_ITEM_ID = 315;
const LOW_HP_FRACTION = 0.4;
const SAFE_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin|man|woman)\b/i;

export interface LowHealthCookEatReengage5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface LowHealthCookEatReengage5mVerificationInput {
    elapsedMs: number;
    actions: LowHealthCookEatReengage5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeLowHealthCookEatReengage5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: LOW_HEALTH_COOK_EAT_REENGAGE_5M_TASK_ID,
        version: LOW_HEALTH_COOK_EAT_REENGAGE_5M_TASK_VERSION,
        timeoutMs: LOW_HEALTH_COOK_EAT_REENGAGE_5M_TIMEOUT_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: RAW_SHRIMP_ITEM_ID }, { itemId: 590 }, { itemId: 1511 }, { itemId: 1351 }],
            initialSkills: { hitpoints: { exp: 1154, level: 3 } },
        },
        setup: async context => {
            if (!context.ensureInventoryItem) {
                context.recordSummary('Gateway inventory ensure unavailable; relying on create-time benchmark inventory.');
                return;
            }
            await context.ensureInventoryItem({ itemId: RAW_SHRIMP_ITEM_ID }, 1);
            await context.ensureInventoryItem({ itemId: 590 }, 1);
            await context.ensureInventoryItem({ itemId: 1511 }, 1);
            await context.ensureInventoryItem({ itemId: 1351 }, 1);
            context.recordSummary('Ensured raw fish and cooking tools after connecting benchmark resident.');
        },
        run: async context => {
            const startedAt = now();
            context.recordSummary('Observe low-health recovery chain: cook raw fish, eat, then safely reengage combat.');
            while (!context.signal.aborted && now() - startedAt < LOW_HEALTH_COOK_EAT_REENGAGE_5M_BUDGET_MS) {
                const outcome = verifyLowHealthCookEatReengage5m({
                    elapsedMs: now() - startedAt,
                    actions: [...context.actionAttempts()],
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }
            return verifyLowHealthCookEatReengage5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observe selected-module low-health cook/eat/reengage recovery under autonomous control.');
            while (!context.signal.aborted && now() - startedAt < LOW_HEALTH_COOK_EAT_REENGAGE_5M_BUDGET_MS) {
                const outcome = verifyLowHealthCookEatReengage5m({
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
            return verifyLowHealthCookEatReengage5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyLowHealthCookEatReengage5m(input: LowHealthCookEatReengage5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = lowHealthCookEatReengageMetrics(input);
    if (input.elapsedMs > LOW_HEALTH_COOK_EAT_REENGAGE_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'low-health-cook-eat-reengage-5m exceeded the 5 minute budget before recovery evidence was observed',
        };
    }
    if (metrics.recoveryChain === 0) {
        return {
            status: 'failed',
            score: 0.5,
            metrics,
            failureReason: 'No ordered low-health cook/eat/reengage chain was observed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['low-health-cook-eat-reengage-5m observed a low-health resident cooked food, ate it, and reengaged safely.'],
    };
}

function lowHealthCookEatReengageMetrics(input: LowHealthCookEatReengage5mVerificationInput): Record<string, number> {
    const lowHealthStartObserved = startsAtLowHealth(input.perceptions) ? 1 : 0;
    const rawFishInitiallyCarried = initiallyCarriesRawFish(input.perceptions) ? 1 : 0;
    const successfulCookingActions = input.actions.filter(attempt => isSuccessfulAttempt(attempt) && isCookAction(attempt.action)).length;
    const eatActions = input.actions.filter(attempt => isSuccessfulAttempt(attempt) && attempt.action.kind === 'eat').length;
    const hpImprovedAfterEat = hasHpRecoveryAfterEat(input.actions, input.perceptions) ? 1 : 0;
    const safeReengageAttacks = orderedSafeReengageAttacks(input.actions).length;
    const recoveryChain =
        lowHealthStartObserved === 1 &&
        rawFishInitiallyCarried === 1 &&
        successfulCookingActions > 0 &&
        eatActions > 0 &&
        hpImprovedAfterEat === 1 &&
        safeReengageAttacks > 0
            ? 1
            : 0;

    return {
        actionsAttempted: input.actions.length,
        lowHealthStartObserved,
        rawFishInitiallyCarried,
        successfulCookingActions,
        eatActions,
        hpImprovedAfterEat,
        safeReengageAttacks,
        recoveryChain,
        combatEvidence: hasCombatEvidence(input.events, input.perceptions) ? 1 : 0,
        cookedFishObserved: cookedFishObserved(input.perceptions) ? 1 : 0,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): LowHealthCookEatReengage5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function startsAtLowHealth(perceptions: Perception[]): boolean {
    const first = perceptions.at(0);
    if (!first) {
        return false;
    }
    const hp = residentHp(first);
    return hp.current > 0 && hp.max > 0 && hp.current / hp.max <= LOW_HP_FRACTION;
}

function initiallyCarriesRawFish(perceptions: Perception[]): boolean {
    const first = perceptions.at(0);
    return first ? inventory(first).some(entry => isRawFish(entry)) : false;
}

function cookedFishObserved(perceptions: Perception[]): boolean {
    return perceptions.some(perception => inventory(perception).some(entry => isCookedFish(entry)));
}

function hasHpRecoveryAfterEat(actions: LowHealthCookEatReengage5mActionAttempt[], perceptions: Perception[]): boolean {
    const eatIndex = actions.findIndex(attempt => isSuccessfulAttempt(attempt) && attempt.action.kind === 'eat');
    if (eatIndex < 0 || perceptions.length < 2) {
        return false;
    }
    const baselineHp = residentHp(perceptions[0]).current;
    return perceptions.some(perception => residentHp(perception).current > baselineHp);
}

function orderedSafeReengageAttacks(actions: LowHealthCookEatReengage5mActionAttempt[]): LowHealthCookEatReengage5mActionAttempt[] {
    const eatIndex = actions.findIndex(attempt => isSuccessfulAttempt(attempt) && attempt.action.kind === 'eat');
    if (eatIndex < 0) {
        return [];
    }
    return actions.filter((attempt, index) => index > eatIndex && isSuccessfulAttempt(attempt) && isSafeAttackAction(attempt.action));
}

function hasCombatEvidence(events: PerceptionEvent[], perceptions: Perception[]): boolean {
    return (
        events.some(event => {
            const kind = recordString(event, 'kind');
            return kind === 'hit_dealt' || kind === 'hit_taken';
        }) ||
        perceptions.some(perception => {
            const combatTarget = recordField(perception.resident, 'combatTarget');
            return isSafeCombatTarget(combatTarget);
        })
    );
}

function isCookAction(action: AgentAction): boolean {
    if (action.kind === 'use_item_on' || action.kind === 'use_item_on_item') {
        const cause = action.cause || '';
        return /cook/i.test(cause) || cause === 'low_health_cook_food';
    }
    return false;
}

function isSafeAttackAction(action: AgentAction): boolean {
    if (action.kind !== 'attack') {
        return false;
    }
    return isSafeCombatTarget(action.target);
}

function isSafeCombatTarget(target: unknown): boolean {
    const key = combatTargetKey(target);
    return SAFE_TARGET_PATTERN.test(key);
}

function combatTargetKey(target: unknown): string {
    if (!isRecord(target)) {
        return '';
    }
    const key = recordString(target, 'key') || '';
    const name = recordString(target, 'name') || '';
    return `${key} ${name}`.toLowerCase();
}

function isSuccessfulAttempt(attempt: LowHealthCookEatReengage5mActionAttempt): boolean {
    if (attempt.finalStatus) {
        return attempt.finalStatus === 'success';
    }
    return attempt.result?.ok !== false;
}

function residentHp(perception: Perception): { current: number; max: number } {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const hp = recordField(resident, 'hp');
    return {
        current: numericField(hp, 'current', 0),
        max: Math.max(1, numericField(hp, 'max', 1)),
    };
}

function inventory(perception: Perception): Array<Record<string, unknown>> {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const raw = Array.isArray(resident.inventory) ? resident.inventory : [];
    return raw.filter(isRecord);
}

function isRawFish(entry: Record<string, unknown>): boolean {
    return numericField(entry, 'itemId', -1) === RAW_SHRIMP_ITEM_ID || /raw_shrimp/i.test(recordString(entry, 'key') || '');
}

function isCookedFish(entry: Record<string, unknown>): boolean {
    return numericField(entry, 'itemId', -1) === COOKED_SHRIMP_ITEM_ID || /^rs:shrimp$/i.test(recordString(entry, 'key') || '');
}

function recordField(record: unknown, key: string): unknown {
    if (!isRecord(record)) {
        return undefined;
    }
    return record[key];
}

function recordString(record: unknown, key: string): string | undefined {
    const value = recordField(record, key);
    return typeof value === 'string' ? value : undefined;
}

function numericField(record: unknown, key: string, fallback = 0): number {
    const value = recordField(record, key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
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
