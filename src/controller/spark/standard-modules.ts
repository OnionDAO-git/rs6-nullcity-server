import { NervousSystem } from '../nervous-system';
import { HybridAgentThinkingModule } from '../thinking/hybrid-agent-thinking-module';
import type { SparkModule } from './modules';
import { RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST } from './standard-module-metadata';
export { RUNESCAPE_STANDARD_SPARK_MODULE_ID, RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST } from './standard-module-metadata';

export function standardSparkModules(): SparkModule[] {
    return [runescapeStandardSparkModule()];
}

export function runescapeStandardSparkModule(): SparkModule {
    return {
        manifest: RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST,
        createThinkingModule: context => new HybridAgentThinkingModule(context),
        createNervousSystem: context => new NervousSystem(context),
    };
}
