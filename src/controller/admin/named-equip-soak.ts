import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import type { AgentAction, Perception } from '../transport/message-codecs';
import { GatewayClient } from '../transport/gateway-client';
import { isoDate } from '../util/clock';

const PRELOADED_EQUIP_LOOKBACK_MS = 180_000;

export interface NamedEquipSoakInventoryItem {
    itemId: number;
    amount: number;
    key?: string;
}

export interface NamedEquipSoakLogEntry {
    t?: string;
    source?: string;
    action?: Record<string, unknown>;
    result?: Record<string, unknown>;
}

export interface NamedEquipSoakOptions {
    resident: string;
    commandPeer: string;
    commandPrefix: string;
    setupMode: 'unequip' | 'preloaded-inventory';
    configPath: string;
    outputDir: string;
    durationMs: number;
    pollMs: number;
    keepPeer: boolean;
    commandSpawn: { x: number; y: number; level: number };
}

export interface NamedEquipSoakVerificationInput {
    resident: string;
    entries: NamedEquipSoakLogEntry[];
    inventoryBefore: NamedEquipSoakInventoryItem[];
    inventoryAfterSetup: NamedEquipSoakInventoryItem[];
    inventoryAfter: NamedEquipSoakInventoryItem[];
    equipmentAfter: NamedEquipSoakInventoryItem[];
    setupCommandSubmitted: number;
    setupMode: 'unequip' | 'preloaded-inventory';
}

export interface NamedEquipSoakActorRef {
    id: string;
    kind: 'resident';
    name?: string;
    position: { x: number; y: number; level: number };
}

export interface NamedEquipSoakOutcome {
    status: 'passed' | 'failed';
    score: number;
    metrics: Record<string, number>;
    failureReason?: string;
    summaries: string[];
}

export interface NamedEquipSoakRuntime {
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
}

const DEFAULT_DURATION_MS = 120_000;
const DEFAULT_POLL_MS = 500;
const USEFUL_GEAR = new Set([9703, 9704]);

export function parseNamedEquipSoakArgs(argv: string[], now: Date = new Date()): NamedEquipSoakOptions {
    const defaultPeerSuffix = equipSoakPeerSuffix(now);
    const options: NamedEquipSoakOptions = {
        resident: process.env.CONTROLLER_EQUIP_SOAK_RESIDENT || 'res:qa-survivor',
        commandPeer: process.env.CONTROLLER_EQUIP_SOAK_COMMAND_PEER || `res:codex-cqa3-${defaultPeerSuffix}`,
        commandPrefix: process.env.CONTROLLER_EQUIP_SOAK_PREFIX || 'survive',
        setupMode: readSetupMode(process.env.CONTROLLER_EQUIP_SOAK_SETUP_MODE),
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        outputDir: process.env.CONTROLLER_EQUIP_SOAK_OUTPUT_DIR || path.join('data', 'benchmarks', `capability-qa-${isoDate(now)}`),
        durationMs: readPositiveInt(process.env.CONTROLLER_EQUIP_SOAK_DURATION_MS, DEFAULT_DURATION_MS),
        pollMs: readPositiveInt(process.env.CONTROLLER_EQUIP_SOAK_POLL_MS, DEFAULT_POLL_MS),
        keepPeer: process.env.CONTROLLER_EQUIP_SOAK_KEEP_PEER === '1' || process.env.CONTROLLER_EQUIP_SOAK_KEEP_PEER === 'true',
        commandSpawn: { x: 3253, y: 3231, level: 0 },
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--resident') {
            options.resident = normalizeResidentName(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--resident=')) {
            options.resident = normalizeResidentName(arg.slice('--resident='.length));
        } else if (arg === '--command-peer') {
            options.commandPeer = normalizeResidentName(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--command-peer=')) {
            options.commandPeer = normalizeResidentName(arg.slice('--command-peer='.length));
        } else if (arg === '--prefix') {
            options.commandPrefix = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--prefix=')) {
            options.commandPrefix = arg.slice('--prefix='.length);
        } else if (arg === '--setup-mode') {
            options.setupMode = readSetupMode(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--setup-mode=')) {
            options.setupMode = readSetupMode(arg.slice('--setup-mode='.length));
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
        } else if (arg === '--keep-peer') {
            options.keepPeer = true;
        } else {
            throw new Error(`Unknown named equip soak argument ${arg}`);
        }
    }

    options.resident = normalizeResidentName(options.resident);
    options.commandPeer = normalizeResidentName(options.commandPeer);
    return options;
}

export function verifyNamedEquipSoakEvidence(input: NamedEquipSoakVerificationInput): NamedEquipSoakOutcome {
    const metrics = namedEquipSoakMetrics(input);
    if (input.setupMode === 'unequip' && metrics.setupUnequipActions < 2) {
        return failed('Setup did not produce two ordinary action-log unequip actions', metrics);
    }
    if (metrics.setupCommandSubmitted === 0) {
        return failed('No command-peer combat prompt was submitted', metrics);
    }
    const usefulGearReadyForPrompt =
        input.setupMode === 'preloaded-inventory'
            ? metrics.usefulGearInInventoryAfterSetup + metrics.usefulGearInEquipmentAfter
            : metrics.usefulGearInInventoryAfterSetup;
    const requiredUsefulGearAfterSetup = input.setupMode === 'preloaded-inventory' ? 1 : 2;
    if (usefulGearReadyForPrompt < requiredUsefulGearAfterSetup) {
        return failed('Setup did not move useful gear into inventory before the combat prompt', metrics);
    }
    if (metrics.residentEquipActions === 0) {
        return failed('No ordinary action-log equip action with resident useful-gear cause was observed', metrics);
    }
    if (metrics.usefulGearInEquipmentAfter === 0) {
        return failed('No useful gear remained equipped after the soak sequence', metrics);
    }
    const combatSummary = metrics.postEquipAttacks > 0 ? 'and resumed attack actions.' : 'combat engagement remains CQA5 scope.';
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            input.setupMode === 'preloaded-inventory'
                ? `${input.resident} started with preloaded useful gear and equipped it through ordinary combat routines; ${combatSummary}`
                : `${input.resident} unequipped seeded gear and re-equipped it through ordinary combat routines; ${combatSummary}`,
        ],
    };
}

export function peerSpawnNearPerception(perception: Perception | undefined): { x: number; y: number; level: number } | undefined {
    const resident = isRecord(perception?.resident) ? perception?.resident : undefined;
    const position = isRecord(resident?.position) ? resident.position : undefined;
    if (typeof position?.x !== 'number' || typeof position.y !== 'number' || typeof position.level !== 'number') {
        return undefined;
    }
    return { x: position.x - 1, y: position.y, level: position.level };
}

export function actorRefFromPerception(resident: string, perception: Perception | undefined): NamedEquipSoakActorRef | undefined {
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

export async function runNamedEquipSoakCli(argv: string[], runtime: NamedEquipSoakRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (line => process.stdout.write(line));
    const stderr = runtime.stderr || (line => process.stderr.write(line));
    const options = parseNamedEquipSoakArgs(argv);
    const config = loadControllerConfig(options.configPath);
    const gateway = new GatewayClient({
        url: config.gateway.url,
        authToken: config.gateway.authToken,
        controllerId: `${config.gateway.controllerId}:equip-soak`,
        reconnect: false,
        requestTimeoutMs: 20_000,
    });
    const startedAt = new Date();
    const evidenceStartedAt = new Date(
        startedAt.getTime() - (options.setupMode === 'preloaded-inventory' ? PRELOADED_EQUIP_LOOKBACK_MS : 0),
    );
    const actionLogPath = path.join(config.logging.dir, options.resident, 'actions', `${isoDate(startedAt)}.jsonl`);
    const targetPerceptions: Perception[] = [];
    let createdPeer = false;
    let setupCommandSubmitted = 0;

    gateway.on('perception', (residentId, perception) => {
        if (sameResident(residentId, options.resident)) {
            targetPerceptions.push(perception);
        }
    });
    gateway.on('error', error => {
        stderr(`[controller:equip-soak:gateway] ${error.message}\n`);
    });

    try {
        await gateway.connect();
        await gateway.hello();
        const residents = await gateway.listResidents('all');
        const target = residents.find(resident => sameResident(resident.name, options.resident));
        if (!target?.online) {
            throw new Error(`${options.resident} is not online; start controller before running named equip soak`);
        }
        await gateway.attach({ name: options.resident, observe: true, control: false, onDisconnect: 'idle' });
        await waitFor(() => targetPerceptions.length > 0, options, 'initial target perception');
        const initialPerception = targetPerceptions.at(-1);
        const dynamicSpawn = peerSpawnNearPerception(initialPerception);
        const targetRef = actorRefFromPerception(options.resident, initialPerception);
        if (!targetRef) {
            throw new Error(`Could not derive live actor ref for ${options.resident} from perception`);
        }

        const commandSpawn = dynamicSpawn || options.commandSpawn;
        createdPeer = await recreatePeer(gateway, options.commandPeer, commandSpawn);
        await gateway.connectResident({ name: options.commandPeer, observe: false, control: true, onDisconnect: 'idle' });

        const inventoryBefore = inventoryFromPerception(initialPerception, 'inventory');
        const equipmentBefore = inventoryFromPerception(initialPerception, 'equipment');
        stdout(
            `[equip-soak] ${options.resident} before setup usefulInventory=${usefulItemCount(inventoryBefore)} commandPeer=${options.commandPeer}@${commandSpawn.x},${commandSpawn.y},${commandSpawn.level}\n`,
        );

        if (options.setupMode === 'unequip') {
            await unequipTargetGear(gateway, options.resident);
            await waitFor(
                () => usefulItemCount(inventoryFromPerception(targetPerceptions.at(-1), 'inventory')) >= 2,
                options,
                'unequipped useful gear in inventory',
            );
        } else if (usefulItemCount(inventoryBefore) + usefulItemCount(equipmentBefore) < 1) {
            throw new Error(`${options.resident} needs at least one useful gear item available for preloaded-inventory setup mode`);
        }

        const inventoryAfterSetup = inventoryFromPerception(targetPerceptions.at(-1), 'inventory');
        await gateway.submitAction(options.commandPeer, {
            kind: 'say',
            text: `${options.commandPrefix} train combat`,
            cause: 'named_equip_soak_command',
        });
        setupCommandSubmitted += 1;

        await waitFor(
            () => metricFromLogSinceTime(actionLogPath, evidenceStartedAt, 'equip') >= 1,
            options,
            'resident equip action in soak window',
        );

        await sleep(options.pollMs);
        const entries = readActionLogEntriesSinceTime(actionLogPath, evidenceStartedAt);
        const inventoryAfter = inventoryFromPerception(targetPerceptions.at(-1), 'inventory');
        const equipmentAfter = inventoryFromPerception(targetPerceptions.at(-1), 'equipment');

        const outcome = verifyNamedEquipSoakEvidence({
            resident: options.resident,
            entries,
            inventoryBefore,
            inventoryAfterSetup,
            inventoryAfter,
            equipmentAfter,
            setupMode: options.setupMode,
            setupCommandSubmitted,
        });

        const artifactPath = writeArtifact(options.outputDir, {
            schemaVersion: 1,
            kind: 'named_equip_soak',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            evidenceStartedAt: evidenceStartedAt.toISOString(),
            options: publicOptions(options),
            dynamicSpawn,
            actionLogPath,
            status: outcome.status,
            score: outcome.score,
            metrics: outcome.metrics,
            failureReason: outcome.failureReason,
            summaries: outcome.summaries,
            inventoryBefore,
            inventoryAfterSetup,
            inventoryAfter,
            equipmentAfter,
            entries,
        });

        stdout(`${JSON.stringify({ artifactPath, status: outcome.status, score: outcome.score, metrics: outcome.metrics })}\n`);
        return outcome.status === 'passed' ? 0 : 1;
    } catch (error) {
        stderr(`[controller:equip-soak] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    } finally {
        if (!options.keepPeer) {
            await cleanupPeer(gateway, options.commandPeer, createdPeer);
        }
        gateway.close();
    }
}

async function unequipTargetGear(gateway: GatewayClient, resident: string): Promise<void> {
    const actions: AgentAction[] = [
        { kind: 'unequip', equipmentSlot: 'main_hand' },
        { kind: 'unequip', equipmentSlot: 'off_hand' },
    ];
    for (const action of actions) {
        await gateway.submitAction(resident, action);
    }
}

function namedEquipSoakMetrics(input: NamedEquipSoakVerificationInput): Record<string, number> {
    const equipIndex = input.entries.findIndex(
        entry => entry.action?.kind === 'equip' && /(^|_)equip_useful_gear/.test(String(entry.action.cause || '')),
    );
    const entriesAfterEquip = equipIndex >= 0 ? input.entries.slice(equipIndex + 1) : [];
    return {
        ordinaryActionEntries: input.entries.length,
        setupUnequipActions: countAction(input.entries, 'unequip'),
        residentEquipActions: input.entries.filter(
            entry => entry.action?.kind === 'equip' && /(^|_)equip_useful_gear/.test(String(entry.action.cause || '')),
        ).length,
        postEquipAttacks: entriesAfterEquip.filter(entry => entry.action?.kind === 'attack').length,
        setupCommandSubmitted: input.setupCommandSubmitted,
        usefulGearInInventoryBefore: usefulItemCount(input.inventoryBefore),
        usefulGearInInventoryAfterSetup: usefulItemCount(input.inventoryAfterSetup),
        usefulGearInInventoryAfter: usefulItemCount(input.inventoryAfter),
        usefulGearInEquipmentAfter: usefulItemCount(input.equipmentAfter),
    };
}

function failed(failureReason: string, metrics: Record<string, number>): NamedEquipSoakOutcome {
    return { status: 'failed', score: 0, metrics, failureReason, summaries: [] };
}

function countAction(entries: NamedEquipSoakLogEntry[], kind: string): number {
    return entries.filter(entry => entry.action?.kind === kind).length;
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
        // Deletion can be disabled or unnecessary.
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
        // Best effort.
    }
    try {
        await gateway.deleteResident(name);
    } catch {
        // Best effort.
    }
}

function readActionLogEntriesSinceTime(filePath: string, since: Date): NamedEquipSoakLogEntry[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const sinceMs = since.getTime();
    return fs
        .readFileSync(filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => safeJson(line))
        .filter((entry): entry is NamedEquipSoakLogEntry => {
            if (!entry?.t) {
                return false;
            }
            const timestamp = Date.parse(entry.t);
            return Number.isFinite(timestamp) && timestamp >= sinceMs;
        });
}

function metricFromLogSinceTime(filePath: string, since: Date, actionKind: string): number {
    return countAction(readActionLogEntriesSinceTime(filePath, since), actionKind);
}

function inventoryFromPerception(perception: Perception | undefined, key: 'inventory' | 'equipment'): NamedEquipSoakInventoryItem[] {
    const resident = isRecord(perception?.resident) ? perception?.resident : undefined;
    const items = Array.isArray(resident?.[key]) ? resident[key] : [];
    return items
        .map(item => (isRecord(item) && typeof item.itemId === 'number' ? itemFromRecord(item) : undefined))
        .filter((item): item is NamedEquipSoakInventoryItem => Boolean(item));
}

function itemFromRecord(item: Record<string, unknown>): NamedEquipSoakInventoryItem {
    return {
        itemId: Number(item.itemId),
        amount: typeof item.amount === 'number' ? item.amount : 1,
        key: typeof item.key === 'string' ? item.key : undefined,
    };
}

function usefulItemCount(items: NamedEquipSoakInventoryItem[]): number {
    return items.filter(item => USEFUL_GEAR.has(item.itemId)).reduce((total, item) => total + item.amount, 0);
}

async function waitFor(predicate: () => boolean, options: NamedEquipSoakOptions, label: string): Promise<void> {
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
    const artifactPath = path.join(outputDir, `named_equip_soak_${stamp}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifactPath;
}

function publicOptions(options: NamedEquipSoakOptions): Record<string, unknown> {
    return {
        resident: options.resident,
        commandPeer: options.commandPeer,
        commandPrefix: options.commandPrefix,
        setupMode: options.setupMode,
        configPath: options.configPath,
        durationMs: options.durationMs,
        pollMs: options.pollMs,
        commandSpawn: options.commandSpawn,
    };
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

function readSetupMode(value: string | undefined): NamedEquipSoakOptions['setupMode'] {
    if (!value || value === 'unequip') {
        return 'unequip';
    }
    if (value === 'preloaded-inventory') {
        return 'preloaded-inventory';
    }
    throw new Error(`Unknown named equip soak setup mode ${value}`);
}

function normalizeResidentName(name: string): string {
    const withoutGatewayPrefix = name.startsWith('resident:') ? name.slice('resident:'.length) : name;
    return withoutGatewayPrefix.startsWith('res:') ? withoutGatewayPrefix.toLowerCase() : `res:${withoutGatewayPrefix.toLowerCase()}`;
}

function equipSoakPeerSuffix(now: Date): string {
    return now
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(8, 14);
}

function sameResident(candidate: string, expected: string): boolean {
    return candidate === expected || candidate === `resident:${expected}`;
}

function safeJson(line: string): NamedEquipSoakLogEntry | undefined {
    try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? (parsed as NamedEquipSoakLogEntry) : undefined;
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
    runNamedEquipSoakCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
