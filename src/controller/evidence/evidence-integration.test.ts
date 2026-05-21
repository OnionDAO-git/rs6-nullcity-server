import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Perception } from '../transport/message-codecs';
import { EvidenceStore } from './evidence-store';
import { MockPerceptionAdapter } from './mock-perception';
import { ProgressTracker, type ProgressSnapshot } from './progress-tracker';
import { EVIDENCE_SCHEMA_VERSION } from './schemas';
import { TrajectoryBuilder } from './trajectory-builder';

describe('Evidence Layer integration', () => {
    it('writes trajectory and progress JSONL from scripted perceptions', () => {
        const store = new EvidenceStore('res:agent', fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-integration-')), {
            now: () => new Date('2026-05-21T09:00:00.000Z'),
        });
        const session = store.beginSession('session-a', 'soul-v1');
        const builder = new TrajectoryBuilder(store, { now: () => new Date('2026-05-21T09:00:01.000Z') });
        const progress = new ProgressTracker({ stuckThresholdTicks: 3 });
        const adapter = new MockPerceptionAdapter();
        adapter.push(perception(1, 3200, 3200, 0, 10));
        adapter.push(perception(2, 3201, 3200, 25, 11));

        for (const next of adapter.drain()) {
            const tick = next.tick || 0;
            builder.beginTick(tick, next);
            const delta = progress.observe(snapshotFrom(next));
            store.appendProgress({
                schemaVersion: EVIDENCE_SCHEMA_VERSION,
                ts: '2026-05-21T09:00:01.000Z',
                tick,
                sessionId: session.sessionId,
                kind: 'progress',
                meaningful: delta.meaningful,
                reasons: delta.reasons,
                stuckSince: delta.stuckSince,
            });
            builder.endTick('tick_complete');
        }

        expect(readJsonl(session.trajectoryPath).map((line: { kind: string }) => line.kind)).toEqual([
            'begin_tick',
            'end_tick',
            'begin_tick',
            'end_tick',
        ]);
        expect(readJsonl(session.progressPath)).toEqual([
            expect.objectContaining({ tick: 1, meaningful: true, reasons: ['initial_sample'] }),
            expect.objectContaining({
                tick: 2,
                meaningful: true,
                reasons: ['xp_gain:woodcutting:25', 'inventory:+1', 'position_changed'],
            }),
        ]);
    });
});

function perception(tick: number, x: number, y: number, woodcuttingXp: number, inventoryCount: number): Perception {
    return {
        tick,
        resident: {
            position: { x, y, level: 0 },
            inventory: Array.from({ length: inventoryCount }, (_, index) => ({ itemId: 1511, key: `slot-${index}`, amount: 1 })),
            skills: { woodcutting: { xp: woodcuttingXp } },
            hitpoints: { current: 10 },
        },
    };
}

function snapshotFrom(perception: Perception): ProgressSnapshot {
    const resident = perception.resident as {
        position?: { x: number; y: number; level?: number };
        inventory?: unknown[];
        skills?: Record<string, { xp?: number }>;
        hitpoints?: { current?: number };
    };
    const position = resident.position || { x: 0, y: 0, level: 0 };
    return {
        tick: perception.tick || 0,
        xpBySkill: Object.fromEntries(Object.entries(resident.skills || {}).map(([skill, value]) => [skill, value.xp || 0])),
        inventoryCount: resident.inventory?.length || 0,
        positionHash: `${position.x},${position.y},${position.level || 0}`,
        hp: resident.hitpoints?.current || 0,
    };
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
    return fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
