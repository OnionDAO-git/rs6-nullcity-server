import { SYNTHETIC_SLUG_PATTERN, isSyntheticResident, isSyntheticSlug } from './synthetic-residents';

// HR-7: one shared predicate fences test/benchmark resident artifacts off
// every public surface (wall, library, graveyard, epitaph broadcast,
// storyteller digest). Conservative by design: only clear test patterns are
// synthetic; the qa-* roster (qa-cook, qa-woodcutter, ...) is the LIVE CAST
// and must never be filtered.
describe('synthetic resident predicate (HR-7)', () => {
    describe('isSyntheticSlug — clear test patterns are synthetic', () => {
        it.each([
            'res-bmk_fire_5m_002e9qp0',
            'res-bmk_peer_01h3m5sy',
            'res-restart-test',
            'res-restart-test-2',
            'res-wf-verify-born',
            'res-wf-verify-cook',
            'res-e2e-letters-1',
            'res-loop-check',
            'res-smoke-born',
            'res-death-test',
            'res-verify-born',
            'res-patron-loop-smoke', // *-smoke suffix convention
        ])('%s is synthetic', slug => {
            expect(isSyntheticSlug(slug)).toBe(true);
        });
    });

    describe('isSyntheticSlug — the live cast is NOT synthetic', () => {
        it.each([
            'res-qa-cook', // qa-* roster residents are the live cast (HR-7 decision)
            'res-qa-woodcutter',
            'res-qa-guardian',
            'res-hans',
            'res-agent', // canonical demo soul
            'res-duke-horacio',
            'res-father-aereck',
        ])('%s is kept', slug => {
            expect(isSyntheticSlug(slug)).toBe(false);
        });
    });

    describe('isSyntheticResident — accepts colon resident names and raw slugs', () => {
        it('matches the colon form used by senderResident fields', () => {
            expect(isSyntheticResident('res:bmk_fire_5m_002e9qp0')).toBe(true);
            expect(isSyntheticResident('res:wf-verify-born')).toBe(true);
            expect(isSyntheticResident('res:e2e-letters-1')).toBe(true);
            expect(isSyntheticResident('res:patron-loop-smoke')).toBe(true);
        });

        it('keeps real residents in colon form', () => {
            expect(isSyntheticResident('res:qa-cook')).toBe(false);
            expect(isSyntheticResident('res:hans')).toBe(false);
            expect(isSyntheticResident('res:agent')).toBe(false);
        });

        it('accepts already-slugged input', () => {
            expect(isSyntheticResident('res-restart-test')).toBe(true);
            expect(isSyntheticResident('res-qa-woodcutter')).toBe(false);
        });
    });

    it('exposes the pattern for callers that need it directly', () => {
        expect(SYNTHETIC_SLUG_PATTERN.test('res-bmk_x')).toBe(true);
        expect(SYNTHETIC_SLUG_PATTERN.test('res-qa-cook')).toBe(false);
    });
});
