import fs from 'fs';
import path from 'path';
import type { Perception, PerceptionEvent } from '../transport/message-codecs';
import { isoDate } from '../util/clock';

export type ControllerEvent = { kind: string; t: string; [key: string]: unknown };

export class PerceptionHistory {
    private readonly items: Array<Perception | PerceptionEvent | ControllerEvent> = [];

    constructor(
        private readonly maxItems = 80,
        private readonly jsonlDir?: string,
    ) {}

    push(item: Perception | PerceptionEvent | ControllerEvent): void {
        this.items.push(item);
        while (this.items.length > this.maxItems) {
            this.items.shift();
        }

        if (this.jsonlDir) {
            fs.mkdirSync(this.jsonlDir, { recursive: true });
            fs.appendFileSync(path.join(this.jsonlDir, `${isoDate()}.jsonl`), `${JSON.stringify(item)}\n`);
        }
    }

    recent(): Array<Perception | PerceptionEvent | ControllerEvent> {
        return [...this.items];
    }
}
