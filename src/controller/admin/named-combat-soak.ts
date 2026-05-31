import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import type { AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';
import { GatewayClient } from '../transport/gateway-client';
import { isoDate } from '../util/clock';

export interface NamedCombatSoakLogEntry {
    t?: string;
    source?: string;
    action?: Record<string, unknown>;
    result?: Record<string, unknown>;
}

export interface NamedCombatSoakOptions {
    resident: string;
    commandPeer: string;
    commandPrefix: string;
    targetName: string;
    configPath: string;
    outputDir: string;
    durationMs: number;
    pollMs: number;
    keepPeer: boolean;
    requireLowHealthRecoveryChain: boolean;
    commandSpawn: { x: number; y: number; level: number };
}

export interface NamedCombatSoakVerificationInput {
    resident: string;
    commandPeer: string;
    entries: NamedCombatSoakLogEntry[];
    events: Array<Record<string, unknown>>;
    commandSubmitted: number;
    perceptionCount: number;
    requireLowHealthRecoveryChain?: boolean;
    recoveryTargetName?: string;
}

export interface NamedCombatSoakActorRef {
    id: string;
    kind: 'resident';
    name?: string;
    position: { x: number; y: number; level: number };
}

export interface NamedCombatSoakOutcome {
    status: 'passed' | 'failed';
    score: number;
    metrics: Record<string, number>;
    failureReason?: string;
    summaries: string[];
}

export interface NamedCombatSoakRuntime {
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
}

const DEFAULT_DURATION_MS = 120_000;
const DEFAULT_POLL_MS = 500;
const SAFE_TARGET_PATTERN = /\b(chicken|cow|rat|giant rat|goblin|man|woman)\b/i;
const UNSAFE_TARGET_PATTERN = /\b(player|guard|dragon|demon|wizard|king|black knight|dark wizard)\b/i;

export function parseNamedCombatSoakArgs(argv: string[], now: Date = new Date()): NamedCombatSoakOptions {
    const defaultPeerSuffix = combatSoakPeerSuffix(now);
    const options: NamedCombatSoakOptions = {
        resident: process.env.CONTROLLER_COMBAT_SOAK_RESIDENT || 'res:qa-survivor',
        commandPeer: process.env.CONTROLLER_COMBAT_SOAK_COMMAND_PEER || `res:codex-cqa5-${defaultPeerSuffix}`,
        commandPrefix: process.env.CONTROLLER_COMBAT_SOAK_PREFIX || 'survive',
        targetName: process.env.CONTROLLER_COMBAT_SOAK_TARGET || 'goblin',
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        outputDir: process.env.CONTROLLER_COMBAT_SOAK_OUTPUT_DIR || path.join('data', 'benchmarks', `capability-qa-${isoDate(now)}`),
        durationMs: readPositiveInt(process.env.CONTROLLER_COMBAT_SOAK_DURATION_MS, DEFAULT_DURATION_MS),
        pollMs: readPositiveInt(process.env.CONTROLLER_COMBAT_SOAK_POLL_MS, DEFAULT_POLL_MS),
        keepPeer: process.env.CONTROLLER_COMBAT_SOAK_KEEP_PEER === '1' || process.env.CONTROLLER_COMBAT_SOAK_KEEP_PEER === 'true',
        requireLowHealthRecoveryChain:
            process.env.CONTROLLER_COMBAT_SOAK_REQUIRE_LOW_HEALTH_RECOVERY_CHAIN === '1' ||
            process.env.CONTROLLER_COMBAT_SOAK_REQUIRE_LOW_HEALTH_RECOVERY_CHAIN === 'true',
        commandSpawn: { x: 3253, y: 3230, level: 0 },
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
        } else if (arg === '--target') {
            options.targetName = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--target=')) {
            options.targetName = arg.slice('--target='.length);
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
        } else if (arg === '--require-low-health-recovery-chain') {
            options.requireLowHealthRecoveryChain = true;
        } else {
            throw new Error(`Unknown named combat soak argument ${arg}`);
        }
    }

    options.resident = normalizeResidentName(options.resident);
    options.commandPeer = normalizeResidentName(options.commandPeer);
    options.targetName = options.targetName.trim() || 'goblin';
    return options;
}

export function verifyNamedCombatSoakEvidence(input: NamedCombatSoakVerificationInput): NamedCombatSoakOutcome {
    const metrics = namedCombatSoakMetrics(input);
    if (metrics.commandSubmitted === 0) {
        return failed('No command-peer combat prompt was submitted', metrics);
    }
    if (metrics.perceptionCount === 0) {
        return failed('No live perceptions were observed from the named resident', metrics);
    }
    if (metrics.deathEvents > 0) {
        return failed('The named resident died during the combat soak', metrics);
    }
    if (metrics.unsafeAttackActions > 0) {
        return failed('Unsafe combat target was attacked by the named resident', metrics);
    }
    if (metrics.safeAttackActions === 0) {
        if (metrics.lowHealthRefusals > 0) {
            return failed('Resident refused combat while low on health before a safe attack', metrics);
        }
        return failed('No ordinary safe attack appeared in the named resident action log', metrics);
    }
    if (metrics.combatEvidence === 0) {
        return failed('Safe attack appeared, but no combat event evidence was observed', metrics);
    }
    if (input.requireLowHealthRecoveryChain && metrics.lowHealthRecoveryChain === 0) {
        return failed('No ordered low-health fish/cook/eat/reengage chain appeared in the named resident action log', metrics);
    }

    const prayerSummary =
        metrics.bonesEvidence > 0 && metrics.prayerEvidence > 0
            ? 'and carried the fight through bones/prayer evidence.'
            : 'with no bones/prayer proof in this short soak.';
    const recoverySummary =
        input.requireLowHealthRecoveryChain && metrics.lowHealthRecoveryChain > 0
            ? `${input.resident} fished, cooked, ate, then reengaged a safe target.`
            : `${input.resident} attacked a safe target, survived, and avoided unsafe targets`;
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [`${recoverySummary} ${prayerSummary}`],
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

export function actorRefFromPerception(resident: string, perception: Perception | undefined): NamedCombatSoakActorRef | undefined {
    const residentRecord = isRecord(perception?.resident) ? perception.resident : undefined;
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

export async function runNamedCombatSoakCli(argv: string[], runtime: NamedCombatSoakRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (line => process.stdout.write(line));
    const stderr = runtime.stderr || (line => process.stderr.write(line));
    const options = parseNamedCombatSoakArgs(argv);
    const config = loadControllerConfig(options.configPath);
    const gateway = new GatewayClient({
        url: config.gateway.url,
        authToken: config.gateway.authToken,
        controllerId: `${config.gateway.controllerId}:combat-soak`,
        reconnect: false,
        requestTimeoutMs: 20_000,
    });
    const startedAt = new Date();
    const actionLogPath = path.join(config.logging.dir, options.resident, 'actions', `${isoDate(startedAt)}.jsonl`);
    const baselineSize = fileSize(actionLogPath);
    const targetPerceptions: Perception[] = [];
    const targetEvents: PerceptionEvent[] = [];
    let createdPeer = false;
    let commandSubmitted = 0;

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
        stderr(`[controller:combat-soak:gateway] ${error.message}\n`);
    });

    try {
        await gateway.connect();
        await gateway.hello();
        const residents = await gateway.listResidents('all');
        const target = residents.find(resident => sameResident(resident.name, options.resident));
        if (!target?.online) {
            throw new Error(`${options.resident} is not online; start controller before running named combat soak`);
        }
        await gateway.attach({ name: options.resident, observe: true, control: false, onDisconnect: 'idle' });
        await waitFor(() => targetPerceptions.length > 0, options, 'initial target perception');
        const initialPerception = targetPerceptions.at(-1);
        const commandSpawn = peerSpawnNearPerception(initialPerception) || options.commandSpawn;

        createdPeer = await recreatePeer(gateway, options.commandPeer, commandSpawn);
        await gateway.connectResident({ name: options.commandPeer, observe: false, control: true, onDisconnect: 'idle' });
        stdout(
            `[combat-soak] ${options.resident} commandPeer=${options.commandPeer}@${commandSpawn.x},${commandSpawn.y},${commandSpawn.level} target=${options.targetName}\n`,
        );

        await gateway.submitAction(options.commandPeer, {
            kind: 'say',
            text: `${options.commandPrefix} attack ${options.targetName}`,
            cause: 'named_combat_soak_command',
        });
        commandSubmitted += 1;

        const sawSuccessfulAttack = await waitForResult(() => requiredCombatSoakSatisfied(actionLogPath, baselineSize, options), options);
        if (!sawSuccessfulAttack) {
            const proof = options.requireLowHealthRecoveryChain ? 'low-health recovery chain' : 'successful safe attack';
            stdout(`[combat-soak] no ${proof} before ${options.durationMs}ms; writing diagnostic artifact\n`);
        }
        await sleep(options.pollMs * 2);

        const entries = readActionLogEntriesSince(actionLogPath, baselineSize);
        const outcome = verifyNamedCombatSoakEvidence({
            resident: options.resident,
            commandPeer: options.commandPeer,
            entries,
            events: targetEvents,
            commandSubmitted,
            perceptionCount: targetPerceptions.length,
            requireLowHealthRecoveryChain: options.requireLowHealthRecoveryChain,
            recoveryTargetName: options.targetName,
        });
        const artifactPath = writeArtifact(options.outputDir, {
            schemaVersion: 1,
            kind: 'named_combat_soak',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            options: publicOptions(options),
            commandSpawn,
            actionLogPath,
            status: outcome.status,
            score: outcome.score,
            metrics: outcome.metrics,
            failureReason: outcome.failureReason,
            summaries: outcome.summaries,
            entries,
            events: targetEvents,
        });
        stdout(`${JSON.stringify({ artifactPath, status: outcome.status, score: outcome.score, metrics: outcome.metrics })}\n`);
        return outcome.status === 'passed' ? 0 : 1;
    } catch (error) {
        stderr(`[controller:combat-soak] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    } finally {
        if (!options.keepPeer) {
            await cleanupPeer(gateway, options.commandPeer, createdPeer);
        }
        gateway.close();
    }
}

function namedCombatSoakMetrics(input: NamedCombatSoakVerificationInput): Record<string, number> {
    const attackEntries = input.entries.filter(entry => entry.action?.kind === 'attack');
    const safeAttacks = attackEntries.filter(isSuccessfulSafeAttackEntry);
    const unsafeAttacks = attackEntries.filter(entry => !isSafeAttack(entry.action));
    const events = input.events;
    const recovery = lowHealthRecoveryChainMetrics(input.entries, input.recoveryTargetName);
    return {
        ordinaryActionEntries: input.entries.length,
        commandSubmitted: input.commandSubmitted,
        perceptionCount: input.perceptionCount,
        attackActions: attackEntries.length,
        failedAttackActions: attackEntries.filter(entry => !isSuccessfulActionResult(entry.result)).length,
        safeAttackActions: safeAttacks.length,
        unsafeAttackActions: unsafeAttacks.length,
        lowHealthRefusals: input.entries.filter(isLowHealthRefusal).length,
        combatEvidence: hasCombatEvidence(events) || safeAttacks.length > 1 ? 1 : 0,
        bonesEvidence: events.some(isBonesEvent) || input.entries.some(isBonesAction) ? 1 : 0,
        prayerEvidence: events.some(isPrayerEvent) || input.entries.some(isBuryAction) ? 1 : 0,
        survivalActions: input.entries.filter(entry => entry.action?.kind === 'eat' || isSurvivalCause(entry.action?.cause)).length,
        deathEvents: events.filter(isDeathEvent).length,
        ...recovery,
    };
}

function lowHealthRecoveryChainMetrics(entries: NamedCombatSoakLogEntry[], targetName?: string): Record<string, number> {
    let fishIndex = -1;
    let cookIndex = -1;
    let eatIndex = -1;
    let reengageIndex = -1;

    entries.forEach((entry, index) => {
        if (fishIndex < 0 && isLowHealthFishEntry(entry)) {
            fishIndex = index;
        }
        if (fishIndex >= 0 && cookIndex < 0 && index > fishIndex && isLowHealthCookEntry(entry)) {
            cookIndex = index;
        }
        if (cookIndex >= 0 && eatIndex < 0 && index > cookIndex && isLowHealthRecoveryEatEntry(entry)) {
            eatIndex = index;
        }
        if (eatIndex >= 0 && reengageIndex < 0 && index > eatIndex && isSuccessfulRecoveryAttackEntry(entry, targetName)) {
            reengageIndex = index;
        }
    });

    return {
        lowHealthFishActions: entries.filter(isLowHealthFishEntry).length,
        lowHealthCookActions: entries.filter(isLowHealthCookEntry).length,
        lowHealthEatActions: entries.filter(isLowHealthRecoveryEatEntry).length,
        lowHealthRecoveryReengageAttacks: reengageIndex >= 0 ? 1 : 0,
        lowHealthRecoveryChain: fishIndex >= 0 && cookIndex >= 0 && eatIndex >= 0 && reengageIndex >= 0 ? 1 : 0,
    };
}

function isSuccessfulSafeAttackEntry(entry: NamedCombatSoakLogEntry): boolean {
    return isSafeAttack(entry.action) && isSuccessfulActionResult(entry.result);
}

function isSuccessfulRecoveryAttackEntry(entry: NamedCombatSoakLogEntry, targetName?: string): boolean {
    return isSuccessfulSafeAttackEntry(entry) && (!targetName || attackTargetMatches(entry.action, targetName));
}

function isSuccessfulActionResult(result: Record<string, unknown> | undefined): boolean {
    return result?.ok === true;
}

function isLowHealthRefusal(entry: NamedCombatSoakLogEntry): boolean {
    const action = entry.action;
    return (
        action?.kind === 'say' &&
        /(health is too low|low health|too (?:weak|hurt)|hurt to (?:fight|start combat|continue)|cannot fight while hurt)/i.test(
            String(action.text || action.cause || ''),
        )
    );
}

function isSurvivalCause(cause: unknown): boolean {
    return typeof cause === 'string' && /^(combat_retreat|low_health_)/.test(cause);
}

function isLowHealthFishEntry(entry: NamedCombatSoakLogEntry): boolean {
    const target = isRecord(entry.action?.target) ? entry.action.target : {};
    const targetText = [target.key, target.name, target.id].filter((value): value is string => typeof value === 'string').join(' ');
    return (
        isSuccessfulActionResult(entry.result) &&
        entry.action?.kind === 'interact' &&
        /low_health_fish_food/.test(String(entry.action.cause || '')) &&
        /net/i.test(String(entry.action.option || '')) &&
        /fishing[_\s-]?spot/i.test(targetText)
    );
}

function isLowHealthCookEntry(entry: NamedCombatSoakLogEntry): boolean {
    if (!isSuccessfulActionResult(entry.result)) {
        return false;
    }
    const cause = String(entry.action?.cause || '');
    return entry.action?.kind === 'use_item_on' && /(low_health_cook_food|starter_fishing_cook_catch)/.test(cause);
}

function isLowHealthRecoveryEatEntry(entry: NamedCombatSoakLogEntry): boolean {
    return (
        isSuccessfulActionResult(entry.result) &&
        entry.action?.kind === 'eat' &&
        /(nervous:eat-when-low-health|low_health_eat|starter_fishing_eat_cooked_fish_for_space)/.test(String(entry.action.cause || ''))
    );
}

function isSafeAttack(action: Record<string, unknown> | undefined): boolean {
    const target = isRecord(action?.target) ? action.target : {};
    const name = [target.name, target.key, target.id].filter((value): value is string => typeof value === 'string').join(' ');
    if (!name || UNSAFE_TARGET_PATTERN.test(name)) {
        return false;
    }
    if (typeof target.combatLevel === 'number' && target.combatLevel > 10 && !SAFE_TARGET_PATTERN.test(name)) {
        return false;
    }
    return SAFE_TARGET_PATTERN.test(name);
}

function attackTargetMatches(action: Record<string, unknown> | undefined, targetName: string): boolean {
    const target = isRecord(action?.target) ? action.target : {};
    const normalizedTargetName = targetName.trim().toLowerCase();
    if (!normalizedTargetName) {
        return true;
    }
    return [target.name, target.key, target.id].some(
        value => typeof value === 'string' && value.toLowerCase().includes(normalizedTargetName),
    );
}

function hasCombatEvidence(events: Array<Record<string, unknown>>): boolean {
    return events.some(event => /^(hit|hit_taken|attacked|combat|damage|item_received)$/.test(String(event.kind || '')));
}

function isBonesEvent(event: Record<string, unknown>): boolean {
    return Number(event.itemId) === 526 || /\bbones?\b/i.test(String(event.itemKey || event.itemName || event.text || ''));
}

function isPrayerEvent(event: Record<string, unknown>): boolean {
    return /prayer/i.test(String(event.skill || event.text || ''));
}

function isDeathEvent(event: Record<string, unknown>): boolean {
    return /^(death|died)$/.test(String(event.kind || '')) || /death|died/i.test(String(event.text || ''));
}

function isBonesAction(entry: NamedCombatSoakLogEntry): boolean {
    const action = entry.action;
    return Number(action?.itemId) === 526 || /\bbones?\b/i.test(String(action?.itemKey || action?.itemName || action?.text || ''));
}

function isBuryAction(entry: NamedCombatSoakLogEntry): boolean {
    return entry.action?.kind === 'item_action' && /bury/i.test(String(entry.action.option || entry.action.cause || ''));
}

function failed(failureReason: string, metrics: Record<string, number>): NamedCombatSoakOutcome {
    return { status: 'failed', score: 0, metrics, failureReason, summaries: [] };
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

function readActionLogEntriesSince(filePath: string, baselineSize: number): NamedCombatSoakLogEntry[] {
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
        .filter((entry): entry is NamedCombatSoakLogEntry => Boolean(entry));
}

function successfulSafeAttackCountFromLog(filePath: string, baselineSize: number): number {
    return readActionLogEntriesSince(filePath, baselineSize).filter(isSuccessfulSafeAttackEntry).length;
}

function requiredCombatSoakSatisfied(filePath: string, baselineSize: number, options: NamedCombatSoakOptions): boolean {
    const entries = readActionLogEntriesSince(filePath, baselineSize);
    if (!options.requireLowHealthRecoveryChain) {
        return entries.filter(isSuccessfulSafeAttackEntry).length >= 1;
    }
    return lowHealthRecoveryChainMetrics(entries, options.targetName).lowHealthRecoveryChain === 1;
}

async function waitFor(predicate: () => boolean, options: NamedCombatSoakOptions, label: string): Promise<void> {
    const matched = await waitForResult(predicate, options);
    if (!matched) {
        throw new Error(`Timed out waiting for ${label}`);
    }
}

async function waitForResult(predicate: () => boolean, options: NamedCombatSoakOptions): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < options.durationMs) {
        if (predicate()) {
            return true;
        }
        await sleep(options.pollMs);
    }
    return false;
}

function writeArtifact(outputDir: string, artifact: Record<string, unknown>): string {
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14);
    const artifactPath = path.join(outputDir, `named_combat_soak_${stamp}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifactPath;
}

function publicOptions(options: NamedCombatSoakOptions): Record<string, unknown> {
    return {
        resident: options.resident,
        commandPeer: options.commandPeer,
        commandPrefix: options.commandPrefix,
        targetName: options.targetName,
        configPath: options.configPath,
        durationMs: options.durationMs,
        pollMs: options.pollMs,
        requireLowHealthRecoveryChain: options.requireLowHealthRecoveryChain,
        commandSpawn: options.commandSpawn,
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

function combatSoakPeerSuffix(now: Date): string {
    return now
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(8, 14);
}

function sameResident(candidate: string, expected: string): boolean {
    return candidate === expected || candidate === `resident:${expected}`;
}

function safeJson(line: string): NamedCombatSoakLogEntry | undefined {
    try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? (parsed as NamedCombatSoakLogEntry) : undefined;
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
    runNamedCombatSoakCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
