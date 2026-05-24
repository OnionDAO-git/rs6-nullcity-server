import fs from 'fs';
import path from 'path';
import { isoDate } from '../util/clock';

export class InferenceLog {
    /**
     * @param root inference-log directory root (per-resident subdir created on demand).
     * @param includeEnvelope when true, every entry keeps its `envelope` field
     *   (full prompt + completion content). Use in dev / for narrow scoped
     *   audits. When false, envelope is stripped by default — see
     *   {@link samplePromptRate} for the gated production capture path.
     * @param samplePromptRate when `includeEnvelope=false` AND this is `>0`,
     *   call `sampler()` per append and keep the envelope when the sampler's
     *   return value is `< samplePromptRate`. Defaults to `0` (never sample),
     *   preserving the existing `includeEnvelope=false` strip behavior for
     *   callers that haven't opted in. Kept entries get an additional
     *   `envelopeSampled: true` marker so audit tooling can find them. See
     *   `docs/intelligence-verification-log.md` § E26 / HD-034 #1 for the
     *   motivation — E14/E15/E21 all hit "can't quote prompt".
     * @param sampler test-injectable RNG; defaults to `Math.random`. Return
     *   value is compared `< samplePromptRate`, so a sampler that returns
     *   `0` always keeps and one that returns `0.99` keeps only at rates
     *   above 0.99.
     */
    constructor(
        private readonly root: string,
        private readonly includeEnvelope: boolean,
        private readonly samplePromptRate: number = 0,
        private readonly sampler: () => number = Math.random,
    ) {}

    append(resident: string, entry: Record<string, unknown>): void {
        const dir = path.join(this.root, resident, 'inference');
        fs.mkdirSync(dir, { recursive: true });
        let safeEntry: Record<string, unknown>;
        if (this.includeEnvelope) {
            // Always-keep wins; sampler is not consulted.
            safeEntry = entry;
        } else if (this.samplePromptRate > 0 && this.sampler() < this.samplePromptRate) {
            // Sampled keep: preserve envelope AND mark the row so audit
            // tools can grep for `envelopeSampled` without rescanning all
            // rows. The marker is non-destructive — if the entry already
            // carries an `envelopeSampled` field for some reason, this
            // overwrites it deliberately.
            safeEntry = { ...entry, envelopeSampled: true };
        } else {
            safeEntry = { ...entry, envelope: undefined };
        }
        fs.appendFileSync(path.join(dir, `${isoDate()}.jsonl`), `${JSON.stringify({ t: new Date().toISOString(), ...safeEntry })}\n`);
    }
}
