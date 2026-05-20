import fs from 'fs';
import os from 'os';
import path from 'path';
import { acquireControllerLock } from './controller-lock';

describe('controller process lock', () => {
    it('creates and releases a controller-id lock file', () => {
        const dir = tempDir();
        const lock = acquireControllerLock({ lockDir: dir, controllerId: 'nullcity-controller', pid: 123 });

        expect(fs.existsSync(path.join(dir, 'nullcity-controller.lock'))).toBe(true);

        lock.release();

        expect(fs.existsSync(path.join(dir, 'nullcity-controller.lock'))).toBe(false);
    });

    it('rejects a second live controller with the same id', () => {
        const dir = tempDir();
        const first = acquireControllerLock({ lockDir: dir, controllerId: 'nullcity-controller', pid: 123, isProcessAlive: () => true });

        expect(() => acquireControllerLock({ lockDir: dir, controllerId: 'nullcity-controller', pid: 456, isProcessAlive: () => true })).toThrow(
            /controller lock already held by pid 123/,
        );

        first.release();
    });

    it('replaces stale lock files when the recorded pid is gone', () => {
        const dir = tempDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'nullcity-controller.lock'), JSON.stringify({ controllerId: 'nullcity-controller', pid: 123 }));

        const lock = acquireControllerLock({ lockDir: dir, controllerId: 'nullcity-controller', pid: 456, isProcessAlive: () => false });

        expect(JSON.parse(fs.readFileSync(path.join(dir, 'nullcity-controller.lock'), 'utf8')).pid).toBe(456);

        lock.release();
    });
});

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-controller-lock-'));
}
