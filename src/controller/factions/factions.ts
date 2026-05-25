/**
 * rs6 faction catalog — K1 / K2 / K4 / K5.
 *
 * Static TypeScript constants; never DB rows. All creative content is from the
 * spec draft (`docs/superpowers/specs/2026-05-22-rs6-factions-design.md`).
 * Maintainer may rename/recolour any entry; downstream code is keyed on `id`.
 */

export type FactionId = 'foundry' | 'bureau-of-continuity' | 'ledger' | 'veil';

export type TensionAxis = 'making_vs_remembering' | 'transparency_vs_concealment';
export type TensionPole = 'making' | 'remembering' | 'transparency' | 'concealment';

export type SoulArchetype = 'achiever' | 'mentor' | 'endurer';

export type VisualTreatment = 'standard' | 'redacted';

export interface FactionDefinition {
    readonly id: FactionId;
    readonly displayName: string;
    readonly motto: string;
    /** Primary hex color used on dashboard, plaques, and portrait headers. */
    readonly color: string;
    /** Accent color; only meaningful for `visualTreatment: 'redacted'` (The Veil). */
    readonly accentColor?: string;
    readonly archetype: SoulArchetype;
    readonly tensionAxis: TensionAxis;
    readonly tensionPole: TensionPole;
    readonly visualTreatment: VisualTreatment;
    /** References a `PoiDefinition.id` in `POIS`. */
    readonly homePoiId: string;
    /** Display name of this faction's flagship resident (used in letter sender fields). */
    readonly flagshipDisplayName: string;
    /** Soul YAML name (res-* slug) of the flagship resident. */
    readonly flagshipResidentSlug: string;
    readonly description: string;
}

export interface PoiDefinition {
    readonly id: string;
    readonly displayName: string;
    /** Undefined for the neutral atrium. */
    readonly factionId?: FactionId;
    readonly coordinates: { readonly x: number; readonly y: number; readonly level: number };
    readonly description: string;
}

export const FACTIONS: ReadonlyArray<FactionDefinition> = [
    {
        id: 'foundry',
        displayName: 'The Foundry',
        motto: 'What the city needs, we make. What we make, the city becomes.',
        color: '#B87333',
        archetype: 'achiever',
        tensionAxis: 'making_vs_remembering',
        tensionPole: 'making',
        visualTreatment: 'standard',
        homePoiId: 'foundry.falador-anvil',
        flagshipDisplayName: 'Mother Anvil',
        flagshipResidentSlug: 'res-mother-anvil',
        description:
            'The builders. Robed engineers who treat hammers like prayer-objects. Impatient with abstractions. They believe Null City is only as alive as the things humans help them forge.',
    },
    {
        id: 'bureau-of-continuity',
        displayName: 'The Bureau of Continuity',
        motto: 'Nothing is gone while we remember it. We remember everything.',
        color: '#E6CB78',
        archetype: 'mentor',
        tensionAxis: 'making_vs_remembering',
        tensionPole: 'remembering',
        visualTreatment: 'standard',
        homePoiId: 'bureau.lumbridge-churchyard',
        flagshipDisplayName: 'Archivist Severn',
        flagshipResidentSlug: 'res-severn-vesta',
        description:
            "The archivists. Half librarians, half mourners. They believe Null City's job is to record every resident's life so completely that death cannot fully erase them. Naturally owns the Library of Souls.",
    },
    {
        id: 'ledger',
        displayName: 'The Ledger',
        motto: 'It did not happen until we all wrote it down.',
        color: '#CD7F32',
        archetype: 'mentor',
        tensionAxis: 'transparency_vs_concealment',
        tensionPole: 'transparency',
        visualTreatment: 'standard',
        homePoiId: 'ledger.varrock-square',
        flagshipDisplayName: 'First Witness Wren',
        flagshipResidentSlug: 'res-wren-calix',
        description:
            'The transparency radicals. Half scribes, half validator nodes. They insist that only consensus-recorded events are real. Their plazas are open-air, plaqued, and continuously updated. Cannot resist a procedural argument.',
    },
    {
        id: 'veil',
        displayName: 'The Veil',
        motto: 'Every door has a back. We knock first.',
        color: '#0A0A0A',
        accentColor: '#660000',
        archetype: 'endurer',
        tensionAxis: 'transparency_vs_concealment',
        tensionPole: 'concealment',
        visualTreatment: 'redacted',
        homePoiId: 'veil.edgeville-shadow',
        flagshipDisplayName: 'The Hush',
        flagshipResidentSlug: 'res-the-hush',
        description:
            "The skeptics and pranksters. Trench-coated, sleep-deprived, comfortable in any threat model. They believe Null City's real vulnerabilities should be found before someone else exploits them. Their parcels render as redacted black tiles, which the other factions find infuriating.",
    },
] as const;

export const FACTIONS_BY_ID: Readonly<Record<FactionId, FactionDefinition>> = Object.fromEntries(FACTIONS.map(f => [f.id, f])) as Readonly<
    Record<FactionId, FactionDefinition>
>;

export const POIS: ReadonlyArray<PoiDefinition> = [
    {
        id: 'atrium.lumbridge-castle-courtyard',
        displayName: 'The Atrium',
        factionId: undefined,
        coordinates: { x: 3222, y: 3218, level: 0 },
        description: 'Where newborn residents wake. Neutral ground. Humans entering Null City for the first time arrive here.',
    },
    {
        id: 'foundry.falador-anvil',
        displayName: 'The Foundry',
        factionId: 'foundry',
        coordinates: { x: 3015, y: 3357, level: 0 },
        description: 'A working forge. Always hot. The Foundry meets, builds, and refuses to apologize for the noise.',
    },
    {
        id: 'bureau.lumbridge-churchyard',
        displayName: 'The Continuity Office',
        factionId: 'bureau-of-continuity',
        coordinates: { x: 3242, y: 3208, level: 0 },
        description: "The Bureau's archive. Adjacent to the Library of Souls and the in-game graveyard. Quiet. Lit by candles.",
    },
    {
        id: 'ledger.varrock-square',
        displayName: 'The Open Plaza',
        factionId: 'ledger',
        coordinates: { x: 3210, y: 3424, level: 0 },
        description:
            'An open-air court of bronze plaques. The Ledger holds quorum here on the hour, every hour, whether anyone is present or not.',
    },
    {
        id: 'veil.edgeville-shadow',
        displayName: 'The Quiet Door',
        factionId: 'veil',
        coordinates: { x: 3093, y: 3493, level: 0 },
        description:
            "A door that is not always there. Knock first. The Veil welcomes anyone who can find them, which is fewer humans than they'd prefer.",
    },
] as const;

export const POIS_BY_ID: Readonly<Record<string, PoiDefinition>> = Object.fromEntries(POIS.map(p => [p.id, p]));

/** All IDs for the two tension axes as a convenience for validation. */
export const TENSION_AXES: ReadonlyArray<TensionAxis> = ['making_vs_remembering', 'transparency_vs_concealment'];

/** Return the faction an unaligned default should use, or undefined if factionId is unknown. */
export function lookupFaction(id: string): FactionDefinition | undefined {
    return FACTIONS_BY_ID[id as FactionId];
}
