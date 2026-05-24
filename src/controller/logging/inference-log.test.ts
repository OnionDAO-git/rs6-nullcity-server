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

    // E26 / HD-034 fix #1: gated sample of prompt body so future audits
    // (E14/E15/E21 all hit "can't quote prompt") have real prompt content
    // to inspect at a controllable rate. Production passes
    // includeEnvelope=false (default) + samplePromptRate=0.01 (~1/100
    // calls keep their envelope); dev keeps includeEnvelope=true (always).
    it('keeps envelope when sampleFn fires even though includeEnvelope=false (HD-034 #1)', () => {
        const root = tmpDir('inflog-');
        // Deterministic sampler that always fires (rate effectively 1.0).
        const log = new InferenceLog(root, false, 1.0, () => 0);

        log.append('res:agent', { moduleId: 'm', envelope: { messages: [{ role: 'user', content: 'hello' }] } });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(lines[0]).toMatchObject({
            moduleId: 'm',
            envelope: { messages: [{ role: 'user', content: 'hello' }] },
            envelopeSampled: true,
        });
    });

    it('strips envelope when sampleFn does NOT fire (HD-034 #1 — under-rate path)', () => {
        const root = tmpDir('inflog-');
        // Deterministic sampler that NEVER fires (rate vs 1.0 always exceeds).
        const log = new InferenceLog(root, false, 0.5, () => 0.99);

        log.append('res:agent', { moduleId: 'm', envelope: { secret: 'not-kept' }, completionTokens: 5 });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(lines[0]).toMatchObject({ moduleId: 'm', completionTokens: 5 });
        expect(lines[0].envelope).toBeUndefined();
        expect(lines[0].envelopeSampled).toBeUndefined();
    });

    it('does not sample when samplePromptRate is 0 or omitted (default behavior preserved)', () => {
        const root = tmpDir('inflog-');
        // Explicit rate 0; sampler would fire if checked, but should not be checked.
        const sampler = jest.fn(() => 0);
        const log = new InferenceLog(root, false, 0, sampler);

        log.append('res:agent', { moduleId: 'm', envelope: { secret: 'should-strip' } });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(lines[0].envelope).toBeUndefined();
        expect(sampler).not.toHaveBeenCalled();
    });

    it('does not sample when includeEnvelope=true (always-keep wins, sampler not consulted)', () => {
        const root = tmpDir('inflog-');
        const sampler = jest.fn(() => 0.99);
        const log = new InferenceLog(root, true, 0.5, sampler);

        log.append('res:agent', { moduleId: 'm', envelope: { content: 'kept' } });

        const lines = readJsonl(findInferenceFile(root, 'res:agent')) as Array<Record<string, unknown>>;
        expect(lines[0]).toMatchObject({ moduleId: 'm', envelope: { content: 'kept' } });
        expect(lines[0].envelopeSampled).toBeUndefined();
        expect(sampler).not.toHaveBeenCalled();
    });
});
