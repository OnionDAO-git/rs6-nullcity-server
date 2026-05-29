import fs from 'fs';
import path from 'path';
import { normalizeBenchmarkArtifact, type BenchmarkArtifact } from './benchmark-artifact';

export interface BenchmarkReport {
    inputDir: string;
    generatedAt: string;
    artifacts: number;
    skipped: number;
    rows: BenchmarkReportRow[];
}

export interface BenchmarkReportRow {
    profileId: string;
    resident: string;
    endpointId?: string;
    provider?: string;
    model?: string;
    taskId: string;
    mode: BenchmarkArtifact['mode'];
    runs: number;
    passed: number;
    passRate: number;
    averageScore: number;
    averageDurationMs: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    failureReasons: string[];
}

export interface BenchmarkReportCliRuntime {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    now: () => Date;
}

interface ReportAccumulator {
    profileId: string;
    resident: string;
    endpointId?: string;
    provider?: string;
    model?: string;
    taskId: string;
    mode: BenchmarkArtifact['mode'];
    runs: number;
    passed: number;
    scoreTotal: number;
    durationTotalMs: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    failureReasons: Set<string>;
}

const DEFAULT_INPUT_DIR = 'data/benchmarks';

export function buildBenchmarkReport(inputDir = DEFAULT_INPUT_DIR, now = new Date()): BenchmarkReport {
    const files = listJsonFiles(inputDir);
    const groups = new Map<string, ReportAccumulator>();
    let artifacts = 0;
    let skipped = 0;

    for (const file of files) {
        const artifact = readArtifact(file);
        if (!artifact) {
            skipped += 1;
            continue;
        }
        artifacts += 1;
        const profileId = artifact.inference?.profileId || artifact.modelProfile;
        const resident = artifact.resident;
        const endpointId = artifact.inference?.endpointId;
        const provider = artifact.inference?.provider;
        const model = artifact.inference?.model || artifact.modelProfile;
        const taskId = artifact.task.id;
        const mode = artifact.mode;
        const key = `${profileId}\0${resident}\0${endpointId || '-'}\0${provider || '-'}\0${model || '-'}\0${taskId}\0${mode}`;
        const row =
            groups.get(key) ||
            ({
                profileId,
                resident,
                endpointId,
                provider,
                model,
                taskId,
                mode,
                runs: 0,
                passed: 0,
                scoreTotal: 0,
                durationTotalMs: 0,
                promptTokens: 0,
                completionTokens: 0,
                estimatedCostUsd: 0,
                failureReasons: new Set<string>(),
            } satisfies ReportAccumulator);
        row.runs += 1;
        row.passed += artifact.status === 'passed' ? 1 : 0;
        row.scoreTotal += artifact.score;
        row.durationTotalMs += artifact.durationMs;
        row.promptTokens += artifact.inference?.promptTokens || 0;
        row.completionTokens += artifact.inference?.completionTokens || 0;
        row.estimatedCostUsd += estimatedCostUsd(artifact);
        if (artifact.failureReason) {
            row.failureReasons.add(artifact.failureReason);
        }
        groups.set(key, row);
    }

    return {
        inputDir,
        generatedAt: now.toISOString(),
        artifacts,
        skipped,
        rows: [...groups.values()].map(toReportRow).sort(compareRows),
    };
}

export function formatBenchmarkReportMarkdown(report: BenchmarkReport): string {
    const lines = [
        '# Null City benchmark report',
        '',
        `Generated: ${report.generatedAt}`,
        `Input: ${report.inputDir}`,
        `Artifacts: ${report.artifacts} parsed, ${report.skipped} skipped`,
        '',
        '| Profile | Resident | Endpoint | Model | Task | Mode | Runs | Pass | Avg score | Avg sec | Tokens | Cost | Failure causes |',
        '|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|',
    ];
    for (const row of report.rows) {
        lines.push(
            [
                row.profileId,
                row.resident,
                row.endpointId || '-',
                row.model || '-',
                row.taskId,
                row.mode,
                String(row.runs),
                `${Math.round(row.passRate * 100)}%`,
                row.averageScore.toFixed(3),
                (row.averageDurationMs / 1000).toFixed(1),
                String(row.promptTokens + row.completionTokens),
                `$${row.estimatedCostUsd.toFixed(6)}`,
                row.failureReasons.length > 0 ? row.failureReasons.join('; ') : '-',
            ]
                .join(' | ')
                .replace(/^/, '| ') + ' |',
        );
    }
    return `${lines.join('\n')}\n`;
}

export async function runBenchmarkReportCli(
    argv: string[],
    runtime: BenchmarkReportCliRuntime = {
        stdout: text => process.stdout.write(text),
        stderr: text => process.stderr.write(text),
        now: () => new Date(),
    },
): Promise<number> {
    try {
        const options = parseReportCliArgs(argv);
        const report = buildBenchmarkReport(options.inputDir, runtime.now());
        runtime.stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatBenchmarkReportMarkdown(report));
        return 0;
    } catch (error) {
        runtime.stderr(`[benchmark:report] ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

function parseReportCliArgs(argv: string[]): { inputDir: string; json: boolean } {
    let inputDir = process.env.CONTROLLER_BENCHMARK_REPORT_INPUT || DEFAULT_INPUT_DIR;
    let json = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--input') {
            inputDir = readRequiredValue(argv, (index += 1), arg);
            continue;
        }
        if (arg === '--json') {
            json = true;
            continue;
        }
        throw new Error(`Unknown benchmark report argument ${arg}`);
    }
    return { inputDir, json };
}

function listJsonFiles(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }
    const files: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const child = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...listJsonFiles(child));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(child);
        }
    }
    return files.sort();
}

function readArtifact(filePath: string): BenchmarkArtifact | undefined {
    try {
        return normalizeBenchmarkArtifact(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return undefined;
    }
}

function estimatedCostUsd(artifact: BenchmarkArtifact): number {
    if (typeof artifact.inference?.estimatedCostUsd === 'number') {
        return artifact.inference.estimatedCostUsd;
    }
    const promptTokens = artifact.inference?.promptTokens || 0;
    const completionTokens = artifact.inference?.completionTokens || 0;
    const promptCost = artifact.inference?.pricing?.promptTokenUsd || 0;
    const completionCost = artifact.inference?.pricing?.completionTokenUsd || 0;
    return promptTokens * promptCost + completionTokens * completionCost;
}

function toReportRow(row: ReportAccumulator): BenchmarkReportRow {
    return {
        profileId: row.profileId,
        resident: row.resident,
        endpointId: row.endpointId,
        provider: row.provider,
        model: row.model,
        taskId: row.taskId,
        mode: row.mode,
        runs: row.runs,
        passed: row.passed,
        passRate: round(row.passed / row.runs, 4),
        averageScore: round(row.scoreTotal / row.runs, 4),
        averageDurationMs: Math.round(row.durationTotalMs / row.runs),
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        estimatedCostUsd: round(row.estimatedCostUsd, 8),
        failureReasons: [...row.failureReasons].sort(),
    };
}

function compareRows(left: BenchmarkReportRow, right: BenchmarkReportRow): number {
    return (
        left.profileId.localeCompare(right.profileId) ||
        left.resident.localeCompare(right.resident) ||
        (left.endpointId || '').localeCompare(right.endpointId || '') ||
        left.taskId.localeCompare(right.taskId) ||
        left.mode.localeCompare(right.mode)
    );
}

function round(value: number, digits: number): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function readRequiredValue(argv: string[], index: number, arg: string): string {
    const value = argv[index];
    if (!value) {
        throw new Error(`Missing value for ${arg}`);
    }
    return value;
}

if (require.main === module) {
    runBenchmarkReportCli(process.argv.slice(2)).then(code => {
        process.exitCode = code;
    });
}
