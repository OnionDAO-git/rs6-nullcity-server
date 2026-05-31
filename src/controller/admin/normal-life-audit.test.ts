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
            'trade_starter_offer',
            'trade_keepalive',
            'follow_listen_hold',
            'agent_keepalive',
            'hero_keepalive',
            'faction_landmark_recovery',
        ]);
        expect(report.trackedCauseCounts.agent_keepalive).toBe(0);
        expect(report.trackedCauseCounts.hero_keepalive).toBe(0);
        expect(report.trackedCauseCounts.faction_landmark_recovery).toBe(0);
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
                    'nervous:starter-gp-harvest': 0,
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
            action('2026-05-31T12:09:00.000Z', 'trade_request', 'trade_starter_offer', true, 430),
        ]);
        writeJsonl(path.join(logsRoot, 'res:qa-beta', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:00:00.000Z', 'say', 'idle_initiative', true, 100),
            action('2026-05-31T12:01:00.000Z', 'say', 'idle_initiative', true, 99),
            action('2026-05-31T12:02:00.000Z', 'say', 'nervous:request-attention', true, 98),
            action('2026-05-31T12:03:00.000Z', 'say', 'agent_keepalive', true, 97),
            action('2026-05-31T12:04:00.000Z', 'say', 'faction_landmark_recovery', true, 96),
            action('2026-05-31T12:05:00.000Z', 'say', 'hero_keepalive', true, 95),
            action('2026-05-31T12:06:00.000Z', 'say', 'trade_keepalive', true, 94),
            action('2026-05-31T12:07:00.000Z', 'say', 'follow_listen_hold', true, 93),
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

        expect(report.actionKindCounts).toEqual([['say', 8]]);
        expect(report.trackedActionCounts.city_exchange_ap_gp).toBe(1);
        expect(report.trackedActionCounts.trade_request).toBe(2);
        expect(report.trackedActionCounts.attack).toBe(1);
        expect(report.trackedActionCounts.eat).toBe(1);
        expect(report.trackedActionCounts.use_item_on).toBe(1);
        expect(report.trackedCauseCounts.low_health_heal_wait).toBe(1);
        expect(report.trackedCauseCounts.combat_resupply_food).toBe(1);
        expect(report.trackedCauseCounts.agent_keepalive).toBe(1);
        expect(report.trackedCauseCounts.hero_keepalive).toBe(1);
        expect(report.trackedCauseCounts.faction_landmark_recovery).toBe(1);
        expect(report.trackedCauseCounts.trade_starter_offer).toBe(1);
        expect(report.trackedCauseCounts.trade_keepalive).toBe(1);
        expect(report.trackedCauseCounts.follow_listen_hold).toBe(1);
        expect(report.trackedTimelineCounts.city_ap_gp_exchange).toBe(1);
        expect(report.trackedTimelineCounts.trade_completed).toBe(1);
        expect(report.trackedTimelineCounts.first_xp).toBe(1);
        expect(report.trackedTimelineCounts.death).toBe(1);
        expect(report.recurrenceSummary).toMatchObject({
            apGpExchangeActions: 1,
            apGpExchangeEvents: 1,
            tradeRequests: 2,
            tradeStarterOffers: 1,
            tradeKeepaliveActions: 1,
            followListenHolds: 1,
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
        expect(alpha?.trackedCauseCounts.trade_starter_offer).toBe(1);
        expect(alpha?.trackedTimelineCounts.trade_completed).toBe(1);
        expect(alpha?.actionAttempts).toBe(10);
        expect(alpha?.failedActionSubmissions).toBe(0);
        const beta = report.residentSlices.find(entry => entry.resident === 'res:qa-beta');
        expect(beta?.trackedCauseCounts.agent_keepalive).toBe(1);
        expect(beta?.trackedCauseCounts.hero_keepalive).toBe(1);
        expect(beta?.trackedCauseCounts.faction_landmark_recovery).toBe(1);
        expect(beta?.trackedCauseCounts.trade_keepalive).toBe(1);
        expect(beta?.trackedCauseCounts.follow_listen_hold).toBe(1);
    });

    it('attributes stuck churn to residents for targeted follow-up fixes', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-life-audit-stuck-'));
        const logsRoot = path.join(root, 'logs');
        const libraryRoot = path.join(root, 'library');
        fs.mkdirSync(logsRoot, { recursive: true });
        fs.mkdirSync(libraryRoot, { recursive: true });

        writeJsonl(path.join(logsRoot, 'res:qa-alpha', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:01:00.000Z', 'move_to', 'explore_patrol', true, 100),
        ]);
        writeJsonl(path.join(logsRoot, 'res:qa-beta', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:01:00.000Z', 'move_to', 'explore_patrol', true, 100),
        ]);

        writeJsonl(path.join(libraryRoot, 'res-qa-alpha', 'timeline.jsonl'), [
            timeline('2026-05-31T12:02:00.000Z', 'stuck_detected'),
            timeline('2026-05-31T12:03:00.000Z', 'stuck_recovered'),
            timeline('2026-05-31T12:04:00.000Z', 'stuck_detected'),
        ]);
        writeJsonl(path.join(libraryRoot, 'res-qa-beta', 'timeline.jsonl'), [
            timeline('2026-05-31T12:02:00.000Z', 'stuck_detected'),
            timeline('2026-05-31T12:03:00.000Z', 'stuck_recovered'),
        ]);

        const report = collectNormalLifeAudit({
            logsRoot,
            libraryRoot,
            windowStart: new Date('2026-05-31T12:00:00.000Z'),
            windowEnd: new Date('2026-05-31T13:00:00.000Z'),
            maxTopRows: 1,
        });

        expect(report.stuckSummary).toEqual({
            stuckDetected: 3,
            stuckRecovered: 2,
            unresolved: 1,
            topResidents: [{ resident: 'res:qa-alpha', stuckDetected: 2, stuckRecovered: 1, unresolved: 1, churn: 3 }],
        });
    });

    it('summarizes organic vs controlled AP/GP economy recurrence and GP runway', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-life-audit-economy-'));
        const logsRoot = path.join(root, 'logs');
        const libraryRoot = path.join(root, 'library');
        const economyEventsPath = path.join(root, 'city-integration', 'economy-events.jsonl');
        fs.mkdirSync(logsRoot, { recursive: true });
        fs.mkdirSync(libraryRoot, { recursive: true });

        writeJsonl(path.join(logsRoot, 'res:qa-alpha', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:01:00.000Z', 'say', 'nervous:request-attention', true, 250),
        ]);
        writeJsonl(path.join(logsRoot, 'res:qa-beta', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:01:00.000Z', 'say', 'idle_initiative', true, 600),
        ]);
        writeJsonl(path.join(logsRoot, 'res:qa-gamma', 'actions', '2026-05-31.jsonl'), [
            action('2026-05-31T12:01:00.000Z', 'say', 'nervous:request-attention', true, 200),
        ]);

        writeJsonl(economyEventsPath, [
            economy('2026-05-31T11:59:00.000Z', 'gp_observed', 'res:qa-gamma', {
                refId: 'inspect:res:qa-gamma',
                note: 'observed 200 GP in item 995',
            }),
            economy('2026-05-31T11:59:30.000Z', 'gp_observed', 'res:qa-beta', {
                refId: 'inspect:res:qa-beta-stale',
                note: 'observed 300 GP in item 995',
            }),
            economy('2026-05-31T11:59:45.000Z', 'ap_decay', 'res:qa-delta', {
                refId: 'admin_drain:res:qa-delta:2026-05-31T11:59:45.000Z',
                apDelta: -200,
            }),
            economy('2026-05-31T12:02:00.000Z', 'gp_observed', 'res:qa-alpha', {
                refId: 'inspect:res:qa-alpha',
                note: 'observed 100 GP in item 995',
            }),
            economy('2026-05-31T12:03:00.000Z', 'ap_decay', 'res:qa-alpha', {
                refId: 'admin_drain:res:qa-alpha:2026-05-31T12:03:00.000Z',
                apDelta: -300,
            }),
            economy('2026-05-31T12:03:30.000Z', 'ap_gp_exchange', 'res:qa-alpha', {
                cityUserId: 'resident:self',
                refId: 'apgp:res:qa-alpha:self-ap-gp:res:qa-alpha:42',
                apDelta: 100,
                gpDelta: -50,
            }),
            economy('2026-05-31T12:04:00.000Z', 'gp_observed', 'res:qa-beta', {
                refId: 'inspect:res:qa-beta',
                note: 'observed 75 GP in item 995',
            }),
            economy('2026-05-31T12:05:00.000Z', 'ap_gp_exchange', 'res:qa-beta', {
                cityUserId: 'resident:self',
                refId: 'apgp:res:qa-beta:self-ap-gp:res:qa-beta:77',
                apDelta: 50,
                gpDelta: -25,
            }),
            economy('2026-05-31T12:06:00.000Z', 'ap_gp_exchange', 'res:qa-gamma', {
                cityUserId: 'resident:self',
                refId: 'apgp:res:qa-gamma:manual-resident-self',
                apDelta: 40,
                gpDelta: -20,
            }),
            economy('2026-05-31T12:06:30.000Z', 'ap_gp_exchange', 'res:qa-delta', {
                cityUserId: 'resident:self',
                refId: 'apgp:res:qa-delta:self-ap-gp:res:qa-delta:88',
                apDelta: 40,
                gpDelta: -20,
            }),
            economy('2026-05-31T13:05:00.000Z', 'ap_gp_exchange', 'res:qa-late', {
                cityUserId: 'resident:self',
                refId: 'outside-window',
                apDelta: 50,
                gpDelta: -25,
            }),
        ]);

        const report = collectNormalLifeAudit({
            logsRoot,
            libraryRoot,
            economyEventsPath,
            windowStart: new Date('2026-05-31T12:00:00.000Z'),
            windowEnd: new Date('2026-05-31T13:00:00.000Z'),
            maxTopRows: 6,
        });

        expect(report.economySummary).toMatchObject({
            economyEventsInWindow: 7,
            apGpExchangeEvents: 4,
            selfInitiatedApGpExchangeEvents: 3,
            controlledApGpExchangeEvents: 2,
            organicSelfInitiatedApGpExchangeEvents: 1,
            adminDrainEvents: 2,
            attentionRunwayThresholdAp: 300,
            minimumExchangeGp: 10,
        });
        expect(report.economySummary.latestGpByResident).toEqual([
            { resident: 'res:qa-gamma', gp: 200, observedAt: '2026-05-31T11:59:00.000Z' },
            { resident: 'res:qa-alpha', gp: 100, observedAt: '2026-05-31T12:02:00.000Z' },
            { resident: 'res:qa-beta', gp: 75, observedAt: '2026-05-31T12:04:00.000Z' },
        ]);
        expect(report.economySummary.lowApWithGpResidents).toEqual([
            {
                resident: 'res:qa-gamma',
                apLast: 200,
                gp: 200,
                requestAttentionActions: 1,
                lastGpObservedAt: '2026-05-31T11:59:00.000Z',
            },
            {
                resident: 'res:qa-alpha',
                apLast: 250,
                gp: 100,
                requestAttentionActions: 1,
                lastGpObservedAt: '2026-05-31T12:02:00.000Z',
            },
        ]);
        expect(report.economySummary.requestAttentionWithGpResidents).toEqual([
            {
                resident: 'res:qa-gamma',
                apLast: 200,
                gp: 200,
                requestAttentionActions: 1,
                lastGpObservedAt: '2026-05-31T11:59:00.000Z',
            },
            {
                resident: 'res:qa-alpha',
                apLast: 250,
                gp: 100,
                requestAttentionActions: 1,
                lastGpObservedAt: '2026-05-31T12:02:00.000Z',
            },
        ]);
        expect(report.economySummary.aboveRunwayThresholdWithGpResidents).toEqual([
            {
                resident: 'res:qa-beta',
                apLast: 600,
                gp: 75,
                requestAttentionActions: 0,
                lastGpObservedAt: '2026-05-31T12:04:00.000Z',
            },
        ]);
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

function economy(ts: string, kind: string, residentName: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        id: `${kind}-${residentName}-${ts}`,
        ts,
        kind,
        residentName,
        ...extra,
    };
}

function writeJsonl(filePath: string, rows: unknown[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}
