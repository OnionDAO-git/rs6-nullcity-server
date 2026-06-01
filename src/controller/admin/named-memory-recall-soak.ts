import fs from 'fs';
import path from 'path';
import { loadControllerConfig } from '../config';
import { residentSlug } from '../memory/runtime-state';
import type { AgentAction, Perception, PerceptionEvent } from '../transport/message-codecs';
import { GatewayClient } from '../transport/gateway-client';
import { isoDate } from '../util/clock';

export interface NamedMemoryRecallSoakLogEntry {
    t?: string;
    source?: string;
    action?: Record<string, unknown>;
    result?: Record<string, unknown>;
}

export interface NamedMemoryRecallSoakOptions {
    resident: string;
    commandPeer: string;
    configPath: string;
    outputDir: string;
    durationMs: number;
    delayMs: number;
    pollMs: number;
    actionTimeoutMs: number;
    factTopic: string;
    factText: string;
    keepPeer: boolean;
    commandSpawn: { x: number; y: number; level: number };
}

export interface NamedMemoryRecallSoakVerificationInput {
    resident: string;
    commandPeer: string;
    events: PerceptionEvent[];
    entries: NamedMemoryRecallSoakLogEntry[];
    factTexts: string[];
    socialTexts?: string[];
    factPath?: string;
    expectedFactText?: string;
    teachSubmittedAtMs: number;
    questionSubmittedAtMs: number;
    minDelayMs: number;
}

export interface NamedMemoryRecallSoakOutcome {
    status: 'passed' | 'failed';
    score: number;
    metrics: Record<string, number>;
    failureReason?: string;
    summaries: string[];
}

export interface NamedMemoryRecallSoakRuntime {
    stdout?: (line: string) => void;
    stderr?: (line: string) => void;
}

const DEFAULT_DURATION_MS = 780_000;
const DEFAULT_DELAY_MS = 600_000;
const DEFAULT_POLL_MS = 500;
const DEFAULT_ACTION_TIMEOUT_MS = 120_000;
const DEFAULT_FACT_TOPIC = 'routes';
const DEFAULT_FACT_TEXT = 'west gate passphrase is ember-vellum';
const DEFAULT_RECALL_SUBJECT = 'west gate passphrase';
const FACT_TERM_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'about', 'use', 'topic']);

export function parseNamedMemoryRecallSoakArgs(argv: string[], now: Date = new Date()): NamedMemoryRecallSoakOptions {
    const suffix = memoryRecallPeerSuffix(now);
    const options: NamedMemoryRecallSoakOptions = {
        resident: process.env.CONTROLLER_MEMORY_RECALL_SOAK_RESIDENT || 'res:hans',
        commandPeer: process.env.CONTROLLER_MEMORY_RECALL_SOAK_COMMAND_PEER || `res:codex-smem4-${suffix}`,
        configPath: process.env.CONTROLLER_CONFIG || 'controller.yml',
        outputDir: process.env.CONTROLLER_MEMORY_RECALL_SOAK_OUTPUT_DIR || path.join('data', 'benchmarks', `capability-qa-${isoDate(now)}`),
        durationMs: readPositiveInt(process.env.CONTROLLER_MEMORY_RECALL_SOAK_DURATION_MS, DEFAULT_DURATION_MS),
        delayMs: readPositiveInt(process.env.CONTROLLER_MEMORY_RECALL_SOAK_DELAY_MS, DEFAULT_DELAY_MS),
        pollMs: readPositiveInt(process.env.CONTROLLER_MEMORY_RECALL_SOAK_POLL_MS, DEFAULT_POLL_MS),
        actionTimeoutMs: readPositiveInt(process.env.CONTROLLER_MEMORY_RECALL_SOAK_ACTION_TIMEOUT_MS, DEFAULT_ACTION_TIMEOUT_MS),
        factTopic: process.env.CONTROLLER_MEMORY_RECALL_SOAK_FACT_TOPIC || DEFAULT_FACT_TOPIC,
        factText: process.env.CONTROLLER_MEMORY_RECALL_SOAK_FACT_TEXT || DEFAULT_FACT_TEXT,
        keepPeer:
            process.env.CONTROLLER_MEMORY_RECALL_SOAK_KEEP_PEER === '1' || process.env.CONTROLLER_MEMORY_RECALL_SOAK_KEEP_PEER === 'true',
        commandSpawn: { x: 3222, y: 3218, level: 0 },
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
        } else if (arg === '--delay-ms') {
            options.delayMs = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_DELAY_MS);
        } else if (arg.startsWith('--delay-ms=')) {
            options.delayMs = readPositiveInt(arg.slice('--delay-ms='.length), DEFAULT_DELAY_MS);
        } else if (arg === '--poll-ms') {
            options.pollMs = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_POLL_MS);
        } else if (arg.startsWith('--poll-ms=')) {
            options.pollMs = readPositiveInt(arg.slice('--poll-ms='.length), DEFAULT_POLL_MS);
        } else if (arg === '--action-timeout-ms') {
            options.actionTimeoutMs = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_ACTION_TIMEOUT_MS);
        } else if (arg.startsWith('--action-timeout-ms=')) {
            options.actionTimeoutMs = readPositiveInt(arg.slice('--action-timeout-ms='.length), DEFAULT_ACTION_TIMEOUT_MS);
        } else if (arg === '--fact-topic') {
            options.factTopic = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--fact-topic=')) {
            options.factTopic = arg.slice('--fact-topic='.length);
        } else if (arg === '--fact-text') {
            options.factText = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--fact-text=')) {
            options.factText = arg.slice('--fact-text='.length);
        } else if (arg === '--keep-peer') {
            options.keepPeer = true;
        } else {
            throw new Error(`Unknown named memory recall soak argument ${arg}`);
        }
    }

    options.resident = normalizeResidentName(options.resident);
    options.commandPeer = normalizeResidentName(options.commandPeer);
    options.factTopic = safeTopic(options.factTopic);
    return options;
}

export function verifyNamedMemoryRecallSoakEvidence(input: NamedMemoryRecallSoakVerificationInput): NamedMemoryRecallSoakOutcome {
    const metrics = namedMemoryRecallMetrics(input);
    if (metrics.factPrompts === 0) {
        return failed('No durable fact prompt was observed by the named resident', metrics, 0);
    }
    if (metrics.recallQuestions === 0) {
        return failed('No delayed recall question was observed by the named resident', metrics, 0.2);
    }
    if (metrics.qmdFactWrites === 0) {
        return failed('No qmd durable fact write containing the taught fact was observed', metrics, 0.35);
    }
    if (metrics.delaySatisfied === 0) {
        return failed('The delayed recall question was asked before the requested delay elapsed', metrics, 0.45);
    }
    if (metrics.naturalAnswers === 0) {
        return failed('Resident did not answer naturally after the recall question', metrics, 0.5);
    }
    if (metrics.jsonLikeReplies > 0) {
        return failed('Resident answered with JSON-like prompt echo instead of natural memory recall', metrics, 0.55);
    }
    if (metrics.passphraseMentions === 0 || metrics.westGateMentions === 0) {
        return failed('Resident answered after recall question, but omitted the west gate passphrase fact', metrics, 0.75);
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [`${input.resident} recalled the delayed qmd fact from ${input.factPath || 'facts/routes.md'}.`],
    };
}

export async function runNamedMemoryRecallSoakCli(argv: string[], runtime: NamedMemoryRecallSoakRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (line => process.stdout.write(line));
    const stderr = runtime.stderr || (line => process.stderr.write(line));
    const options = parseNamedMemoryRecallSoakArgs(argv);
    const config = loadControllerConfig(options.configPath);
    const gateway = new GatewayClient({
        url: config.gateway.url,
        authToken: config.gateway.authToken,
        controllerId: `${config.gateway.controllerId}:memory-recall-soak`,
        reconnect: false,
        requestTimeoutMs: options.actionTimeoutMs,
        listResidentsRequestTimeoutMs: options.actionTimeoutMs,
        actionRequestTimeoutMs: options.actionTimeoutMs,
        actionQueueTimeoutMs: options.actionTimeoutMs,
    });
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const actionLogPath = path.join(config.logging.dir, options.resident, 'actions', `${isoDate(startedAt)}.jsonl`);
    const actionLogBaseline = fileSize(actionLogPath);
    const factPath = path.join(config.memory.dir, residentSlug(options.resident), 'facts', `${safeTopic(options.factTopic)}.md`);
    const factBaseline = fileSize(factPath);
    const socialPath = path.join(config.memory.dir, residentSlug(options.resident), 'facts', 'social.md');
    const socialBaseline = fileSize(socialPath);
    const targetPerceptions: Perception[] = [];
    const targetEvents: PerceptionEvent[] = [];
    let createdPeer = false;
    let teachSubmittedAtMs = 0;
    let questionSubmittedAtMs = 0;

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
        stderr(`[controller:memory-recall-soak:gateway] ${error.message}\n`);
    });

    try {
        await gateway.connect();
        await gateway.hello();
        const residents = await gateway.listResidents('all');
        const target = residents.find(resident => sameResident(resident.name, options.resident));
        if (!target?.online) {
            throw new Error(`${options.resident} is not online; start controller before running named memory recall soak`);
        }
        await gateway.attach({ name: options.resident, observe: true, control: false, onDisconnect: 'idle' });
        await waitFor(() => targetPerceptions.length > 0, options, startedAtMs, 'initial target perception');
        const commandSpawn = peerSpawnNearPerception(targetPerceptions.at(-1)) || options.commandSpawn;

        createdPeer = await recreatePeer(gateway, options.commandPeer, commandSpawn);
        await gateway.connectResident({ name: options.commandPeer, observe: false, control: true, onDisconnect: 'idle' });

        const teachPrompt = `${residentAddress(options.resident)}, durable fact: ${options.factText}. Use rememberFact topic ${safeTopic(
            options.factTopic,
        )}.`;
        await gateway.submitAction(options.commandPeer, {
            kind: 'say',
            text: teachPrompt,
            cause: 'named_memory_recall_soak_teach',
        });
        teachSubmittedAtMs = Date.now();
        stdout(`[memory-recall-soak] taught ${options.resident}: ${options.factText}\n`);

        await sleep(options.delayMs);

        const questionPrompt = `${residentAddress(options.resident)}, what do you remember about ${recallSubject(options.factText)}?`;
        await gateway.submitAction(options.commandPeer, {
            kind: 'say',
            text: questionPrompt,
            cause: 'named_memory_recall_soak_question',
        });
        questionSubmittedAtMs = Date.now();
        stdout(`[memory-recall-soak] asked delayed recall after ${questionSubmittedAtMs - teachSubmittedAtMs}ms\n`);

        let outcome = verifyNow(
            options,
            targetEvents,
            actionLogPath,
            actionLogBaseline,
            factPath,
            factBaseline,
            socialPath,
            socialBaseline,
            teachSubmittedAtMs,
            questionSubmittedAtMs,
        );
        while (outcome.status !== 'passed' && Date.now() - startedAtMs < options.durationMs) {
            await sleep(options.pollMs);
            outcome = verifyNow(
                options,
                targetEvents,
                actionLogPath,
                actionLogBaseline,
                factPath,
                factBaseline,
                socialPath,
                socialBaseline,
                teachSubmittedAtMs,
                questionSubmittedAtMs,
            );
        }

        const entries = readActionLogEntriesSince(actionLogPath, actionLogBaseline);
        const factTexts = readTextSince(factPath, factBaseline);
        const socialTexts = readTextSince(socialPath, socialBaseline);
        const artifactPath = writeArtifact(options.outputDir, {
            schemaVersion: 1,
            kind: 'named_memory_recall_soak',
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            options: publicOptions(options),
            dynamicSpawn: commandSpawn,
            actionLogPath,
            factPath,
            factExcerpt: factTexts.join('\n').slice(0, 1200),
            socialPath,
            socialExcerpt: socialTexts.join('\n').slice(0, 1200),
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
        stderr(`[controller:memory-recall-soak] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    } finally {
        if (!options.keepPeer) {
            await cleanupPeer(gateway, options.commandPeer, createdPeer);
        }
        gateway.close();
    }
}

function verifyNow(
    options: NamedMemoryRecallSoakOptions,
    events: PerceptionEvent[],
    actionLogPath: string,
    actionLogBaseline: number,
    factPath: string,
    factBaseline: number,
    socialPath: string,
    socialBaseline: number,
    teachSubmittedAtMs: number,
    questionSubmittedAtMs: number,
): NamedMemoryRecallSoakOutcome {
    return verifyNamedMemoryRecallSoakEvidence({
        resident: options.resident,
        commandPeer: options.commandPeer,
        events: [...events],
        entries: readActionLogEntriesSince(actionLogPath, actionLogBaseline),
        factTexts: readTextSince(factPath, factBaseline),
        socialTexts: readTextSince(socialPath, socialBaseline),
        factPath,
        expectedFactText: options.factText,
        teachSubmittedAtMs,
        questionSubmittedAtMs,
        minDelayMs: options.delayMs,
    });
}

function namedMemoryRecallMetrics(input: NamedMemoryRecallSoakVerificationInput): Record<string, number> {
    const reports = memoryRecallReports(input);
    const expectedFactText = input.expectedFactText || DEFAULT_FACT_TEXT;
    const expectedSubject = recallSubject(expectedFactText);
    return {
        ordinaryActionEntries: input.entries.length,
        factPrompts: factPrompts(input.events, expectedFactText).length,
        recallQuestions: recallQuestions(input.events, input.socialTexts || [], expectedSubject).length,
        qmdFactWrites: input.factTexts.some(text => containsExpectedFact(text, expectedFactText)) ? 1 : 0,
        delaySatisfied: input.questionSubmittedAtMs - input.teachSubmittedAtMs >= input.minDelayMs ? 1 : 0,
        naturalAnswers: reports.length,
        jsonLikeReplies: reports.some(looksLikeStructuredChat) ? 1 : 0,
        passphraseMentions: reports.some(report => containsExpectedAnswer(report, expectedFactText)) ? 1 : 0,
        westGateMentions: reports.some(report => containsExpectedSubject(report, expectedSubject)) ? 1 : 0,
    };
}

function memoryRecallReports(input: NamedMemoryRecallSoakVerificationInput): string[] {
    const eventReports = targetChatReportsAfterRecall(input);
    if (eventReports.length > 0) {
        return eventReports;
    }
    return spokenReports(input.entries, input.resident, input.questionSubmittedAtMs);
}

function targetChatReportsAfterRecall(input: NamedMemoryRecallSoakVerificationInput): string[] {
    const expectedFactText = input.expectedFactText || DEFAULT_FACT_TEXT;
    const expectedSubject = recallSubject(expectedFactText);
    const lastRecallQuestionIndex = latestRecallQuestionIndex(input.events, expectedSubject);
    if (lastRecallQuestionIndex === undefined) {
        return [];
    }
    const prompts = new Set([...factPrompts(input.events, expectedFactText), ...recallQuestions(input.events, [], expectedSubject)]);
    return input.events
        .slice(lastRecallQuestionIndex + 1)
        .filter(event => !prompts.has(event))
        .filter(event => stringField(event, 'kind') === 'chat')
        .filter(event => eventFromMatches(event, input.resident))
        .map(event => stringField(event, 'text'))
        .filter((text): text is string => Boolean(text));
}

function spokenReports(entries: NamedMemoryRecallSoakLogEntry[], resident: string, questionSubmittedAtMs: number): string[] {
    return entries
        .filter(entry => entry.source === undefined || sameResident(entry.source, resident))
        .filter(entry => actionLogEntryAtOrAfter(entry, questionSubmittedAtMs))
        .map(entry => entry.action)
        .filter(isSayAction)
        .map(action => action.text);
}

function latestRecallQuestionIndex(events: PerceptionEvent[], subject: string): number | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        if (isRecallQuestion(events[index], subject)) {
            return index;
        }
    }
    return undefined;
}

function factPrompts(events: PerceptionEvent[], expectedFactText: string): PerceptionEvent[] {
    return events.filter(event => {
        const text = normalizeText(stringField(event, 'text') || '');
        return text.includes('durable fact') && containsExpectedFact(text, expectedFactText);
    });
}

function recallQuestions(
    events: PerceptionEvent[],
    socialTexts: string[] = [],
    subject = DEFAULT_RECALL_SUBJECT,
): Array<PerceptionEvent | string> {
    return [
        ...events.filter(event => isRecallQuestion(event, subject)),
        ...socialTexts.filter(text => isRecallQuestionText(text, subject)),
    ];
}

function isRecallQuestion(event: PerceptionEvent, subject: string): boolean {
    return isRecallQuestionText(stringField(event, 'text') || '', subject);
}

function isRecallQuestionText(value: string, subject: string): boolean {
    const text = normalizeText(value);
    return text.includes('what do you remember') && containsExpectedSubject(text, subject);
}

function containsExpectedFact(text: string, expectedFactText: string): boolean {
    const normalized = normalizeForFactMatch(text);
    return factTerms(expectedFactText).every(term => normalized.includes(term));
}

function containsExpectedAnswer(text: string, expectedFactText: string): boolean {
    return containsExpectedFact(text, expectedFactText);
}

function containsExpectedSubject(text: string, subject: string): boolean {
    const normalized = normalizeForFactMatch(text);
    return factTerms(subject).every(term => normalized.includes(term));
}

function factTerms(text: string): string[] {
    const terms = normalizeForFactMatch(text)
        .split(' ')
        .filter(term => term.length >= 3 && !FACT_TERM_STOP_WORDS.has(term));
    return terms.length > 0 ? terms : [normalizeForFactMatch(DEFAULT_FACT_TEXT)];
}

function recallSubject(factText: string): string {
    const normalized = factText.trim();
    const [subject] = normalized.split(/\s+\bis\b\s+|:\s+/i);
    return subject?.trim() || DEFAULT_RECALL_SUBJECT;
}

function normalizeForFactMatch(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function actionLogEntryAtOrAfter(entry: NamedMemoryRecallSoakLogEntry, timestampMs: number): boolean {
    if (timestampMs <= 0) {
        return true;
    }
    if (typeof entry.t !== 'string') {
        return false;
    }
    const parsed = Date.parse(entry.t);
    return Number.isFinite(parsed) && parsed >= timestampMs;
}

function eventFromMatches(event: PerceptionEvent, resident: string): boolean {
    const from = isRecord(event.from) ? event.from : {};
    return [from.id, from.name].filter((value): value is string => typeof value === 'string').some(value => sameResident(value, resident));
}

function isSayAction(action: Record<string, unknown> | undefined): action is AgentAction & { kind: 'say'; text: string } {
    return action?.kind === 'say' && typeof action.text === 'string';
}

function failed(failureReason: string, metrics: Record<string, number>, score: number): NamedMemoryRecallSoakOutcome {
    return { status: 'failed', score, metrics, failureReason, summaries: [] };
}

function peerSpawnNearPerception(perception: Perception | undefined): { x: number; y: number; level: number } | undefined {
    const resident = isRecord(perception?.resident) ? perception.resident : undefined;
    const position = isRecord(resident?.position) ? resident.position : undefined;
    if (typeof position?.x !== 'number' || typeof position.y !== 'number' || typeof position.level !== 'number') {
        return undefined;
    }
    return { x: position.x, y: position.y, level: position.level };
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
        // Best-effort cleanup.
    }
    try {
        await gateway.deleteResident(name);
    } catch {
        // Best-effort cleanup.
    }
}

function readActionLogEntriesSince(filePath: string, baselineSize: number): NamedMemoryRecallSoakLogEntry[] {
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
        .filter((entry): entry is NamedMemoryRecallSoakLogEntry => Boolean(entry));
}

function readTextSince(filePath: string, baselineSize: number): string[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const buffer = fs.readFileSync(filePath);
    const slice = buffer.subarray(Math.min(baselineSize, buffer.length)).toString('utf8').trim();
    return slice ? [slice] : [];
}

async function waitFor(predicate: () => boolean, options: NamedMemoryRecallSoakOptions, startedAtMs: number, label: string): Promise<void> {
    while (Date.now() - startedAtMs < options.durationMs) {
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
    const artifactPath = path.join(outputDir, `named_memory_recall_soak_${stamp}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifactPath;
}

function publicOptions(options: NamedMemoryRecallSoakOptions): Record<string, unknown> {
    return {
        resident: options.resident,
        commandPeer: options.commandPeer,
        configPath: options.configPath,
        durationMs: options.durationMs,
        delayMs: options.delayMs,
        pollMs: options.pollMs,
        actionTimeoutMs: options.actionTimeoutMs,
        factTopic: options.factTopic,
        factText: options.factText,
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

function residentAddress(resident: string): string {
    return normalizeResidentName(resident).slice('res:'.length);
}

function memoryRecallPeerSuffix(now: Date): string {
    return now
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(8, 14);
}

function sameResident(candidate: string, expected: string): boolean {
    return normalizeResidentName(candidate) === normalizeResidentName(expected);
}

function safeTopic(topic: string): string {
    const normalized = topic
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || DEFAULT_FACT_TOPIC;
}

function safeJson(line: string): NamedMemoryRecallSoakLogEntry | undefined {
    try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? (parsed as NamedMemoryRecallSoakLogEntry) : undefined;
    } catch {
        return undefined;
    }
}

function stringField(value: unknown, key: string): string | undefined {
    return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function looksLikeStructuredChat(text: string): boolean {
    const sample = text.trim().slice(0, 180);
    return sample.startsWith('{') || sample.startsWith('[') || /"rememberFact"\s*:/.test(sample) || /"memories"\s*:/.test(sample);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
    runNamedMemoryRecallSoakCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
