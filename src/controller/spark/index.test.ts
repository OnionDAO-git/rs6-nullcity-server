describe('spark public barrel', () => {
    it('exposes pure standard module metadata without loading executable module factories', () => {
        jest.isolateModules(() => {
            jest.doMock('../thinking/hybrid-agent-thinking-module', () => {
                throw new Error('hybrid thinking stack should not load from spark metadata barrel');
            });

            expect(() => require('./index')).not.toThrow();
            const spark = require('./index') as Record<string, unknown>;

            expect(spark.RUNESCAPE_STANDARD_SPARK_MODULE_ID).toBe('onion.runescape.standard');
            expect(spark.RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST).toMatchObject({
                id: 'onion.runescape.standard',
                version: '0.1.0',
            });
            expect(spark.standardSparkModules).toBeUndefined();
            expect(spark.runescapeStandardSparkModule).toBeUndefined();
        });
    });
});
