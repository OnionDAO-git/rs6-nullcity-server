import type { CityStatus } from '../observability/status-aggregator';
import { statusExitCode, renderStatusTable, parseHealthIfFresh } from './status-cli';

function city(overrides: Partial<CityStatus> = {}): CityStatus {
    return {
        health: { state: 'ok', detail: 'probe ok (120ms)', model: 'qwopus3.5-27b-v3', endpoint: 'default' },
        residents: [
            {
                resident: 'res:qa-woodcutter',
                online: true,
                state: 'ALIVE_ACTING',
                ticksSinceAction: 1,
                currentGoal: 'Master woodcutting and supply the city with logs.',
                storyLine: 'res:qa-woodcutter — Master woodcutting… — acted 1t ago',
                attention: 80,
                lastInferenceCause: 'brain_clean',
                inferenceErrorRate: 0,
                thoughtAgeTicks: 5,
            },
        ],
        erroringResidents: 0,
        generatedAt: 'T',
        ...overrides,
    };
}

describe('statusExitCode', () => {
    it('is 0 when health is ok and nothing is erroring', () => {
        expect(statusExitCode(city())).toBe(0);
    });

    it('is non-zero when the health probe is red (outage)', () => {
        expect(statusExitCode(city({ health: { state: 'error', detail: '400 Bad Request' } }))).not.toBe(0);
    });

    it('is non-zero when any resident is ERRORING even if the probe is ok', () => {
        expect(statusExitCode(city({ erroringResidents: 1 }))).not.toBe(0);
    });

    it('is non-zero when the endpoint is not configured', () => {
        expect(statusExitCode(city({ health: { state: 'not_configured', detail: 'no endpoint' } }))).not.toBe(0);
    });

    it('is 0 when the probe has never run yet (unknown), to avoid false alarms at boot', () => {
        expect(statusExitCode(city({ health: { state: 'unknown', detail: 'no probe yet' } }))).toBe(0);
    });
});

describe('parseHealthIfFresh', () => {
    const now = Date.parse('2026-06-01T05:00:00.000Z');
    const fresh = { status: 'ok', ok: true, endpoint: 'default', generatedAt: '2026-06-01T04:59:55.000Z' };

    it('returns the probe when the file is fresh', () => {
        const result = parseHealthIfFresh(fresh, now, 30_000);
        expect(result?.status).toBe('ok');
    });

    it('returns null when the file is stale (so a stale OK never masks an outage)', () => {
        const stale = { ...fresh, generatedAt: '2026-06-01T04:58:00.000Z' }; // 120s old
        expect(parseHealthIfFresh(stale, now, 30_000)).toBeNull();
    });

    it('returns null for malformed/empty input', () => {
        expect(parseHealthIfFresh(null, now, 30_000)).toBeNull();
        expect(parseHealthIfFresh({ nope: 1 }, now, 30_000)).toBeNull();
    });

    it('returns null when generatedAt is missing (cannot prove freshness)', () => {
        expect(parseHealthIfFresh({ status: 'ok', ok: true, endpoint: 'default' }, now, 30_000)).toBeNull();
    });
});

describe('renderStatusTable', () => {
    it('includes the health state and each resident story line', () => {
        const out = renderStatusTable(city());
        expect(out).toContain('HEALTH');
        expect(out.toLowerCase()).toContain('ok');
        expect(out).toContain('res:qa-woodcutter');
        expect(out).toContain('ALIVE_ACTING');
    });

    it('makes a red health state visually prominent', () => {
        const out = renderStatusTable(city({ health: { state: 'error', detail: '400 Bad Request' } }));
        expect(out).toContain('400 Bad Request');
        expect(out.toUpperCase()).toContain('ERROR');
    });
});
