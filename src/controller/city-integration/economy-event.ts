import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

/**
 * EconomyEvent (P0 economy contract).
 *
 * A single normalized, flat event shape covering every economic moment in
 * Null City: AP movement, GP observation/earning/trading, AP-for-GP exchange,
 * and NCRI sale/redemption. Each subsystem (ApLedger, ApGpExchangeStore,
 * NcriRegistry, GP observation) emits a normalized EconomyEvent into one
 * append-only log. CityEventDigest reads this log to build the grounded
 * evidence packet the (gated) Storyteller will later narrate.
 *
 * Flat-on-purpose: a digest aggregator wants `apDelta`/`gpDelta`/`residentName`
 * uniformly across kinds rather than a deep per-kind union. `refId` links back
 * to the authoritative source record (exchange id, NCRI id, ledger entry).
 */
export const ECONOMY_EVENT_KINDS = [
    'ap_decay',
    'ap_grant',
    'ap_topup',
    'ap_fade',
    'gp_observed',
    'gp_earned',
    'gp_traded',
    'ap_gp_exchange',
    'ncri_sale',
    'ncri_redemption',
    'ncri_gift',
    'ncri_admin_transfer',
] as const;

export type EconomyEventKind = (typeof ECONOMY_EVENT_KINDS)[number];

export interface EconomyEvent {
    schemaVersion: 1;
    id: string;
    ts: string;
    kind: EconomyEventKind;
    /** Resident this event is about, if any (res:<slug>). */
    residentName?: string;
    /** Human/city user involved, if any. */
    cityUserId?: string;
    /** Signed AP change (Null City ledger units). */
    apDelta?: number;
    /** Signed GP change (real RuneScape gold). */
    gpDelta?: number;
    /** NCRI id for ncri_* kinds. */
    ncriId?: string;
    /** Link back to the authoritative source record (exchange id, ledger entry, etc.). */
    refId?: string;
    /** Short human-readable summary for digests/narration. */
    note?: string;
}

/** Input to {@link EconomyEventLog.append}; `id` + `ts` are assigned by the log. */
export type EconomyEventInput = Omit<EconomyEvent, 'schemaVersion' | 'id' | 'ts'> & { ts?: string };

const economyEventSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    ts: z.string().min(1),
    kind: z.enum(ECONOMY_EVENT_KINDS),
    residentName: z
        .string()
        .regex(/^res:[a-z0-9_-]{1,20}$/, 'must match res:<slug>')
        .optional(),
    cityUserId: z.string().min(1).optional(),
    apDelta: z.number().finite().optional(),
    gpDelta: z.number().finite().optional(),
    ncriId: z.string().min(1).optional(),
    refId: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
});

const economyEventInputSchema = economyEventSchema.omit({ schemaVersion: true, id: true, ts: true }).extend({
    ts: z.string().min(1).optional(),
});

/**
 * Max bytes per JSONL append line. Keeping each write <= PIPE_BUF helps preserve
 * per-line atomicity assumptions when multiple processes append concurrently.
 */
const ECONOMY_EVENT_ATOMIC_APPEND_MAX_BYTES = 4096;

export interface EconomyEventFilter {
    residentName?: string;
    cityUserId?: string;
    kind?: EconomyEventKind;
    /** Inclusive lower bound on `ts` (ISO string compare). */
    sinceTs?: string;
}

/**
 * Append-only, file-backed economy event log (JSONL). Append is the only
 * mutation; reads are resilient (malformed lines skipped). One file per city
 * instance under `<memoryRoot>/city-integration/economy-events.jsonl`.
 */
export class EconomyEventLog {
    constructor(
        private readonly memoryRoot: string,
        private readonly now: () => Date = () => new Date(),
    ) {}

    append(input: EconomyEventInput): EconomyEvent {
        const parsedInput = economyEventInputSchema.parse(input);
        const event: EconomyEvent = {
            schemaVersion: 1,
            id: crypto.randomUUID(),
            ts: parsedInput.ts ?? this.now().toISOString(),
            kind: parsedInput.kind,
            ...(parsedInput.residentName !== undefined ? { residentName: parsedInput.residentName } : {}),
            ...(parsedInput.cityUserId !== undefined ? { cityUserId: parsedInput.cityUserId } : {}),
            ...(parsedInput.apDelta !== undefined ? { apDelta: parsedInput.apDelta } : {}),
            ...(parsedInput.gpDelta !== undefined ? { gpDelta: parsedInput.gpDelta } : {}),
            ...(parsedInput.ncriId !== undefined ? { ncriId: parsedInput.ncriId } : {}),
            ...(parsedInput.refId !== undefined ? { refId: parsedInput.refId } : {}),
            ...(parsedInput.note !== undefined ? { note: parsedInput.note } : {}),
        };
        const validated = economyEventSchema.parse(event);
        const filePath = this.logPath();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const line = `${JSON.stringify(validated)}\n`;
        const lineBytes = Buffer.byteLength(line, 'utf8');
        if (lineBytes > ECONOMY_EVENT_ATOMIC_APPEND_MAX_BYTES) {
            throw new Error(`economy_event_atomic_append_exceeded: ${lineBytes} > ${ECONOMY_EVENT_ATOMIC_APPEND_MAX_BYTES}`);
        }
        fs.appendFileSync(filePath, line);
        return validated;
    }

    readAll(): EconomyEvent[] {
        const filePath = this.logPath();
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const events: EconomyEvent[] = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0) {
                continue;
            }
            try {
                events.push(economyEventSchema.parse(JSON.parse(trimmed)));
            } catch {
                // Skip malformed lines.
            }
        }
        return events;
    }

    filter(criteria: EconomyEventFilter): EconomyEvent[] {
        return this.readAll().filter(event => {
            if (criteria.residentName !== undefined && event.residentName !== criteria.residentName) {
                return false;
            }
            if (criteria.cityUserId !== undefined && event.cityUserId !== criteria.cityUserId) {
                return false;
            }
            if (criteria.kind !== undefined && event.kind !== criteria.kind) {
                return false;
            }
            if (criteria.sinceTs !== undefined && event.ts < criteria.sinceTs) {
                return false;
            }
            return true;
        });
    }

    /**
     * Returns the last `n` valid events by reading at most `n * MAX_LINE_BYTES` bytes
     * from the end of the file. Far cheaper than `readAll()` when only the most recent
     * events are needed (e.g. heartbeat). Malformed lines are silently skipped, so the
     * result may contain fewer than `n` entries.
     */
    tail(n: number): EconomyEvent[] {
        if (n <= 0) return [];
        const filePath = this.logPath();
        if (!fs.existsSync(filePath)) return [];
        const fileSize = fs.statSync(filePath).size;
        if (fileSize === 0) return [];

        const readSize = Math.min(n * ECONOMY_EVENT_ATOMIC_APPEND_MAX_BYTES, fileSize);
        const offset = fileSize - readSize;

        const fd = fs.openSync(filePath, 'r');
        try {
            const buf = Buffer.alloc(readSize);
            fs.readSync(fd, buf, 0, readSize, offset);
            const chunk = buf.toString('utf8');
            const lines = chunk.split('\n');
            // When we didn't start at byte 0 the first element may be a partial line.
            const startIdx = offset > 0 ? 1 : 0;
            const candidateLines = lines.slice(startIdx).filter(line => line.trim().length > 0);
            const tailLines = candidateLines.slice(-n);
            const events: EconomyEvent[] = [];
            for (const line of tailLines) {
                try {
                    events.push(economyEventSchema.parse(JSON.parse(line)));
                } catch {
                    // skip malformed lines
                }
            }
            return events;
        } finally {
            fs.closeSync(fd);
        }
    }

    /**
     * Counts non-empty lines in the log file without parsing JSON. Includes malformed
     * lines. Returns 0 when the file does not exist. Used by callers that need an event
     * count for monitoring/heartbeat without paying the full `readAll()` cost.
     */
    lineCount(): number {
        const filePath = this.logPath();
        if (!fs.existsSync(filePath)) return 0;
        let count = 0;
        const CHUNK = 65536;
        const fd = fs.openSync(filePath, 'r');
        try {
            const buf = Buffer.alloc(CHUNK);
            let pos = 0;
            let bytesRead: number;
            while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK, pos)) > 0) {
                for (let i = 0; i < bytesRead; i++) {
                    if (buf[i] === 0x0a) count++;
                }
                pos += bytesRead;
            }
        } finally {
            fs.closeSync(fd);
        }
        return count;
    }

    private logPath(): string {
        return path.join(this.memoryRoot, 'city-integration', 'economy-events.jsonl');
    }
}
