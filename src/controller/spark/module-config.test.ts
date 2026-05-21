import { validateSparkModuleConfig, type SparkModuleConfigPolicy, type SparkModuleConfigSchema } from './module-config';

describe('validateSparkModuleConfig', () => {
    it('accepts small data-only config objects', () => {
        expect(validateSparkModuleConfig({ mode: 'careful', weights: [1, 2], nested: { enabled: true } })).toEqual({
            mode: 'careful',
            weights: [1, 2],
            nested: { enabled: true },
        });
    });

    it('uses reviewed module schema before returning config', () => {
        const schema: SparkModuleConfigSchema = {
            parse: jest.fn(() => ({ mode: 'schema-default' })),
        };

        expect(validateSparkModuleConfig({}, { schema })).toEqual({ mode: 'schema-default' });
    });

    it('rejects secret-shaped keys', () => {
        expect(() => validateSparkModuleConfig({ apiKey: 'abc123' })).toThrow(
            'SPARK module config apiKey is not allowed to contain secret-like fields',
        );
    });

    it('rejects secret-looking string values', () => {
        expect(() => validateSparkModuleConfig({ note: 'Use OPENAI_API_KEY=supersecret for testing' })).toThrow(
            'SPARK module config note is not allowed to contain secret-like values',
        );
        expect(() => validateSparkModuleConfig({ nested: { label: 'sk-or-v1-supersecretvalue' } })).toThrow(
            'SPARK module config nested.label is not allowed to contain secret-like values',
        );
    });

    it('returns an immutable clone of validated config', () => {
        const input = { mode: 'careful', nested: { enabled: true } };
        const config = validateSparkModuleConfig(input);

        expect(config).toEqual(input);
        expect(config).not.toBe(input);
        expect(config.nested).not.toBe(input.nested);
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.nested)).toBe(true);
        expect(() => {
            config.mode = 'reckless';
        }).toThrow();
        expect(() => {
            (config.nested as Record<string, unknown>).enabled = false;
        }).toThrow();
        expect(input.mode).toBe('careful');
        expect(input.nested.enabled).toBe(true);
    });

    it('rejects endpoint-looking strings unless the field is explicitly allowed', () => {
        expect(() => validateSparkModuleConfig({ endpoint: 'http://example.test/api' })).toThrow(
            'SPARK module config endpoint is not allowed to contain endpoint URLs',
        );

        const policy: SparkModuleConfigPolicy = { allowEndpointFields: ['endpoint'] };
        expect(validateSparkModuleConfig({ endpoint: 'http://example.test/api' }, { policy })).toEqual({
            endpoint: 'http://example.test/api',
        });
    });

    it('rejects path-looking strings unless the field is explicitly allowed', () => {
        expect(() => validateSparkModuleConfig({ dataPath: '../private/file.md' })).toThrow(
            'SPARK module config dataPath is not allowed to contain filesystem paths',
        );

        const policy: SparkModuleConfigPolicy = { allowPathFields: ['dataPath'] };
        expect(validateSparkModuleConfig({ dataPath: 'runescape/skill.md' }, { policy })).toEqual({
            dataPath: 'runescape/skill.md',
        });
    });

    it('rejects oversized and too-deep config', () => {
        expect(() => validateSparkModuleConfig({ text: 'x'.repeat(5000) })).toThrow('SPARK module config exceeds 4096 bytes');
        expect(() => validateSparkModuleConfig({ a: { b: { c: { d: { e: { f: { g: true } } } } } } })).toThrow(
            'SPARK module config exceeds max depth 6',
        );
    });
});
