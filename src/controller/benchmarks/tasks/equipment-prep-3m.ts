import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const EQUIPMENT_PREP_3M_TASK_ID = 'equipment-prep-3m';
export const EQUIPMENT_PREP_3M_TASK_VERSION = '0.1.0';
export const EQUIPMENT_PREP_3M_BUDGET_MS = 3 * 60 * 1000;

const START_POSITION = { x: 3232, y: 3299, level: 0 };
const STARTER_WEAPON = { itemId: 9703 };
const STARTER_FOOD = { itemId: 315 };
const FALLBACK_CHICKEN = {
    id: 'npc:chicken',
    kind: 'npc' as const,
    key: 'rs:chicken',
    name: 'Chicken',
    position: START_POSITION,
    hpFraction: 1,
};
const SAFE_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin)\b/i;
const USEFUL_GEAR_PATTERN = /\b(sword|dagger|scimitar|mace|battleaxe|axe|bow|staff|shield|helm|body|legs|boots|gloves|cape|amulet|ring)\b/i;
const USEFUL_GEAR_IDS = new Set([
    1059, 1061, 1063, 1075, 1087, 1095, 1103, 1117, 1129, 1139, 1155, 1167, 1171, 1173, 1189, 1205, 1277, 1279, 1281, 1351, 1349, 1353,
    1361, 841, 882, 9703, 9704,
]);

export interface EquipmentPrep3mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface EquipmentPrep3mVerificationInput {
    elapsedMs: number;
    actions: EquipmentPrep3mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeEquipmentPrep3mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: EQUIPMENT_PREP_3M_TASK_ID,
        version: EQUIPMENT_PREP_3M_TASK_VERSION,
        timeoutMs: EQUIPMENT_PREP_3M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [STARTER_WEAPON, STARTER_FOOD, STARTER_FOOD],
            initialEquipment: [],
        },
        run: async context => {
            const startedAt = now();
            const actions: EquipmentPrep3mActionAttempt[] = [];
            context.recordSummary('Running scripted equipment-prep-3m smoke.');

            while (!context.signal.aborted && now() - startedAt < EQUIPMENT_PREP_3M_BUDGET_MS) {
                const outcome = verifyEquipmentPrep3m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }

                const nextAction = nextScriptedAction(context.latestPerception(), actions);
                if (nextAction) {
                    const attempt: EquipmentPrep3mActionAttempt = { action: nextAction };
                    actions.push(attempt);
                    attempt.result = await context.submitAction(nextAction);
                }

                await sleep(1000, context.signal);
            }

            return verifyEquipmentPrep3m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for equipment-prep-3m.');

            while (!context.signal.aborted && now() - startedAt < EQUIPMENT_PREP_3M_BUDGET_MS) {
                const outcome = verifyEquipmentPrep3m({
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

            return verifyEquipmentPrep3m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyEquipmentPrep3m(input: EquipmentPrep3mVerificationInput): BenchmarkTaskOutcome {
    const metrics = equipmentPrepMetrics(input);
    if (input.elapsedMs > EQUIPMENT_PREP_3M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'equipment-prep-3m exceeded the 3 minute budget before success was observed',
        };
    }
    if (metrics.deathEvents > 0) {
        return { status: 'failed', score: 0, metrics, failureReason: 'The resident died during equipment preparation' };
    }
    if (metrics.equipActions === 0) {
        return { status: 'failed', score: 0.2, metrics, failureReason: 'No useful gear equip action was attempted' };
    }
    if (metrics.equipmentEvidence === 0) {
        return { status: 'failed', score: 0.45, metrics, failureReason: 'No equipment-state evidence confirmed the gear was equipped' };
    }
    if (metrics.safeAttackActions === 0) {
        return { status: 'failed', score: 0.7, metrics, failureReason: 'Gear was equipped, but no safe combat action followed' };
    }
    if (metrics.equipBeforeAttack === 0) {
        return { status: 'failed', score: 0.75, metrics, failureReason: 'Safe combat happened before useful gear was equipped' };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['equipment-prep-3m observed useful gear equipped before safe combat.'],
    };
}

function equipmentPrepMetrics(input: EquipmentPrep3mVerificationInput): Record<string, number> {
    const equipIndex = input.actions.findIndex(attempt => isSuccessfulAttempt(attempt) && isEquipUsefulGearAction(attempt.action));
    const attackIndex = input.actions.findIndex(attempt => isSafeAttackAction(attempt.action));
    return {
        equipActions: input.actions.filter(attempt => isSuccessfulAttempt(attempt) && isEquipUsefulGearAction(attempt.action)).length,
        equipmentEvidence: input.perceptions.some(perception => equipment(perception).some(isUsefulGear)) ? 1 : 0,
        safeAttackActions: input.actions.filter(attempt => isSafeAttackAction(attempt.action)).length,
        safeAttackAckedActions: input.actions.filter(attempt => isSuccessfulAttempt(attempt) && isSafeAttackAction(attempt.action)).length,
        equipBeforeAttack: equipIndex >= 0 && attackIndex >= 0 && equipIndex < attackIndex ? 1 : 0,
        deathEvents: allEvents(input).filter(isDeathEvent).length,
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): EquipmentPrep3mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function nextScriptedAction(perception: Perception | undefined, actions: EquipmentPrep3mActionAttempt[]): AgentAction | undefined {
    if (!perception) {
        return undefined;
    }
    if (!actions.some(attempt => isEquipUsefulGearAction(attempt.action))) {
        const slot = inventory(perception).findIndex(isUsefulGear);
        if (slot >= 0) {
            return { kind: 'equip', slot, cause: 'benchmark_equipment_prep_3m' };
        }
    }
    if (equipment(perception).some(isUsefulGear) && !actions.some(attempt => isSafeAttackAction(attempt.action))) {
        const target = nearbyNpcs(perception).find(isSafeCombatTarget) || FALLBACK_CHICKEN;
        return { kind: 'attack', target, cause: 'benchmark_equipment_prep_3m' };
    }
    return undefined;
}

function inventory(perception: Perception): unknown[] {
    return Array.isArray(recordField(perception.resident, 'inventory')) ? (recordField(perception.resident, 'inventory') as unknown[]) : [];
}

function equipment(perception: Perception): unknown[] {
    return Array.isArray(recordField(perception.resident, 'equipment')) ? (recordField(perception.resident, 'equipment') as unknown[]) : [];
}

function nearbyNpcs(perception: Perception): Record<string, unknown>[] {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    const npcs = Array.isArray(nearby.npcs) ? nearby.npcs : [];
    return npcs.filter(isRecord);
}

function allEvents(input: EquipmentPrep3mVerificationInput): unknown[] {
    return [...input.events, ...input.perceptions.flatMap(perception => (Array.isArray(perception.events) ? perception.events : []))];
}

function isEquipUsefulGearAction(action: AgentAction): boolean {
    if (action.kind === 'equip') {
        return true;
    }
    return action.kind === 'item_action' && /^(wear|wield|equip)$/i.test(stringField(action, 'option') || '');
}

function isSafeAttackAction(action: AgentAction): boolean {
    const target = recordField(action as unknown as Record<string, unknown>, 'target');
    return action.kind === 'attack' && isSafeCombatTarget(target);
}

function isSafeCombatTarget(target: unknown): target is Record<string, unknown> {
    if (!isRecord(target) || stringField(target, 'kind') !== 'npc') {
        return false;
    }
    const label = [stringField(target, 'key'), stringField(target, 'name'), stringField(target, 'id')].filter(Boolean).join(' ');
    return SAFE_TARGET_PATTERN.test(label);
}

function isUsefulGear(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const itemId = numericField(value, 'itemId', -1);
    if (USEFUL_GEAR_IDS.has(itemId)) {
        return true;
    }
    return USEFUL_GEAR_PATTERN.test(stringField(value, 'key') || '');
}

function isSuccessfulAttempt(attempt: EquipmentPrep3mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    return !attempt.finalStatus || !/fail|reject|error|timeout|blocked/i.test(attempt.finalStatus);
}

function isDeathEvent(value: unknown): boolean {
    return isRecord(value) && value.kind === 'died';
}

function recordField(value: unknown, field: string): unknown {
    return isRecord(value) ? value[field] : undefined;
}

function stringField(value: unknown, field: string): string | undefined {
    const fieldValue = recordField(value, field);
    return typeof fieldValue === 'string' ? fieldValue : undefined;
}

function numericField(value: unknown, field: string, fallback: number): number {
    const fieldValue = recordField(value, field);
    return typeof fieldValue === 'number' ? fieldValue : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}
