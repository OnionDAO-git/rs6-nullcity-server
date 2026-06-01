import type { InferenceHealthResult } from '../llm/inference-health';
import { buildCityStatus, healthFromProbe, type ResidentRawInput } from './status-aggregator';

function okProbe(): InferenceHealthResult {
    return { ok: true, status: 'ok', endpoint: 'default', model: 'qwopus3.5-27b-v3', latencyMs: 120 };
}

function resident(overrides: Partial<ResidentRawInput> = {}): ResidentRawInput {
    return {
        resident: 'res:qa-woodcutter',
        online: true,
        thinking: false,
        state: {
            attention: 80,
            tick: 1200,
            cognition: {
                activeGoal: { description: 'Master woodcutting and supply the city with logs.' },
                lastBrainTick: 1195,
            },
        },
        recentTrajectory: [
            { kind: 'action', tick: 1197, goalId: 'master-woodcutting' },
            { kind: 'action', tick: 1199, goalId: 'master-woodcutting' },
        ],
        ...overrides,
    };
}

describe('healthFromProbe', () => {
    it('maps an ok probe to ok health with model/endpoint', () => {
        const h = healthFromProbe(okProbe());
        expect(h.state).toBe('ok');
        expect(h.model).toBe('qwopus3.5-27b-v3');
        expect(h.endpoint).toBe('default');
    });

    it('maps a thrown-error probe (the 400-storm signature) to error health', () => {
        const probe: InferenceHealthResult = {
            ok: false,
            status: 'error',
            endpoint: 'default',
            model: 'qwopus3.5-27b-v3',
            error: 'LLM health probe failed: 400 Bad Request',
        };
        const h = healthFromProbe(probe);
        expect(h.state).toBe('error');
        expect(h.detail).toContain('400');
    });

    it('maps not_configured distinctly from error (so a missing endpoint is not mistaken for an outage)', () => {
        const h = healthFromProbe({ ok: false, status: 'not_configured', endpoint: 'default' });
        expect(h.state).toBe('not_configured');
    });

    it('maps a null probe (never run yet) to unknown', () => {
        expect(healthFromProbe(null).state).toBe('unknown');
    });
});

describe('buildCityStatus — per-resident state', () => {
    it('a resident acting recently with a healthy probe is ALIVE_ACTING with a story line', () => {
        const city = buildCityStatus({ health: okProbe(), residents: [resident()], generatedAt: 'T' });
        const row = city.residents[0];
        expect(row.state).toBe('ALIVE_ACTING');
        expect(row.ticksSinceAction).toBe(1); // tick 1200 - last action tick 1199
        expect(row.currentGoal).toContain('Master woodcutting');
        expect(row.storyLine).toContain('res:qa-woodcutter');
        expect(row.storyLine.toLowerCase()).toContain('acted');
        expect(city.erroringResidents).toBe(0);
    });

    it('marks every online resident ERRORING when the health probe is red (the outage that was invisible tonight)', () => {
        const redProbe: InferenceHealthResult = {
            ok: false,
            status: 'error',
            endpoint: 'default',
            error: 'LLM health probe failed: 400 Bad Request',
        };
        const city = buildCityStatus({ health: redProbe, residents: [resident()], generatedAt: 'T' });
        expect(city.health.state).toBe('error');
        expect(city.residents[0].state).toBe('ERRORING');
        expect(city.erroringResidents).toBe(1);
        expect(city.residents[0].storyLine.toUpperCase()).toContain('ERRORING');
    });

    it('does NOT force ERRORING when the probe is merely not_configured', () => {
        const city = buildCityStatus({
            health: { ok: false, status: 'not_configured', endpoint: 'default' },
            residents: [resident()],
            generatedAt: 'T',
        });
        expect(city.residents[0].state).toBe('ALIVE_ACTING');
        expect(city.erroringResidents).toBe(0);
    });

    it('marks a resident ERRORING from its own trajectory when recent brain decisions are mostly unusable', () => {
        const erroring = resident({
            recentTrajectory: [
                { kind: 'decision', tick: 1190, cause: 'completion_parse_failed' },
                { kind: 'decision', tick: 1195, cause: 'brain_truly_empty' },
                { kind: 'decision', tick: 1199, cause: 'request_timeout' },
            ],
        });
        const city = buildCityStatus({ health: okProbe(), residents: [erroring], generatedAt: 'T' });
        expect(city.residents[0].state).toBe('ERRORING');
        expect(city.residents[0].inferenceErrorRate).toBeGreaterThanOrEqual(0.5);
    });

    it('is STUCK when stuckSince is set', () => {
        const stuck = resident({
            state: { attention: 50, tick: 1200, stuckSince: 1100, cognition: { activeGoal: { description: 'Explore the city.' } } },
        });
        const city = buildCityStatus({ health: okProbe(), residents: [stuck], generatedAt: 'T' });
        expect(city.residents[0].state).toBe('STUCK');
        expect(city.residents[0].storyLine.toUpperCase()).toContain('STUCK');
    });

    it('is THINKING when a brain call is in flight and nothing is wrong', () => {
        const city = buildCityStatus({ health: okProbe(), residents: [resident({ thinking: true })], generatedAt: 'T' });
        expect(city.residents[0].state).toBe('THINKING');
    });

    it('is OFFLINE when deceased, regardless of probe', () => {
        const dead = resident({ state: { tick: 1200, deceased: { cause: 'goblin' } } });
        const city = buildCityStatus({ health: okProbe(), residents: [dead], generatedAt: 'T' });
        expect(city.residents[0].state).toBe('OFFLINE');
    });

    it('is OFFLINE when the disk layer reports it offline (stale runtime-state)', () => {
        const city = buildCityStatus({ health: okProbe(), residents: [resident({ online: false })], generatedAt: 'T' });
        expect(city.residents[0].state).toBe('OFFLINE');
    });

    it('reports null ticksSinceAction when there are no recent actions', () => {
        const noActions = resident({ recentTrajectory: [{ kind: 'decision', tick: 1199, cause: 'brain_clean' }] });
        const city = buildCityStatus({ health: okProbe(), residents: [noActions], generatedAt: 'T' });
        expect(city.residents[0].ticksSinceAction).toBeNull();
    });
});
