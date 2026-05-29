import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface CityIntegrationRecord<TResult = unknown> {
    schemaVersion: 1;
    command: string;
    idempotencyKey: string;
    payloadHash: string;
    status: 'completed';
    createdAt: string;
    completedAt: string;
    result: TResult;
}

export interface CityIntegrationAuditEntry {
    schemaVersion: 1;
    ts: string;
    command: string;
    idempotencyKey?: string;
    resident?: string;
    status: string;
    payloadHash?: string;
    result?: unknown;
    error?: unknown;
}

export class CityIntegrationStore {
    constructor(private readonly memoryRoot: string) {}

    read<TResult>(command: string, idempotencyKey: string): CityIntegrationRecord<TResult> | undefined {
        const filePath = this.recordPath(command, idempotencyKey);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CityIntegrationRecord<TResult>;
    }

    write<TResult>(record: CityIntegrationRecord<TResult>): void {
        const filePath = this.recordPath(record.command, record.idempotencyKey);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`);
        fs.renameSync(tmpPath, filePath);
    }

    appendAudit(entry: CityIntegrationAuditEntry): void {
        const filePath = path.join(this.root(), 'audit.jsonl');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
    }

    payloadHash(payload: unknown): string {
        return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
    }

    private recordPath(command: string, idempotencyKey: string): string {
        const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
        return path.join(this.root(), 'idempotency', safeSegment(command), `${digest}.json`);
    }

    private root(): string {
        return path.join(this.memoryRoot, 'city-integration');
    }
}

function safeSegment(value: string): string {
    return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'command';
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
