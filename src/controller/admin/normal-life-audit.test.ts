import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    collectNormalLifeAudit,
    parseNormalLifeAuditArgs,
    runNormalLifeAuditCli,
    type NormalLifeAuditReport,
} from './normal-life-audit';

describe('normal life audit', () => {
    it('parses defaults with a one-hour window ending at now', () => {
        const now = new Date('2026-05-30T13:00:00.000Z');
        const options = parseNormalLifeAuditArgs([], now);

        expect(options.durationMs).toBe(3_600_000);
        expect(options.windowEnd.toISOString()).toBe('2026-05-30T13:00:00.000Z');
        expect(options.windowStart.toISOString()).toBe('2026-05-30T12:00:00.000Z');
        expect(options.logsRoot).toBe(path.join('data', 'controller', 'logs'));
        expect(options.libraryRoot).toBe(path.join('data', 'controller', 'memory', 'library'));
        expect(options.outputDir).toBe(path.join('data', 'benchmarks', 'capability-qa-2026-05-30'));
    });

    it('collects one-hour metrics and excludes benchmark residents', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-life-audit-'));
        const logsRoot = path.join(root, 'logs');
        const libraryRoot = path.join(root, 'library');
        fs.mkdirSync(logsRoot, { recursive: true });
        fs.mkdirSync(libraryRoot, { recursive: true });

        writeJsonl(
            path.join(logsRoot, 'res:qa-alpha', 'actions', '2026-05-30.jsonl'),
            [
                action('2026-05-30T11:59:59.000Z', 'move_to', 'idle_initiative', true, 120),
                action('2026-05-30T12:10:00.000Z', 'move_to', 'idle_initiative', true, 100),
                action('2026-05-30T12:20:00.000Z', 'say', 'idle_initiative', false, 95),
                action('2026-05-30T12:50:00.000Z', 'trade_request', 'direct_chat_trade', true, 90),
            ],
        );
        writeJsonl(
            path.join(logsRoot, 'res:qa-beta', 'actions', '2026-05-30.jsonl'),
            [
                action('2026-05-30T12:15:00.000Z', 'move_to', 'explore_patrol', true, 50),
                action('2026-05-30T12:55:00.000Z', 'say', 'none', true, 55),
            ],
        );
        writeJsonl(
            path.join(logsRoot, 'res:bmk_ignore', 'actions', '2026-05-30.jsonl'),
            [action('2026-05-30T12:30:00.000Z', 'attack', 'benchmark', true, 1)],
        );

        writeJsonl(path.join(libraryRoot, 'res-qa-alpha', 'timeline.jsonl'), [
            timeline('2026-05-30T12:11:00.000Z', 'stuck_detected'),
            timeline('2026-05-30T12:12:00.000Z', 'stuck_recovered'),
            timeline('2026-05-30T11:30:00.000Z', 'say'),
        ]);
        writeJsonl(path.join(libraryRoot, 'res-qa-beta', 'timeline.jsonl'), [timeline('2026-05-30T12:16:00.000Z', 'say')]);

        const report = collectNormalLifeAudit({
            logsRoot,
            libraryRoot,
            windowStart: new Date('2026-05-30T12:00:00.000Z'),
            windowEnd: new Date('2026-05-30T13:00:00.000Z'),
            maxTopRows: 4,
        });

        expect(report.activeResidents).toBe(2);
        expect(report.totalActionAttempts).toBe(5);
        expect(report.successfulActionSubmissions).toBe(4);
        expect(report.failedActionSubmissions).toBe(1);
        expect(report.actionSuccessRate).toBeCloseTo(80, 2);
        expect(report.actionKindCounts[0]).toEqual(['move_to', 2]);
        expect(report.actionKindCounts).toContainEqual(['say', 2]);
        expect(report.actionKindCounts).toContainEqual(['trade_request', 1]);
        expect(report.causeCounts).toContainEqual(['idle_initiative', 2]);
        expect(report.timelineKindCounts).toEqual([
            ['say', 1],
            ['stuck_detected', 1],
            ['stuck_recovered', 1],
        ]);
        expect(report.apSummary.residentsWithAttention).toBe(2);
        expect(report.apSummary.residentsWithDrop).toBe(1);
        expect(report.apSummary.aggregateDrop).toBe(10);
        expect(report.apSummary.topDrops[0]).toMatchObject({
            resident: 'res:qa-alpha',
            first: 100,
            last: 90,
            drop: 10,
        });
        expect(report.notObservedTimelineKinds).toContain('trade_completed');
        expect(report.notObservedTimelineKinds).not.toContain('stuck_detected');
    });

    it('writes a JSON artifact and returns exit code 0', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-life-audit-cli-'));
        const logsRoot = path.join(root, 'logs');
        const libraryRoot = path.join(root, 'library');
        const outputDir = path.join(root, 'out');
        fs.mkdirSync(logsRoot, { recursive: true });
        fs.mkdirSync(libraryRoot, { recursive: true });

        writeJsonl(path.join(logsRoot, 'res:qa-alpha', 'actions', '2026-05-30.jsonl'), [
            action('2026-05-30T12:10:00.000Z', 'say', 'idle_initiative', true, 100),
        ]);

        const writes: string[] = [];
        const exitCode = await runNormalLifeAuditCli(
            [
                '--logs-root',
                logsRoot,
                '--library-root',
                libraryRoot,
                '--output-dir',
                outputDir,
                '--start',
                '2026-05-30T12:00:00.000Z',
                '--end',
                '2026-05-30T13:00:00.000Z',
            ],
            {
                stdout: chunk => writes.push(chunk),
                now: new Date('2026-05-30T13:00:00.000Z'),
            },
        );

        expect(exitCode).toBe(0);
        const artifactLine = writes.find(line => line.includes('[normal-life-audit] artifact='));
        expect(artifactLine).toBeDefined();
        const artifactPath = artifactLine!.split('artifact=')[1].trim();
        expect(fs.existsSync(artifactPath)).toBe(true);

        const report = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as NormalLifeAuditReport;
        expect(report.totalActionAttempts).toBe(1);
        expect(report.activeResidents).toBe(1);
    });
});

function action(t: string, kind: string, cause: string, ok: boolean, attentionAfter: number): Record<string, unknown> {
    return {
        t,
        source: 'thinking',
        attention_after: attentionAfter,
        action: { kind, cause },
        result: { ok },
    };
}

function timeline(ts: string, kind: string): Record<string, unknown> {
    return { ts, kind };
}

function writeJsonl(filePath: string, rows: unknown[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}
