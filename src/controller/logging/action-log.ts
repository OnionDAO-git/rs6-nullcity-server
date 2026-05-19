import fs from 'fs';
import path from 'path';
import { isoDate } from '../util/clock';

export class ActionLog {
    constructor(private readonly root: string) {}

    append(resident: string, entry: unknown): void {
        const dir = path.join(this.root, resident, 'actions');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${isoDate()}.jsonl`), `${JSON.stringify({ t: new Date().toISOString(), ...asRecord(entry) })}\n`);
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}
