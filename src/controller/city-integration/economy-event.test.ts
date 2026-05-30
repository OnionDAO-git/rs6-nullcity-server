import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { ECONOMY_EVENT_KINDS, EconomyEventLog } from './economy-event';

describe('EconomyEventLog', () => {
    let root: string;
    let clock: number;
    let log: EconomyEventLog;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'economy-event-'));
        clock = Date.parse('2026-05-29T12:00:00.000Z');
        log = new EconomyEventLog(root, () => new Date(clock));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('appends an event, assigning id + ts', () => {
        const ev = log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5, cityUserId: 'demo@onion' });
        expect(ev.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(ev.ts).toBe('2026-05-29T12:00:00.000Z');
        expect(ev.kind).toBe('ap_grant');
        expect(ev.apDelta).toBe(5);
        expect(ev.schemaVersion).toBe(1);
    });

    it('honors an explicit ts when provided', () => {
        const ev = log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 120, ts: '2026-05-28T09:00:00.000Z' });
        expect(ev.ts).toBe('2026-05-28T09:00:00.000Z');
    });

    it('supports signed deltas (decay is negative)', () => {
        const ev = log.append({ kind: 'ap_decay', residentName: 'res:hans', apDelta: -3 });
        expect(ev.apDelta).toBe(-3);
    });

    it('rejects append lines that exceed atomic JSONL byte safety bounds', () => {
        const hugeNote = 'x'.repeat(5000);
        expect(() => log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 1, note: hugeNote })).toThrow(/atomic/i);
    });

    it('persists as JSONL and replays across instances', () => {
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
        log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 100 });
        const fresh = new EconomyEventLog(root);
        const all = fresh.readAll();
        expect(all).toHaveLength(2);
        expect(all.map(e => e.kind)).toEqual(['ap_grant', 'gp_earned']);
    });

    it('readAll returns empty when no log file exists', () => {
        expect(log.readAll()).toEqual([]);
    });

    it('skips malformed JSONL lines without throwing', () => {
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
        const filePath = path.join(root, 'city-integration', 'economy-events.jsonl');
        fs.appendFileSync(filePath, 'not json\n');
        fs.appendFileSync(filePath, '{"partial":true}\n'); // valid json, invalid schema
        log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 100 });
        const all = log.readAll();
        expect(all).toHaveLength(2);
        expect(all.map(e => e.kind)).toEqual(['ap_grant', 'gp_earned']);
    });

    it('rejects an unknown kind', () => {
        // @ts-expect-error intentional bad kind
        expect(() => log.append({ kind: 'totally_made_up', residentName: 'res:hans' })).toThrow();
    });

    it('rejects a malformed resident name', () => {
        expect(() => log.append({ kind: 'ap_grant', residentName: 'hans' })).toThrow();
    });

    it('filters by resident', () => {
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
        log.append({ kind: 'ap_grant', residentName: 'res:pip', apDelta: 5 });
        expect(log.filter({ residentName: 'res:hans' })).toHaveLength(1);
    });

    it('filters by kind', () => {
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
        log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 100 });
        log.append({ kind: 'gp_earned', residentName: 'res:pip', gpDelta: 50 });
        expect(log.filter({ kind: 'gp_earned' })).toHaveLength(2);
    });

    it('filters by cityUserId', () => {
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5, cityUserId: 'a@onion' });
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5, cityUserId: 'b@onion' });
        expect(log.filter({ cityUserId: 'b@onion' })).toHaveLength(1);
    });

    it('filters by sinceTs (inclusive lower bound)', () => {
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5, ts: '2026-05-29T10:00:00.000Z' });
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5, ts: '2026-05-29T12:00:00.000Z' });
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5, ts: '2026-05-29T14:00:00.000Z' });
        const recent = log.filter({ sinceTs: '2026-05-29T12:00:00.000Z' });
        expect(recent).toHaveLength(2);
    });

    it('combines filter criteria (resident + kind)', () => {
        log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 100 });
        log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
        log.append({ kind: 'gp_earned', residentName: 'res:pip', gpDelta: 50 });
        expect(log.filter({ residentName: 'res:hans', kind: 'gp_earned' })).toHaveLength(1);
    });

    it('exposes all 12 economy event kinds', () => {
        expect(ECONOMY_EVENT_KINDS).toHaveLength(12);
        for (const kind of ECONOMY_EVENT_KINDS) {
            const ev = log.append({ kind, note: `${kind} sample` });
            expect(ev.kind).toBe(kind);
        }
        expect(log.readAll()).toHaveLength(12);
    });

    describe('tail(n)', () => {
        it('returns empty when n is zero', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
            expect(log.tail(0)).toEqual([]);
        });

        it('returns empty when file does not exist', () => {
            expect(log.tail(5)).toEqual([]);
        });

        it('returns all events when n exceeds total count', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
            log.append({ kind: 'gp_earned', residentName: 'res:pip', gpDelta: 100 });
            const events = log.tail(10);
            expect(events).toHaveLength(2);
            expect(events.map(e => e.kind)).toEqual(['ap_grant', 'gp_earned']);
        });

        it('returns only the last n events when log has more', () => {
            for (let i = 0; i < 5; i++) {
                log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: i + 1 });
            }
            const events = log.tail(2);
            expect(events).toHaveLength(2);
            expect(events[0].apDelta).toBe(4);
            expect(events[1].apDelta).toBe(5);
        });

        it('tail(1) returns only the most recent event', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 10 });
            log.append({ kind: 'gp_earned', residentName: 'res:pip', gpDelta: 200 });
            log.append({ kind: 'ap_topup', residentName: 'res:hans', apDelta: 50 });
            const events = log.tail(1);
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe('ap_topup');
        });

        it('skips a malformed line at the end of the file', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
            log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 100 });
            const filePath = path.join(root, 'city-integration', 'economy-events.jsonl');
            fs.appendFileSync(filePath, 'not-valid-json\n');
            // tail(3) reads the last 3 lines; the bad line is skipped; 2 valid events returned
            const events = log.tail(3);
            expect(events).toHaveLength(2);
            expect(events.map(e => e.kind)).toEqual(['ap_grant', 'gp_earned']);
        });

        it('preserves append order (oldest first) in the returned slice', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 1 });
            log.append({ kind: 'ap_decay', residentName: 'res:hans', apDelta: -1 });
            log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 50 });
            const events = log.tail(2);
            expect(events[0].kind).toBe('ap_decay');
            expect(events[1].kind).toBe('gp_earned');
        });
    });

    describe('lineCount()', () => {
        it('returns 0 when file does not exist', () => {
            expect(log.lineCount()).toBe(0);
        });

        it('returns the number of appended events', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
            log.append({ kind: 'gp_earned', residentName: 'res:hans', gpDelta: 100 });
            log.append({ kind: 'ap_topup', residentName: 'res:pip', apDelta: 20 });
            expect(log.lineCount()).toBe(3);
        });

        it('counts lines including malformed ones', () => {
            log.append({ kind: 'ap_grant', residentName: 'res:hans', apDelta: 5 });
            const filePath = path.join(root, 'city-integration', 'economy-events.jsonl');
            fs.appendFileSync(filePath, 'malformed\n');
            expect(log.lineCount()).toBe(2);
        });
    });

    it('keeps every JSONL line parseable under concurrent appenders', async () => {
        const workerCount = 4;
        const writesPerWorker = 40;
        const filePath = path.join(root, 'city-integration', 'economy-events.jsonl');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        const workerScript = `
            const fs = require('fs');
            const filePath = process.argv[1];
            const workerId = Number(process.argv[2]);
            const writes = Number(process.argv[3]);
            for (let i = 0; i < writes; i++) {
              const event = {
                schemaVersion: 1,
                id: \`w\${workerId}-\${i}\`,
                ts: '2026-05-29T12:00:00.000Z',
                kind: 'ap_grant',
                residentName: 'res:hans',
                apDelta: 1,
                note: \`worker-\${workerId}-\${i}\`,
              };
              fs.appendFileSync(filePath, JSON.stringify(event) + '\\n');
            }
        `;

        await Promise.all(
            Array.from(
                { length: workerCount },
                (_, index) =>
                    new Promise<void>((resolve, reject) => {
                        const child = spawn(process.execPath, ['-e', workerScript, filePath, String(index), String(writesPerWorker)], {
                            stdio: 'ignore',
                        });
                        child.once('error', reject);
                        child.once('close', code => {
                            if (code !== 0) {
                                reject(new Error(`worker ${index} exited with code ${String(code)}`));
                                return;
                            }
                            resolve();
                        });
                    }),
            ),
        );

        const events = log.readAll();
        expect(events).toHaveLength(workerCount * writesPerWorker);
        expect(log.lineCount()).toBe(workerCount * writesPerWorker);
    });
});
