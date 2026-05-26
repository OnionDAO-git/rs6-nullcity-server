import { FACTIONS, lookupFaction, type FactionId, type VisualTreatment } from './factions/factions';
import { RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST } from './spark/standard-module-metadata';

export interface FactionUiMetadata {
    readonly id: FactionId;
    readonly displayName: string;
    readonly color: string;
    readonly accentColor?: string;
    readonly wallColor: string;
    readonly visualTreatment: VisualTreatment;
}

export interface ModuleUiMetadata {
    readonly id: string;
    readonly version: string;
    readonly displayName: string;
    readonly owner?: string;
    readonly risk?: 'core' | 'reviewed' | 'experimental';
    readonly capabilities: readonly string[];
}

export interface EmotionPresetUiMetadata {
    readonly id: 'stillness' | 'reverie' | 'unease' | 'anguish' | 'fury';
    readonly label: string;
    readonly color: string;
    readonly weight: number;
}

export const FACTION_UI_METADATA: ReadonlyArray<FactionUiMetadata> = FACTIONS.map(faction => ({
    id: faction.id,
    displayName: faction.displayName,
    color: faction.color,
    accentColor: faction.accentColor,
    wallColor: faction.color === '#0A0A0A' && faction.accentColor ? faction.accentColor : faction.color,
    visualTreatment: faction.visualTreatment,
}));

export const FACTION_UI_METADATA_BY_ID: Readonly<Record<FactionId, FactionUiMetadata>> = Object.fromEntries(
    FACTION_UI_METADATA.map(faction => [faction.id, faction]),
) as Readonly<Record<FactionId, FactionUiMetadata>>;

export const MODULE_UI_METADATA: ReadonlyArray<ModuleUiMetadata> = [RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST].map(manifest => ({
    id: manifest.id,
    version: manifest.version,
    displayName: manifest.displayName,
    owner: manifest.owner,
    risk: manifest.risk,
    capabilities: [...manifest.capabilities],
}));

export const MODULE_UI_METADATA_BY_ID: Readonly<Record<string, ModuleUiMetadata>> = Object.fromEntries(
    MODULE_UI_METADATA.map(module => [module.id, module]),
);

export const EMOTION_PRESETS: ReadonlyArray<EmotionPresetUiMetadata> = [
    { id: 'stillness', label: 'Stillness', color: '#7FA7B8', weight: 1 },
    { id: 'reverie', label: 'Reverie', color: '#70A870', weight: 1.1 },
    { id: 'unease', label: 'Unease', color: '#C8913A', weight: 1.2 },
    { id: 'anguish', label: 'Anguish', color: '#7A6FA0', weight: 1.3 },
    { id: 'fury', label: 'Fury', color: '#B84A3A', weight: 1.3 },
];

export const UI_METADATA = {
    factions: FACTION_UI_METADATA,
    factionsById: FACTION_UI_METADATA_BY_ID,
    modules: MODULE_UI_METADATA,
    modulesById: MODULE_UI_METADATA_BY_ID,
    emotionPresets: EMOTION_PRESETS,
} as const;

export function factionWallColor(id: string): string | undefined {
    return factionUiMetadata(id)?.wallColor;
}

export function factionUiMetadata(id: string): FactionUiMetadata | undefined {
    const faction = lookupFaction(id);
    if (!faction) {
        return undefined;
    }
    return FACTION_UI_METADATA_BY_ID[faction.id];
}

export function moduleUiMetadata(id: string): ModuleUiMetadata | undefined {
    return MODULE_UI_METADATA_BY_ID[id];
}
