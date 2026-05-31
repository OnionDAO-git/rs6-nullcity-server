import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectNormalLifeAudit, parseNormalLifeAuditArgs, runNormalLifeAuditCli, type NormalLifeAuditReport } from './normal-life-audit';

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

        writeJsonl(path.join(logsRoot, 'res:qa-alpha', 'actions', '2026-05-30.jsonl'), [
            action('2026-05-30T11:59:59.000Z', 'move_to', 'idle_initiative', true, 120),
            action('2026-05-30T12:10:00.000Z', 'move_to', 'idle_initiative', true, 100),
            action('2026-05-30T12:20:00.000Z', 'say', 'idle_initiative', false, 95),
            action('2026-05-30T12:50:00.000Z', 'trade_request', 'direct_chat_trade', true, 90),
            action('2026-05-30T12:51:00.000Z', 'city_exchange_ap_gp', 'nervous:self-initiated-ap-gp-exchange', true, 90),
        ]);
        writeJsonl(path.join(logsRoot, 'res:qa-beta', 'actions', '2026-05-30.jsonl'), [
            action('2026-05-30T12:15:00.000Z', 'move_to', 'explore_patrol', true, 50),
            action('2026-05-30T12:30:00.000Z', 'eat', 'combat_resupply_food', true, 49),
            action('2026-05-30T12:55:00.000Z', 'say', 'none', true, 55),
        ]);
        writeJsonl(path.join(logsRoot, 'res:bmk_ignore', 'actions', '2026-05-30.jsonl'), [
            action('2026-05-30T12:30:00.000Z', 'attack', 'benchmark', true, 1),
        ]);

        writeJsonl(path.join(libraryRoot, 'res-qa-alpha', 'timeline.jsonl'), [
            timeline('2026-05-30T12:11:00.000Z', 'stuck_detected'),
            timeline('2026-05-30T12:12:00.000Z', 'stuck_recovered'),
            timeline('2026-05-30T12:52:00.000Z', 'city_ap_gp_exchange'),
            timeline('2026-05-30T11:30:00.000Z', 'say'),
        ]);
        writeJsonl(path.join(libraryRoot, 'res-qa-beta', 'timeline.jsonl'), [timeline('2026-05-30T12:16:00.000Z', 'say')]);

        const report = collectNormalLifeAudit({
            logsRoot,
            libraryRoot,
            windowStart: new Date('2026-05-30T12:00:00.000Z'),
            windowEnd: new Date('2026-05-30T13:00:00.000Z'),
            maxTopRows: 6,
        });

        expect(report.activeResidents).toBe(2);
        expect(report.totalActionAttempts).toBe(7);
        expect(report.successfulActionSubmissions).toBe(6);
        expect(report.failedActionSubmissions).toBe(1);
        expect(report.actionSuccessRate).toBeCloseTo(85.714, 2);
        expect(report.actionKindCounts[0]).toEqual(['move_to', 2]);
        expect(report.actionKindCounts).toContainEqual(['say', 2]);
        expect(report.actionKindCounts).toContainEqual(['trade_request', 1]);
        expect(report.causeCounts).toContainEqual(['idle_initiative', 2]);
        expect(report.trackedActionCounts.city_exchange_ap_gp).toBe(1);
        expect(report.trackedActionCounts.trade_completed).toBe(0);
        expect(report.trackedActionCounts.eat).toBe(1);
        expect(report.trackedCauseCounts.combat_resupply_food).toBe(1);
        expect(report.trackedCauseCounts.low_health_heal_wait).toBe(0);
        expect(report.trackedTimelineCounts.city_ap_gp_exchange).toBe(1);
        expect(report.trackedTimelineCounts.trade_cancelled).toBe(0);
        expect(report.timelineKindCounts).toEqual([
            ['city_ap_gp_exchange', 1],
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
        expect(Object.keys(report.trackedActionCounts)).toEqual([
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
        ]);
        expect(Object.keys(report.trackedCauseCounts)).toEqual([
            'nervous:self-initiated-ap-gp-exchange',
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
        ]);
        expect(Object.keys(report.trackedTimelineCounts)).toEqual([
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
        ]);
        expect(report.residentSignalSummary).toBe(report.residentSlices);
        expect(report.residentSlices).toEqual([
            expect.objectContaining({
                resident: 'res:qa-alpha',
                actionAttempts: 4,
                successfulActionSubmissions: 3,
                failedActionSubmissions: 1,
                apDrop: 10,
                trackedActionCounts: expect.objectContaining({
                    city_exchange_ap_gp: 1,
                    trade_request: 1,
                    eat: 0,
                }),
                trackedCauseCounts: expect.objectContaining({
                    'nervous:self-initiated-ap-gp-exchange': 1,
                    combat_resupply_food: 0,
                }),
                trackedTimelineCounts: expect.objectContaining({
                    city_ap_gp_exchange: 1,
                    stuck_detected: 1,
                    stuck_recovered: 1,
                }),
            }),
            expect.objectContaining({
                resident: 'res:qa-beta',
                actionAttempts: 3,
                successfulActionSubmissions: 3,
                failedActionSubmissions: 0,
                apDrop: 0,
                trackedActionCounts: expect.objectContaining({
                    city_exchange_ap_gp: 0,
                    eat: 1,
                }),
                trackedCauseCounts: expect.objectContaining({ combat_resupply_food: 1 }),
                trackedTimelineCounts: expect.objectContaining({ say: 1 }),
            }),
        ]);
        expect(report.notObservedTimelineKinds).toContain('trade_completed');
        expect(report.notObservedTimelineKinds).not.toContain('stuck_detected');
    });

    it('keeps tracked recurrence signals and resident slices even when top rows hide them', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-life-audit-tracked-'));
        const logsRoot = path.join(root, 'logs');
        const libraryRoot = path.join(root, 'library');
        fs.mkdirSync(logsRoot, { recursive: true });
        fs.mkdirSync(libraryRoot, { recursive: true });

        writeJsonl(path.join(logsRoot, 'res:qa-alpha', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:00:00.000Z', 'move_to', 'idle_initiative', true, 100),
            action('2026-05-31T12:01:00.000Z', 'move_to', 'idle_initiative', true, 99),
            action('2026-05-31T12:02:00.000Z', 'city_exchange_ap_gp', 'nervous:self-initiated-ap-gp-exchange', true, 500),
            action('2026-05-31T12:03:00.000Z', 'trade_request', 'direct_chat_trade', true, 490),
            action('2026-05-31T12:04:00.000Z', 'attack', 'combat_attack_safe_target', true, 480),
            action('2026-05-31T12:05:00.000Z', 'eat', 'starter_fishing_eat_cooked_fish_for_space', true, 470),
            action('2026-05-31T12:06:00.000Z', 'use_item_on', 'starter_fishing_cook_catch', true, 460),
            action('2026-05-31T12:07:00.000Z', 'move_to', 'low_health_heal_wait', true, 450),
            action('2026-05-31T12:08:00.000Z', 'move_to', 'combat_resupply_food', true, 440),
        ]);
        writeJsonl(path.join(logsRoot, 'res:qa-beta', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:00:00.000Z', 'say', 'idle_initiative', true, 100),
            action('2026-05-31T12:01:00.000Z', 'say', 'idle_initiative', true, 99),
            action('2026-05-31T12:02:00.000Z', 'say', 'nervous:request-attention', true, 98),
        ]);

        writeJsonl(path.join(libraryRoot, 'res-qa-alpha', 'timeline.jsonl'), [
            timeline('2026-05-31T12:02:30.000Z', 'city_ap_gp_exchange'),
            timeline('2026-05-31T12:03:30.000Z', 'trade_completed'),
            timeline('2026-05-31T12:04:30.000Z', 'first_xp'),
            timeline('2026-05-31T12:05:30.000Z', 'level_up'),
            timeline('2026-05-31T12:06:30.000Z', 'stuck_detected'),
            timeline('2026-05-31T12:07:30.000Z', 'stuck_recovered'),
        ]);
        writeJsonl(path.join(libraryRoot, 'res-qa-beta', 'timeline.jsonl'), [
            timeline('2026-05-31T12:02:30.000Z', 'death'),
            timeline('2026-05-31T12:03:30.000Z', 'logout'),
        ]);

        const report = collectNormalLifeAudit({
            logsRoot,
            libraryRoot,
            windowStart: new Date('2026-05-31T12:00:00.000Z'),
            windowEnd: new Date('2026-05-31T13:00:00.000Z'),
            maxTopRows: 1,
        });

        expect(report.actionKindCounts).toEqual([['move_to', 4]]);
        expect(report.trackedActionCounts.city_exchange_ap_gp).toBe(1);
        expect(report.trackedActionCounts.trade_request).toBe(1);
        expect(report.trackedActionCounts.attack).toBe(1);
        expect(report.trackedActionCounts.eat).toBe(1);
        expect(report.trackedActionCounts.use_item_on).toBe(1);
        expect(report.trackedCauseCounts.low_health_heal_wait).toBe(1);
        expect(report.trackedCauseCounts.combat_resupply_food).toBe(1);
        expect(report.trackedTimelineCounts.city_ap_gp_exchange).toBe(1);
        expect(report.trackedTimelineCounts.trade_completed).toBe(1);
        expect(report.trackedTimelineCounts.first_xp).toBe(1);
        expect(report.trackedTimelineCounts.death).toBe(1);
        expect(report.recurrenceSummary).toMatchObject({
            apGpExchangeActions: 1,
            apGpExchangeEvents: 1,
            tradeRequests: 1,
            tradeCompleted: 1,
            combatActions: 1,
            eatingActions: 1,
            cookingActions: 1,
            lowHealthWaits: 1,
            combatResupplyActions: 1,
            xpEvents: 1,
            levelUps: 1,
            deaths: 1,
            logouts: 1,
            stuckDetected: 1,
            stuckRecovered: 1,
        });

        const alpha = report.residentSlices.find(entry => entry.resident === 'res:qa-alpha');
        expect(alpha).toBeDefined();
        expect(alpha?.trackedActionCounts.city_exchange_ap_gp).toBe(1);
        expect(alpha?.trackedCauseCounts.combat_resupply_food).toBe(1);
        expect(alpha?.trackedTimelineCounts.trade_completed).toBe(1);
        expect(alpha?.actionAttempts).toBe(9);
        expect(alpha?.failedActionSubmissions).toBe(0);
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
