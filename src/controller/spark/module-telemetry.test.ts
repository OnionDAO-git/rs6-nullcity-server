import { createSparkModuleTelemetry } from './module-telemetry';

describe('createSparkModuleTelemetry', () => {
    const module = { id: 'onion.test', version: '0.1.0' };

    it('emits bounded redacted module telemetry to the provided sink', () => {
        const append = jest.fn();
        const telemetry = createSparkModuleTelemetry({
            resident: 'res:test',
            module,
            append,
            maxBytes: 1024,
            maxTextLength: 64,
        });

        telemetry.emit({
            kind: 'decision',
            message: 'Using OPENAI_API_KEY=supersecret to choose action',
            data: { note: 'token sk-or-v1-secretvalue', count: 1 },
        });

        expect(append).toHaveBeenCalledWith({
            cause: 'module_telemetry',
            resident: 'res:test',
            sparkModule: module,
            telemetry: {
                kind: 'decision',
                message: 'Using [redacted] to choose action',
                data: { note: 'token [redacted]', count: 1 },
            },
        });
    });

    it('rejects unsupported event kinds and secret-shaped keys', () => {
        const telemetry = createSparkModuleTelemetry({ resident: 'res:test', module, append: jest.fn() });

        expect(() => telemetry.emit({ kind: 'trace', message: 'hello' } as never)).toThrow(
            'SPARK module telemetry kind trace is not allowed',
        );
        expect(() => telemetry.emit({ kind: 'debug', data: { apiKey: 'abc123' } })).toThrow(
            'SPARK module telemetry data.apiKey is not allowed to contain secret-like fields',
        );
    });

    it('rejects entries over the configured size cap', () => {
        const telemetry = createSparkModuleTelemetry({ resident: 'res:test', module, append: jest.fn(), maxBytes: 80 });

        expect(() => telemetry.emit({ kind: 'observation', message: 'x'.repeat(500) })).toThrow('SPARK module telemetry exceeds 80 bytes');
    });

    it('can be disabled without throwing', () => {
        const telemetry = createSparkModuleTelemetry({ resident: 'res:test', module });

        expect(() => telemetry.emit({ kind: 'metric', data: { score: 1 } })).not.toThrow();
    });
});
