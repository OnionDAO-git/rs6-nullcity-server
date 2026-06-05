import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { findTrajectoryReply } from './reply-capture';

let tmpDir: string;
const RESIDENT = 'res:test';
const SLUG = 'res-test';

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-capture-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTrajectory(lines: object[]): void {
    const trajDir = path.join(tmpDir, SLUG, 'evidence', 'trajectory');
    fs.mkdirSync(trajDir, { recursive: true });
    const filePath = path.join(trajDir, 'session-1.jsonl');
    fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    // Write a text pointer (not a symlink, to work in sandbox)
    fs.writeFileSync(path.join(trajDir, 'current'), 'session-1.jsonl');
}

describe('findTrajectoryReply', () => {
    it('returns null when no trajectory file exists', () => {
        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T00:00:00.000Z');
        expect(result).toBeNull();
    });

    it('returns null when no say entry exists after sinceTs', () => {
        writeTrajectory([{ kind: 'say', text: 'Hello!', ts: '2026-01-01T09:59:59.999Z' }]);
        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T10:00:00.000Z');
        expect(result).toBeNull();
    });

    it('returns null when say has empty text', () => {
        writeTrajectory([{ kind: 'say', text: '', ts: '2026-01-01T10:01:00.000Z' }]);
        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T10:00:00.000Z');
        expect(result).toBeNull();
    });

    it('returns the say text when found after sinceTs', () => {
        writeTrajectory([
            { kind: 'move_to', x: 3200, y: 3200, ts: '2026-01-01T10:00:01.000Z' },
            { kind: 'say', text: 'I found the Blue Moon Inn!', ts: '2026-01-01T10:00:05.000Z' },
        ]);
        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T10:00:00.000Z');
        expect(result).not.toBeNull();
        expect(result!.text).toBe('I found the Blue Moon Inn!');
        expect(result!.ts).toBe('2026-01-01T10:00:05.000Z');
    });

    it('returns the latest say when multiple exist after sinceTs', () => {
        writeTrajectory([
            { kind: 'say', text: 'First reply', ts: '2026-01-01T10:00:02.000Z' },
            { kind: 'say', text: 'Second reply', ts: '2026-01-01T10:00:08.000Z' },
        ]);
        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T10:00:00.000Z');
        expect(result!.text).toBe('Second reply');
        expect(result!.ts).toBe('2026-01-01T10:00:08.000Z');
    });

    it('ignores malformed lines without throwing', () => {
        const trajDir = path.join(tmpDir, SLUG, 'evidence', 'trajectory');
        fs.mkdirSync(trajDir, { recursive: true });
        const filePath = path.join(trajDir, 'session-1.jsonl');
        fs.writeFileSync(
            filePath,
            ['not-json', JSON.stringify({ kind: 'say', text: 'Good reply', ts: '2026-01-01T10:00:05.000Z' }), '{"broken":'].join('\n') +
                '\n',
        );
        fs.writeFileSync(path.join(trajDir, 'current'), 'session-1.jsonl');

        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T10:00:00.000Z');
        expect(result!.text).toBe('Good reply');
    });

    it('uses index.json when no current pointer exists', () => {
        const evidenceDir = path.join(tmpDir, SLUG, 'evidence');
        const trajDir = path.join(evidenceDir, 'trajectory');
        fs.mkdirSync(trajDir, { recursive: true });
        const sessionFile = path.join(evidenceDir, 'trajectory', 'session-a.jsonl');
        fs.writeFileSync(sessionFile, JSON.stringify({ kind: 'say', text: 'Via index', ts: '2026-01-01T10:00:06.000Z' }) + '\n');
        fs.writeFileSync(
            path.join(evidenceDir, 'index.json'),
            JSON.stringify({
                currentSessionId: 'sess-a',
                sessions: [{ sessionId: 'sess-a', trajectoryPath: 'trajectory/session-a.jsonl' }],
            }),
        );

        const result = findTrajectoryReply(tmpDir, RESIDENT, '2026-01-01T10:00:00.000Z');
        expect(result!.text).toBe('Via index');
    });
});
