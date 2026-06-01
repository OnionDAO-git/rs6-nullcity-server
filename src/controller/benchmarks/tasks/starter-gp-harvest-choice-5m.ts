import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';
import { EARN_GP_VIA_COMBAT_5M_BUDGET_MS, verifyEarnGpViaCombat5m, type EarnGpViaCombat5mActionAttempt } from './earn-gp-via-combat-5m';

export const STARTER_GP_HARVEST_CHOICE_5M_TASK_ID = 'starter-gp-harvest-choice-5m';
export const STARTER_GP_HARVEST_CHOICE_5M_TASK_VERSION = '0.1.0';
export const STARTER_GP_HARVEST_CHOICE_5M_TIMEOUT_MS = EARN_GP_VIA_COMBAT_5M_BUDGET_MS;

const START_POSITION = { x: 3254, y: 3230, level: 0 };
const COOKED_SHRIMP_ITEM_ID = 315;
const BRONZE_SCIMITAR_ITEM_ID = 9703;
const WOODEN_SHIELD_ITEM_ID = 9704;
const STARTER_GP_HARVEST_CAUSE = 'nervous:starter-gp-harvest';

export interface StarterGpHarvestChoice5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface StarterGpHarvestChoice5mVerificationInput {
    elapsedMs: number;
    actions: StarterGpHarvestChoice5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeStarterGpHarvestChoice5mBenchmarkTask(): BenchmarkTask {
    return {
        id: STARTER_GP_HARVEST_CHOICE_5M_TASK_ID,
        version: STARTER_GP_HARVEST_CHOICE_5M_TASK_VERSION,
        timeoutMs: STARTER_GP_HARVEST_CHOICE_5M_TIMEOUT_MS,
        autonomousRequiresSelectedModuleAction: false,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COOKED_SHRIMP_ITEM_ID }, { itemId: COOKED_SHRIMP_ITEM_ID }, { itemId: COOKED_SHRIMP_ITEM_ID }],
            initialEquipment: [null, null, null, { itemId: BRONZE_SCIMITAR_ITEM_ID }, null, { itemId: WOODEN_SHIELD_ITEM_ID }],
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'starter-gp-harvest-choice-5m requires autonomous mode with a low-AP, no-GP resident; run with --mode autonomous',
            metrics: {
                starterGpHarvestActions: 0,
                actionsAttempted: 0,
            },
        }),
        runAutonomous: async context => observeStarterGpHarvestChoice(context),
    };
}

export function verifyStarterGpHarvestChoice5m(input: StarterGpHarvestChoice5mVerificationInput): BenchmarkTaskOutcome {
    const starterGpHarvestActions = input.actions.filter(attempt => attempt.action.cause === STARTER_GP_HARVEST_CAUSE).length;
    const earnOutcome = verifyEarnGpViaCombat5m({
        elapsedMs: input.elapsedMs,
        actions: input.actions as EarnGpViaCombat5mActionAttempt[],
        perceptions: input.perceptions,
        events: input.events,
    });
    const metrics: Record<string, number> = {
        ...(earnOutcome.metrics || {}),
        starterGpHarvestActions,
    };

    if (input.elapsedMs > STARTER_GP_HARVEST_CHOICE_5M_TIMEOUT_MS) {
        return {
            status: 'timeout',
            score: 0,
            failureReason:
                'starter-gp-harvest-choice-5m exceeded the 5 minute budget before low-AP/no-GP harvest choice and GP earn evidence were observed',
            metrics,
        };
    }

    if (starterGpHarvestActions === 0) {
        return {
            status: 'failed',
            score: 0.2,
            failureReason: 'No low-AP/no-GP starter GP harvest cue (cause nervous:starter-gp-harvest) was observed',
            metrics,
        };
    }

    if (earnOutcome.status !== 'passed') {
        return {
            status: earnOutcome.status,
            score: Math.min(0.8, Math.max(0.35, earnOutcome.score ?? 0)),
            failureReason: earnOutcome.failureReason || 'Starter GP harvest was chosen, but combat GP earning did not complete',
            metrics,
        };
    }

    if ((metrics.gpFromCombat ?? 0) <= 0) {
        return {
            status: 'failed',
            score: 0.85,
            failureReason: 'Starter GP harvest looted a combat drop but did not put real RuneScape coin item 995 into inventory',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            'starter-gp-harvest-choice-5m observed a low-AP/no-GP resident choose GP harvest, then safely fight and loot real RuneScape GP coin item 995.',
        ],
    };
}

async function observeStarterGpHarvestChoice(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome> {
    const startedAt = Date.now();
    context.recordSummary('Observing low-AP/no-GP starter GP harvest choice followed by safe combat GP earning.');
    while (!context.signal.aborted && Date.now() - startedAt < STARTER_GP_HARVEST_CHOICE_5M_TIMEOUT_MS) {
        const outcome = verifyStarterGpHarvestChoice5m({
            elapsedMs: Date.now() - startedAt,
            actions: [...context.actionAttempts()],
            perceptions: [...context.perceptions()],
            events: [...context.events()],
        });
        if (outcome.status === 'passed' || outcome.metrics?.deaths || outcome.metrics?.unsafeTargetActions) {
            return outcome;
        }
        await sleep(1000, context.signal);
    }
    return verifyStarterGpHarvestChoice5m({
        elapsedMs: Date.now() - startedAt,
        actions: [...context.actionAttempts()],
        perceptions: [...context.perceptions()],
        events: [...context.events()],
    });
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
