import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const COMBAT_PRAYER_10M_TASK_ID = 'combat-prayer-10m';
export const COMBAT_PRAYER_10M_TASK_VERSION = '0.1.0';
export const COMBAT_PRAYER_10M_BUDGET_MS = 10 * 60 * 1000;

const START_POSITION = { x: 3254, y: 3230, level: 0 };
const FALLBACK_GOBLIN = {
    id: 'npc:100',
    kind: 'npc',
    key: 'rs:goblin',
    name: 'Goblin',
    position: { x: 3254, y: 3231, level: 0 },
    hpFraction: 1,
};
const MAX_REPEATED_COMBAT_ACTIONS = 12;
const BONE_ITEM_IDS = new Set([526, 528, 530, 532, 534, 536]);
const BONE_KEY_PATTERN = /^rs:(bones|bones_.+|.+_bones)$/i;
const SAFE_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin)\b/i;
const UNSAFE_TARGET_PATTERN = /\b(goblin_guard|guard|dragon|demon|wizard)\b/i;

export interface CombatPrayer10mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface CombatPrayer10mVerificationInput {
    elapsedMs: number;
    actions: CombatPrayer10mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeCombatPrayer10mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: COMBAT_PRAYER_10M_TASK_ID,
        version: COMBAT_PRAYER_10M_TASK_VERSION,
        timeoutMs: COMBAT_PRAYER_10M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: 315 }, { itemId: 315 }, { itemId: 315 }],
            initialEquipment: [null, null, null, { itemId: 9703 }, null, { itemId: 9704 }],
        },
        run: async context => {
            const startedAt = now();
            const actions: CombatPrayer10mActionAttempt[] = [];
            context.recordSummary('Running scripted combat-prayer-10m smoke.');

            while (!context.signal.aborted && now() - startedAt < COMBAT_PRAYER_10M_BUDGET_MS) {
                const outcome = verifyCombatPrayer10m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed' || outcome.metrics?.unsafeLoops || outcome.metrics?.deathEvents) {
                    return outcome;
                }

                const perception = context.latestPerception();
                const nextAction = nextScriptedAction(perception, actions);
                if (nextAction) {
                    const attempt: CombatPrayer10mActionAttempt = { action: nextAction };
                    actions.push(attempt);
                    attempt.result = await context.submitAction(nextAction);
                }

                await sleep(1000, context.signal);
            }

            return verifyCombatPrayer10m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for combat-prayer-10m.');

            while (!context.signal.aborted && now() - startedAt < COMBAT_PRAYER_10M_BUDGET_MS) {
                const outcome = verifyCombatPrayer10m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed' || outcome.metrics?.unsafeLoops || outcome.metrics?.deathEvents) {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }

            return verifyCombatPrayer10m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyCombatPrayer10m(input: CombatPrayer10mVerificationInput): BenchmarkTaskOutcome {
    const metrics = combatPrayerMetrics(input);
    if (input.elapsedMs > COMBAT_PRAYER_10M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'combat-prayer-10m exceeded the 10 minute budget before success was observed',
        };
    }

    if (metrics.deathEvents > 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'The resident died before completing safe combat prayer training',
        };
    }

    if (metrics.unsafeTargetActions > 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'Unsafe combat target action was attempted',
        };
    }

    if (metrics.safeAttackActions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No selected-module safe combat action was attempted',
        };
    }

    if (metrics.unsafeLoops > 0) {
        return {
            status: 'failed',
            score: 0.15,
            metrics,
            failureReason: 'Detected unsafe loop: repeated combat-prayer action without progress evidence',
        };
    }

    if (metrics.combatEvidence === 0) {
        return {
            status: 'failed',
            score: 0.25,
            metrics,
            failureReason: 'No combat evidence was observed after the safe attack',
        };
    }

    if (metrics.bonesEvidence === 0) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'No combat-supplied bones evidence was observed',
        };
    }

    if (metrics.orderedActionChain === 0) {
        return {
            status: 'failed',
            score: 0.55,
            metrics,
            failureReason: 'No ordered combat-prayer action chain was observed',
        };
    }

    if (metrics.buryActions === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Bones were acquired after combat, but no bury action was attempted',
        };
    }

    if (metrics.prayerSuccess === 0) {
        return {
            status: 'failed',
            score: 0.75,
            metrics,
            failureReason: 'Bury was attempted, but no Prayer success evidence was observed',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['combat-prayer-10m observed safe combat, combat-supplied bones, burial, and Prayer progress.'],
    };
}

function combatPrayerMetrics(input: CombatPrayer10mVerificationInput): Record<string, number> {
    const attackActions = input.actions.filter(attempt => isCombatAttackAction(attempt.action));
    const safeAttackActions = input.actions.filter(attempt => isSafeAttackAction(attempt.action) && isSuccessfulAttempt(attempt));
    const unsafeTargetActions = attackActions.filter(attempt => !isSafeAttackAction(attempt.action)).length;
    const buryActions = input.actions.filter(attempt => isBuryAction(attempt.action) && isSuccessfulAttempt(attempt)).length;
    const pickupBonesActions = input.actions.filter(attempt => isPickupBonesAction(attempt.action)).length;
    const combatEvidence = hasCombatEvidence(input) ? 1 : 0;
    const externalBonesSupplyActions = countExternalBonesSupplyActions(input);
    const bonesEvidence = combatEvidence && hasCombatSuppliedBonesEvidence(input, externalBonesSupplyActions) ? 1 : 0;
    const prayerXpIncreasedValue = prayerXpIncreased(input.perceptions) ? 1 : 0;
    const prayerLevelEvents = allEvents(input).filter(isPrayerLevelEvent).length;
    const bonesLostEvents = allEvents(input).filter(isBonesLostEvent).length;
    const bonesConsumedAfterGainValue = bonesConsumedAfterGain(input.perceptions) ? 1 : 0;
    const orderedActionChainValue = orderedActionChain(input.actions) ? 1 : 0;
    const prayerSuccessValue = prayerXpIncreasedValue || prayerLevelEvents ? 1 : 0;
    const unsafeLoopDetected = repeatedActionLoop(input.actions.filter(isCombatPrayerLoopAction));
    const completedPrayerChain = orderedActionChainValue === 1 && bonesEvidence === 1 && prayerSuccessValue === 1;
    const madeCombatBonesProgress = combatEvidence === 1 && bonesEvidence === 1;

    return {
        actionsAttempted: input.actions.length,
        attackActions: attackActions.length,
        safeAttackActions: safeAttackActions.length,
        unsafeTargetActions,
        pickupBonesActions,
        buryActions,
        orderedActionChain: orderedActionChainValue,
        combatEvidence,
        bonesEvidence,
        bonesAppeared: bonesAppeared(input.perceptions) ? 1 : 0,
        bonesReceivedEvents: allEvents(input).filter(isBonesReceivedEvent).length,
        externalBonesSupplyActions,
        bonesConsumedAfterGain: bonesConsumedAfterGainValue,
        prayerXpIncreased: prayerXpIncreasedValue,
        prayerLevelEvents,
        bonesLostEvents,
        prayerSuccess: prayerSuccessValue,
        deathEvents: allEvents(input).filter(isDeathEvent).length,
        survivalActions: input.actions.filter(attempt => attempt.action.kind === 'eat' || attempt.action.cause === 'combat_retreat').length,
        unsafeLoops: unsafeLoopDetected && !completedPrayerChain && !madeCombatBonesProgress ? 1 : 0,
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): CombatPrayer10mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function nextScriptedAction(perception: Perception | undefined, actions: CombatPrayer10mActionAttempt[]): AgentAction | undefined {
    if (!perception) {
        return undefined;
    }
    const bonesSlot = inventory(perception).findIndex(isBones);
    if (bonesSlot >= 0 && !actions.some(attempt => isBuryAction(attempt.action))) {
        return { kind: 'item_action', slot: bonesSlot, option: 'bury', cause: 'benchmark_combat_prayer_10m' };
    }

    const bones = nearbyWorldItems(perception).find(isBones);
    if (bones && !actions.some(attempt => isPickupBonesAction(attempt.action))) {
        return { kind: 'interact', target: bones, option: 'pick-up', cause: 'benchmark_combat_prayer_10m' };
    }

    if (!actions.some(attempt => isSafeAttackAction(attempt.action))) {
        const target = nearbyNpcs(perception).find(isSafeCombatTarget) || FALLBACK_GOBLIN;
        return { kind: 'attack', target, cause: 'benchmark_combat_prayer_10m' };
    }

    return undefined;
}

function hasCombatEvidence(input: CombatPrayer10mVerificationInput): boolean {
    return (
        allEvents(input).some(isCombatEvent) ||
        input.perceptions.some(perception => isSafeCombatTarget(recordField(perception.resident, 'combatTarget'))) ||
        safeNpcHpDropped(input.perceptions)
    );
}

function hasCombatSuppliedBonesEvidence(input: CombatPrayer10mVerificationInput, externalBonesSupplyActions: number): boolean {
    return !bonesPresentInitially(input.perceptions) && externalBonesSupplyActions === 0 && bonesAppeared(input.perceptions);
}

function countExternalBonesSupplyActions(input: CombatPrayer10mVerificationInput): number {
    const initialBonesVisible = bonesPresentInitially(input.perceptions);
    return input.actions.filter(attempt => {
        const action = attempt.action;
        if (action.kind === 'trade_offer_item' || action.kind === 'trade_accept_stage_1' || action.kind === 'trade_accept_stage_2') {
            return true;
        }
        return initialBonesVisible && isPickupBonesAction(action);
    }).length;
}

function orderedActionChain(actions: CombatPrayer10mActionAttempt[]): boolean {
    const attackIndex = actions.findIndex(attempt => isSafeAttackAction(attempt.action) && isSuccessfulAttempt(attempt));
    if (attackIndex < 0) {
        return false;
    }
    const buryIndex = actions.findIndex(
        (attempt, index) => index > attackIndex && isBuryAction(attempt.action) && isSuccessfulAttempt(attempt),
    );
    return buryIndex > attackIndex;
}

function safeNpcHpDropped(perceptions: Perception[]): boolean {
    const firstHp = new Map<string, number>();
    for (const perception of perceptions) {
        for (const npc of nearbyNpcs(perception)) {
            if (!isSafeCombatTarget(npc)) {
                continue;
            }
            const key = combatTargetKey(npc);
            const hp = numericField(npc, 'hpFraction', 1);
            const previous = firstHp.get(key);
            if (previous === undefined) {
                firstHp.set(key, hp);
            } else if (hp < previous) {
                return true;
            }
        }
    }
    return false;
}

function bonesAppeared(perceptions: Perception[]): boolean {
    if (perceptions.length < 2 || bonesCount(perceptions[0]) > 0) {
        return false;
    }
    return perceptions.slice(1).some(perception => bonesCount(perception) > 0);
}

function bonesPresentInitially(perceptions: Perception[]): boolean {
    return perceptions.length > 0 && bonesCount(perceptions[0]) > 0;
}

function bonesConsumedAfterGain(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let sawBones = false;
    for (const perception of perceptions) {
        const count = inventoryBonesCount(perception);
        if (count > 0) {
            sawBones = true;
        } else if (sawBones) {
            return true;
        }
    }
    return false;
}

function bonesCount(perception: Perception): number {
    return inventoryBonesCount(perception) + nearbyWorldItems(perception).filter(isBones).length;
}

function inventoryBonesCount(perception: Perception): number {
    return inventory(perception).reduce((total, item) => {
        if (!isBones(item)) {
            return total;
        }
        return total + numericField(item, 'amount', 1);
    }, 0);
}

function prayerXpIncreased(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxXp = prayerXp(perceptions[0]);
    for (const perception of perceptions.slice(1)) {
        const xp = prayerXp(perception);
        if (xp !== undefined && maxXp !== undefined && xp > maxXp) {
            return true;
        }
        if (xp !== undefined && (maxXp === undefined || xp > maxXp)) {
            maxXp = xp;
        }
    }
    return false;
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

function repeatedActionLoop(actions: CombatPrayer10mActionAttempt[]): boolean {
    let lastKey: string | undefined;
    let repeated = 0;
    for (const attempt of actions) {
        const key = loopKey(attempt.action);
        repeated = key === lastKey ? repeated + 1 : 1;
        lastKey = key;
        if (repeated >= MAX_REPEATED_COMBAT_ACTIONS) {
            return true;
        }
    }
    return false;
}

function loopKey(action: AgentAction): string {
    const targetValue = (action as Record<string, unknown>).target;
    const target = isRecord(targetValue) ? targetValue : {};
    return JSON.stringify({
        kind: action.kind,
        option: stringField(action, 'option')?.toLowerCase(),
        target: combatTargetKey(target) || stringField(target, 'key') || stringField(target, 'id'),
        slot: numericField(action, 'slot', -1),
    });
}

function isCombatPrayerLoopAction(attempt: CombatPrayer10mActionAttempt): boolean {
    return isCombatAttackAction(attempt.action) || isPickupBonesAction(attempt.action) || isBuryAction(attempt.action);
}

function isCombatAttackAction(action: AgentAction): boolean {
    if (action.kind === 'attack') {
        return true;
    }
    return action.kind === 'interact' && /^attack$/i.test(stringField(action, 'option') || '');
}

function isSafeAttackAction(action: AgentAction): boolean {
    return isCombatAttackAction(action) && isSafeCombatTarget(recordField(action, 'target'));
}

function isSafeCombatTarget(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value) || stringField(value, 'kind') !== 'npc') {
        return false;
    }
    const label = [stringField(value, 'key'), stringField(value, 'name'), stringField(value, 'id')].filter(Boolean).join(' ');
    return SAFE_TARGET_PATTERN.test(label) && !UNSAFE_TARGET_PATTERN.test(label);
}

function isBuryAction(action: AgentAction): boolean {
    return action.kind === 'item_action' && /^bury$/i.test(stringField(action, 'option') || '');
}

function isPickupBonesAction(action: AgentAction): boolean {
    return (
        action.kind === 'interact' && /pick.?up|take/i.test(stringField(action, 'option') || '') && isBones(recordField(action, 'target'))
    );
}

function isSuccessfulAttempt(attempt: CombatPrayer10mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
}

function isCombatEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind') || '';
    const damage = numericField(event, 'damage', 0);
    if (damage <= 0) {
        return false;
    }
    if (kind === 'hit_dealt') {
        return isSafeCombatTarget(event.to);
    }
    if (kind === 'hit_taken') {
        return isSafeCombatTarget(event.from);
    }
    return false;
}

function isBonesReceivedEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'item_received' && isBones(event.item);
}

function isBonesLostEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'item_lost' && isBones(event.item);
}

function isPrayerLevelEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'level_up' && stringField(event, 'skill') === 'prayer';
}

function isDeathEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'died';
}

function allEvents(input: CombatPrayer10mVerificationInput): PerceptionEvent[] {
    return [...input.events, ...input.perceptions.flatMap(perceptionEvents)];
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function inventory(perception: Perception): Array<Record<string, unknown> | null> {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? (resident.inventory as Array<Record<string, unknown> | null>) : [];
}

function nearbyNpcs(perception: Perception): Array<Record<string, unknown>> {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.npcs) ? (nearby.npcs.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function nearbyWorldItems(perception: Perception): Array<Record<string, unknown>> {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.worldItems) ? (nearby.worldItems.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function isBones(item: unknown): item is Record<string, unknown> {
    if (!isRecord(item)) {
        return false;
    }
    const key = stringField(item, 'key');
    if (key && BONE_KEY_PATTERN.test(key)) {
        return true;
    }
    return BONE_ITEM_IDS.has(numericField(item, 'itemId'));
}

function combatTargetKey(target: Record<string, unknown>): string {
    return [stringField(target, 'id'), stringField(target, 'key'), stringField(target, 'name')].filter(Boolean).join('|');
}

function recordField(record: unknown, key: string): Record<string, unknown> | undefined {
    if (!isRecord(record)) {
        return undefined;
    }
    const value = record[key];
    return isRecord(value) ? value : undefined;
}

function numericField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
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
