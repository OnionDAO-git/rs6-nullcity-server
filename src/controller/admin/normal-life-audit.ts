import fs from 'fs';
import path from 'path';
import { SELF_INITIATED_EXCHANGE_MIN_GP, SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD } from '../spark/self-initiated-ap-gp-exchange';
import { isoDate } from '../util/clock';

export interface NormalLifeAuditOptions {
    logsRoot: string;
    libraryRoot: string;
    economyEventsPath: string;
    outputDir: string;
    windowStart: Date;
    windowEnd: Date;
    durationMs: number;
    maxTopRows: number;
    excludeResidentPrefixes: string[];
}

export interface ResidentApDrop {
    resident: string;
    first: number;
    last: number;
    drop: number;
}

export type NormalLifeTrackedCounts = Record<string, number>;

export interface NormalLifeAuditResidentSlice {
    resident: string;
    actionAttempts: number;
    successfulActionSubmissions: number;
    failedActionSubmissions: number;
    apFirst?: number;
    apLast?: number;
    apDrop: number;
    trackedActionCounts: NormalLifeTrackedCounts;
    trackedCauseCounts: NormalLifeTrackedCounts;
    trackedTimelineCounts: NormalLifeTrackedCounts;
}

export interface NormalLifeAuditRecurrenceSummary {
    apGpExchangeActions: number;
    apGpExchangeEvents: number;
    tradeRequests: number;
    tradeCompleted: number;
    tradeCancelled: number;
    combatActions: number;
    eatingActions: number;
    cookingActions: number;
    lowHealthWaits: number;
    combatResupplyActions: number;
    xpEvents: number;
    levelUps: number;
    deaths: number;
    logouts: number;
    stuckDetected: number;
    stuckRecovered: number;
}

export interface NormalLifeAuditStuckResident {
    resident: string;
    stuckDetected: number;
    stuckRecovered: number;
    unresolved: number;
    churn: number;
}

export interface NormalLifeAuditStuckSummary {
    stuckDetected: number;
    stuckRecovered: number;
    unresolved: number;
    topResidents: NormalLifeAuditStuckResident[];
}

export interface NormalLifeAuditGpObservation {
    resident: string;
    gp: number;
    observedAt: string;
}

export interface NormalLifeAuditGpRunwayResident {
    resident: string;
    apLast: number;
    gp: number;
    requestAttentionActions: number;
    lastGpObservedAt: string;
}

export interface NormalLifeAuditEconomySummary {
    economyEventsPath: string;
    economyEventsInWindow: number;
    apGpExchangeEvents: number;
    selfInitiatedApGpExchangeEvents: number;
    controlledApGpExchangeEvents: number;
    organicSelfInitiatedApGpExchangeEvents: number;
    adminDrainEvents: number;
    attentionRunwayThresholdAp: number;
    minimumExchangeGp: number;
    latestGpByResident: NormalLifeAuditGpObservation[];
    lowApWithGpResidents: NormalLifeAuditGpRunwayResident[];
    requestAttentionWithGpResidents: NormalLifeAuditGpRunwayResident[];
}

export interface NormalLifeAuditReport {
    runId: string;
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    activeResidents: number;
    totalActionAttempts: number;
    successfulActionSubmissions: number;
    failedActionSubmissions: number;
    actionSuccessRate: number;
    actionKindCounts: Array<[string, number]>;
    causeCounts: Array<[string, number]>;
    timelineKindCounts: Array<[string, number]>;
    trackedActionCounts: NormalLifeTrackedCounts;
    trackedCauseCounts: NormalLifeTrackedCounts;
    trackedTimelineCounts: NormalLifeTrackedCounts;
    recurrenceSummary: NormalLifeAuditRecurrenceSummary;
    stuckSummary: NormalLifeAuditStuckSummary;
    economySummary: NormalLifeAuditEconomySummary;
    residentSlices: NormalLifeAuditResidentSlice[];
    residentSignalSummary: NormalLifeAuditResidentSlice[];
    notObservedTimelineKinds: string[];
    apSummary: {
        residentsWithAttention: number;
        residentsWithDrop: number;
        aggregateDrop: number;
        topDrops: ResidentApDrop[];
    };
}

export interface NormalLifeAuditCliRuntime {
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
    now?: Date;
}

interface ResidentAttentionSpan {
    firstAt: number;
    first: number;
    lastAt: number;
    last: number;
}

interface ResidentSliceAccumulator {
    resident: string;
    actionAttempts: number;
    successfulActionSubmissions: number;
    failedActionSubmissions: number;
    attention?: ResidentAttentionSpan;
    actionKindCounts: Map<string, number>;
    causeCounts: Map<string, number>;
    timelineKindCounts: Map<string, number>;
}

const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const DEFAULT_MAX_TOP_ROWS = 12;
const DEFAULT_EXCLUDE_PREFIXES = ['res:bmk_'];
const TRACKED_ACTION_KINDS = [
    'city_exchange_ap_gp',
    'trade_request',
    'trade_offer_item',
    'trade_accept_stage_1',
    'trade_accept_stage_2',
    'trade_decline',
    'trade_completed',
    'trade_cancelled',
    'attack',
    'eat',
    'interact',
    'use_item_on',
    'use_item_on_item',
    'item_action',
    'equip',
];
const TRACKED_CAUSES = [
    'nervous:self-initiated-ap-gp-exchange',
    'nervous:starter-gp-harvest',
    'nervous:request-attention',
    'low_health_heal_wait',
    'low_health_fish_food',
    'low_health_cook_food',
    'low_health_eat',
    'combat_attack_safe_target',
    'combat_seek_safe_target',
    'combat_resupply_food',
    'combat_eat_before_training',
    'combat_loot_pickup',
    'combat_bury_looted_bones',
    'combat_loot_or_prayer',
    'starter_fishing_net',
    'starter_fishing_cook_catch',
    'starter_fishing_eat_cooked_fish_for_space',
    'direct_chat_trade',
    'agent_keepalive',
    'hero_keepalive',
    'faction_landmark_recovery',
];
const TRACKED_TIMELINE_KINDS = [
    'logout',
    'death',
    'city_attention_credit',
    'city_gold_observed',
    'city_gold_burn',
    'city_ap_gp_exchange',
    'trade_completed',
    'trade_cancelled',
    'level_up',
    'quest_complete',
    'stuck_detected',
    'stuck_recovered',
    'first_xp',
    'say',
];
const CONTROLLED_EXCHANGE_AFTER_ADMIN_DRAIN_MS = 10 * 60 * 1000;

export function parseNormalLifeAuditArgs(argv: string[], now: Date = new Date()): NormalLifeAuditOptions {
    const options: NormalLifeAuditOptions = {
        logsRoot: process.env.CONTROLLER_LOGS_ROOT || path.join('data', 'controller', 'logs'),
        libraryRoot: process.env.CONTROLLER_LIBRARY_ROOT || path.join('data', 'controller', 'memory', 'library'),
        economyEventsPath: process.env.CONTROLLER_ECONOMY_EVENTS_PATH || '',
        outputDir: process.env.CONTROLLER_NORMAL_LIFE_AUDIT_OUTPUT_DIR || path.join('data', 'benchmarks', `capability-qa-${isoDate(now)}`),
        windowEnd: now,
        windowStart: new Date(now.getTime() - DEFAULT_DURATION_MS),
        durationMs: readPositiveInt(process.env.CONTROLLER_NORMAL_LIFE_AUDIT_DURATION_MS, DEFAULT_DURATION_MS),
        maxTopRows: readPositiveInt(process.env.CONTROLLER_NORMAL_LIFE_AUDIT_TOP_ROWS, DEFAULT_MAX_TOP_ROWS),
        excludeResidentPrefixes: [...DEFAULT_EXCLUDE_PREFIXES],
    };

    let startOverride: Date | undefined;
    let endOverride: Date | undefined;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--logs-root') {
            options.logsRoot = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--logs-root=')) {
            options.logsRoot = arg.slice('--logs-root='.length);
        } else if (arg === '--library-root') {
            options.libraryRoot = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--library-root=')) {
            options.libraryRoot = arg.slice('--library-root='.length);
        } else if (arg === '--economy-events-path') {
            options.economyEventsPath = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--economy-events-path=')) {
            options.economyEventsPath = arg.slice('--economy-events-path='.length);
        } else if (arg === '--output-dir' || arg === '--output') {
            options.outputDir = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--output-dir=')) {
            options.outputDir = arg.slice('--output-dir='.length);
        } else if (arg.startsWith('--output=')) {
            options.outputDir = arg.slice('--output='.length);
        } else if (arg === '--duration-ms') {
            options.durationMs = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_DURATION_MS);
        } else if (arg.startsWith('--duration-ms=')) {
            options.durationMs = readPositiveInt(arg.slice('--duration-ms='.length), DEFAULT_DURATION_MS);
        } else if (arg === '--start') {
            startOverride = parseIso(readRequiredValue(argv, ++i, arg), '--start');
        } else if (arg.startsWith('--start=')) {
            startOverride = parseIso(arg.slice('--start='.length), '--start');
        } else if (arg === '--end') {
            endOverride = parseIso(readRequiredValue(argv, ++i, arg), '--end');
        } else if (arg.startsWith('--end=')) {
            endOverride = parseIso(arg.slice('--end='.length), '--end');
        } else if (arg === '--top') {
            options.maxTopRows = readPositiveInt(readRequiredValue(argv, ++i, arg), DEFAULT_MAX_TOP_ROWS);
        } else if (arg.startsWith('--top=')) {
            options.maxTopRows = readPositiveInt(arg.slice('--top='.length), DEFAULT_MAX_TOP_ROWS);
        } else if (arg === '--exclude-prefix') {
            options.excludeResidentPrefixes.push(readRequiredValue(argv, ++i, arg));
        } else if (arg.startsWith('--exclude-prefix=')) {
            options.excludeResidentPrefixes.push(arg.slice('--exclude-prefix='.length));
        } else {
            throw new Error(`Unknown normal-life-audit argument ${arg}`);
        }
    }

    if (!options.economyEventsPath) {
        options.economyEventsPath = defaultEconomyEventsPath(options.libraryRoot);
    }

    if (startOverride && endOverride && startOverride.getTime() > endOverride.getTime()) {
        throw new Error('window start must be <= window end');
    }

    if (startOverride && endOverride) {
        options.windowStart = startOverride;
        options.windowEnd = endOverride;
        options.durationMs = Math.max(1, endOverride.getTime() - startOverride.getTime());
    } else if (startOverride) {
        options.windowStart = startOverride;
        options.windowEnd = new Date(startOverride.getTime() + options.durationMs);
    } else if (endOverride) {
        options.windowEnd = endOverride;
        options.windowStart = new Date(endOverride.getTime() - options.durationMs);
    } else {
        options.windowEnd = now;
        options.windowStart = new Date(now.getTime() - options.durationMs);
    }

    return options;
}

export function collectNormalLifeAudit(options: {
    logsRoot: string;
    libraryRoot: string;
    economyEventsPath?: string;
    windowStart: Date;
    windowEnd: Date;
    maxTopRows?: number;
    excludeResidentPrefixes?: string[];
    runId?: string;
    generatedAt?: Date;
}): NormalLifeAuditReport {
    const maxTopRows = options.maxTopRows ?? DEFAULT_MAX_TOP_ROWS;
    const excludePrefixes = options.excludeResidentPrefixes ?? DEFAULT_EXCLUDE_PREFIXES;
    const runId = options.runId ?? `normal_life_audit_${timestampCompact(options.generatedAt ?? options.windowEnd)}`;
    const generatedAt = options.generatedAt ?? options.windowEnd;
    const economyEventsPath = options.economyEventsPath ?? defaultEconomyEventsPath(options.libraryRoot);

    const actionKindCounts = new Map<string, number>();
    const causeCounts = new Map<string, number>();
    const timelineKindCounts = new Map<string, number>();
    const residentAttention = new Map<string, ResidentAttentionSpan>();
    const residentSlices = new Map<string, ResidentSliceAccumulator>();
    const activeResidents = new Set<string>();

    let totalActionAttempts = 0;
    let successfulActionSubmissions = 0;
    let failedActionSubmissions = 0;

    const residentDirs = safeReadDirs(options.logsRoot).filter(name => name.startsWith('res:'));
    for (const resident of residentDirs) {
        if (excludePrefixes.some(prefix => resident.startsWith(prefix))) continue;
        const actionDir = path.join(options.logsRoot, resident, 'actions');
        for (const fileName of safeReadFiles(actionDir)) {
            if (!fileName.endsWith('.jsonl')) continue;
            const rows = readJsonl(path.join(actionDir, fileName));
            for (const row of rows) {
                const ts = parseIsoMillis(stringField(row, 't'));
                if (ts === undefined || !inWindow(ts, options.windowStart, options.windowEnd)) continue;
                totalActionAttempts += 1;
                activeResidents.add(resident);
                const slice = ensureResidentSlice(residentSlices, resident);
                slice.actionAttempts += 1;

                const action = recordField(row, 'action');
                const kind = stringField(action, 'kind') || 'unknown';
                const cause = stringField(action, 'cause') || 'none';
                bump(actionKindCounts, kind);
                bump(causeCounts, cause);
                bump(slice.actionKindCounts, kind);
                bump(slice.causeCounts, cause);

                const result = recordField(row, 'result');
                if (boolField(result, 'ok') === true) {
                    successfulActionSubmissions += 1;
                    slice.successfulActionSubmissions += 1;
                } else {
                    failedActionSubmissions += 1;
                    slice.failedActionSubmissions += 1;
                }

                const attentionAfter = numberField(row, 'attention_after');
                if (attentionAfter !== undefined) {
                    updateAttentionSpan(residentAttention, resident, ts, attentionAfter);
                    slice.attention = updateAttentionSpanForValue(slice.attention, ts, attentionAfter);
                }
            }
        }

        const timelinePath = path.join(options.libraryRoot, residentToLibraryDir(resident), 'timeline.jsonl');
        for (const row of readJsonl(timelinePath)) {
            const ts = parseIsoMillis(stringField(row, 'ts'));
            if (ts === undefined || !inWindow(ts, options.windowStart, options.windowEnd)) continue;
            const kind = stringField(row, 'kind') || 'unknown';
            bump(timelineKindCounts, kind);
            bump(ensureResidentSlice(residentSlices, resident).timelineKindCounts, kind);
        }
    }

    const drops: ResidentApDrop[] = [];
    for (const [resident, span] of residentAttention.entries()) {
        const drop = round3(span.first - span.last);
        if (drop > 0) {
            drops.push({ resident, first: span.first, last: span.last, drop });
        }
    }

    drops.sort((a, b) => (b.drop === a.drop ? a.resident.localeCompare(b.resident) : b.drop - a.drop));

    const aggregateDrop = round3(drops.reduce((sum, entry) => sum + entry.drop, 0));
    const actionSuccessRate = totalActionAttempts === 0 ? 0 : round3((successfulActionSubmissions / totalActionAttempts) * 100);

    const residentSliceReports = sortedResidentSlices(residentSlices);
    const stuckSummary = buildStuckSummary(residentSliceReports, maxTopRows);
    const economySummary = buildEconomySummary({
        economyEventsPath,
        residentSlices: residentSliceReports,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
    });

    return {
        runId,
        generatedAt: generatedAt.toISOString(),
        windowStart: options.windowStart.toISOString(),
        windowEnd: options.windowEnd.toISOString(),
        activeResidents: activeResidents.size,
        totalActionAttempts,
        successfulActionSubmissions,
        failedActionSubmissions,
        actionSuccessRate,
        actionKindCounts: sortedCounts(actionKindCounts, maxTopRows),
        causeCounts: sortedCounts(causeCounts, maxTopRows),
        timelineKindCounts: sortedCounts(timelineKindCounts, maxTopRows),
        trackedActionCounts: trackedCounts(actionKindCounts, TRACKED_ACTION_KINDS),
        trackedCauseCounts: trackedCounts(causeCounts, TRACKED_CAUSES),
        trackedTimelineCounts: trackedCounts(timelineKindCounts, TRACKED_TIMELINE_KINDS),
        recurrenceSummary: buildRecurrenceSummary(actionKindCounts, causeCounts, timelineKindCounts),
        stuckSummary,
        economySummary,
        residentSlices: residentSliceReports,
        residentSignalSummary: residentSliceReports,
        notObservedTimelineKinds: TRACKED_TIMELINE_KINDS.filter(kind => !timelineKindCounts.has(kind)),
        apSummary: {
            residentsWithAttention: residentAttention.size,
            residentsWithDrop: drops.length,
            aggregateDrop,
            topDrops: drops.slice(0, maxTopRows),
        },
    };
}

export async function runNormalLifeAuditCli(argv: string[], runtime: NormalLifeAuditCliRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (chunk => process.stdout.write(chunk));
    const stderr = runtime.stderr || (chunk => process.stderr.write(chunk));
    const now = runtime.now || new Date();

    try {
        const options = parseNormalLifeAuditArgs(argv, now);
        const report = collectNormalLifeAudit({
            logsRoot: options.logsRoot,
            libraryRoot: options.libraryRoot,
            economyEventsPath: options.economyEventsPath,
            windowStart: options.windowStart,
            windowEnd: options.windowEnd,
            maxTopRows: options.maxTopRows,
            excludeResidentPrefixes: options.excludeResidentPrefixes,
            generatedAt: now,
        });

        fs.mkdirSync(options.outputDir, { recursive: true });
        const artifactPath = path.join(options.outputDir, `${report.runId}.json`);
        fs.writeFileSync(artifactPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

        stdout(
            `[normal-life-audit] window=${report.windowStart}..${report.windowEnd} residents=${report.activeResidents} actions=${report.totalActionAttempts} success=${report.actionSuccessRate}%\n`,
        );
        stdout(`[normal-life-audit] artifact=${artifactPath}\n`);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(`[normal-life-audit] ${message}\n`);
        return 1;
    }
}

if (require.main === module) {
    runNormalLifeAuditCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}

function readRequiredValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (!value || value.startsWith('-')) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function parseIso(value: string, flag: string): Date {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
        throw new Error(`${flag} must be an ISO timestamp`);
    }
    return parsed;
}

function parseIsoMillis(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return undefined;
    return ts;
}

function defaultEconomyEventsPath(libraryRoot: string): string {
    return path.join(path.dirname(libraryRoot), 'city-integration', 'economy-events.jsonl');
}

function safeReadDirs(root: string): string[] {
    try {
        return fs
            .readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

function safeReadFiles(root: string): string[] {
    try {
        return fs
            .readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => entry.name);
    } catch {
        return [];
    }
}

function readJsonl(filePath: string): Record<string, unknown>[] {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                try {
                    const parsed = JSON.parse(line);
                    return isRecord(parsed) ? parsed : {};
                } catch {
                    return {};
                }
            });
    } catch {
        return [];
    }
}

function residentToLibraryDir(resident: string): string {
    return resident.replace(':', '-');
}

function inWindow(ts: number, start: Date, end: Date): boolean {
    return ts >= start.getTime() && ts <= end.getTime();
}

function bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) || 0) + 1);
}

function ensureResidentSlice(slices: Map<string, ResidentSliceAccumulator>, resident: string): ResidentSliceAccumulator {
    const current = slices.get(resident);
    if (current) return current;
    const created: ResidentSliceAccumulator = {
        resident,
        actionAttempts: 0,
        successfulActionSubmissions: 0,
        failedActionSubmissions: 0,
        actionKindCounts: new Map(),
        causeCounts: new Map(),
        timelineKindCounts: new Map(),
    };
    slices.set(resident, created);
    return created;
}

function updateAttentionSpan(spans: Map<string, ResidentAttentionSpan>, resident: string, ts: number, attentionAfter: number): void {
    spans.set(resident, updateAttentionSpanForValue(spans.get(resident), ts, attentionAfter));
}

function updateAttentionSpanForValue(
    current: ResidentAttentionSpan | undefined,
    ts: number,
    attentionAfter: number,
): ResidentAttentionSpan {
    if (!current) {
        return {
            firstAt: ts,
            first: attentionAfter,
            lastAt: ts,
            last: attentionAfter,
        };
    }
    const next = { ...current };
    if (ts < next.firstAt) {
        next.firstAt = ts;
        next.first = attentionAfter;
    }
    if (ts >= next.lastAt) {
        next.lastAt = ts;
        next.last = attentionAfter;
    }
    return next;
}

function sortedCounts(map: Map<string, number>, limit: number): Array<[string, number]> {
    return [...map.entries()]
        .sort((a, b) => {
            if (b[1] === a[1]) return a[0].localeCompare(b[0]);
            return b[1] - a[1];
        })
        .slice(0, limit);
}

function trackedCounts(map: Map<string, number>, trackedKeys: string[]): NormalLifeTrackedCounts {
    const counts: NormalLifeTrackedCounts = {};
    for (const key of trackedKeys) {
        counts[key] = map.get(key) || 0;
    }
    return counts;
}

function buildRecurrenceSummary(
    actionKindCounts: Map<string, number>,
    causeCounts: Map<string, number>,
    timelineKindCounts: Map<string, number>,
): NormalLifeAuditRecurrenceSummary {
    return {
        apGpExchangeActions: actionKindCounts.get('city_exchange_ap_gp') || 0,
        apGpExchangeEvents: timelineKindCounts.get('city_ap_gp_exchange') || 0,
        tradeRequests: actionKindCounts.get('trade_request') || 0,
        tradeCompleted: timelineKindCounts.get('trade_completed') || 0,
        tradeCancelled: timelineKindCounts.get('trade_cancelled') || 0,
        combatActions: actionKindCounts.get('attack') || 0,
        eatingActions: actionKindCounts.get('eat') || 0,
        cookingActions: (actionKindCounts.get('use_item_on') || 0) + (actionKindCounts.get('use_item_on_item') || 0),
        lowHealthWaits: causeCounts.get('low_health_heal_wait') || 0,
        combatResupplyActions: causeCounts.get('combat_resupply_food') || 0,
        xpEvents: timelineKindCounts.get('first_xp') || 0,
        levelUps: timelineKindCounts.get('level_up') || 0,
        deaths: timelineKindCounts.get('death') || 0,
        logouts: timelineKindCounts.get('logout') || 0,
        stuckDetected: timelineKindCounts.get('stuck_detected') || 0,
        stuckRecovered: timelineKindCounts.get('stuck_recovered') || 0,
    };
}

function buildStuckSummary(residentSlices: NormalLifeAuditResidentSlice[], maxTopRows: number): NormalLifeAuditStuckSummary {
    let stuckDetected = 0;
    let stuckRecovered = 0;
    const topResidents = residentSlices
        .map(slice => {
            const residentDetected = slice.trackedTimelineCounts.stuck_detected || 0;
            const residentRecovered = slice.trackedTimelineCounts.stuck_recovered || 0;
            stuckDetected += residentDetected;
            stuckRecovered += residentRecovered;
            return {
                resident: slice.resident,
                stuckDetected: residentDetected,
                stuckRecovered: residentRecovered,
                unresolved: Math.max(0, residentDetected - residentRecovered),
                churn: residentDetected + residentRecovered,
            };
        })
        .filter(entry => entry.churn > 0)
        .sort((a, b) => {
            if (b.churn === a.churn) {
                if (b.unresolved === a.unresolved) return a.resident.localeCompare(b.resident);
                return b.unresolved - a.unresolved;
            }
            return b.churn - a.churn;
        })
        .slice(0, maxTopRows);

    return {
        stuckDetected,
        stuckRecovered,
        unresolved: Math.max(0, stuckDetected - stuckRecovered),
        topResidents,
    };
}

function buildEconomySummary(options: {
    economyEventsPath: string;
    residentSlices: NormalLifeAuditResidentSlice[];
    windowStart: Date;
    windowEnd: Date;
}): NormalLifeAuditEconomySummary {
    const allRows = readJsonl(options.economyEventsPath);
    const rows = allRows.filter(row => {
        const ts = parseIsoMillis(stringField(row, 'ts'));
        return ts !== undefined && inWindow(ts, options.windowStart, options.windowEnd);
    });
    const adminDrainTimes = new Map<string, number[]>();
    const latestGp = new Map<string, NormalLifeAuditGpObservation>();

    let apGpExchangeEvents = 0;
    let selfInitiatedApGpExchangeEvents = 0;
    let controlledApGpExchangeEvents = 0;
    let organicSelfInitiatedApGpExchangeEvents = 0;
    let adminDrainEvents = 0;
    for (const row of allRows) {
        const resident = stringField(row, 'residentName');
        const tsString = stringField(row, 'ts');
        const ts = parseIsoMillis(tsString);
        const kind = stringField(row, 'kind');
        if (!resident || !tsString || ts === undefined || !kind) continue;

        if (
            kind === 'ap_decay' &&
            (stringField(row, 'refId') || '').startsWith(`admin_drain:${resident}:`) &&
            ts >= options.windowStart.getTime() - CONTROLLED_EXCHANGE_AFTER_ADMIN_DRAIN_MS &&
            ts <= options.windowEnd.getTime()
        ) {
            adminDrainEvents += 1;
            const times = adminDrainTimes.get(resident) || [];
            times.push(ts);
            adminDrainTimes.set(resident, times);
        }
    }

    for (const row of allRows) {
        const resident = stringField(row, 'residentName');
        const tsString = stringField(row, 'ts');
        const ts = parseIsoMillis(tsString);
        const kind = stringField(row, 'kind');
        if (!resident || !tsString || ts === undefined || kind !== 'gp_observed' || ts > options.windowEnd.getTime()) continue;
        const gp = gpObservedFromEvent(row);
        if (gp !== undefined) {
            const current = latestGp.get(resident);
            const currentTs = current ? parseIsoMillis(current.observedAt) : undefined;
            if (!current || currentTs === undefined || ts >= currentTs) {
                latestGp.set(resident, { resident, gp, observedAt: tsString });
            }
        }
    }

    for (const row of rows) {
        const resident = stringField(row, 'residentName');
        const ts = parseIsoMillis(stringField(row, 'ts'));
        const kind = stringField(row, 'kind');
        if (!resident || ts === undefined || kind !== 'ap_gp_exchange') continue;

        apGpExchangeEvents += 1;
        const isSelfInitiated =
            stringField(row, 'cityUserId') === 'resident:self' && (stringField(row, 'refId') || '').includes('self-ap-gp:');
        if (isSelfInitiated) {
            selfInitiatedApGpExchangeEvents += 1;
        }
        const isControlled = Boolean(
            (adminDrainTimes.get(resident) || []).some(
                drainTs => drainTs <= ts && ts - drainTs <= CONTROLLED_EXCHANGE_AFTER_ADMIN_DRAIN_MS,
            ),
        );
        if (isControlled) {
            controlledApGpExchangeEvents += 1;
        }
        if (isSelfInitiated && !isControlled) {
            organicSelfInitiatedApGpExchangeEvents += 1;
        }
    }

    const latestGpByResident = [...latestGp.values()].sort((a, b) => {
        if (b.gp === a.gp) return a.resident.localeCompare(b.resident);
        return b.gp - a.gp;
    });

    const lowApWithGpResidents = buildRunwayResidents(latestGp, options.residentSlices, slice => {
        return slice.apLast !== undefined && slice.apLast < SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD;
    });
    const requestAttentionWithGpResidents = buildRunwayResidents(latestGp, options.residentSlices, slice => {
        return (slice.trackedCauseCounts['nervous:request-attention'] || 0) > 0;
    });

    return {
        economyEventsPath: options.economyEventsPath,
        economyEventsInWindow: rows.length,
        apGpExchangeEvents,
        selfInitiatedApGpExchangeEvents,
        controlledApGpExchangeEvents,
        organicSelfInitiatedApGpExchangeEvents,
        adminDrainEvents,
        attentionRunwayThresholdAp: SELF_INITIATED_EXCHANGE_NO_FLOOR_AP_THRESHOLD,
        minimumExchangeGp: SELF_INITIATED_EXCHANGE_MIN_GP,
        latestGpByResident,
        lowApWithGpResidents,
        requestAttentionWithGpResidents,
    };
}

function buildRunwayResidents(
    latestGp: Map<string, NormalLifeAuditGpObservation>,
    residentSlices: NormalLifeAuditResidentSlice[],
    include: (slice: NormalLifeAuditResidentSlice) => boolean,
): NormalLifeAuditGpRunwayResident[] {
    return residentSlices
        .filter(slice => include(slice))
        .map(slice => {
            const gp = latestGp.get(slice.resident);
            if (!gp || gp.gp < SELF_INITIATED_EXCHANGE_MIN_GP || slice.apLast === undefined) return undefined;
            return {
                resident: slice.resident,
                apLast: slice.apLast,
                gp: gp.gp,
                requestAttentionActions: slice.trackedCauseCounts['nervous:request-attention'] || 0,
                lastGpObservedAt: gp.observedAt,
            };
        })
        .filter((entry): entry is NormalLifeAuditGpRunwayResident => entry !== undefined)
        .sort((a, b) => {
            if (a.apLast === b.apLast) {
                if (b.requestAttentionActions === a.requestAttentionActions) return a.resident.localeCompare(b.resident);
                return b.requestAttentionActions - a.requestAttentionActions;
            }
            return a.apLast - b.apLast;
        });
}

function gpObservedFromEvent(row: Record<string, unknown>): number | undefined {
    const note = stringField(row, 'note') || '';
    const match = note.match(/observed\s+([0-9]+(?:\.[0-9]+)?)\s+GP\s+in\s+item\s+995/i);
    if (match) {
        const parsed = Number(match[1]);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    const gpDelta = numberField(row, 'gpDelta');
    return gpDelta !== undefined && gpDelta > 0 ? gpDelta : undefined;
}

function sortedResidentSlices(slices: Map<string, ResidentSliceAccumulator>): NormalLifeAuditResidentSlice[] {
    return [...slices.values()]
        .map(slice => {
            const apFirst = slice.attention?.first;
            const apLast = slice.attention?.last;
            const apDrop = slice.attention ? Math.max(0, round3(slice.attention.first - slice.attention.last)) : 0;
            return {
                resident: slice.resident,
                actionAttempts: slice.actionAttempts,
                successfulActionSubmissions: slice.successfulActionSubmissions,
                failedActionSubmissions: slice.failedActionSubmissions,
                ...(apFirst !== undefined ? { apFirst } : {}),
                ...(apLast !== undefined ? { apLast } : {}),
                apDrop,
                trackedActionCounts: trackedCounts(slice.actionKindCounts, TRACKED_ACTION_KINDS),
                trackedCauseCounts: trackedCounts(slice.causeCounts, TRACKED_CAUSES),
                trackedTimelineCounts: trackedCounts(slice.timelineKindCounts, TRACKED_TIMELINE_KINDS),
            };
        })
        .sort((a, b) => {
            if (b.actionAttempts === a.actionAttempts) return a.resident.localeCompare(b.resident);
            return b.actionAttempts - a.actionAttempts;
        });
}

function timestampCompact(value: Date): string {
    return value
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
}

function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
    if (!record) return undefined;
    const value = record[key];
    return isRecord(value) ? value : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
    if (!record) return undefined;
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
    if (!record) return undefined;
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolField(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
    if (!record) return undefined;
    const value = record[key];
    return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
