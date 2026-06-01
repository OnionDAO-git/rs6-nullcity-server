import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const EARN_GP_VIA_COMBAT_5M_TASK_ID = 'earn-gp-via-combat-5m';
export const EARN_GP_VIA_COMBAT_5M_TASK_VERSION = '0.1.0';
export const EARN_GP_VIA_COMBAT_5M_BUDGET_MS = 5 * 60 * 1000;

// Same Lumbridge goblin courtyard waypoint the CQA5 combat smoke uses, now
// backed by a real small-coin drop so residents can earn AP-funding GP.
const START_POSITION = { x: 3254, y: 3230, level: 0 };
const COOKED_SHRIMP_ITEM_ID = 315;
const BRONZE_SCIMITAR_ITEM_ID = 9703;
const WOODEN_SHIELD_ITEM_ID = 9704;
const COIN_ITEM_ID = 995;
const COIN_KEY_PATTERN = /^rs:coins?$/i;
const SAFE_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin)\b/i;
const UNSAFE_TARGET_PATTERN = /\b(goblin_guard|guard|dragon|demon|wizard|knight|barbarian)\b/i;
// Bones and other non-tradable junk should not count as an earn-route drop.
const NON_TRADABLE_DROP_ITEM_IDS = new Set([526, 528, 530, 532, 534, 536]);
const NON_TRADABLE_DROP_KEY_PATTERN = /^rs:(bones|bones_.+|.+_bones|ashes)$/i;

export interface EarnGpViaCombat5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface EarnGpViaCombat5mVerificationInput {
    elapsedMs: number;
    actions: EarnGpViaCombat5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeEarnGpViaCombat5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: EARN_GP_VIA_COMBAT_5M_TASK_ID,
        version: EARN_GP_VIA_COMBAT_5M_TASK_VERSION,
        timeoutMs: EARN_GP_VIA_COMBAT_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            // Three cooked shrimp for survival, a bronze scimitar + wooden shield equipped, and zero GP.
            initialInventory: [{ itemId: COOKED_SHRIMP_ITEM_ID }, { itemId: COOKED_SHRIMP_ITEM_ID }, { itemId: COOKED_SHRIMP_ITEM_ID }],
            initialEquipment: [null, null, null, { itemId: BRONZE_SCIMITAR_ITEM_ID }, null, { itemId: WOODEN_SHIELD_ITEM_ID }],
        },
        run: async context => {
            const startedAt = now();
            context.recordSummary('Observe self-directed GP earning: safely kill goblins and loot the coin/tradable drop.');
            while (!context.signal.aborted && now() - startedAt < EARN_GP_VIA_COMBAT_5M_BUDGET_MS) {
                const outcome = verifyEarnGpViaCombat5m({
                    elapsedMs: now() - startedAt,
                    actions: [...context.actionAttempts()],
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed' || outcome.metrics?.deaths || outcome.metrics?.unsafeTargetActions) {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }
            return verifyEarnGpViaCombat5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observe selected-module self-directed combat GP earning under autonomous control.');
            while (!context.signal.aborted && now() - startedAt < EARN_GP_VIA_COMBAT_5M_BUDGET_MS) {
                const outcome = verifyEarnGpViaCombat5m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed' || outcome.metrics?.deaths || outcome.metrics?.unsafeTargetActions) {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }
            return verifyEarnGpViaCombat5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyEarnGpViaCombat5m(input: EarnGpViaCombat5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = earnGpViaCombatMetrics(input);
    if (input.elapsedMs > EARN_GP_VIA_COMBAT_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'earn-gp-via-combat-5m exceeded the 5 minute budget before GP-earning evidence was observed',
        };
    }
    if (metrics.deaths > 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'The resident died while attempting to earn GP through combat',
        };
    }
    if (metrics.unsafeTargetActions > 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'Unsafe combat target action was attempted while earning GP',
        };
    }
    if (metrics.safeAttackActions === 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'No safe combat attack action was attempted',
        };
    }
    if (metrics.kills === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'A safe attack was attempted, but no kill evidence was observed',
        };
    }
    if (metrics.lootPickups === 0) {
        return {
            status: 'failed',
            score: 0.55,
            metrics,
            failureReason: 'A safe kill was observed, but no post-combat loot pickup action followed',
        };
    }
    if (metrics.earnEvidence === 0) {
        return {
            status: 'failed',
            score: 0.75,
            metrics,
            failureReason: 'A post-combat loot pickup was observed, but no GP gain or tradable drop landed in inventory',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            'earn-gp-via-combat-5m observed a resident safely kill an NPC, loot the drop, and earned RuneScape GP (coins or a tradable item) into inventory.',
        ],
    };
}

function earnGpViaCombatMetrics(input: EarnGpViaCombat5mVerificationInput): Record<string, number> {
    const events = allEvents(input);
    const attackActions = input.actions.filter(attempt => isCombatAttackAction(attempt.action));
    const safeAttackActions = input.actions.filter(attempt => isSafeAttackAction(attempt.action) && isSuccessfulAttempt(attempt));
    const unsafeTargetActions = attackActions.filter(attempt => !isSafeAttackAction(attempt.action)).length;
    const firstSafeAttackIndex = input.actions.findIndex(attempt => isSafeAttackAction(attempt.action) && isSuccessfulAttempt(attempt));

    const kills = countKills(events, input.perceptions);
    const lootPickups = countLootPickups(input.actions, firstSafeAttackIndex);
    const gpFromCombat = gpGainedFromCombat(input.perceptions);
    const tradableDropsLooted = countTradableDropsLooted(input.actions, events, firstSafeAttackIndex);
    const earnEvidence = kills > 0 && lootPickups > 0 && (gpFromCombat > 0 || tradableDropsLooted > 0) ? 1 : 0;

    return {
        actionsAttempted: input.actions.length,
        attackActions: attackActions.length,
        safeAttackActions: safeAttackActions.length,
        unsafeTargetActions,
        kills,
        lootPickups,
        gpFromCombat,
        tradableDropsLooted,
        earnEvidence,
        deaths: events.filter(isDeathEvent).length,
        gpObservedAmount: maxInventoryCoins(input.perceptions),
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): EarnGpViaCombat5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function countKills(events: PerceptionEvent[], perceptions: Perception[]): number {
    const eventKills = events.filter(isSafeKillEvent).length;
    if (eventKills > 0) {
        return eventKills;
    }
    // Fallback: a safe NPC whose HP fraction dropped below 1 and then disappeared from view.
    return safeTargetsDamagedThenGone(perceptions);
}

function safeTargetsDamagedThenGone(perceptions: Perception[]): number {
    const lastHp = new Map<string, number>();
    const damaged = new Set<string>();
    let killed = 0;
    for (const perception of perceptions) {
        const present = new Set<string>();
        for (const npc of nearbyNpcs(perception)) {
            if (!isSafeCombatTarget(npc)) {
                continue;
            }
            const key = combatTargetKey(npc);
            present.add(key);
            const hp = numericField(npc, 'hpFraction', 1);
            const previous = lastHp.get(key);
            if ((previous !== undefined && hp < previous) || hp < 1) {
                damaged.add(key);
            }
            lastHp.set(key, hp);
        }
        for (const key of [...damaged]) {
            if (!present.has(key)) {
                killed += 1;
                damaged.delete(key);
                lastHp.delete(key);
            }
        }
    }
    return killed;
}

function countLootPickups(actions: EarnGpViaCombat5mActionAttempt[], firstSafeAttackIndex: number): number {
    if (firstSafeAttackIndex < 0) {
        return 0;
    }
    return actions.filter(
        (attempt, index) => index >= firstSafeAttackIndex && isLootPickupAction(attempt.action) && isSuccessfulAttempt(attempt),
    ).length;
}

function countTradableDropsLooted(
    actions: EarnGpViaCombat5mActionAttempt[],
    events: PerceptionEvent[],
    firstSafeAttackIndex: number,
): number {
    if (firstSafeAttackIndex < 0) {
        return 0;
    }
    const pickedUpTradables = actions.filter(
        (attempt, index) =>
            index >= firstSafeAttackIndex &&
            isLootPickupAction(attempt.action) &&
            isSuccessfulAttempt(attempt) &&
            isTradableDrop(recordField(attempt.action, 'target')),
    ).length;
    const receivedTradables = events.filter(event => isTradableItemReceivedEvent(event)).length;
    return Math.max(pickedUpTradables, receivedTradables);
}

function gpGainedFromCombat(perceptions: Perception[]): number {
    // Resident seeds with zero GP; any carried coins must have been earned through combat looting.
    let baseline = 0;
    let peak = 0;
    let sawBaseline = false;
    for (const perception of perceptions) {
        const carried = inventoryCoinAmount(perception);
        if (!sawBaseline) {
            baseline = carried;
            sawBaseline = true;
        }
        peak = Math.max(peak, carried);
    }
    return Math.max(0, peak - baseline);
}

function maxInventoryCoins(perceptions: Perception[]): number {
    return perceptions.reduce((max, perception) => Math.max(max, inventoryCoinAmount(perception)), 0);
}

function inventoryCoinAmount(perception: Perception): number {
    return inventory(perception).reduce((total, item) => total + (isCoinItem(item) ? numericField(item, 'amount', 1) : 0), 0);
}

function isSafeKillEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind') || '';
    if (kind !== 'npc_killed' && kind !== 'npc_died' && kind !== 'kill') {
        return false;
    }
    return isSafeCombatTarget(event.npc) || isSafeCombatTarget(event.target) || isSafeCombatTarget(event.victim);
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

function isLootPickupAction(action: AgentAction): boolean {
    return (
        action.kind === 'interact' &&
        /pick.?up|take|loot/i.test(stringField(action, 'option') || '') &&
        isRecord(recordField(action, 'target'))
    );
}

function isSafeCombatTarget(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value) || stringField(value, 'kind') !== 'npc') {
        return false;
    }
    const label = [stringField(value, 'key'), stringField(value, 'name'), stringField(value, 'id')].filter(Boolean).join(' ');
    return SAFE_TARGET_PATTERN.test(label) && !UNSAFE_TARGET_PATTERN.test(label);
}

function isTradableDrop(item: unknown): boolean {
    if (!isRecord(item)) {
        return false;
    }
    if (isCoinItem(item)) {
        return false;
    }
    const key = stringField(item, 'key') || '';
    if (NON_TRADABLE_DROP_KEY_PATTERN.test(key)) {
        return false;
    }
    return !NON_TRADABLE_DROP_ITEM_IDS.has(numericField(item, 'itemId', -1));
}

function isTradableItemReceivedEvent(event: PerceptionEvent): boolean {
    if (stringField(event, 'kind') !== 'item_received') {
        return false;
    }
    const item = event.item;
    return isRecord(item) && !isCoinItem(item) && isTradableDrop(item);
}

function isCoinItem(item: Record<string, unknown> | null | undefined): item is Record<string, unknown> {
    if (!isRecord(item)) {
        return false;
    }
    const key = stringField(item, 'key') || '';
    return numericField(item, 'itemId', -1) === COIN_ITEM_ID || COIN_KEY_PATTERN.test(key);
}

function isSuccessfulAttempt(attempt: EarnGpViaCombat5mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
}

function isDeathEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'died';
}

function allEvents(input: EarnGpViaCombat5mVerificationInput): PerceptionEvent[] {
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

function combatTargetKey(target: Record<string, unknown>): string {
    return [stringField(target, 'id'), stringField(target, 'key'), stringField(target, 'name')].filter(Boolean).join('|');
}

function recordField(record: unknown, key: string): unknown {
    if (!isRecord(record)) {
        return undefined;
    }
    return record[key];
}

function numericField(record: unknown, key: string, fallback = 0): number {
    const value = recordField(record, key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(record: unknown, key: string): string | undefined {
    const value = recordField(record, key);
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
