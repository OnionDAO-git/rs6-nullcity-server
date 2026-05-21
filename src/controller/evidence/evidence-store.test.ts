import fs from 'fs';
import os from 'os';
import path from 'path';
import { EvidenceStore } from './evidence-store';
import { EVIDENCE_SCHEMA_VERSION, type ProgressLine, type TrajectoryLine } from './schemas';

describe('EvidenceStore', () => {
    it('starts a resident evidence session and appends validated JSONL', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-'));
        const store = new EvidenceStore('res:agent', root, { now: fixedNow });

        const session = store.beginSession('session-1', 'soul-v1');
        const trajectory: TrajectoryLine = {
            schemaVersion: EVIDENCE_SCHEMA_VERSION,
            ts: fixedNow().toISOString(),
            tick: 1,
            sessionId: 'session-1',
            kind: 'begin_tick',
            perceptionHash: 'abc123',
        };
        const progress: ProgressLine = {
            schemaVersion: EVIDENCE_SCHEMA_VERSION,
            ts: fixedNow().toISOString(),
            tick: 1,
            sessionId: 'session-1',
            kind: 'progress',
            meaningful: true,
            reasons: ['initial_sample'],
            stuckSince: null,
        };

        store.appendTrajectory(trajectory);
        store.appendProgress(progress);

        expect(readJsonl(session.trajectoryPath)).toEqual([trajectory]);
        expect(readJsonl(session.progressPath)).toEqual([progress]);
        expect(fs.existsSync(path.join(root, 'res-agent', 'evidence', 'trajectory', 'current'))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'res-agent', 'evidence', 'index.json'), 'utf8'))).toMatchObject({
            resident: 'res:agent',
            currentSessionId: 'session-1',
            sessions: [
                expect.objectContaining({
                    sessionId: 'session-1',
                    soulVersion: 'soul-v1',
                    status: 'active',
                }),
            ],
        });
    });

    it('rejects malformed trajectory lines before writing', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-invalid-'));
        const store = new EvidenceStore('res:agent', root, { now: fixedNow });
        const session = store.beginSession('session-1', 'soul-v1');

        expect(() =>
            store.appendTrajectory({
                schemaVersion: EVIDENCE_SCHEMA_VERSION,
                ts: fixedNow().toISOString(),
                tick: 1,
                sessionId: 'session-1',
                kind: 'not-real',
            } as unknown as TrajectoryLine),
        ).toThrow();
        expect(fs.readFileSync(session.trajectoryPath, 'utf8')).toBe('');
    });

    it('rotates older session files out of the resident evidence index', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-rotation-'));
        const store = new EvidenceStore('res:agent', root, { maxSessions: 1, now: fixedNow });
        const first = store.beginSession('session-1', 'soul-v1');
        store.endSession('session-1', 'shutdown');

        const second = store.beginSession('session-2', 'soul-v1');

        const index = JSON.parse(fs.readFileSync(path.join(root, 'res-agent', 'evidence', 'index.json'), 'utf8'));
        expect(index.sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual(['session-2']);
        expect(fs.existsSync(first.trajectoryPath)).toBe(false);
        expect(fs.existsSync(first.progressPath)).toBe(false);
        expect(fs.existsSync(second.trajectoryPath)).toBe(true);
    });
});

function fixedNow(): Date {
    return new Date('2026-05-21T08:00:00.000Z');
}

function readJsonl(filePath: string): unknown[] {
    return fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
