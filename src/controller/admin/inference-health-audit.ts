import fs from 'fs';
import path from 'path';
import { isoDate } from '../util/clock';

/**
 * S-INFER-DIAG-1 — inference-health-audit
 *
 * Turns the blurry "empty_completion 87.5%" into a precise, per-resident
 * breakdown of WHY each brain-eligible decision did (or did not) produce a
 * usable plan. Reads the per-resident trajectory logs the controller writes at
 * `<memory.dir>/<residentSlug>/evidence/trajectory/*.jsonl` (one `decision`
 * line per brain tick, with `cause` = the SPARK `decisionCause`). S-INFER-1
 * enriched that cause from a blanket `empty_completion` into a salvage
 * classification (`empty_completion_<class>` at the SPARK level, `brain_<class>`
 * at the brain call site), so this audit can finally separate:
 *
 *   - clean / usable  — the brain emitted a usable plan/action/say/memo
 *   - recovered_*      — the completion WAS broken but the S-INFER-1 parser
 *                        salvaged it (think-strip / fence / trailing-comma /
 *                        lenient field recovery). High counts here mean the old
 *                        87.5% was a PARSER bug, now fixed.
 *   - think_only_no_answer — model emitted think text / truncated mid-think with
 *                        no JSON answer (bucket B; raise max_tokens / timeout).
 *   - thinking_cancelled — a reflex pre-empted the brain mid-think (bucket C;
 *                        reflex tuning, NOT a parser problem).
 *   - schema_mismatch  — valid JSON, wrong shape (prompt / schema issue).
 *   - truly_empty      — whitespace / nothing usable at all.
 *
 * Headline metric: usable-brain-decision rate = (clean + recovered) /
 * brain-eligible. This is the number that REPLACES "87.5% empty".
 *
 * HONESTY: there are no current-binary live logs in the sandbox — the audit is
 * proven against a synthetic fixture. Its real value lands after the maintainer
 * restarts the controller onto the new binary and runs it over a live window
 * (see docs/2026-05-31-inference-restart-verification.md).
 */

export type DecisionHealthClass = 'clean' | 'recovered' | 'think_only_no_answer' | 'thinking_cancelled' | 'schema_mismatch' | 'truly_empty';

export const DECISION_HEALTH_CLASSES: DecisionHealthClass[] = [
    'clean',
    'recovered',
    'think_only_no_answer',
    'thinking_cancelled',
    'schema_mismatch',
    'truly_empty',
];

export interface DecisionHealthBreakdown {
    clean: number;
    recovered: number;
    think_only_no_answer: number;
    thinking_cancelled: number;
    schema_mismatch: number;
    truly_empty: number;
}

export interface InferenceHealthResidentSlice {
    resident: string;
    brainEligibleDecisions: number;
    breakdown: DecisionHealthBreakdown;
    /** (clean + recovered) / brainEligibleDecisions, rounded to 4 dp (0..1). */
    usableBrainDecisionRate: number;
    /** distinct goalIds the brain emitted (planChange.id + action/say goalId). */
    goalsEmitted: number;
    /** action/say lines carrying a goalId causation tag (S-GOAL-FOLLOW-1). */
    goalAttributedActions: number;
    /** total action/say lines observed for this resident in the window. */
    totalAttributableActions: number;
    /** goalAttributedActions / totalAttributableActions, rounded 4 dp (0..1). */
    goalFollowThroughRate: number;
    /** raw decisionCause histogram for this resident (forensic detail). */
    causeCounts: Array<[string, number]>;
}

export interface InferenceHealthReport {
    runId: string;
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    trajectoryRoot: string;
    activeResidents: number;
    brainEligibleDecisions: number;
    breakdown: DecisionHealthBreakdown;
    /** THE headline number that replaces "87.5% empty". */
    usableBrainDecisionRate: number;
    goalsEmitted: number;
    goalAttributedActions: number;
    totalAttributableActions: number;
    goalFollowThroughRate: number;
    causeCounts: Array<[string, number]>;
    residentSlices: InferenceHealthResidentSlice[];
    /**
     * True only when the window had at least one brain-eligible decision. When
     * false, the rates are 0 and the maintainer should re-run over a window in
     * which residents actually woke the brain (it does NOT mean inference is
     * broken).
     */
    hasBrainSignal: boolean;
}

export interface InferenceHealthAuditOptions {
    trajectoryRoot: string;
    outputDir: string;
    windowStart: Date;
    windowEnd: Date;
    durationMs: number;
    maxTopRows: number;
    excludeResidentPrefixes: string[];
}

export interface InferenceHealthAuditCliRuntime {
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
    now?: Date;
}

const DEFAULT_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TOP_ROWS = 20;
const DEFAULT_EXCLUDE_PREFIXES = ['res:bmk_'];
const INFERENCE_DECISION_CAUSES = new Set([
    'candidate_fallback',
    'completion_parse_failed',
    'plan_generated',
    'request_timeout',
    'thinking_cancelled',
    'thinking_watchdog_timeout',
    'brain_timeout_fallback',
]);

/**
 * The decisionCause strings S-INFER-1 routes recovered completions through. A
 * cause is "recovered" if it ends with one of these salvage classes (matched
 * against both the SPARK `empty_completion_<class>` and brain `brain_<class>`
 * spellings).
 */
const RECOVERED_SUFFIXES = ['recovered_after_think_strip', 'recovered_from_fence', 'recovered_trailing_comma', 'salvaged_lenient'];

export function classifyDecisionCause(rawCause: string | undefined): DecisionHealthClass {
    const cause = (rawCause || '').trim();
    if (!cause) {
        // A decision line with no cause still represents a brain beat; treat an
        // absent cause conservatively as truly_empty so it is never silently
        // counted as usable.
        return 'truly_empty';
    }

    if (
        cause === 'thinking_cancelled' ||
        cause === 'thinking_watchdog_timeout' ||
        cause === 'brain_timeout_fallback' ||
        cause === 'request_timeout'
    ) {
        return 'thinking_cancelled';
    }

    if (endsWithAny(cause, RECOVERED_SUFFIXES)) {
        return 'recovered';
    }

    if (cause.endsWith('think_only_no_answer')) {
        return 'think_only_no_answer';
    }

    if (cause.endsWith('schema_mismatch') || cause === 'completion_parse_failed') {
        return 'schema_mismatch';
    }

    if (cause === 'empty_completion' || cause === 'empty_completion_idle_initiative' || cause.endsWith('truly_empty')) {
        // Bare `empty_completion` is the telemetry-safe spelling S-INFER-1 keeps
        // for `clean` (well-formed `{}`) AND `truly_empty`. Because the two are
        // indistinguishable at the cause level, the conservative reading is
        // truly_empty (a usable empty-but-clean `{}` beat is rare and would
        // otherwise inflate the headline). The detailed `brain_clean` /
        // `_truly_empty` spellings, when present, are classified precisely above.
        return 'truly_empty';
    }

    if (cause.endsWith('clean')) {
        // Explicit clean spelling from the completion parser.
        return 'clean';
    }

    // Any other named cause (completion_action, plan_generated, brain_goal,
    // candidate_fallback, completion_memory_update, the brain's own parsed.cause
    // for goal/say beats, …) means the brain produced something usable.
    return 'clean';
}

export function collectInferenceHealth(options: {
    trajectoryRoot: string;
    windowStart: Date;
    windowEnd: Date;
    maxTopRows?: number;
    excludeResidentPrefixes?: string[];
    runId?: string;
    generatedAt?: Date;
}): InferenceHealthReport {
    const maxTopRows = options.maxTopRows ?? DEFAULT_MAX_TOP_ROWS;
    const excludePrefixes = options.excludeResidentPrefixes ?? DEFAULT_EXCLUDE_PREFIXES;
    const generatedAt = options.generatedAt ?? options.windowEnd;
    const runId = options.runId ?? `inference_health_audit_${timestampCompact(generatedAt)}`;

    const residentSlices: InferenceHealthResidentSlice[] = [];
    const aggregateBreakdown = emptyBreakdown();
    const aggregateCauseCounts = new Map<string, number>();
    let aggregateGoalsEmitted = 0;
    let aggregateGoalAttributedActions = 0;
    let aggregateTotalAttributableActions = 0;
    let aggregateBrainEligible = 0;

    for (const residentDirName of safeReadDirs(options.trajectoryRoot)) {
        const resident = unslug(residentDirName);
        if (excludePrefixes.some(prefix => resident.startsWith(prefix) || residentDirName.startsWith(prefix.replace(':', '-')))) {
            continue;
        }

        const trajectoryDir = path.join(options.trajectoryRoot, residentDirName, 'evidence', 'trajectory');
        const breakdown = emptyBreakdown();
        const causeCounts = new Map<string, number>();
        const goalIds = new Set<string>();
        let brainEligible = 0;
        let goalAttributedActions = 0;
        let totalAttributableActions = 0;

        for (const fileName of safeReadFiles(trajectoryDir)) {
            if (!fileName.endsWith('.jsonl')) continue;
            for (const row of readJsonl(path.join(trajectoryDir, fileName))) {
                const ts = parseIsoMillis(stringField(row, 'ts'));
                if (ts === undefined || !inWindow(ts, options.windowStart, options.windowEnd)) continue;
                const kind = stringField(row, 'kind');

                if (kind === 'decision' && isInferenceDecision(row)) {
                    brainEligible += 1;
                    const cause = stringField(row, 'cause') || '(unset)';
                    bump(causeCounts, cause);
                    bump(aggregateCauseCounts, cause);
                    const cls = classifyDecisionCause(stringField(row, 'cause'));
                    breakdown[cls] += 1;
                    aggregateBreakdown[cls] += 1;
                    const planId = stringField(recordField(row, 'planChange'), 'id');
                    if (planId) goalIds.add(planId);
                } else if (kind === 'action' || kind === 'say') {
                    totalAttributableActions += 1;
                    aggregateTotalAttributableActions += 1;
                    const goalId = stringField(row, 'goalId');
                    if (goalId) {
                        goalAttributedActions += 1;
                        aggregateGoalAttributedActions += 1;
                        goalIds.add(goalId);
                    }
                }
            }
        }

        if (brainEligible === 0 && totalAttributableActions === 0) {
            continue;
        }

        aggregateBrainEligible += brainEligible;
        aggregateGoalsEmitted += goalIds.size;

        residentSlices.push({
            resident,
            brainEligibleDecisions: brainEligible,
            breakdown,
            usableBrainDecisionRate: usableRate(breakdown, brainEligible),
            goalsEmitted: goalIds.size,
            goalAttributedActions,
            totalAttributableActions,
            goalFollowThroughRate: ratio(goalAttributedActions, totalAttributableActions),
            causeCounts: sortedCounts(causeCounts, maxTopRows),
        });
    }

    residentSlices.sort((a, b) => {
        if (b.brainEligibleDecisions === a.brainEligibleDecisions) return a.resident.localeCompare(b.resident);
        return b.brainEligibleDecisions - a.brainEligibleDecisions;
    });

    return {
        runId,
        generatedAt: generatedAt.toISOString(),
        windowStart: options.windowStart.toISOString(),
        windowEnd: options.windowEnd.toISOString(),
        trajectoryRoot: options.trajectoryRoot,
        activeResidents: residentSlices.length,
        brainEligibleDecisions: aggregateBrainEligible,
        breakdown: aggregateBreakdown,
        usableBrainDecisionRate: usableRate(aggregateBreakdown, aggregateBrainEligible),
        goalsEmitted: aggregateGoalsEmitted,
        goalAttributedActions: aggregateGoalAttributedActions,
        totalAttributableActions: aggregateTotalAttributableActions,
        goalFollowThroughRate: ratio(aggregateGoalAttributedActions, aggregateTotalAttributableActions),
        causeCounts: sortedCounts(aggregateCauseCounts, maxTopRows),
        residentSlices,
        hasBrainSignal: aggregateBrainEligible > 0,
    };
}

export function parseInferenceHealthAuditArgs(argv: string[], now: Date = new Date()): InferenceHealthAuditOptions {
    const options: InferenceHealthAuditOptions = {
        trajectoryRoot: process.env.CONTROLLER_TRAJECTORY_ROOT || path.join('data', 'controller', 'memory'),
        outputDir:
            process.env.CONTROLLER_INFERENCE_AUDIT_OUTPUT_DIR ||
            path.join('data', 'benchmarks', `capability-qa-${isoDate(now)}`, 'inference-audit'),
        windowEnd: now,
        windowStart: new Date(now.getTime() - DEFAULT_DURATION_MS),
        durationMs: readPositiveInt(process.env.CONTROLLER_INFERENCE_AUDIT_DURATION_MS, DEFAULT_DURATION_MS),
        maxTopRows: readPositiveInt(process.env.CONTROLLER_INFERENCE_AUDIT_TOP_ROWS, DEFAULT_MAX_TOP_ROWS),
        excludeResidentPrefixes: [...DEFAULT_EXCLUDE_PREFIXES],
    };

    let startOverride: Date | undefined;
    let endOverride: Date | undefined;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--trajectory-root') {
            options.trajectoryRoot = readRequiredValue(argv, ++i, arg);
        } else if (arg.startsWith('--trajectory-root=')) {
            options.trajectoryRoot = arg.slice('--trajectory-root='.length);
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
            throw new Error(`Unknown inference-health-audit argument ${arg}`);
        }
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

export async function runInferenceHealthAuditCli(argv: string[], runtime: InferenceHealthAuditCliRuntime = {}): Promise<number> {
    const stdout = runtime.stdout || (chunk => process.stdout.write(chunk));
    const stderr = runtime.stderr || (chunk => process.stderr.write(chunk));
    const now = runtime.now || new Date();

    try {
        const options = parseInferenceHealthAuditArgs(argv, now);
        const report = collectInferenceHealth({
            trajectoryRoot: options.trajectoryRoot,
            windowStart: options.windowStart,
            windowEnd: options.windowEnd,
            maxTopRows: options.maxTopRows,
            excludeResidentPrefixes: options.excludeResidentPrefixes,
            generatedAt: now,
        });

        fs.mkdirSync(options.outputDir, { recursive: true });
        const artifactPath = path.join(options.outputDir, `${report.runId}.json`);
        fs.writeFileSync(artifactPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

        const b = report.breakdown;
        stdout(
            `[inference-health-audit] window=${report.windowStart}..${report.windowEnd} residents=${report.activeResidents} brainDecisions=${report.brainEligibleDecisions}\n`,
        );
        if (report.hasBrainSignal) {
            stdout(
                `[inference-health-audit] usable-brain-rate=${pct(report.usableBrainDecisionRate)} ` +
                    `(clean=${b.clean} recovered=${b.recovered} | broken: think_only=${b.think_only_no_answer} ` +
                    `cancelled=${b.thinking_cancelled} schema=${b.schema_mismatch} empty=${b.truly_empty})\n`,
            );
            stdout(
                `[inference-health-audit] planning: goalsEmitted=${report.goalsEmitted} ` +
                    `goal-follow-through=${pct(report.goalFollowThroughRate)} ` +
                    `(${report.goalAttributedActions}/${report.totalAttributableActions} actions)\n`,
            );
        } else {
            stdout(
                `[inference-health-audit] NO brain-eligible decisions in window — re-run over a window where residents woke the brain (this is NOT an inference failure)\n`,
            );
        }
        stdout(`[inference-health-audit] artifact=${artifactPath}\n`);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr(`[inference-health-audit] ${message}\n`);
        return 1;
    }
}

if (require.main === module) {
    runInferenceHealthAuditCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}

function emptyBreakdown(): DecisionHealthBreakdown {
    return {
        clean: 0,
        recovered: 0,
        think_only_no_answer: 0,
        thinking_cancelled: 0,
        schema_mismatch: 0,
        truly_empty: 0,
    };
}

function usableRate(breakdown: DecisionHealthBreakdown, brainEligible: number): number {
    return ratio(breakdown.clean + breakdown.recovered, brainEligible);
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 10000;
}

function pct(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
}

function endsWithAny(value: string, suffixes: string[]): boolean {
    return suffixes.some(suffix => value.endsWith(suffix));
}

/**
 * Trajectory `decision` rows include many controller/control-flow decisions
 * (`budget_exhausted:pause`, `hook_noop`, `body_wait`, `follow_listen_hold`,
 * etc.) that never called the model. Do not let those inflate the inference
 * health headline as "clean brain" output. A row is inference-bearing only
 * when it has prompt/completion hashes or a cause family emitted by the
 * Brain/SPARK completion parser.
 */
function isInferenceDecision(row: Record<string, unknown>): boolean {
    if (stringField(row, 'promptHash') || stringField(row, 'completionHash')) {
        return true;
    }
    if (numberField(row, 'promptTokens') > 0) {
        return true;
    }
    const cause = stringField(row, 'cause');
    if (!cause) {
        return false;
    }
    return (
        cause.startsWith('brain_') ||
        cause.startsWith('completion_') ||
        cause.startsWith('empty_completion') ||
        INFERENCE_DECISION_CAUSES.has(cause)
    );
}

/** `res-agent` (filesystem slug) → `res:agent` (resident id). */
function unslug(slug: string): string {
    const idx = slug.indexOf('-');
    if (idx < 0) return slug;
    const prefix = slug.slice(0, idx);
    if (prefix === 'res') {
        return `res:${slug.slice(idx + 1)}`;
    }
    return slug;
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

function inWindow(ts: number, start: Date, end: Date): boolean {
    return ts >= start.getTime() && ts <= end.getTime();
}

function bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) || 0) + 1);
}

function sortedCounts(map: Map<string, number>, limit: number): Array<[string, number]> {
    return [...map.entries()]
        .sort((a, b) => {
            if (b[1] === a[1]) return a[0].localeCompare(b[0]);
            return b[1] - a[1];
        })
        .slice(0, limit);
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

function numberField(record: Record<string, unknown> | undefined, key: string): number {
    if (!record) return 0;
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
