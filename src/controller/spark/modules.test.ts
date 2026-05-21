import { resolveSparkModules, type SparkModule } from './modules';

describe('resolveSparkModules', () => {
    const alpha = module('onion.alpha');
    const beta = module('onion.beta');

    it('resolves enabled soul modules in soul order', () => {
        expect(
            resolveSparkModules(
                [
                    { id: 'onion.beta', enabled: true },
                    { id: 'onion.alpha', enabled: true, config: { mode: 'fast' } },
                ],
                [alpha, beta],
            ).map(entry => ({ id: entry.module.manifest.id, config: entry.config })),
        ).toEqual([
            { id: 'onion.beta', config: {} },
            { id: 'onion.alpha', config: { mode: 'fast' } },
        ]);
    });

    it('rejects unsafe selected module config', () => {
        expect(() => resolveSparkModules([{ id: 'onion.alpha', config: { apiKey: 'abc123' } }], [alpha])).toThrow(
            'SPARK module config apiKey is not allowed to contain secret-like fields',
        );
    });

    it('ignores disabled modules', () => {
        expect(resolveSparkModules([{ id: 'onion.alpha', enabled: false }], [alpha])).toEqual([]);
    });

    it('throws for unknown enabled modules', () => {
        expect(() => resolveSparkModules([{ id: 'onion.missing' }], [alpha])).toThrow('Unknown SPARK module onion.missing');
    });

    it('throws for duplicate soul module ids', () => {
        expect(() => resolveSparkModules([{ id: 'onion.alpha' }, { id: 'onion.alpha' }], [alpha])).toThrow(
            'Duplicate SPARK module selection onion.alpha',
        );
    });

    it('throws for duplicate registry module ids', () => {
        expect(() => resolveSparkModules([{ id: 'onion.alpha' }], [alpha, module('onion.alpha')])).toThrow(
            'Duplicate SPARK module onion.alpha',
        );
    });

    it('throws when a thinking factory is not declared in capabilities', () => {
        expect(() =>
            resolveSparkModules(
                [{ id: 'onion.alpha' }],
                [
                    {
                        ...alpha,
                        manifest: { ...alpha.manifest, capabilities: ['prompt-sections'] },
                        createThinkingModule: jest.fn(),
                    },
                ],
            ),
        ).toThrow('SPARK module onion.alpha exposes thinking without declaring the thinking capability');
    });

    it('throws when a nervous factory is not declared in capabilities', () => {
        expect(() =>
            resolveSparkModules(
                [{ id: 'onion.alpha' }],
                [
                    {
                        ...alpha,
                        manifest: { ...alpha.manifest, capabilities: ['thinking'] },
                        createNervousSystem: jest.fn(),
                    },
                ],
            ),
        ).toThrow('SPARK module onion.alpha exposes nervous rules without declaring the nervous-rules capability');
    });

    it.each([
        ['hooks', { hooks: jest.fn(() => []) }, 'hooks'],
        ['candidates', { candidates: jest.fn(() => []) }, 'candidates'],
        ['prompt sections', { promptSections: jest.fn(() => []) }, 'prompt-sections'],
        ['attempt observer', { observeAttempt: jest.fn() }, 'attempt-observer'],
        ['benchmarks', { benchmarks: jest.fn(() => []) }, 'benchmarks'],
    ] as const)('throws when %s are not declared in capabilities', (_label, extension, capability) => {
        expect(() =>
            resolveSparkModules(
                [{ id: 'onion.alpha' }],
                [
                    {
                        ...alpha,
                        manifest: { ...alpha.manifest, capabilities: ['thinking'] },
                        ...extension,
                    },
                ],
            ),
        ).toThrow(`SPARK module onion.alpha exposes ${capability} without declaring the ${capability} capability`);
    });

    it('accepts declared future extension facets without exposing them as callable module contract', () => {
        expect(() =>
            resolveSparkModules(
                [{ id: 'onion.alpha' }],
                [
                    {
                        ...alpha,
                        manifest: {
                            ...alpha.manifest,
                            capabilities: ['thinking', 'hooks', 'candidates', 'prompt-sections', 'attempt-observer', 'benchmarks'],
                        },
                        hooks: jest.fn(() => []),
                        candidates: jest.fn(() => []),
                        promptSections: jest.fn(() => []),
                        observeAttempt: jest.fn(),
                        benchmarks: jest.fn(() => []),
                    } as unknown as SparkModule,
                ],
            ),
        ).not.toThrow();
    });

    it('rejects experimental modules in the reviewed in-repo seam', () => {
        expect(() =>
            resolveSparkModules([{ id: 'onion.alpha' }], [{ ...alpha, manifest: { ...alpha.manifest, risk: 'experimental' } }]),
        ).toThrow('SPARK module onion.alpha is experimental and cannot be selected by SOUL');
    });
});

function module(id: string): SparkModule {
    return {
        manifest: {
            id,
            version: '0.1.0',
            displayName: id,
            capabilities: ['thinking'],
            risk: 'reviewed',
        },
    };
}
