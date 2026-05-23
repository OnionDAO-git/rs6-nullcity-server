import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const TRADING_GIVING_5M_TASK_ID = 'trading-giving-5m';
export const TRADING_GIVING_5M_TASK_VERSION = '0.1.0';
export const TRADING_GIVING_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const TRUSTED_PEER_POSITION = { x: 3226, y: 3230, level: 0 };
const UNSAFE_PEER_POSITION = { x: 3227, y: 3230, level: 0 };
const TRUSTED_PEER_ID = 'codex';
const UNSAFE_PEER_ID = 'alice';
const FOLLOW_TEXT = 'agent follow me';
const TRADE_TEXT = 'agent trade me';

export interface TradingGiving5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
}

export interface TradingGiving5mVerificationInput {
    elapsedMs: number;
    actions: TradingGiving5mActionAttempt[];
    events: PerceptionEvent[];
    perceptions?: Perception[];
}

export function makeTradingGiving5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: TRADING_GIVING_5M_TASK_ID,
        version: TRADING_GIVING_5M_TASK_VERSION,
        timeoutMs: TRADING_GIVING_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [
                { itemId: 590, amount: 1 },
                { itemId: 1351, amount: 1 },
                { itemId: 1511, amount: 1 },
                { itemId: 1511, amount: 1 },
            ],
        },
        peers: [
            { id: TRUSTED_PEER_ID, spawnPosition: TRUSTED_PEER_POSITION },
            { id: UNSAFE_PEER_ID, spawnPosition: UNSAFE_PEER_POSITION },
        ],
        run: async context => {
            const startedAt = now();
            const actions: TradingGiving5mActionAttempt[] = [];
            const trustedRef = peerRef(context.peerResident(TRUSTED_PEER_ID), TRUSTED_PEER_POSITION);
            const unsafeRef = peerRef(context.peerResident(UNSAFE_PEER_ID), UNSAFE_PEER_POSITION);
            const selfRef = peerRef(context.resident, START_POSITION);

            await context.submitPeerAction(TRUSTED_PEER_ID, { kind: 'say', text: TRADE_TEXT, cause: 'benchmark_trading_giving_peer' });
            context.recordSummary('Trusted benchmark peer asked the resident to trade.');

            await submitObserved(context, actions, {
                kind: 'trade_request',
                target: trustedRef,
                cause: 'benchmark_trading_giving_request',
            });
            await waitForTradeEvent(context, 'trade_requested', startedAt, now);
            await context.submitPeerAction(TRUSTED_PEER_ID, {
                kind: 'trade_request',
                target: selfRef,
                cause: 'benchmark_trading_giving_peer_reciprocal',
            });
            await waitForTradeEvent(context, 'trade_opened', startedAt, now);

            await submitObserved(context, actions, {
                kind: 'trade_offer_item',
                inventorySlot: 2,
                amount: 1,
                cause: 'benchmark_trading_giving_offer',
            });
            await waitForSafeOffer(context, startedAt, now);
            await context.submitPeerAction(TRUSTED_PEER_ID, {
                kind: 'trade_accept_stage_1',
                cause: 'benchmark_trading_giving_peer_accept_1',
            });
            await submitObserved(context, actions, { kind: 'trade_accept_stage_1', cause: 'benchmark_trading_giving_accept_1' });
            await context.submitPeerAction(TRUSTED_PEER_ID, {
                kind: 'trade_accept_stage_2',
                cause: 'benchmark_trading_giving_peer_accept_2',
            });
            await submitObserved(context, actions, { kind: 'trade_accept_stage_2', cause: 'benchmark_trading_giving_accept_2' });
            await waitForTradeEvent(context, 'trade_completed', startedAt, now);

            await context.submitPeerAction(UNSAFE_PEER_ID, {
                kind: 'say',
                text: TRADE_TEXT,
                cause: 'benchmark_trading_giving_unsafe_peer',
            });
            context.recordSummary('Untrusted benchmark peer asked the resident to trade.');
            await submitObserved(context, actions, {
                kind: 'trade_request',
                target: unsafeRef,
                cause: 'benchmark_trading_giving_unsafe_request',
            });
            await context.submitPeerAction(UNSAFE_PEER_ID, {
                kind: 'trade_request',
                target: selfRef,
                cause: 'benchmark_trading_giving_unsafe_reciprocal',
            });
            await waitForTradeEvent(context, 'trade_opened', startedAt, now);
            await submitObserved(context, actions, { kind: 'trade_decline', cause: 'benchmark_trading_giving_decline' });

            return verifyTradingGiving5m({
                elapsedMs: now() - startedAt,
                actions,
                events: [...context.events()],
                perceptions: [...context.perceptions()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            let askedTrustedTrade = false;
            let reciprocatedTrustedTrade = false;
            let trustedPeerAcceptedStage1 = false;
            let trustedPeerAcceptedStage2 = false;
            let askedUnsafeTrade = false;
            let reciprocatedUnsafeTrade = false;
            const selfRef = peerRef(context.resident, START_POSITION);

            await context.submitPeerAction(TRUSTED_PEER_ID, { kind: 'say', text: FOLLOW_TEXT, cause: 'benchmark_trading_giving_peer' });
            context.recordSummary('Trusted benchmark peer introduced itself with a follow command.');

            while (!context.signal.aborted && now() - startedAt < TRADING_GIVING_5M_BUDGET_MS) {
                const actions = selectedModuleActionAttempts(context);
                const outcome = verifyTradingGiving5m({
                    elapsedMs: now() - startedAt,
                    actions,
                    events: [...context.events()],
                    perceptions: [...context.perceptions()],
                });
                const metrics =
                    outcome.metrics || tradingGivingMetrics({ elapsedMs: now() - startedAt, actions, events: [...context.events()] });

                if (!askedTrustedTrade && (hasFollowEvidence(actions) || now() - startedAt > 8_000)) {
                    await context.submitPeerAction(TRUSTED_PEER_ID, {
                        kind: 'say',
                        text: TRADE_TEXT,
                        cause: 'benchmark_trading_giving_peer',
                    });
                    context.recordSummary('Trusted benchmark peer asked the autonomous resident to trade.');
                    askedTrustedTrade = true;
                }
                if (askedTrustedTrade && !reciprocatedTrustedTrade && (metrics.tradeRequests || 0) >= 1) {
                    await context.submitPeerAction(TRUSTED_PEER_ID, {
                        kind: 'trade_request',
                        target: selfRef,
                        cause: 'benchmark_trading_giving_peer_reciprocal',
                    });
                    context.recordSummary('Trusted benchmark peer reciprocated the resident trade request.');
                    reciprocatedTrustedTrade = true;
                }
                if (reciprocatedTrustedTrade && !trustedPeerAcceptedStage1 && (metrics.safeItemOffers || 0) >= 1) {
                    await context.submitPeerAction(TRUSTED_PEER_ID, {
                        kind: 'trade_accept_stage_1',
                        cause: 'benchmark_trading_giving_peer_accept_1',
                    });
                    context.recordSummary('Trusted benchmark peer accepted the first trade stage.');
                    trustedPeerAcceptedStage1 = true;
                }
                if (trustedPeerAcceptedStage1 && !trustedPeerAcceptedStage2 && (metrics.acceptStage1 || 0) >= 1) {
                    await context.submitPeerAction(TRUSTED_PEER_ID, {
                        kind: 'trade_accept_stage_2',
                        cause: 'benchmark_trading_giving_peer_accept_2',
                    });
                    context.recordSummary('Trusted benchmark peer accepted the second trade stage.');
                    trustedPeerAcceptedStage2 = true;
                }
                if (
                    trustedPeerAcceptedStage2 &&
                    !askedUnsafeTrade &&
                    ((metrics.acceptStage2 || 0) >= 1 || (metrics.tradeCompletedEvents || 0) >= 1)
                ) {
                    await context.submitPeerAction(UNSAFE_PEER_ID, {
                        kind: 'say',
                        text: TRADE_TEXT,
                        cause: 'benchmark_trading_giving_unsafe_peer',
                    });
                    context.recordSummary('Untrusted benchmark peer asked the autonomous resident to trade.');
                    askedUnsafeTrade = true;
                }
                if (askedUnsafeTrade && !reciprocatedUnsafeTrade && (metrics.tradeRequests || 0) >= 2) {
                    await context.submitPeerAction(UNSAFE_PEER_ID, {
                        kind: 'trade_request',
                        target: selfRef,
                        cause: 'benchmark_trading_giving_unsafe_reciprocal',
                    });
                    context.recordSummary('Untrusted benchmark peer reciprocated so the resident can prove unsafe decline behavior.');
                    reciprocatedUnsafeTrade = true;
                }
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyTradingGiving5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                events: [...context.events()],
                perceptions: [...context.perceptions()],
            });
        },
    };
}

export function verifyTradingGiving5m(input: TradingGiving5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = tradingGivingMetrics(input);
    if (input.elapsedMs > TRADING_GIVING_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'trading-giving-5m exceeded the 5 minute budget before success was observed',
        };
    }
    if (metrics.peerTradeCommands === 0) {
        return { status: 'failed', score: 0, metrics, failureReason: 'No benchmark peer trade command was observed' };
    }
    if (metrics.tradeRequests === 0) {
        return { status: 'failed', score: 0.2, metrics, failureReason: 'No trade request was attempted after the peer command' };
    }
    if (metrics.tradeOpenedEvents === 0) {
        return { status: 'failed', score: 0.35, metrics, failureReason: 'No trade window opened after the resident trade request' };
    }
    if (metrics.safeItemOffers === 0) {
        return { status: 'failed', score: 0.5, metrics, failureReason: 'No safe item was offered in the trusted trade' };
    }
    if (metrics.acceptStage1 === 0) {
        return { status: 'failed', score: 0.65, metrics, failureReason: 'No first-stage trade acceptance was attempted' };
    }
    if (metrics.acceptStage2 === 0) {
        return { status: 'failed', score: 0.8, metrics, failureReason: 'No second-stage trade acceptance was attempted' };
    }
    if (metrics.unsafeDeclines === 0) {
        return { status: 'failed', score: 0.9, metrics, failureReason: 'No unsafe or untrusted trade was declined' };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['trading-giving-5m observed request, safe item offer, two-stage accept, and unsafe decline behavior.'],
    };
}

function tradingGivingMetrics(input: TradingGiving5mVerificationInput): Record<string, number> {
    const events = input.events || [];
    const actions = input.actions || [];
    return {
        actionsAttempted: actions.length,
        peerTradeCommands: events.filter(isPeerTradeCommand).length,
        tradeRequests: actions.filter(attempt => attempt.action.kind === 'trade_request').length,
        tradeOpenedEvents: events.filter(event => stringField(event, 'kind') === 'trade_opened').length,
        tradeCompletedEvents: events.filter(event => stringField(event, 'kind') === 'trade_completed').length,
        tradeCancelledEvents: events.filter(event => stringField(event, 'kind') === 'trade_cancelled').length,
        safeItemOffers: actions.filter(attempt => isSafeTradeOffer(attempt.action)).length,
        acceptStage1: actions.filter(attempt => attempt.action.kind === 'trade_accept_stage_1' || attempt.action.kind === 'trade_accept')
            .length,
        acceptStage2: actions.filter(attempt => attempt.action.kind === 'trade_accept_stage_2').length,
        unsafeDeclines: actions.filter(attempt => attempt.action.kind === 'trade_decline').length,
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): TradingGiving5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

async function submitObserved(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: TradingGiving5mActionAttempt[],
    action: AgentAction,
): Promise<void> {
    const result = await context.submitAction(action);
    actions.push({ action, finalStatus: result.ok ? 'success' : String(result.reason || 'failure') });
}

async function waitForTradeEvent(
    context: Parameters<BenchmarkTask['run']>[0],
    kind: string,
    startedAt: number,
    now: () => number,
): Promise<void> {
    while (!context.signal.aborted && now() - startedAt < 30_000) {
        if (context.events().some(event => stringField(event, 'kind') === kind)) {
            return;
        }
        await sleep(500, context.signal);
    }
}

async function waitForSafeOffer(context: Parameters<BenchmarkTask['run']>[0], startedAt: number, now: () => number): Promise<void> {
    while (!context.signal.aborted && now() - startedAt < 30_000) {
        const activeTrade = latestActiveTrade(context.perceptions());
        if (activeTrade?.ours?.some(isSafeItemRef)) {
            return;
        }
        await sleep(500, context.signal);
    }
}

function latestActiveTrade(perceptions: readonly Perception[]): { ours?: unknown[] } | undefined {
    for (const perception of [...perceptions].reverse()) {
        const resident = recordField(perception, 'resident');
        const activeTrade = recordField(resident, 'activeTrade');
        if (activeTrade) {
            return { ours: arrayField(activeTrade, 'ours') };
        }
    }
    return undefined;
}

function hasFollowEvidence(actions: TradingGiving5mActionAttempt[]): boolean {
    return actions.some(attempt => attempt.action.kind === 'move_to' && /follow/i.test(stringField(attempt.action, 'cause') || ''));
}

function isPeerTradeCommand(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'chat' && /agent\s+trade\s+me/i.test(stringField(event, 'text') || '');
}

function isSafeTradeOffer(action: AgentAction): boolean {
    if (action.kind !== 'trade_offer_item') {
        return false;
    }
    const itemId = numberField(action, 'itemId');
    if (itemId !== undefined) {
        return isSafeItemId(itemId);
    }
    return numberField(action, 'inventorySlot') !== undefined && numberField(action, 'amount') !== undefined;
}

function isSafeItemRef(value: unknown): boolean {
    const item = isRecord(value) ? value : {};
    const itemId = numberField(item, 'itemId');
    return itemId !== undefined && isSafeItemId(itemId);
}

function isSafeItemId(itemId: number): boolean {
    return ![590, 303, 1351, 1349, 1353, 995].includes(itemId);
}

function peerRef(name: string | undefined, position: { x: number; y: number; level: number }) {
    const safeName = name || 'unknown';
    return {
        id: safeName.startsWith('resident:') ? safeName : `resident:${safeName}`,
        kind: 'resident' as const,
        name: safeName,
        position,
    };
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const field = value[key];
    return isRecord(field) ? field : undefined;
}

function arrayField(value: unknown, key: string): unknown[] {
    if (!isRecord(value)) {
        return [];
    }
    const field = value[key];
    return Array.isArray(field) ? field : [];
}

function stringField(value: unknown, key: string): string | undefined {
    return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
    return isRecord(value) && typeof value[key] === 'number' ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return;
    }
    await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}
