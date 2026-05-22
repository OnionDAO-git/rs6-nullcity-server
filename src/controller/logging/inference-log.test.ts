import fs from 'fs';
import os from 'os';
import path from 'path';
import { InferenceLog } from './inference-log';

function readJsonl(filePath: string): unknown[] {
    return fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function findInferenceFile(root: string, resident: string): string {
    const dir = path.join(root, resident, 'inference');
    const files = fs.readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    return path.join(dir, files[0]);
}

describe('InferenceLog', () => {
    it('persists promptHash and completionHash fields when present in the entry', () => {
        const root = tmpDir('inflog-');
        const log = new InferenceLog(root, false);

        log.append('res:agent', {
            moduleId: 'onion.runescape.standard',
            moduleVersion: '0.1.0',
            promptHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            completionHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        });

        const lines = readJsonl(findInferenceFile(root, 'res:agent'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
            moduleId: 'onion.runescape.standard',
            promptHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            completionHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        });
    });

    it('strips envelope when includeEnvelope=false', () => {
        const root = tmpDir('inflog-');
        const log = new InferenceLog(root, false);

        log.append('res:agent', { moduleId: 'm', envelope: { secret: 'do-not-persist' }, completionTokens: 10 });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(lines[0]).toMatchObject({ moduleId: 'm', completionTokens: 10 });
        expect(lines[0].envelope).toBeUndefined();
    });

    it('preserves envelope when includeEnvelope=true', () => {
        const root = tmpDir('inflog-');
        const log = new InferenceLog(root, true);

        log.append('res:agent', { moduleId: 'm', envelope: { redactedDemoOnly: 'safe-payload' } });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(lines[0]).toMatchObject({ moduleId: 'm', envelope: { redactedDemoOnly: 'safe-payload' } });
    });

    it('always writes a top-level ISO timestamp `t`', () => {
        const root = tmpDir('inflog-');
        const log = new InferenceLog(root, false);

        log.append('res:agent', { moduleId: 'm' });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(typeof lines[0].t).toBe('string');
        expect(() => new Date(lines[0].t as string).toISOString()).not.toThrow();
    });
});
