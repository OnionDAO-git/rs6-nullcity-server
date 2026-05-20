import fs from 'fs';
import path from 'path';
import { loadSimulationConfig, parseCliOptions } from './lib/config';

interface BugEntry {
    t: string;
    resident?: string;
    severity: string;
    kind: string;
    reason: string;
    details?: unknown;
}

async function main(): Promise<void> {
    const cli = parseCliOptions(process.argv.slice(2));
    const config = loadSimulationConfig(cli);
    const bugDir = path.join(config.paths.logDir, 'bugs');
    const entries = readJsonlDir<BugEntry>(bugDir);
    const counts = new Map<string, number>();

    for (const entry of entries) {
        const key = `${entry.severity}:${entry.kind}:${entry.reason}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    const report = [
        '# Simulation Report',
        '',
        `Generated: ${new Date().toISOString()}`,
        `Bug log entries: ${entries.length}`,
        '',
        '## Bugs By Type',
        '',
        ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `- ${count} ${key}`),
        '',
        '## Recent Bugs',
        '',
        ...entries
            .slice(-25)
            .reverse()
            .map(entry => `- ${entry.t} ${entry.resident || 'global'} ${entry.severity}/${entry.kind}: ${entry.reason}`),
        '',
    ].join('\n');

    if (cli.outPath) {
        const outPath = path.resolve(process.cwd(), cli.outPath);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, report);
    } else {
        process.stdout.write(report);
    }
}

function readJsonlDir<T>(dir: string): T[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const entries: T[] = [];
    for (const file of fs
        .readdirSync(dir)
        .filter(file => file.endsWith('.jsonl'))
        .sort()) {
        const fullPath = path.join(dir, file);
        for (const line of fs.readFileSync(fullPath, 'utf8').split('\n')) {
            if (line.trim()) {
                entries.push(JSON.parse(line) as T);
            }
        }
    }
    return entries;
}

main().catch(error => {
    process.stderr.write(`[simulation:report] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
});
