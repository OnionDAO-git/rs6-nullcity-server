import { FACTIONS } from './factions/factions';
import { RUNESCAPE_STANDARD_SPARK_MODULE_ID, RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST } from './spark/standard-module-metadata';
import { EMOTION_PRESETS, MODULE_UI_METADATA, UI_METADATA, factionWallColor, moduleUiMetadata } from './ui-metadata';

describe('UI_METADATA', () => {
    it('exports one UI metadata row for each faction catalog entry', () => {
        expect(UI_METADATA.factions).toHaveLength(FACTIONS.length);

        for (const faction of FACTIONS) {
            expect(UI_METADATA.factionsById[faction.id]).toMatchObject({
                id: faction.id,
                displayName: faction.displayName,
                color: faction.color,
                wallColor: faction.id === 'veil' ? faction.accentColor : faction.color,
                visualTreatment: faction.visualTreatment,
            });
        }
    });

    it('keeps the redacted Veil wall color readable through the accent color', () => {
        expect(factionWallColor('veil')).toBe('#660000');
    });

    it('returns the primary color for standard factions and undefined for unknown factions', () => {
        expect(factionWallColor('foundry')).toBe('#B87333');
        expect(factionWallColor('missing')).toBeUndefined();
    });

    it('exports metadata for the standard SPARK module', () => {
        const standard = moduleUiMetadata(RUNESCAPE_STANDARD_SPARK_MODULE_ID);

        expect(standard).toMatchObject({
            id: RUNESCAPE_STANDARD_SPARK_MODULE_ID,
            displayName: 'RuneScape Standard',
            version: '0.1.0',
            risk: 'reviewed',
        });
        expect(MODULE_UI_METADATA).toContainEqual(standard);
    });

    it('exports the canonical five Null City emotion presets for dashboard and wall surfaces', () => {
        expect(EMOTION_PRESETS.map(preset => preset.id)).toEqual(['stillness', 'reverie', 'unease', 'anguish', 'fury']);
        for (const preset of EMOTION_PRESETS) {
            expect(preset.color).toMatch(/^#[0-9A-F]{6}$/);
            expect(preset.weight).toBeGreaterThan(0);
        }
    });

    it('does not alias mutable module manifest capability arrays', () => {
        const standard = moduleUiMetadata(RUNESCAPE_STANDARD_SPARK_MODULE_ID);

        expect(standard?.capabilities).toEqual(['thinking', 'nervous-rules']);
        expect(standard?.capabilities).not.toBe(RUNESCAPE_STANDARD_SPARK_MODULE_MANIFEST.capabilities);
    });
});
