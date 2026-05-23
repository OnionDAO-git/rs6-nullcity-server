import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const FOLLOW_AND_CHAT_5M_TASK_ID = 'follow-and-chat-5m';
export const FOLLOW_AND_CHAT_5M_TASK_VERSION = '0.3.0';
export const FOLLOW_AND_CHAT_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const PEER_POSITION = { x: 3229, y: 3230, level: 0 };
const REFOLLOW_PEER_POSITION = { x: 3234, y: 3230, level: 0 };
const FOLLOW_RANGE = 2;
const DEFAULT_PEER_ID = 'player:codex';
const DEFAULT_FOLLOW_TEXT = 'agent follow me';
const DEFAULT_STATUS_TEXT = 'agent status';
const DEFAULT_HELP_TEXT = 'agent help';
const DEFAULT_WAIT_TEXT = 'agent wait';
const DEFAULT_REFOLLOW_TEXT = 'agent follow me again';

export interface FollowAndChat5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
}

export interface FollowAndChat5mVerificationInput {
    elapsedMs: number;
    actions: FollowAndChat5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
    peerId?: string;
    followText?: string;
    statusText?: string;
    helpText?: string;
    waitText?: string;
    refollowText?: string;
    statusResponseAfterActionIndex?: number;
    helpCommandAfterActionIndex?: number;
    waitCommandAfterActionIndex?: number;
    refollowCommandAfterActionIndex?: number;
}

export function makeFollowAndChat5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: FOLLOW_AND_CHAT_5M_TASK_ID,
        version: FOLLOW_AND_CHAT_5M_TASK_VERSION,
        timeoutMs: FOLLOW_AND_CHAT_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        peers: [
            {
                id: 'codex',
                spawnPosition: PEER_POSITION,
            },
        ],
        run: async context => {
            const startedAt = now();
            const actions: FollowAndChat5mActionAttempt[] = [];
            const stimulus = benchmarkStimulus(context);

            await context.submitPeerAction('codex', { kind: 'say', text: stimulus.followText, cause: 'benchmark_follow_and_chat_5m_peer' });
            context.recordSummary('Benchmark peer asked the agent to follow.');

            const moveAction: AgentAction = {
                kind: 'move_to',
                target: PEER_POSITION,
                range: FOLLOW_RANGE,
                cause: 'benchmark_follow_and_chat_5m',
            };
            actions.push({ action: moveAction });
            await context.submitAction(moveAction);

            await waitForFollowEvidence(context, actions, startedAt, now, stimulus);

            await context.submitPeerAction('codex', { kind: 'say', text: stimulus.statusText, cause: 'benchmark_follow_and_chat_5m_peer' });
            context.recordSummary('Benchmark peer asked the agent for status.');
            const statusResponseAfterActionIndex = actions.length;

            const reportAction: AgentAction = {
                kind: 'say',
                text: 'I am online at 3228,3230. I am following the benchmark peer.',
                cause: 'benchmark_follow_and_chat_5m',
            };
            actions.push({ action: reportAction });
            await context.submitAction(reportAction);

            await context.submitPeerAction('codex', { kind: 'say', text: stimulus.helpText, cause: 'benchmark_follow_and_chat_5m_peer' });
            context.recordSummary('Benchmark peer asked the agent for help.');
            const helpCommandAfterActionIndex = actions.length;

            const helpAction: AgentAction = {
                kind: 'say',
                text: 'Try: follow me, status, look around, inventory, make fire, fish, fight safely, trade me, stop.',
                cause: 'benchmark_follow_and_chat_5m',
            };
            actions.push({ action: helpAction });
            await context.submitAction(helpAction);

            await context.submitPeerAction('codex', { kind: 'say', text: stimulus.waitText, cause: 'benchmark_follow_and_chat_5m_peer' });
            context.recordSummary('Benchmark peer asked the agent to wait.');
            const waitCommandAfterActionIndex = actions.length;

            const waitAction: AgentAction = {
                kind: 'say',
                text: 'I will pause here and wait for a new goal.',
                cause: 'benchmark_follow_and_chat_5m',
            };
            actions.push({ action: waitAction });
            await context.submitAction(waitAction);

            await context.submitPeerAction('codex', {
                kind: 'move_to',
                target: REFOLLOW_PEER_POSITION,
                range: 0,
                cause: 'benchmark_follow_and_chat_5m_peer',
            });
            await context.submitPeerAction('codex', {
                kind: 'say',
                text: stimulus.refollowText,
                cause: 'benchmark_follow_and_chat_5m_peer',
            });
            context.recordSummary('Benchmark peer moved away and asked the agent to resume following.');
            const refollowCommandAfterActionIndex = actions.length;

            const refollowAction: AgentAction = {
                kind: 'move_to',
                target: REFOLLOW_PEER_POSITION,
                range: FOLLOW_RANGE,
                cause: 'benchmark_follow_and_chat_5m',
            };
            actions.push({ action: refollowAction });
            await context.submitAction(refollowAction);

            while (!context.signal.aborted && now() - startedAt < FOLLOW_AND_CHAT_5M_BUDGET_MS) {
                const outcome = verifyFollowAndChat5m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                    ...stimulus,
                    statusResponseAfterActionIndex,
                    helpCommandAfterActionIndex,
                    waitCommandAfterActionIndex,
                    refollowCommandAfterActionIndex,
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyFollowAndChat5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
                ...stimulus,
                statusResponseAfterActionIndex,
                helpCommandAfterActionIndex,
                waitCommandAfterActionIndex,
                refollowCommandAfterActionIndex,
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            let askedStatus = false;
            let askedHelp = false;
            let askedWait = false;
            let movedPeerForRefollow = false;
            let askedRefollow = false;
            let peerMoveStartedAt: number | undefined;
            let statusResponseAfterActionIndex: number | undefined;
            let helpCommandAfterActionIndex: number | undefined;
            let waitCommandAfterActionIndex: number | undefined;
            let refollowCommandAfterActionIndex: number | undefined;
            const stimulus = benchmarkStimulus(context);
            await context.submitPeerAction('codex', { kind: 'say', text: stimulus.followText, cause: 'benchmark_follow_and_chat_5m_peer' });
            context.recordSummary('Benchmark peer asked the autonomous agent to follow.');

            while (!context.signal.aborted && now() - startedAt < FOLLOW_AND_CHAT_5M_BUDGET_MS) {
                const actions = selectedModuleActionAttempts(context);
                const outcome = verifyFollowAndChat5m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                    ...stimulus,
                    statusResponseAfterActionIndex,
                    helpCommandAfterActionIndex,
                    waitCommandAfterActionIndex,
                    refollowCommandAfterActionIndex,
                });
                if (!askedStatus && outcome.metrics?.followActions) {
                    statusResponseAfterActionIndex = actions.length;
                    await context.submitPeerAction('codex', {
                        kind: 'say',
                        text: stimulus.statusText,
                        cause: 'benchmark_follow_and_chat_5m_peer',
                    });
                    context.recordSummary('Benchmark peer asked for status after follow evidence.');
                    askedStatus = true;
                }
                if (askedStatus && !askedHelp && outcome.metrics?.statusResponses) {
                    helpCommandAfterActionIndex = actions.length;
                    await context.submitPeerAction('codex', {
                        kind: 'say',
                        text: stimulus.helpText,
                        cause: 'benchmark_follow_and_chat_5m_peer',
                    });
                    context.recordSummary('Benchmark peer asked the autonomous agent for help.');
                    askedHelp = true;
                }
                if (askedHelp && !askedWait && outcome.metrics?.helpResponses) {
                    waitCommandAfterActionIndex = actions.length;
                    await context.submitPeerAction('codex', {
                        kind: 'say',
                        text: stimulus.waitText,
                        cause: 'benchmark_follow_and_chat_5m_peer',
                    });
                    context.recordSummary('Benchmark peer asked the autonomous agent to wait.');
                    askedWait = true;
                }
                if (askedWait && !movedPeerForRefollow && outcome.metrics?.waitAcknowledgements) {
                    await context.submitPeerAction('codex', {
                        kind: 'move_to',
                        target: REFOLLOW_PEER_POSITION,
                        range: 0,
                        cause: 'benchmark_follow_and_chat_5m_peer',
                    });
                    context.recordSummary('Benchmark peer moved away before asking the agent to resume following.');
                    movedPeerForRefollow = true;
                    peerMoveStartedAt = now();
                }
                if (
                    movedPeerForRefollow &&
                    !askedRefollow &&
                    (peerNearPosition(context.perceptions(), REFOLLOW_PEER_POSITION) ||
                        (peerMoveStartedAt !== undefined && now() - peerMoveStartedAt > 10_000))
                ) {
                    refollowCommandAfterActionIndex = actions.length;
                    await context.submitPeerAction('codex', {
                        kind: 'say',
                        text: stimulus.refollowText,
                        cause: 'benchmark_follow_and_chat_5m_peer',
                    });
                    context.recordSummary('Benchmark peer asked the autonomous agent to resume following.');
                    askedRefollow = true;
                }
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyFollowAndChat5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
                ...stimulus,
                statusResponseAfterActionIndex,
                helpCommandAfterActionIndex,
                waitCommandAfterActionIndex,
                refollowCommandAfterActionIndex,
            });
        },
    };
}

export function verifyFollowAndChat5m(input: FollowAndChat5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = followAndChatMetrics(input);
    if (input.elapsedMs > FOLLOW_AND_CHAT_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'follow-and-chat-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.followCommands === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No peer follow command was observed',
        };
    }

    if (metrics.followActions === 0) {
        return {
            status: 'failed',
            score: 0.25,
            metrics,
            failureReason: 'No direct follow movement was attempted after the peer command',
        };
    }

    if (metrics.movedTowardSpeaker === 0 && metrics.arrivedEvents === 0 && metrics.nearSpeakerObserved === 0) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'Follow movement was attempted but no progress toward the speaker was observed',
        };
    }

    if (metrics.chatResponses === 0) {
        return {
            status: 'failed',
            score: 0.7,
            metrics,
            failureReason: 'No chat response was spoken after the peer command',
        };
    }

    if (metrics.statusCommands === 0) {
        return {
            status: 'failed',
            score: 0.75,
            metrics,
            failureReason: 'No benchmark peer status command was observed after follow movement',
        };
    }

    if (metrics.statusResponses === 0) {
        return {
            status: 'failed',
            score: 0.8,
            metrics,
            failureReason: 'No status chat response was spoken after the benchmark status command',
        };
    }

    if (metrics.helpCommands === 0) {
        return {
            status: 'failed',
            score: 0.82,
            metrics,
            failureReason: 'No benchmark peer help command was observed after the status response',
        };
    }

    if (metrics.helpResponses === 0) {
        return {
            status: 'failed',
            score: 0.84,
            metrics,
            failureReason: 'No help or command-list response was spoken after the benchmark help command',
        };
    }

    if (metrics.waitCommands === 0) {
        return {
            status: 'failed',
            score: 0.85,
            metrics,
            failureReason: 'No benchmark peer wait command was observed after the status response',
        };
    }

    if (metrics.waitAcknowledgements === 0) {
        return {
            status: 'failed',
            score: 0.88,
            metrics,
            failureReason: 'No wait or stop acknowledgement was spoken after the benchmark wait command',
        };
    }

    if (metrics.refollowCommands === 0) {
        return {
            status: 'failed',
            score: 0.92,
            metrics,
            failureReason: 'No benchmark peer resumed-follow command was observed after the wait acknowledgement',
        };
    }

    if (metrics.refollowActions === 0) {
        return {
            status: 'failed',
            score: 0.95,
            metrics,
            failureReason: 'No follow movement was attempted after the resumed-follow command',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['follow-and-chat-5m observed follow, status, help, wait-pause, and resumed follow behavior.'],
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): FollowAndChat5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function followAndChatMetrics(input: FollowAndChat5mVerificationInput): Record<string, number> {
    const peerChatEvents = benchmarkPeerChatEvents(input);
    const followCommandEvents = peerChatEvents.filter(event => isFollowChat(event, input));
    const refollowCommandEvents = peerChatEvents.filter(event => isRefollowChat(event, input));
    const events = allEvents(input);
    const followActions = input.actions.filter(attempt => isFollowAction(attempt.action, followCommandEvents));
    const firstFollowActionIndex = input.actions.findIndex(attempt => isFollowAction(attempt.action, followCommandEvents));
    const statusResponseStartIndex =
        input.statusResponseAfterActionIndex ?? (firstFollowActionIndex === -1 ? input.actions.length : firstFollowActionIndex + 1);
    const statusResponseEndIndex = input.helpCommandAfterActionIndex ?? input.actions.length;
    const actionsAfterStatusPrompt = input.actions.slice(statusResponseStartIndex, statusResponseEndIndex);
    const helpResponseStartIndex = input.helpCommandAfterActionIndex ?? input.actions.length;
    const actionsAfterHelpPrompt = input.actions.slice(helpResponseStartIndex);
    const waitResponseStartIndex = input.waitCommandAfterActionIndex ?? input.actions.length;
    const actionsAfterWaitPrompt = input.actions.slice(waitResponseStartIndex);
    const refollowActionStartIndex = input.refollowCommandAfterActionIndex ?? input.actions.length;
    const actionsAfterRefollowPrompt = input.actions.slice(refollowActionStartIndex);
    return {
        actionsAttempted: input.actions.length,
        followCommands: followCommandEvents.length,
        statusCommands: peerChatEvents.filter(event => isStatusChat(event, input)).length,
        helpCommands: peerChatEvents.filter(event => isHelpChat(event, input)).length,
        waitCommands: peerChatEvents.filter(event => isWaitChat(event, input)).length,
        refollowCommands: refollowCommandEvents.length,
        followActions: followActions.length,
        chatResponses: input.actions.filter(attempt => isSayAction(attempt.action)).length,
        statusResponses: actionsAfterStatusPrompt.filter(attempt => isStatusResponseAction(attempt.action)).length,
        helpResponses: actionsAfterHelpPrompt.filter(attempt => isHelpResponseAction(attempt.action)).length,
        waitAcknowledgements: actionsAfterWaitPrompt.filter(attempt => isWaitAcknowledgementAction(attempt.action)).length,
        refollowActions:
            refollowCommandEvents.length > 0
                ? actionsAfterRefollowPrompt.filter(attempt => isFollowAction(attempt.action, refollowCommandEvents)).length
                : 0,
        positionChanged: positionChanged(input.perceptions) ? 1 : 0,
        movedTowardSpeaker: movedTowardSpeaker(input.perceptions, peerChatEvents) ? 1 : 0,
        arrivedEvents: events.some(event => stringField(event, 'kind') === 'arrived') ? 1 : 0,
        nearSpeakerObserved: nearSpeakerObserved(input.perceptions, peerChatEvents) ? 1 : 0,
    };
}

async function waitForFollowEvidence(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: FollowAndChat5mActionAttempt[],
    startedAt: number,
    now: () => number,
    stimulus: Pick<FollowAndChat5mVerificationInput, 'peerId' | 'followText' | 'statusText'>,
): Promise<void> {
    while (!context.signal.aborted && now() - startedAt < 30_000) {
        const metrics = followAndChatMetrics({
            elapsedMs: now() - startedAt,
            actions,
            perceptions: [...context.perceptions()],
            events: [...context.events()],
            ...stimulus,
        });
        if (metrics.movedTowardSpeaker > 0 || metrics.arrivedEvents > 0 || metrics.nearSpeakerObserved > 0) {
            return;
        }
        await sleep(500, context.signal);
    }
}

function isFollowAction(action: AgentAction, followCommandEvents: PerceptionEvent[]): boolean {
    if (action.kind !== 'move_to') {
        return false;
    }
    return /follow/i.test(stringField(action, 'cause') || '') || moveToTargetsSpeaker(action, followCommandEvents);
}

function moveToTargetsSpeaker(action: AgentAction, events: PerceptionEvent[]): boolean {
    const actionRecord: Record<string, unknown> = isRecord(action) ? action : {};
    const target = positionLike(actionRecord.target);
    if (!target) {
        return false;
    }
    const range = Math.max(0, Math.min(typeof actionRecord.range === 'number' ? actionRecord.range : 0, FOLLOW_RANGE));
    return events.some(event => {
        const speakerPosition = eventSpeakerPosition(event);
        return Boolean(speakerPosition && distance(target, speakerPosition) <= range);
    });
}

function isSayAction(action: AgentAction): action is AgentAction & { text: string } {
    return action.kind === 'say' && typeof action.text === 'string' && action.text.trim().length > 0;
}

function isStatusResponseAction(action: AgentAction): boolean {
    if (!isSayAction(action)) {
        return false;
    }
    return /\b(i am online|i am with you|status)\b/i.test(action.text);
}

function isFollowChat(event: PerceptionEvent, input: FollowAndChat5mVerificationInput): boolean {
    const text = normalizeText(stringField(event, 'text') || '');
    return (
        text === normalizeText(input.followText || DEFAULT_FOLLOW_TEXT) ||
        text === normalizeText(input.refollowText || DEFAULT_REFOLLOW_TEXT)
    );
}

function isStatusChat(event: PerceptionEvent, input: FollowAndChat5mVerificationInput): boolean {
    const text = normalizeText(stringField(event, 'text') || '');
    return text === normalizeText(input.statusText || DEFAULT_STATUS_TEXT);
}

function isHelpChat(event: PerceptionEvent, input: FollowAndChat5mVerificationInput): boolean {
    const text = normalizeText(stringField(event, 'text') || '');
    return text === normalizeText(input.helpText || DEFAULT_HELP_TEXT);
}

function isWaitChat(event: PerceptionEvent, input: FollowAndChat5mVerificationInput): boolean {
    const text = normalizeText(stringField(event, 'text') || '');
    return text === normalizeText(input.waitText || DEFAULT_WAIT_TEXT);
}

function isRefollowChat(event: PerceptionEvent, input: FollowAndChat5mVerificationInput): boolean {
    const text = normalizeText(stringField(event, 'text') || '');
    return text === normalizeText(input.refollowText || DEFAULT_REFOLLOW_TEXT);
}

function isWaitAcknowledgementAction(action: AgentAction): boolean {
    if (!isSayAction(action)) {
        return false;
    }
    return /\b(pause|wait|waiting|still here|hold position|stopping)\b/i.test(action.text);
}

function isHelpResponseAction(action: AgentAction): boolean {
    if (!isSayAction(action)) {
        return false;
    }
    return /\b(follow me|make fire|trade me|commands|try:|status)\b/i.test(action.text);
}

function benchmarkPeerChatEvents(input: FollowAndChat5mVerificationInput): PerceptionEvent[] {
    const peerId = normalizeActorId(input.peerId || DEFAULT_PEER_ID);
    return allEvents(input).filter(event => stringField(event, 'kind') === 'chat' && eventFromId(event) === peerId);
}

function allEvents(input: FollowAndChat5mVerificationInput): PerceptionEvent[] {
    return [
        ...input.events,
        ...input.perceptions.flatMap(perception => {
            const events = (perception as Record<string, unknown>).events;
            return Array.isArray(events) ? (events.filter(isRecord) as PerceptionEvent[]) : [];
        }),
    ];
}

function positionChanged(perceptions: Perception[]): boolean {
    const positions = perceptions
        .map(perceptionPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    if (positions.length < 2) {
        return false;
    }
    const first = positions[0];
    return positions.slice(1).some(position => position.x !== first.x || position.y !== first.y || position.level !== first.level);
}

function nearSpeakerObserved(perceptions: Perception[], events: PerceptionEvent[]): boolean {
    const speakerPositions = events
        .map(eventSpeakerPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    if (speakerPositions.length === 0) {
        return false;
    }
    return perceptions.some(perception => {
        const here = perceptionPosition(perception);
        return Boolean(here && speakerPositions.some(position => distance(here, position) <= FOLLOW_RANGE));
    });
}

function movedTowardSpeaker(perceptions: Perception[], events: PerceptionEvent[]): boolean {
    const speakerPositions = events
        .map(eventSpeakerPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    const positions = perceptions
        .map(perceptionPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    if (speakerPositions.length === 0 || positions.length < 2) {
        return false;
    }
    return speakerPositions.some(speakerPosition => {
        let bestDistance = distance(positions[0], speakerPosition);
        for (const position of positions.slice(1)) {
            const nextDistance = distance(position, speakerPosition);
            if (nextDistance < bestDistance) {
                return true;
            }
            bestDistance = Math.min(bestDistance, nextDistance);
        }
        return false;
    });
}

function perceptionPosition(perception: Perception): { x: number; y: number; level: number } | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : undefined;
    return positionLike(resident?.position);
}

function eventSpeakerPosition(event: PerceptionEvent): { x: number; y: number; level: number } | undefined {
    const from = isRecord(event.from) ? event.from : undefined;
    return positionLike(from?.position);
}

function eventFromId(event: PerceptionEvent): string | undefined {
    const from = isRecord(event.from) ? event.from : undefined;
    return typeof from?.id === 'string' ? normalizeActorId(from.id) : undefined;
}

function positionLike(value: unknown): { x: number; y: number; level: number } | undefined {
    if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
        return undefined;
    }
    return {
        x: value.x,
        y: value.y,
        level: typeof value.level === 'number' ? value.level : 0,
    };
}

function distance(a: { x: number; y: number; level: number }, b: { x: number; y: number; level: number }): number {
    if (a.level !== b.level) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeActorId(id: string): string {
    return id.trim().toLowerCase();
}

function benchmarkStimulus(context: Parameters<BenchmarkTask['run']>[0]): {
    peerId: string;
    followText: string;
    statusText: string;
    helpText: string;
    waitText: string;
    refollowText: string;
} {
    const peerResident = context.peerResident('codex');
    const nonce = `benchmark ${context.resident}`;
    return {
        peerId: peerResident ? `resident:${peerResident}` : DEFAULT_PEER_ID,
        followText: `${DEFAULT_FOLLOW_TEXT} ${nonce}`,
        statusText: `${DEFAULT_STATUS_TEXT} ${nonce}`,
        helpText: `${DEFAULT_HELP_TEXT} ${nonce}`,
        waitText: `${DEFAULT_WAIT_TEXT} ${nonce}`,
        refollowText: `${DEFAULT_REFOLLOW_TEXT} ${nonce}`,
    };
}

function peerNearPosition(perceptions: readonly Perception[], target: { x: number; y: number; level: number }): boolean {
    return perceptions.some(perception => {
        const nearby = isRecord(perception.nearby) ? perception.nearby : undefined;
        const players = Array.isArray(nearby?.players) ? nearby.players.filter(isRecord) : [];
        return players.some(player => {
            const position = positionLike(player.position);
            return Boolean(position && distance(position, target) <= 1);
        });
    });
}

function stringField(value: unknown, key: string): string | undefined {
    return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return;
    }
    await new Promise<void>(resolve => {
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
