import fs from 'fs';
import path from 'path';
import type { InferenceHealthResult } from '../llm/inference-health';

/**
 * Resident Observatory — health-probe timer (Phase 1, component 2).
 *
 * Runs the existing `runInferenceHealthProbe` on a schedule and writes the
 * latest result to `<memory.dir>/inference-health.json`. This is the
 * cadence-independent outage detector: a 400-on-every-call (tonight's failure)
 * turns the probe red within one interval (~10s), regardless of how rarely any
 * resident's brain fires. The CLI + dashboard read this file.
 *
 * Best-effort and self-protecting: a probe rejection or a disk write failure is
 * routed to `onError` and never throws — the timer must not be able to crash the
 * controller it observes. The file write is atomic (tmp + rename).
 */

export interface HealthProbeTimerOptions {
    outputPath: string;
    intervalMs?: number;
    probe: () => Promise<InferenceHealthResult>;
    /** Injectable for tests; defaults to an atomic file write. */
    writeFile?: (filePath: string, data: string) => void;
    onError?: (error: unknown) => void;
}

export interface HealthProbeTimer {
    runOnce: () => Promise<void>;
    start: () => void;
    stop: () => void;
}

const DEFAULT_INTERVAL_MS = 10_000;

export function createHealthProbeTimer(options: HealthProbeTimerOptions): HealthProbeTimer {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const writeFile = options.writeFile ?? atomicWriteFile;
    const onError = options.onError ?? (() => undefined);
    let handle: ReturnType<typeof setInterval> | undefined;

    const runOnce = async (): Promise<void> => {
        try {
            const result = await options.probe();
            const payload = { ...result, generatedAt: new Date().toISOString() };
            writeFile(options.outputPath, JSON.stringify(payload, null, 2) + '\n');
        } catch (error) {
            onError(error);
        }
    };

    return {
        runOnce,
        start: () => {
            if (handle) return;
            void runOnce();
            handle = setInterval(() => void runOnce(), intervalMs);
            // Do not keep the event loop alive solely for the probe timer.
            if (typeof handle.unref === 'function') handle.unref();
        },
        stop: () => {
            if (handle) {
                clearInterval(handle);
                handle = undefined;
            }
        },
    };
}

function atomicWriteFile(filePath: string, data: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
}
