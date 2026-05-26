import type { SparkModuleManifest } from './modules';

export const RUNESCAPE_STANDARD_SPARK_MODULE_ID = 'onion.runescape.standard';

export const RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST: SparkModuleManifest = {
    id: RUNESCAPE_STANDARD_SPARK_MODULE_ID,
    version: '0.1.0',
    displayName: 'RuneScape Standard',
    owner: 'OnionDAO',
    description: 'The reviewed standard RuneScape resident Brain/Body/Nervous compatibility module.',
    capabilities: ['thinking', 'nervous-rules'],
    risk: 'reviewed',
};
