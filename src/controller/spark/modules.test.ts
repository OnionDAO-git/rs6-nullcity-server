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
