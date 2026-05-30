import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomyEventLog } from './economy-event';
import {
    ApGpExchangeStore,
    deriveExchangeStatus,
    makeExchangeId,
    apGpExchangeRecordSchema,
    apGpExchangeRequestSchema,
} from './ap-gp-exchange';

describe('makeExchangeId', () => {
    it('formats exchange id as apgp:<resident>:<key>', () => {
        expect(makeExchangeId('res:duke', 'tx-001')).toBe('apgp:res:duke:tx-001');
    });
});

describe('deriveExchangeStatus', () => {
    const apEv = { creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 };
    const gpEv = { itemId: 995 as const, burnedAmount: 100, remainingAmount: 50 };

    it('returns complete when both AP and GP evidence present', () => {
        expect(deriveExchangeStatus(apEv, gpEv)).toBe('complete');
    });

    it('returns failed_gp when caller explicitly attributes failure to GP side', () => {
        expect(
            deriveExchangeStatus(undefined, undefined, {
                failedSide: 'gp',
                failureReason: 'insufficient_gold',
            }),
        ).toBe('failed_gp');
    });

    it('returns failed_ap when GP evidence present but AP evidence missing (one-sided record)', () => {
        expect(deriveExchangeStatus(undefined, gpEv)).toBe('failed_ap');
    });

    it('returns failed_ap when caller explicitly attributes failure to AP side', () => {
        expect(
            deriveExchangeStatus(undefined, undefined, {
                failedSide: 'ap',
                failureReason: 'resident_not_found',
            }),
        ).toBe('failed_ap');
    });

    it('returns failed_unknown when caller cannot attribute failure side (defensive)', () => {
        expect(
            deriveExchangeStatus(undefined, undefined, {
                failedSide: 'unknown',
                failureReason: 'resident_not_found',
            }),
        ).toBe('failed_unknown');
    });

    it('returns incomplete when AP evidence present but GP evidence missing', () => {
        expect(deriveExchangeStatus(apEv, undefined)).toBe('incomplete');
    });

    it('returns incomplete when both evidences absent and no failure attributed', () => {
        expect(deriveExchangeStatus(undefined, undefined)).toBe('incomplete');
    });

    it('does NOT silently classify any failure as failed_gp (F2 regression)', () => {
        // Audit F2: previously, any failureReason with no evidence returned 'failed_gp'
        // regardless of where the failure actually came from. Tightened helper now
        // requires explicit failedSide attribution; an AP-side failure must never be
        // recorded as failed_gp.
        expect(
            deriveExchangeStatus(undefined, undefined, {
                failedSide: 'ap',
                failureReason: 'resident_not_found',
            }),
        ).not.toBe('failed_gp');
    });
});

describe('apGpExchangeRequestSchema', () => {
    it('accepts a valid exchange request', () => {
        const result = apGpExchangeRequestSchema.safeParse({
            idempotencyKey: 'exch-001',
            apAmount: 50,
            gpAmount: 100,
            cityUserId: 'user-1',
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing idempotencyKey', () => {
        const result = apGpExchangeRequestSchema.safeParse({ apAmount: 50, gpAmount: 100 });
        expect(result.success).toBe(false);
    });

    it('rejects zero or negative apAmount', () => {
        expect(apGpExchangeRequestSchema.safeParse({ idempotencyKey: 'k', apAmount: 0, gpAmount: 100 }).success).toBe(false);
        expect(apGpExchangeRequestSchema.safeParse({ idempotencyKey: 'k', apAmount: -1, gpAmount: 100 }).success).toBe(false);
    });

    it('rejects zero or negative gpAmount', () => {
        expect(apGpExchangeRequestSchema.safeParse({ idempotencyKey: 'k', apAmount: 50, gpAmount: 0 }).success).toBe(false);
        expect(apGpExchangeRequestSchema.safeParse({ idempotencyKey: 'k', apAmount: 50, gpAmount: -5 }).success).toBe(false);
    });

    it('rejects unknown fields (strict)', () => {
        const result = apGpExchangeRequestSchema.safeParse({ idempotencyKey: 'k', apAmount: 50, gpAmount: 100, mystery: true });
        expect(result.success).toBe(false);
    });
});

describe('apGpExchangeRecordSchema', () => {
    it('validates a complete exchange record', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-1',
            idempotencyKey: 'tx-1',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'complete',
            apEvidence: { creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 },
            gpEvidence: { itemId: 995, burnedAmount: 100, remainingAmount: 50 },
            createdAt: '2026-05-29T00:00:00.000Z',
            completedAt: '2026-05-29T00:00:01.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(true);
    });

    it('accepts fractional attention evidence because live AP decays between ticks', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-fractional-ap',
            idempotencyKey: 'tx-fractional-ap',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 25,
            status: 'complete',
            apEvidence: { creditedAmount: 50, attentionBefore: 25430.5, attentionAfter: 25480.5 },
            gpEvidence: { itemId: 995, burnedAmount: 25, remainingAmount: 1850 },
            createdAt: '2026-05-30T18:22:00.000Z',
            completedAt: '2026-05-30T18:22:00.000Z',
        };

        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(true);
    });

    it('validates a failed_gp exchange record (no apEvidence, no gpEvidence)', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-2',
            idempotencyKey: 'tx-2',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'failed_gp',
            failureReason: 'insufficient_gold',
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(true);
    });

    it('validates a failed_ap exchange record (gpEvidence present, no apEvidence)', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-3',
            idempotencyKey: 'tx-3',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'failed_ap',
            gpEvidence: { itemId: 995, burnedAmount: 100, remainingAmount: 0 },
            failureReason: 'resident_not_found',
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(true);
    });

    it('rejects itemId !== 995 in gpEvidence', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-4',
            idempotencyKey: 'tx-4',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'complete',
            gpEvidence: { itemId: 1234, burnedAmount: 100, remainingAmount: 0 },
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(false);
    });

    it('rejects status complete when AP evidence is missing', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-5',
            idempotencyKey: 'tx-5',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'complete',
            gpEvidence: { itemId: 995, burnedAmount: 100, remainingAmount: 0 },
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(false);
    });

    it('rejects status complete when GP evidence is missing', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-6',
            idempotencyKey: 'tx-6',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'complete',
            apEvidence: { creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 },
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(false);
    });

    it('rejects failed_ap when GP evidence is missing', () => {
        const record = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-7',
            idempotencyKey: 'tx-7',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'failed_ap',
            failureReason: 'resident_not_found',
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        expect(apGpExchangeRecordSchema.safeParse(record).success).toBe(false);
    });
});

describe('ApGpExchangeStore', () => {
    let root: string;
    let store: ApGpExchangeStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-gp-exchange-store-'));
        store = new ApGpExchangeStore(root);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const baseRecord = (): Parameters<ApGpExchangeStore['write']>[0] => ({
        schemaVersion: 1,
        exchangeId: 'apgp:res:duke:tx-1',
        idempotencyKey: 'tx-1',
        resident: 'res:duke',
        apAmount: 50,
        gpAmount: 100,
        status: 'complete',
        apEvidence: { creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 },
        gpEvidence: { itemId: 995, burnedAmount: 100, remainingAmount: 50 },
        createdAt: '2026-05-29T00:00:00.000Z',
        completedAt: '2026-05-29T00:00:01.000Z',
    });

    it('returns undefined for a key that was never written', () => {
        expect(store.read('missing-key')).toBeUndefined();
    });

    it('stores and retrieves a complete exchange record', () => {
        const record = baseRecord();
        store.write(record);
        expect(store.read('tx-1')).toEqual(record);
    });

    it('overwrites the record when written again with the same key', () => {
        store.write(baseRecord());
        const updated = { ...baseRecord(), status: 'failed_gp' as const, completedAt: undefined };
        store.write(updated);
        expect(store.read('tx-1')).toMatchObject({ status: 'failed_gp' });
    });

    it('stores a failed_gp record without evidence fields', () => {
        const record: Parameters<ApGpExchangeStore['write']>[0] = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-2',
            idempotencyKey: 'tx-2',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 200,
            status: 'failed_gp',
            failureReason: 'insufficient_gold',
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        store.write(record);
        const loaded = store.read('tx-2');
        expect(loaded).toBeDefined();
        expect(loaded?.status).toBe('failed_gp');
        expect(loaded?.apEvidence).toBeUndefined();
        expect(loaded?.gpEvidence).toBeUndefined();
    });

    it('different idempotency keys produce separate records', () => {
        store.write({ ...baseRecord(), idempotencyKey: 'key-a', exchangeId: 'apgp:res:duke:key-a' });
        store.write({ ...baseRecord(), idempotencyKey: 'key-b', exchangeId: 'apgp:res:duke:key-b', apAmount: 999 });
        expect(store.read('key-a')?.apAmount).toBe(50);
        expect(store.read('key-b')?.apAmount).toBe(999);
    });

    it('exchange record survives store restart (file persistence)', () => {
        store.write(baseRecord());
        const store2 = new ApGpExchangeStore(root);
        expect(store2.read('tx-1')).toEqual(baseRecord());
    });
});

describe('ApGpExchangeStore EconomyEventLog emission', () => {
    let root: string;
    let log: EconomyEventLog;
    let store: ApGpExchangeStore;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-gp-exchange-emit-'));
        log = new EconomyEventLog(root, () => new Date('2026-05-30T01:00:00.000Z'));
        store = new ApGpExchangeStore(root, log);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const completeRecord = (
        overrides: Partial<Parameters<ApGpExchangeStore['write']>[0]> = {},
    ): Parameters<ApGpExchangeStore['write']>[0] => ({
        schemaVersion: 1,
        exchangeId: 'apgp:res:duke:tx-1',
        idempotencyKey: 'tx-1',
        resident: 'res:duke',
        apAmount: 50,
        gpAmount: 100,
        status: 'complete',
        apEvidence: { creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 },
        gpEvidence: { itemId: 995, burnedAmount: 100, remainingAmount: 50 },
        cityUserId: 'user-1',
        createdAt: '2026-05-29T00:00:00.000Z',
        completedAt: '2026-05-30T01:00:00.000Z',
        ...overrides,
    });

    it('emits ap_gp_exchange on complete exchange (apDelta + gpDelta + refId)', () => {
        store.write(completeRecord());
        const events = log.readAll();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            kind: 'ap_gp_exchange',
            residentName: 'res:duke',
            apDelta: 50,
            gpDelta: -100,
            refId: 'apgp:res:duke:tx-1',
            cityUserId: 'user-1',
        });
    });

    it('does NOT emit for failed_gp (no completion)', () => {
        const failed: Parameters<ApGpExchangeStore['write']>[0] = {
            schemaVersion: 1,
            exchangeId: 'apgp:res:duke:tx-2',
            idempotencyKey: 'tx-2',
            resident: 'res:duke',
            apAmount: 50,
            gpAmount: 100,
            status: 'failed_gp',
            failureReason: 'insufficient_gold',
            createdAt: '2026-05-29T00:00:00.000Z',
        };
        store.write(failed);
        expect(log.readAll()).toHaveLength(0);
    });

    it('does NOT emit when economyEventLog is undefined (backward compatible)', () => {
        const storeNoLog = new ApGpExchangeStore(root);
        storeNoLog.write(completeRecord({ idempotencyKey: 'tx-3', exchangeId: 'apgp:res:duke:tx-3' }));
        expect(log.readAll()).toHaveLength(0);
    });

    it('uses apEvidence.creditedAmount and gpEvidence.burnedAmount when present', () => {
        const record = completeRecord({
            idempotencyKey: 'tx-4',
            exchangeId: 'apgp:res:duke:tx-4',
            apEvidence: { creditedAmount: 42, attentionBefore: 0, attentionAfter: 42 },
            gpEvidence: { itemId: 995, burnedAmount: 99, remainingAmount: 1 },
        });
        store.write(record);
        const event = log.readAll()[0];
        expect(event.apDelta).toBe(42);
        expect(event.gpDelta).toBe(-99);
    });
});
