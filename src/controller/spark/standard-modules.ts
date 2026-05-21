import { NervousSystem } from '../nervous-system';
import { HybridAgentThinkingModule } from '../thinking/hybrid-agent-thinking-module';
import type { SparkModule } from './modules';

export const RUNESCAPE_STANDARD_SPARK_MODULE_ID = 'onion.runescape.standard';

export function standardSparkModules(): SparkModule[] {
    return [runescapeStandardSparkModule()];
}

export function runescapeStandardSparkModule(): SparkModule {
    return {
        manifest: {
            id: RUNESCAPE_STANDARD_SPARK_MODULE_ID,
            version: '0.1.0',
            displayName: 'RuneScape Standard',
            owner: 'OnionDAO',
            description: 'The reviewed standard RuneScape resident Brain/Body/Nervous compatibility module.',
            capabilities: ['thinking', 'nervous-rules'],
            risk: 'reviewed',
        },
        createThinkingModule: context => new HybridAgentThinkingModule(context),
        createNervousSystem: context => new NervousSystem(context),
    };
}
