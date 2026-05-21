import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';
import {
    EVIDENCE_SCHEMA_VERSION,
    type EvidenceIndex,
    type EvidenceSessionIndexEntry,
    type ProgressLine,
    type TrajectoryLine,
    evidenceIndexSchema,
    progressLineSchema,
    trajectoryLineSchema,
} from './schemas';

export type EvidenceEndReason = 'shutdown' | 'crash' | 'logout';

export interface EvidenceSessionHandle {
    sessionId: string;
    trajectoryPath: string;
    progressPath: string;
}

export interface EvidenceStoreOptions {
    maxSessions?: number;
    now?: () => Date;
}

export class EvidenceStore {
    private active?: EvidenceSessionHandle;
    private readonly maxSessions: number;
    private readonly now: () => Date;

    constructor(
        private readonly residentName: string,
        private readonly root: string,
        options: EvidenceStoreOptions = {},
    ) {
        this.maxSessions = options.maxSessions ?? 8;
        this.now = options.now ?? (() => new Date());
    }

    beginSession(sessionId: string, soulVersion: string): EvidenceSessionHandle {
        const base = this.baseDir();
        fs.mkdirSync(this.trajectoryDir(), { recursive: true });
        fs.mkdirSync(this.progressDir(), { recursive: true });

        const startedAt = this.now().toISOString();
        const fileStem = `${compactTimestamp(startedAt)}-${safeFileSegment(sessionId)}.jsonl`;
        const handle = {
            sessionId,
            trajectoryPath: path.join(this.trajectoryDir(), fileStem),
            progressPath: path.join(this.progressDir(), fileStem),
        };

        fs.closeSync(fs.openSync(handle.trajectoryPath, 'a'));
        fs.closeSync(fs.openSync(handle.progressPath, 'a'));
        linkCurrent(this.trajectoryDir(), handle.trajectoryPath);
        linkCurrent(this.progressDir(), handle.progressPath);

        const index = this.readIndex();
        const sessions = index.sessions.filter(session => session.sessionId !== sessionId);
        sessions.push({
            sessionId,
            soulVersion,
            startedAt,
            trajectoryPath: path.relative(base, handle.trajectoryPath),
            progressPath: path.relative(base, handle.progressPath),
            status: 'active',
        });
        const nextIndex = this.rotateIndex({
            schemaVersion: EVIDENCE_SCHEMA_VERSION,
            resident: this.residentName,
            currentSessionId: sessionId,
            sessions,
        });
        this.writeIndex(nextIndex);
        this.active = handle;
        return handle;
    }

    endSession(sessionId: string, reason: EvidenceEndReason): void {
        const index = this.readIndex();
        const endedAt = this.now().toISOString();
        const sessions = index.sessions.map(session =>
            session.sessionId === sessionId
                ? {
                      ...session,
                      endedAt,
                      endReason: reason,
                      status: 'ended' as const,
                  }
                : session,
        );
        this.writeIndex({
            ...index,
            currentSessionId: index.currentSessionId === sessionId ? undefined : index.currentSessionId,
            sessions,
        });
        if (this.active?.sessionId === sessionId) {
            this.active = undefined;
        }
    }

    appendTrajectory(line: TrajectoryLine): void {
        const active = this.requireActive(line.sessionId);
        const parsed = trajectoryLineSchema.parse(line);
        fs.appendFileSync(active.trajectoryPath, `${JSON.stringify(parsed)}\n`);
    }

    appendProgress(line: ProgressLine): void {
        const active = this.requireActive(line.sessionId);
        const parsed = progressLineSchema.parse(line);
        fs.appendFileSync(active.progressPath, `${JSON.stringify(parsed)}\n`);
    }

    rotate(): void {
        this.writeIndex(this.rotateIndex(this.readIndex()));
    }

    currentSession(): EvidenceSessionHandle | undefined {
        return this.active;
    }

    private requireActive(sessionId: string): EvidenceSessionHandle {
        if (!this.active) {
            throw new Error('Evidence session has not started');
        }
        if (this.active.sessionId !== sessionId) {
            throw new Error(`Evidence line session ${sessionId} does not match active session ${this.active.sessionId}`);
        }
        return this.active;
    }

    private rotateIndex(index: EvidenceIndex): EvidenceIndex {
        if (index.sessions.length <= this.maxSessions) {
            return index;
        }
        const keep = index.sessions.slice(-this.maxSessions);
        const remove = index.sessions.slice(0, -this.maxSessions);
        for (const session of remove) {
            this.removeSessionFiles(session);
        }
        return { ...index, sessions: keep };
    }

    private removeSessionFiles(session: EvidenceSessionIndexEntry): void {
        for (const relativePath of [session.trajectoryPath, session.progressPath]) {
            const absolutePath = path.join(this.baseDir(), relativePath);
            fs.rmSync(absolutePath, { force: true });
        }
    }

    private readIndex(): EvidenceIndex {
        const indexPath = this.indexPath();
        if (!fs.existsSync(indexPath)) {
            return { schemaVersion: EVIDENCE_SCHEMA_VERSION, resident: this.residentName, sessions: [] };
        }
        return evidenceIndexSchema.parse(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
    }

    private writeIndex(index: EvidenceIndex): void {
        fs.mkdirSync(this.baseDir(), { recursive: true });
        fs.writeFileSync(this.indexPath(), `${JSON.stringify(evidenceIndexSchema.parse(index), null, 2)}\n`);
    }

    private baseDir(): string {
        return path.join(this.root, residentSlug(this.residentName), 'evidence');
    }

    private trajectoryDir(): string {
        return path.join(this.baseDir(), 'trajectory');
    }

    private progressDir(): string {
        return path.join(this.baseDir(), 'progress');
    }

    private indexPath(): string {
        return path.join(this.baseDir(), 'index.json');
    }
}

function linkCurrent(dir: string, targetPath: string): void {
    const currentPath = path.join(dir, 'current');
    fs.rmSync(currentPath, { force: true });
    try {
        fs.symlinkSync(path.basename(targetPath), currentPath);
    } catch {
        fs.writeFileSync(currentPath, path.basename(targetPath));
    }
}

function compactTimestamp(iso: string): string {
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function safeFileSegment(value: string): string {
    return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-|-$/g, '') || 'session';
}
