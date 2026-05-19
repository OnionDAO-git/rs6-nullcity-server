import fs from 'fs';
import path from 'path';
import { isoDate } from '../util/clock';

export class InferenceLog {
    constructor(
        private readonly root: string,
        private readonly includeEnvelope: boolean,
    ) {}

    append(resident: string, entry: Record<string, unknown>): void {
        const dir = path.join(this.root, resident, 'inference');
        fs.mkdirSync(dir, { recursive: true });
        const safeEntry = this.includeEnvelope ? entry : { ...entry, envelope: undefined };
        fs.appendFileSync(path.join(dir, `${isoDate()}.jsonl`), `${JSON.stringify({ t: new Date().toISOString(), ...safeEntry })}\n`);
    }
}
