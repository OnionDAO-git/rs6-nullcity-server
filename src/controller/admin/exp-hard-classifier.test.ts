import { classifyExpHardRun, parseExpHardClassifierArgs } from './exp-hard-classifier';
import type { ExpHardClassifierInput } from './exp-hard-classifier';

function baseInput(overrides: Partial<ExpHardClassifierInput> = {}): ExpHardClassifierInput {
    return {
        entries: [],
        events: [],
        metrics: {
            commandSubmitted: 1,
            perceptionCount: 4,
            attackActions: 2,
            failedAttackActions: 0,
            safeAttackActions: 2,
            unsafeAttackActions: 0,
            combatEvidence: 1,
            bonesEvidence: 1,
            prayerEvidence: 1,
            survivalActions: 1,
            deathEvents: 0,
            lowHealthRefusals: 0,
            ordinaryActionEntries: 10,
            catatonicLoopDetected: 0,
        },
        durationMs: 120_000,
        ...overrides,
    };
}

describe('classifyExpHardRun', () => {
    it('produces no observations for a clean passing soak', () => {
        const result = classifyExpHardRun(baseInput());
        expect(result.observations).toHaveLength(0);
        expect(result.axisSurface).toBe(false); // only 2 kills, not >= 3
    });

    it('emits BODY:catatonic observation when catatonicLoopDetected is true', () => {
        const result = classifyExpHardRun(baseInput({ catatonicLoopDetected: true }));
        const bodyObs = result.observations.filter(o => o.primaryClass === 'BODY');
        expect(bodyObs.length).toBeGreaterThan(0);
        expect(bodyObs[0].evidence).toContain('metrics.catatonicLoopDetected=true');
    });

    it('emits INFERENCE observation when perceptionCount is zero', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, perceptionCount: 0 } }));
        const inferenceObs = result.observations.find(o => o.primaryClass === 'INFERENCE');
        expect(inferenceObs).toBeDefined();
        expect(inferenceObs?.secondaryClasses).toContain('ENGINE');
    });

    it('emits BODY observation when no command was submitted', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, commandSubmitted: 0 } }));
        const bodyObs = result.observations.find(o => o.primaryClass === 'BODY' && o.evidence.includes('metrics.commandSubmitted=0'));
        expect(bodyObs).toBeDefined();
    });

    it('emits DESIGN observation when unsafe targets were attacked', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, unsafeAttackActions: 2 } }));
        const designObs = result.observations.find(o => o.primaryClass === 'DESIGN');
        expect(designObs).toBeDefined();
        expect(designObs?.evidence[0]).toMatch(/unsafeAttackActions=2/);
        expect(designObs?.secondaryClasses).toContain('KNOWLEDGE');
    });

    it('emits BODY observation for high action failure rate (>50%)', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, attackActions: 4, failedAttackActions: 3 } }));
        const bodyObs = result.observations.find(o => o.primaryClass === 'BODY' && o.evidence.some(e => e.includes('failedAttackActions')));
        expect(bodyObs).toBeDefined();
        expect(bodyObs?.secondaryClasses).toContain('PERCEPTION');
    });

    it('does not emit BODY failure rate observation for 50% failures (requires >50%)', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, attackActions: 4, failedAttackActions: 2 } }));
        const bodyFailureObs = result.observations.find(
            o => o.primaryClass === 'BODY' && o.evidence.some(e => e.includes('failedAttackActions')),
        );
        expect(bodyFailureObs).toBeUndefined();
    });

    it('emits DESIGN:missing_eat_reflex when resident died with zero survival actions', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, deathEvents: 1, survivalActions: 0 } }));
        const designObs = result.observations.find(o => o.primaryClass === 'DESIGN' && o.evidence.some(e => e.includes('deathEvents=1')));
        expect(designObs).toBeDefined();
        expect(designObs?.evidence).toContain('metrics.survivalActions=0');
    });

    it('emits DESIGN:over_cautious_refusal when refusals happen but no safe attacks', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, safeAttackActions: 0, lowHealthRefusals: 3 } }));
        const designObs = result.observations.find(
            o => o.primaryClass === 'DESIGN' && o.evidence.some(e => e.includes('lowHealthRefusals=3')),
        );
        expect(designObs).toBeDefined();
    });

    it('emits KNOWLEDGE:missing_bone_burial when 2+ safe attacks but zero bones', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, bonesEvidence: 0, safeAttackActions: 3 } }));
        const knowledgeObs = result.observations.find(o => o.primaryClass === 'KNOWLEDGE');
        expect(knowledgeObs).toBeDefined();
        expect(knowledgeObs?.evidence[0]).toMatch(/bonesEvidence=0/);
    });

    it('does not emit bone-burial observation when fewer than 2 safe attacks', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, bonesEvidence: 0, safeAttackActions: 1 } }));
        const knowledgeObs = result.observations.find(o => o.primaryClass === 'KNOWLEDGE');
        expect(knowledgeObs).toBeUndefined();
    });

    it('emits INFERENCE:low_throughput for long duration with very few actions', () => {
        const result = classifyExpHardRun(
            baseInput({ durationMs: 3_600_000, metrics: { ...baseInput().metrics, ordinaryActionEntries: 3 } }),
        );
        const inferenceObs = result.observations.find(
            o => o.primaryClass === 'INFERENCE' && o.evidence.some(e => e.includes('ordinaryActionEntries=3')),
        );
        expect(inferenceObs).toBeDefined();
    });

    it('does not emit throughput observation for short soak', () => {
        const result = classifyExpHardRun(baseInput({ durationMs: 30_000, metrics: { ...baseInput().metrics, ordinaryActionEntries: 3 } }));
        const inferenceObs = result.observations.find(
            o => o.primaryClass === 'INFERENCE' && o.evidence.some(e => e.includes('ordinaryActionEntries')),
        );
        expect(inferenceObs).toBeUndefined();
    });

    it('emits PERCEPTION:stale_target for multiple target_not_found failures', () => {
        const entries = Array.from({ length: 3 }, () => ({
            action: { kind: 'attack', target: { name: 'Goblin' } },
            result: { ok: false, reason: 'target_not_found' },
        }));
        const result = classifyExpHardRun(baseInput({ entries }));
        const perceptionObs = result.observations.find(o => o.primaryClass === 'PERCEPTION');
        expect(perceptionObs).toBeDefined();
        expect(perceptionObs?.evidence[0]).toMatch(/staleTargetFailures=3/);
    });

    it('emits ENGINE observation for death without unsafe attacks or combat evidence', () => {
        const result = classifyExpHardRun(
            baseInput({
                metrics: { ...baseInput().metrics, deathEvents: 1, unsafeAttackActions: 0, combatEvidence: 0, survivalActions: 1 },
            }),
        );
        const engineObs = result.observations.find(o => o.primaryClass === 'ENGINE');
        expect(engineObs).toBeDefined();
    });

    it('reports axisSurface=true when 3+ safe attacks, 0 deaths, and bones evidence present', () => {
        const result = classifyExpHardRun(
            baseInput({ metrics: { ...baseInput().metrics, safeAttackActions: 3, deathEvents: 0, bonesEvidence: 1 } }),
        );
        expect(result.axisSurface).toBe(true);
    });

    it('reports axisDiversity=true when eat, bones, and attack all present', () => {
        const result = classifyExpHardRun(
            baseInput({ metrics: { ...baseInput().metrics, survivalActions: 2, bonesEvidence: 1, safeAttackActions: 2 } }),
        );
        expect(result.axisDiversity).toBe(true);
    });

    it('reports axisYield=true when 5+ observations from 3+ distinct primary classes', () => {
        // Inject a scenario that triggers many observations
        const result = classifyExpHardRun(
            baseInput({
                catatonicLoopDetected: true,
                durationMs: 3_600_000,
                entries: Array.from({ length: 3 }, () => ({
                    action: { kind: 'attack', target: { name: 'Goblin' } },
                    result: { ok: false, reason: 'target_not_found' },
                })),
                metrics: {
                    ...baseInput().metrics,
                    perceptionCount: 0,
                    commandSubmitted: 0,
                    unsafeAttackActions: 1,
                    attackActions: 4,
                    failedAttackActions: 3,
                    deathEvents: 1,
                    survivalActions: 0,
                    safeAttackActions: 0,
                    bonesEvidence: 0,
                    ordinaryActionEntries: 2,
                    combatEvidence: 0,
                },
            }),
        );
        expect(result.axisYield).toBe(true);
        expect(result.observations.length).toBeGreaterThanOrEqual(5);
        expect(Object.values(result.classCounts).filter(v => v > 0).length).toBeGreaterThanOrEqual(3);
    });

    it('computes dominant class from classCounts', () => {
        const result = classifyExpHardRun(
            baseInput({
                metrics: {
                    ...baseInput().metrics,
                    unsafeAttackActions: 2,
                    deathEvents: 1,
                    survivalActions: 0,
                },
            }),
        );
        expect(result.dominantClass).toBe('DESIGN');
    });

    it('includes all observation ids and suggestedFix in the summary', () => {
        const result = classifyExpHardRun(baseInput({ metrics: { ...baseInput().metrics, unsafeAttackActions: 1 } }));
        expect(result.summary).toContain('OBS-001');
        expect(result.summary).toContain('Suggested fix');
    });
});

describe('parseExpHardClassifierArgs', () => {
    it('parses --input and --output flags', () => {
        const opts = parseExpHardClassifierArgs(['--input', '/data/run-a', '--output', '/data/run-a/classification']);
        expect(opts.inputDir).toBe('/data/run-a');
        expect(opts.outputDir).toBe('/data/run-a/classification');
    });

    it('defaults output to input/classification when output not provided', () => {
        const opts = parseExpHardClassifierArgs(['--input=/data/run-a']);
        expect(opts.inputDir).toBe('/data/run-a');
        expect(opts.outputDir).toBe('/data/run-a/classification');
    });

    it('throws when input is not provided', () => {
        expect(() => parseExpHardClassifierArgs([])).toThrow('--input');
    });
});
