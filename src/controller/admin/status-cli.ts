import fs from 'fs';
import path from 'path';
import type { InferenceHealthResult } from '../llm/inference-health';
import { buildCityStatus, type CityStatus, type ResidentRawInput, type TrajectoryRowLite } from '../observability/status-aggregator';

/**
 * controller:status — operator outage-detector + at-a-glance resident legibility.
 *
 * Reads the disk artifacts the running controller already writes:
 *   - <memory.dir>/inference-health.json    (latest health probe; see index.ts timer)
 *   - <memory.dir>/<slug>/runtime-state.json (attention, tick, goal, stuckSince, deceased)
 *   - <memory.dir>/<slug>/evidence/trajectory/*.jsonl (recent action/say/decision rows)
 *
 * Exit code is the demo safety contract: non-zero iff the inference probe is red
 * (or unconfigured) OR any resident is ERRORING. A torn JSONL line must NEVER
 * page anyone — defensive parsing throughout; parse failures degrade to nulls.
 */

const DEFAULT_STALE_MS = 60_000;
const DEFAULT_RECENT_ROWS = 60;
const DEFAULT_EXCLUDE_PREFIXES = ['res-bmk_'];
/** A health file older than this is treated as unknown, never as truth. */
const DEFAULT_HEALTH_MAX_AGE_MS = 30_000;

/**
 * Accept a parsed health payload only if it carries a `generatedAt` within
 * `maxAgeMs` of `now`. A stale OK file must NEVER mask a live outage — if we
 * cannot prove freshness we return null (→ unknown health), the safe default.
 */
export function parseHealthIfFresh(raw: unknown, now: number, maxAgeMs: number): InferenceHealthResult | null {
    if (!isRecord(raw) || typeof raw.status !== 'string') return null;
    const generatedAt = typeof raw.generatedAt === 'string' ? Date.parse(raw.generatedAt) : NaN;
    if (!Number.isFinite(generatedAt)) return null;
    if (now - generatedAt > maxAgeMs) return null;
    return raw as unknown as InferenceHealthResult;
}

export function statusExitCode(city: CityStatus): number {
    const healthBad = city.health.state === 'error' || city.health.state === 'timeout' || city.health.state === 'not_configured';
    if (healthBad || city.erroringResidents > 0) return 2;
    return 0;
}

export function renderStatusTable(city: CityStatus): string {
    const lines: string[] = [];
    const h = city.health;
    const banner = h.state === 'ok' ? 'ok' : h.state.toUpperCase();
    lines.push(`HEALTH: ${banner} — ${h.detail}${h.model ? ` [${h.endpoint}/${h.model}]` : ''}`);
    lines.push(`residents=${city.residents.length} erroring=${city.erroringResidents} generatedAt=${city.generatedAt}`);
    lines.push('');
    const sorted = [...city.residents].sort(
        (a, b) => statePriority(a.state) - statePriority(b.state) || a.resident.localeCompare(b.resident),
    );
    for (const r of sorted) {
        const ap = r.attention === null ? '?' : String(r.attention);
        const tsa = r.ticksSinceAction === null ? '-' : `${r.ticksSinceAction}t`;
        lines.push(`  ${pad(r.state, 12)} AP=${pad(ap, 4)} act=${pad(tsa, 5)} ${r.storyLine}`);
    }
    return lines.join('\n') + '\n';
}

function statePriority(state: string): number {
    switch (state) {
        case 'ERRORING':
            return 0;
        case 'STUCK':
            return 1;
        case 'OFFLINE':
            return 2;
        case 'THINKING':
            return 3;
        default:
            return 4;
    }
}

function pad(text: string, width: number): string {
    return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

// ---------------------------------------------------------------------------
// Disk layer
// ---------------------------------------------------------------------------

export interface CollectOptions {
    memoryDir: string;
    healthFilePath: string;
    now?: number;
    staleMs?: number;
    recentRows?: number;
    excludeSlugPrefixes?: string[];
    healthMaxAgeMs?: number;
}

export function collectCityStatusFromDisk(options: CollectOptions): CityStatus {
    const now = options.now ?? Date.now();
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const recentRows = options.recentRows ?? DEFAULT_RECENT_ROWS;
    const excludePrefixes = options.excludeSlugPrefixes ?? DEFAULT_EXCLUDE_PREFIXES;

    const health = parseHealthIfFresh(readJsonFile(options.healthFilePath), now, options.healthMaxAgeMs ?? DEFAULT_HEALTH_MAX_AGE_MS);

    const residents: ResidentRawInput[] = [];
    for (const slug of safeReadDirs(options.memoryDir)) {
        if (excludePrefixes.some(p => slug.startsWith(p))) continue;
        const residentDir = path.join(options.memoryDir, slug);
        const statePath = path.join(residentDir, 'runtime-state.json');
        const stateRaw = readJsonFile(statePath);
        if (!stateRaw) continue; // not a resident dir (no runtime-state.json)

        const mtimeMs = safeMtimeMs(statePath);
        const deceased = isRecord(stateRaw.deceased) ? (stateRaw.deceased as ResidentRawInput['state'] & object) : undefined;
        const fresh = mtimeMs !== null && now - mtimeMs <= staleMs;
        const online = fresh && !deceased;

        residents.push({
            resident: unslug(slug),
            online,
            thinking: false, // Phase 1: transient THINKING is a dashboard-only signal.
            state: stateRaw as ResidentRawInput['state'],
            recentTrajectory: readRecentTrajectory(residentDir, recentRows),
        });
    }

    residents.sort((a, b) => a.resident.localeCompare(b.resident));
    return buildCityStatus({ health, residents, generatedAt: new Date(now).toISOString() });
}

export interface StatusCliRuntime {
    stdout?: (chunk: string) => void;
    stderr?: (chunk: string) => void;
    now?: number;
}

export function runStatusCli(argv: string[], runtime: StatusCliRuntime = {}): number {
    const stdout = runtime.stdout || (chunk => process.stdout.write(chunk));
    const stderr = runtime.stderr || (chunk => process.stderr.write(chunk));
    try {
        const memoryDir = readArg(argv, '--memory-dir') || process.env.CONTROLLER_MEMORY_DIR || path.join('data', 'controller', 'memory');
        const healthFilePath = readArg(argv, '--health-file') || path.join(memoryDir, 'inference-health.json');
        const city = collectCityStatusFromDisk({ memoryDir, healthFilePath, now: runtime.now });
        stdout(renderStatusTable(city));
        return statusExitCode(city);
    } catch (error) {
        stderr(`[controller:status] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

if (require.main === module) {
    process.exitCode = runStatusCli(process.argv.slice(2));
}

// ---------------------------------------------------------------------------
// Defensive IO helpers
// ---------------------------------------------------------------------------

function readRecentTrajectory(residentDir: string, limit: number): TrajectoryRowLite[] {
    const trajDir = path.join(residentDir, 'evidence', 'trajectory');
    const files = safeReadFiles(trajDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort(); // date-named, lexical sort == chronological
    if (files.length === 0) return [];
    const newest = files[files.length - 1];
    const rows = readJsonl(path.join(trajDir, newest));
    const tail = rows.slice(-limit);
    return tail.map(row => ({
        kind: typeof row.kind === 'string' ? row.kind : '',
        tick: typeof row.tick === 'number' ? row.tick : undefined,
        cause: typeof row.cause === 'string' ? row.cause : undefined,
        goalId: typeof row.goalId === 'string' ? row.goalId : undefined,
    }));
}

function readArg(argv: string[], flag: string): string | undefined {
    const eq = `${flag}=`;
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === flag) return argv[i + 1];
        if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
    }
    return undefined;
}

function unslug(slug: string): string {
    const idx = slug.indexOf('-');
    if (idx < 0) return slug;
    if (slug.slice(0, idx) === 'res') return `res:${slug.slice(idx + 1)}`;
    return slug;
}

function safeMtimeMs(filePath: string): number | null {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return null;
    }
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function readJsonl(filePath: string): Record<string, unknown>[] {
    try {
        return fs
            .readFileSync(filePath, 'utf8')
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

function safeReadDirs(root: string): string[] {
    try {
        return fs
            .readdirSync(root, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
    } catch {
        return [];
    }
}

function safeReadFiles(root: string): string[] {
    try {
        return fs
            .readdirSync(root, { withFileTypes: true })
            .filter(e => e.isFile())
            .map(e => e.name);
    } catch {
        return [];
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
