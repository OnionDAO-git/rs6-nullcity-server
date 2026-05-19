import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class ActionLog {
    public constructor(private readonly rootDir: string = 'data/agent-logs') {}

    public append(residentName: string, entry: Record<string, unknown>): void {
        const day = new Date().toISOString().slice(0, 10);
        const dir = join(this.rootDir, residentName.toLowerCase());
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
    }
}
