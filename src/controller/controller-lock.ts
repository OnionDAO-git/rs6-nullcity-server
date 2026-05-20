import fs from 'fs';
import path from 'path';

export interface ControllerLockOptions {
    lockDir: string;
    controllerId: string;
    pid?: number;
    isProcessAlive?: (pid: number) => boolean;
}

export interface ControllerLock {
    path: string;
    release(): void;
}

interface ControllerLockFile {
    controllerId: string;
    pid: number;
    cwd: string;
    acquiredAt: string;
}

export function acquireControllerLock(options: ControllerLockOptions): ControllerLock {
    const pid = options.pid ?? process.pid;
    const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
    const lockPath = path.join(options.lockDir, `${sanitizeLockName(options.controllerId)}.lock`);
    const contents = JSON.stringify(
        {
            controllerId: options.controllerId,
            pid,
            cwd: process.cwd(),
            acquiredAt: new Date().toISOString(),
        } satisfies ControllerLockFile,
        null,
        2,
    );

    fs.mkdirSync(options.lockDir, { recursive: true });
    writeLock(lockPath, contents, isProcessAlive);

    let released = false;
    return {
        path: lockPath,
        release() {
            if (released) {
                return;
            }
            released = true;
            releaseLock(lockPath, options.controllerId, pid);
        },
    };
}

function writeLock(lockPath: string, contents: string, isProcessAlive: (pid: number) => boolean): void {
    try {
        fs.writeFileSync(lockPath, contents, { flag: 'wx' });
        return;
    } catch (error) {
        if (!isErrno(error) || error.code !== 'EEXIST') {
            throw error;
        }
    }

    const existing = readLock(lockPath);
    if (existing?.pid && isProcessAlive(existing.pid)) {
        throw new Error(`controller lock already held by pid ${existing.pid}: ${lockPath}`);
    }

    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(lockPath, contents, { flag: 'wx' });
}

function releaseLock(lockPath: string, controllerId: string, pid: number): void {
    const existing = readLock(lockPath);
    if (!existing || existing.controllerId !== controllerId || existing.pid !== pid) {
        return;
    }

    fs.rmSync(lockPath, { force: true });
}

function readLock(lockPath: string): Partial<ControllerLockFile> | undefined {
    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as unknown;
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function defaultIsProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return isErrno(error) && error.code === 'EPERM';
    }
}

function sanitizeLockName(value: string): string {
    return value.replace(/[^a-z0-9._-]+/gi, '_') || 'controller';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
    return isRecord(error) && typeof error.code === 'string';
}
