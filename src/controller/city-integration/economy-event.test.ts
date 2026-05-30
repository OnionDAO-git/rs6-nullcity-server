import fs from 'fs';
import os from 'os';
import path from 'path';
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
});
