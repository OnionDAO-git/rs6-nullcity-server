import type { InferenceHealthResult } from '../llm/inference-health';
import { createHealthProbeTimer } from './health-probe-timer';

describe('createHealthProbeTimer', () => {
    it('writes the probe result as JSON to the output path on runOnce', async () => {
        const result: InferenceHealthResult = { ok: true, status: 'ok', endpoint: 'default', model: 'm', latencyMs: 10 };
        const writes: Array<{ path: string; data: string }> = [];
        const timer = createHealthProbeTimer({
            outputPath: '/tmp/x/inference-health.json',
            probe: async () => result,
            writeFile: (path, data) => writes.push({ path, data }),
        });
        await timer.runOnce();
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe('/tmp/x/inference-health.json');
        const parsed = JSON.parse(writes[0].data);
        expect(parsed.status).toBe('ok');
        expect(parsed.endpoint).toBe('default');
    });

    it('never throws when the probe rejects; routes the error to onError and writes nothing', async () => {
        const errors: unknown[] = [];
        const writes: unknown[] = [];
        const timer = createHealthProbeTimer({
            outputPath: '/tmp/x/inference-health.json',
            probe: async () => {
                throw new Error('probe blew up');
            },
            writeFile: () => writes.push(1),
            onError: e => errors.push(e),
        });
        await expect(timer.runOnce()).resolves.toBeUndefined();
        expect(errors).toHaveLength(1);
        expect(writes).toHaveLength(0);
    });

    it('never throws when writeFile fails', async () => {
        const errors: unknown[] = [];
        const timer = createHealthProbeTimer({
            outputPath: '/tmp/x/inference-health.json',
            probe: async () => ({ ok: true, status: 'ok', endpoint: 'default' }),
            writeFile: () => {
                throw new Error('disk full');
            },
            onError: e => errors.push(e),
        });
        await expect(timer.runOnce()).resolves.toBeUndefined();
        expect(errors).toHaveLength(1);
    });
});
