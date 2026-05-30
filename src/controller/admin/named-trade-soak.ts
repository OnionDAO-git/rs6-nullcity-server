import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import type { AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';
import { GatewayClient } from '../transport/gateway-client';
import { isoDate } from '../util/clock';

export interface NamedTradeSoakInventoryItem {
    itemId: number;
    amount: number;
    key?: string;
}

export interface NamedTradeSoakLogEntry {
    t?: string;
    source?: string;
    action?: Record<string, unknown>;
    result?: Record<string, unknown>;
}

export interface NamedTradeSoakOptions {
    resident: string;
    trustedPeer: string;
    unsafePeer: string;
    commandPrefix: string;
    configPath: string;
    outputDir: string;
    durationMs: number;
    pollMs: number;
    unsafeRepeatCount: number;
    keepPeers: boolean;
    trustedSpawn: { x: number; y: number; level: number };
    unsafeSpawn: { x: number; y: number; level: number };
}

export interface NamedTradeSoakVerificationInput {
    resident: string;
    trustedPeer: string;
    unsafePeer: string;
    entries: NamedTradeSoakLogEntry[];
    inventoryBefore: NamedTradeSoakInventoryItem[];
    inventoryAfter: NamedTradeSoakInventoryItem[];
    tradeCompletedEvents: number;
    tradeCancelledEvents: number;
    unsafeRepeatCount?: number;
}

export interface NamedTradeSoakPeerSpawns {
    trustedSpawn: { x: number; y: number; level: number };
    unsafeSpawn: { x: number; y: number; level: number };
}

export interface NamedTradeSoakActorRef {
    id: string;
    kind: 'resident';
    name?: string;
    position: { x: number; y: number; level: number };
}

export interface NamedTradeSoakOutcome {
    status: 'passed' | 'failed';
    score: number;
    metrics: Record<string, number>;
    failureReason?: string;
    summaries: string[];
}

export interface NamedTradeSoakRuntime {
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
}

const DEFAULT_DURATION_MS = 120_000;
const DEFAULT_POLL_MS = 500;
const SAFE_ITEM_ID = 1511;

export function parseNamedTradeSoakArgs(argv: string[], now: Date = new Date()): NamedTradeSoakOptions {
    const defaultPeerSuffix = tradeSoakPeerSuffix(now);
    const options: NamedTradeSoakOptions = {
        resident: process.env.CONTROLLER_TRADE_SOAK_RESIDENT || 'res:qa-trader',
        trustedPeer: process.env.CONTROLLER_TRADE_SOAK_TRUSTED_PEER || `res:codex-cqa4-${defaultPeerSuffix}`,
        unsafePeer: process.env.CONTROLLER_TRADE_SOAK_UNSAFE_PEER || `res:alice-cqa4-${defaultPeerSuffix}`,
        commandPrefix: process.env.CONTROLLER_TRADE_SOAK_PREFIX || 'trade',
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        outputDir: process.env.CONTROLLER_TRADE_SOAK_OUTPUT_DIR || path.join('data', 'benchmarks', `capability-qa-${isoDate(now)}`),
        durationMs: readPositiveInt(process.env.CONTROLLER_TRADE_SOAK_DURATION_MS, DEFAULT_DURATION_MS),
        pollMs: readPositiveInt(process.env.CONTROLLER_TRADE_SOAK_POLL_MS, DEFAULT_POLL_MS),
        unsafeRepeatCount: readPositiveInt(process.env.CONTROLLER_TRADE_SOAK_UNSAFE_REPEATS, 1),
        keepPeers: process.env.CONTROLLER_TRADE_SOAK_KEEP_PEERS === '1' || process.env.CONTROLLER_TRADE_SOAK_KEEP_PEERS === 'true',
        trustedSpawn: { x: 3226, y: 3230, level: 0 },
        unsafeSpawn: { x: 3228, y: 3230, level: 0 },
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--resident') {
            options.resident = normalizeResidentName(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--resident=')) {
            options.resident = normalizeResidentName(arg.slice('--resident='.length));
        } else if (arg === '--trusted-peer') {
            options.trustedPeer = normalizeResidentName(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--trusted-peer=')) {
            options.trustedPeer = normalizeResidentName(arg.slice('--trusted-peer='.length));
        } else if (arg === '--unsafe-peer') {
            options.unsafePeer = normalizeResidentName(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--unsafe-peer=')) {
            options.unsafePeer = normalizeResidentName(arg.slice('--unsafe-peer='.length));
        } else if (arg === '--prefix') {
            options.commandPrefix = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--prefix=')) {
            options.commandPrefix = arg.slice('--prefix='.length);
        } else if (arg === '--config' || arg === '-c') {
            options.configPath = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.slice('--config='.length);
        } else if (arg === '--output' || arg === '--output-dir') {
            options.outputDir = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--output=')) {
            options.outputDir = arg.slice('--output='.length);
        } else if (arg.startsWith('--output-dir=')) {
            options.outputDir = arg.slice('--output-dir='.length);
        } else if (arg === '--duration-ms') {
            options.durationMs = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_DURATION_MS);
        } else if (arg.startsWith('--duration-ms=')) {
            options.durationMs = readPositiveInt(arg.slice('--duration-ms='.length), DEFAULT_DURATION_MS);
        } else if (arg === '--poll-ms') {
            options.pollMs = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_POLL_MS);
        } else if (arg.startsWith('--poll-ms=')) {
            options.pollMs = readPositiveInt(arg.slice('--poll-ms='.length), DEFAULT_POLL_MS);
        } else if (arg === '--unsafe-repeats') {
            options.unsafeRepeatCount = readPositiveInt(readRequiredValue(argv, ++i, arg), 1);
        } else if (arg.startsWith('--unsafe-repeats=')) {
            options.unsafeRepeatCount = readPositiveInt(arg.slice('--unsafe-repeats='.length), 1);
        } else if (arg === '--keep-peers') {
            options.keepPeers = true;
        } else {
            throw new Error(`Unknown named trade soak argument ${arg}`);
        }
    }

    options.resident = normalizeResidentName(options.resident);
    options.trustedPeer = normalizeResidentName(options.trustedPeer);
    options.unsafePeer = normalizeResidentName(options.unsafePeer);
    return options;
}

export function verifyNamedTradeSoakEvidence(input: NamedTradeSoakVerificationInput): NamedTradeSoakOutcome {
    const metrics = namedTradeSoakMetrics(input);
    if (metrics.tradeRequests === 0) {
        return failed('No ordinary action-log trade_request from the named resident', metrics);
    }
    if (metrics.tradeCompletedEvents === 0) {
        return failed('No trusted trade_completed event was observed', metrics);
    }
    if (metrics.safeItemOffers === 0) {
        return failed('No ordinary action-log trade_offer_item for a safe item was observed', metrics);
    }
    if (metrics.acceptStage1 === 0 || metrics.acceptStage2 === 0) {
        return failed('No complete two-stage trusted trade acceptance was observed', metrics);
    }
    if (metrics.safeInventoryDelta >= 0) {
        return failed('No inventory decrease for a safe trade item was observed', metrics);
    }
    if (metrics.unsafeTradeRequests < metrics.unsafeRepeatTarget) {
        return failed('Not every repeated unsafe trade prompt produced a named-resident trade_request', metrics);
    }
    if (metrics.unsafeDeclines === 0) {
        return failed('No ordinary action-log unsafe trade_decline was observed', metrics);
    }
    if (metrics.postUnsafeOffersOrAccepts > 0) {
        return failed('Unsafe peer prompted trade loop produced offer/accept actions', metrics);
    }
    if (metrics.unsafeDeclines < metrics.unsafeRepeatTarget) {
        return failed('Not every repeated unsafe trade prompt was declined', metrics);
    }
    if (metrics.tradeCancelledEvents < metrics.unsafeRepeatTarget) {
        return failed('No unsafe trade_cancelled event was observed', metrics);
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            `${input.resident} completed trusted operator trade with ${input.trustedPeer} and declined unsafe trade with ${input.unsafePeer}.`,
        ],
    };
}

export function peerSpawnsNearPerception(perception: Perception | undefined): NamedTradeSoakPeerSpawns | undefined {
    const resident = isRecord(perception?.resident) ? perception?.resident : undefined;
    const position = isRecord(resident?.position) ? resident.position : undefined;
    if (typeof position?.x !== 'number' || typeof position.y !== 'number' || typeof position.level !== 'number') {
        return undefined;
    }
    const spawn = { x: position.x, y: position.y, level: position.level };
    return {
        trustedSpawn: spawn,
        unsafeSpawn: spawn,
    };
}

export function actorRefFromPerception(resident: string, perception: Perception | undefined): NamedTradeSoakActorRef | undefined {
    const residentRecord = isRecord(perception?.resident) ? perception?.resident : undefined;
    const position = isRecord(residentRecord?.position) ? residentRecord.position : undefined;
    if (typeof position?.x !== 'number' || typeof position.y !== 'number' || typeof position.level !== 'number') {
        return undefined;
    }
    return {
        id: typeof residentRecord?.id === 'string' ? residentRecord.id : `resident:${resident}`,
        kind: 'resident',
        name: typeof residentRecord?.name === 'string' ? residentRecord.name : resident,
        position: { x: position.x, y: position.y, level: position.level },
    };
}

export async function runNamedTradeSoakCli(argv: string[], runtime: NamedTradeSoakRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (line => process.stdout.write(line));
    const stderr = runtime.stderr || (line => process.stderr.write(line));
    const options = parseNamedTradeSoakArgs(argv);
    const config = loadControllerConfig(options.configPath);
    const gateway = new GatewayClient({
        url: config.gateway.url,
        authToken: config.gateway.authToken,
        controllerId: `${config.gateway.controllerId}:trade-soak`,
        reconnect: false,
        requestTimeoutMs: 20_000,
    });
    const startedAt = new Date();
    const actionLogPath = path.join(config.logging.dir, options.resident, 'actions', `${isoDate(startedAt)}.jsonl`);
    const baselineSize = fileSize(actionLogPath);
    const targetPerceptions: Perception[] = [];
    const targetEvents: PerceptionEvent[] = [];
    let createdTrusted = false;
    let createdUnsafe = false;

    gateway.on('perception', (residentId, perception) => {
        if (sameResident(residentId, options.resident)) {
            targetPerceptions.push(perception);
        }
    });
    gateway.on('event', (residentId, event) => {
        if (sameResident(residentId, options.resident)) {
            targetEvents.push(event);
        }
    });
    gateway.on('error', error => {
        stderr(`[controller:trade-soak:gateway] ${error.message}\n`);
    });

    try {
        await gateway.connect();
        await gateway.hello();
        const residents = await gateway.listResidents('all');
        const target = residents.find(resident => sameResident(resident.name, options.resident));
        if (!target?.online) {
            throw new Error(`${options.resident} is not online; start controller before running named trade soak`);
        }
        await gateway.attach({ name: options.resident, observe: true, control: false, onDisconnect: 'idle' });
        await waitFor(() => targetPerceptions.length > 0, options, 'initial target perception');
        const initialTargetPerception = targetPerceptions.at(-1);
        const dynamicSpawns = peerSpawnsNearPerception(initialTargetPerception);
        const targetRef = actorRefFromPerception(options.resident, initialTargetPerception);
        if (!targetRef) {
            throw new Error(`Could not derive live actor ref for ${options.resident} from perception`);
        }
        const trustedSpawn = dynamicSpawns?.trustedSpawn || options.trustedSpawn;
        const unsafeSpawn = dynamicSpawns?.unsafeSpawn || options.unsafeSpawn;

        createdTrusted = await recreatePeer(gateway, options.trustedPeer, trustedSpawn);
        createdUnsafe = await recreatePeer(gateway, options.unsafePeer, unsafeSpawn);
        await gateway.connectResident({ name: options.trustedPeer, observe: false, control: true, onDisconnect: 'idle' });
        await gateway.connectResident({ name: options.unsafePeer, observe: false, control: true, onDisconnect: 'idle' });

        const inventoryBefore = inventoryFromPerception(targetPerceptions.at(-1));
        stdout(
            `[trade-soak] ${options.resident} initial safe item count=${safeItemCount(inventoryBefore)} peers=${trustedSpawn.x},${trustedSpawn.y}/${unsafeSpawn.x},${unsafeSpawn.y}\n`,
        );

        await trustedTradeSequence(gateway, options, actionLogPath, baselineSize, targetEvents, targetRef);
        for (let repeatIndex = 0; repeatIndex < options.unsafeRepeatCount; repeatIndex += 1) {
            await unsafeTradeSequence(gateway, options, actionLogPath, baselineSize, targetRef, repeatIndex);
        }
        await sleep(options.pollMs);
        const entries = readActionLogEntriesSince(actionLogPath, baselineSize);
        const inventoryAfter = inventoryFromPerception(targetPerceptions.at(-1));
        const outcome = verifyNamedTradeSoakEvidence({
            resident: options.resident,
            trustedPeer: options.trustedPeer,
            unsafePeer: options.unsafePeer,
            entries,
            inventoryBefore,
            inventoryAfter,
            tradeCompletedEvents: targetEvents.filter(event => event.kind === 'trade_completed').length,
            tradeCancelledEvents: targetEvents.filter(event => event.kind === 'trade_cancelled').length,
            unsafeRepeatCount: options.unsafeRepeatCount,
        });
        const artifactPath = writeArtifact(options.outputDir, {
            schemaVersion: 1,
            kind: 'named_trade_soak',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            options: publicOptions(options),
            dynamicSpawns,
            actionLogPath,
            status: outcome.status,
            score: outcome.score,
            metrics: outcome.metrics,
            failureReason: outcome.failureReason,
            summaries: outcome.summaries,
            inventoryBefore,
            inventoryAfter,
            entries,
            events: targetEvents,
        });
        stdout(`${JSON.stringify({ artifactPath, status: outcome.status, score: outcome.score, metrics: outcome.metrics })}\n`);
        return outcome.status === 'passed' ? 0 : 1;
    } catch (error) {
        stderr(`[controller:trade-soak] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    } finally {
        if (!options.keepPeers) {
            await cleanupPeer(gateway, options.unsafePeer, createdUnsafe);
            await cleanupPeer(gateway, options.trustedPeer, createdTrusted);
        }
        gateway.close();
    }
}

async function trustedTradeSequence(
    gateway: GatewayClient,
    options: NamedTradeSoakOptions,
    actionLogPath: string,
    baselineSize: number,
    events: PerceptionEvent[],
    targetRef: NamedTradeSoakActorRef,
): Promise<void> {
    await gateway.submitAction(options.trustedPeer, {
        kind: 'say',
        text: `${options.commandPrefix} trade me`,
        cause: 'named_trade_soak_trusted_command',
    });
    await waitFor(() => metricFromLog(actionLogPath, baselineSize, 'trade_request') >= 1, options, 'trusted trade_request');
    await gateway.submitAction(options.trustedPeer, {
        kind: 'trade_request',
        target: targetRef,
        cause: 'named_trade_soak_trusted_reciprocal',
    });
    await waitFor(() => metricFromLog(actionLogPath, baselineSize, 'trade_offer_item') >= 1, options, 'trusted trade_offer_item');
    await gateway.submitAction(options.trustedPeer, {
        kind: 'trade_accept_stage_1',
        cause: 'named_trade_soak_trusted_accept_1',
    });
    await waitFor(() => metricFromLog(actionLogPath, baselineSize, 'trade_accept_stage_1') >= 1, options, 'trusted accept stage 1');
    await gateway.submitAction(options.trustedPeer, {
        kind: 'trade_accept_stage_2',
        cause: 'named_trade_soak_trusted_accept_2',
    });
    await waitFor(
        () =>
            metricFromLog(actionLogPath, baselineSize, 'trade_accept_stage_2') >= 1 ||
            events.some(event => event.kind === 'trade_completed'),
        options,
        'trusted accept stage 2 or completion',
    );
}

async function unsafeTradeSequence(
    gateway: GatewayClient,
    options: NamedTradeSoakOptions,
    actionLogPath: string,
    baselineSize: number,
    targetRef: NamedTradeSoakActorRef,
    repeatIndex: number,
): Promise<void> {
    await gateway.submitAction(options.unsafePeer, {
        kind: 'say',
        text: `${options.commandPrefix} trade me ${repeatIndex + 1}`,
        cause: 'named_trade_soak_unsafe_command',
    });
    await waitFor(
        () => tradeRequestsToPeerFromLog(actionLogPath, baselineSize, options.unsafePeer) >= repeatIndex + 1,
        options,
        `unsafe trade_request ${repeatIndex + 1}`,
    );
    await gateway.submitAction(options.unsafePeer, {
        kind: 'trade_request',
        target: targetRef,
        cause: 'named_trade_soak_unsafe_reciprocal',
    });
    await waitFor(
        () => unsafeDeclinesFromLog(actionLogPath, baselineSize) >= repeatIndex + 1,
        options,
        `unsafe trade_decline ${repeatIndex + 1}`,
    );
}

function namedTradeSoakMetrics(input: NamedTradeSoakVerificationInput): Record<string, number> {
    const firstUnsafeRequestIndex = input.entries.findIndex(entry => isTradeRequestToPeer(entry, input.unsafePeer));
    return {
        unsafeRepeatTarget: Math.max(1, input.unsafeRepeatCount || 1),
        ordinaryActionEntries: input.entries.length,
        tradeRequests: countAction(input.entries, 'trade_request'),
        trustedTradeRequests: input.entries.filter(entry => isTradeRequestToPeer(entry, input.trustedPeer)).length,
        unsafeTradeRequests: input.entries.filter(entry => isTradeRequestToPeer(entry, input.unsafePeer)).length,
        safeItemOffers: input.entries.filter(entry => entry.action?.kind === 'trade_offer_item' && safeOffer(entry.action)).length,
        acceptStage1: countAction(input.entries, 'trade_accept_stage_1'),
        acceptStage2: countAction(input.entries, 'trade_accept_stage_2'),
        unsafeDeclines: input.entries.filter(
            entry => entry.action?.kind === 'trade_decline' && /untrusted|unsafe/i.test(String(entry.action.cause || '')),
        ).length,
        tradeCompletedEvents: input.tradeCompletedEvents,
        tradeCancelledEvents: input.tradeCancelledEvents,
        inventoryBeforeItem1511: itemCount(input.inventoryBefore, SAFE_ITEM_ID),
        inventoryAfterItem1511: itemCount(input.inventoryAfter, SAFE_ITEM_ID),
        inventoryDeltaItem1511: itemCount(input.inventoryAfter, SAFE_ITEM_ID) - itemCount(input.inventoryBefore, SAFE_ITEM_ID),
        safeInventoryBefore: safeItemCount(input.inventoryBefore),
        safeInventoryAfter: safeItemCount(input.inventoryAfter),
        safeInventoryDelta: safeItemCount(input.inventoryAfter) - safeItemCount(input.inventoryBefore),
        postUnsafeOffersOrAccepts:
            firstUnsafeRequestIndex < 0
                ? 0
                : input.entries.slice(firstUnsafeRequestIndex + 1).filter(entry => isTradeOfferOrAccept(entry.action)).length,
    };
}

function failed(failureReason: string, metrics: Record<string, number>): NamedTradeSoakOutcome {
    return { status: 'failed', score: 0, metrics, failureReason, summaries: [] };
}

function countAction(entries: NamedTradeSoakLogEntry[], kind: string): number {
    return entries.filter(entry => entry.action?.kind === kind).length;
}

function safeOffer(action: Record<string, unknown>): boolean {
    const itemId = typeof action.itemId === 'number' ? action.itemId : undefined;
    if (itemId !== undefined) {
        return itemId === SAFE_ITEM_ID;
    }
    return typeof action.inventorySlot === 'number' && typeof action.amount === 'number';
}

async function recreatePeer(
    gateway: GatewayClient,
    name: string,
    spawnPosition: { x: number; y: number; level: number },
): Promise<boolean> {
    try {
        await gateway.disconnectResident(name);
    } catch {
        // Peer may not exist yet.
    }
    try {
        await gateway.deleteResident(name);
    } catch {
        // Deletion can be disabled or unnecessary; create will report if this matters.
    }
    await gateway.createResident({ name, spawnPosition });
    return true;
}

async function cleanupPeer(gateway: GatewayClient, name: string, created: boolean): Promise<void> {
    if (!created) {
        return;
    }
    try {
        await gateway.disconnectResident(name);
    } catch {
        // Best-effort cleanup.
    }
    try {
        await gateway.deleteResident(name);
    } catch {
        // Best-effort cleanup.
    }
}

function readActionLogEntriesSince(filePath: string, baselineSize: number): NamedTradeSoakLogEntry[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const buffer = fs.readFileSync(filePath);
    const slice = buffer.subarray(Math.min(baselineSize, buffer.length));
    return slice
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => safeJson(line))
        .filter((entry): entry is NamedTradeSoakLogEntry => Boolean(entry));
}

function metricFromLog(filePath: string, baselineSize: number, actionKind: string): number {
    return countAction(readActionLogEntriesSince(filePath, baselineSize), actionKind);
}

function tradeRequestsToPeerFromLog(filePath: string, baselineSize: number, peer: string): number {
    return readActionLogEntriesSince(filePath, baselineSize).filter(entry => isTradeRequestToPeer(entry, peer)).length;
}

function unsafeDeclinesFromLog(filePath: string, baselineSize: number): number {
    return readActionLogEntriesSince(filePath, baselineSize).filter(
        entry => entry.action?.kind === 'trade_decline' && /untrusted|unsafe/i.test(String(entry.action.cause || '')),
    ).length;
}

function inventoryFromPerception(perception: Perception | undefined): NamedTradeSoakInventoryItem[] {
    const resident = isRecord(perception?.resident) ? perception?.resident : undefined;
    const inventory = Array.isArray(resident?.inventory) ? resident.inventory : [];
    return inventory
        .map(item => (isRecord(item) && typeof item.itemId === 'number' ? itemFromRecord(item) : undefined))
        .filter((item): item is NamedTradeSoakInventoryItem => Boolean(item));
}

function itemFromRecord(item: Record<string, unknown>): NamedTradeSoakInventoryItem {
    return {
        itemId: Number(item.itemId),
        amount: typeof item.amount === 'number' ? item.amount : 1,
        key: typeof item.key === 'string' ? item.key : undefined,
    };
}

function itemCount(items: NamedTradeSoakInventoryItem[], itemId: number): number {
    return items.filter(item => item.itemId === itemId).reduce((total, item) => total + item.amount, 0);
}

function safeItemCount(items: NamedTradeSoakInventoryItem[]): number {
    return items.filter(isSafeInventoryItem).reduce((total, item) => total + item.amount, 0);
}

function isSafeInventoryItem(item: NamedTradeSoakInventoryItem): boolean {
    return ![590, 303, 1351, 1349, 1353, 995].includes(item.itemId);
}

async function waitFor(predicate: () => boolean, options: NamedTradeSoakOptions, label: string): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < options.durationMs) {
        if (predicate()) {
            return;
        }
        await sleep(options.pollMs);
    }
    throw new Error(`Timed out waiting for ${label}`);
}

function writeArtifact(outputDir: string, artifact: Record<string, unknown>): string {
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14);
    const artifactPath = path.join(outputDir, `named_trade_soak_${stamp}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifactPath;
}

function publicOptions(options: NamedTradeSoakOptions): Record<string, unknown> {
    return {
        resident: options.resident,
        trustedPeer: options.trustedPeer,
        unsafePeer: options.unsafePeer,
        commandPrefix: options.commandPrefix,
        configPath: options.configPath,
        durationMs: options.durationMs,
        pollMs: options.pollMs,
        unsafeRepeatCount: options.unsafeRepeatCount,
        trustedSpawn: options.trustedSpawn,
        unsafeSpawn: options.unsafeSpawn,
    };
}

function fileSize(filePath: string): number {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function readRequiredValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (!value) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeResidentName(name: string): string {
    const withoutGatewayPrefix = name.startsWith('resident:') ? name.slice('resident:'.length) : name;
    return withoutGatewayPrefix.startsWith('res:') ? withoutGatewayPrefix.toLowerCase() : `res:${withoutGatewayPrefix.toLowerCase()}`;
}

function tradeSoakPeerSuffix(now: Date): string {
    return now
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(8, 14);
}

function sameResident(candidate: string, expected: string): boolean {
    return candidate === expected || candidate === `resident:${expected}`;
}

function isTradeRequestToPeer(entry: NamedTradeSoakLogEntry, peer: string): boolean {
    if (entry.action?.kind !== 'trade_request') {
        return false;
    }
    return actionTargetMatches(entry.action, peer);
}

function actionTargetMatches(action: Record<string, unknown>, peer: string): boolean {
    const target = isRecord(action.target) ? action.target : {};
    const candidates = [target.id, target.name]
        .filter((value): value is string => typeof value === 'string')
        .flatMap(value => [value, value.startsWith('resident:') ? value.slice('resident:'.length) : `resident:${value}`]);
    return candidates.some(candidate => sameResident(candidate.toLowerCase(), peer.toLowerCase()));
}

function isTradeOfferOrAccept(action: Record<string, unknown> | undefined): boolean {
    return action?.kind === 'trade_offer_item' || action?.kind === 'trade_accept_stage_1' || action?.kind === 'trade_accept_stage_2';
}

function safeJson(line: string): NamedTradeSoakLogEntry | undefined {
    try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? (parsed as NamedTradeSoakLogEntry) : undefined;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
    runNamedTradeSoakCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
