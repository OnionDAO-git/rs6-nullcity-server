import * as fs from 'node:fs';
import * as path from 'node:path';
import { FACTIONS, FACTIONS_BY_ID, POIS, POIS_BY_ID, TENSION_AXES, lookupFaction, type FactionId } from './factions';

describe('rs6 faction catalog integrity', () => {
    test('exactly four factions defined', () => {
        expect(FACTIONS).toHaveLength(4);
    });

    test('all faction ids are unique', () => {
        const ids = FACTIONS.map(f => f.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('all faction display names are unique', () => {
        const names = FACTIONS.map(f => f.displayName);
        expect(new Set(names).size).toBe(names.length);
    });

    test('all faction colors are unique', () => {
        const colors = FACTIONS.map(f => f.color);
        expect(new Set(colors).size).toBe(colors.length);
    });

    test('all faction mottos are unique', () => {
        const mottos = FACTIONS.map(f => f.motto);
        expect(new Set(mottos).size).toBe(mottos.length);
    });

    test('each tension axis has exactly two factions', () => {
        for (const axis of TENSION_AXES) {
            const onAxis = FACTIONS.filter(f => f.tensionAxis === axis);
            expect(onAxis).toHaveLength(2);
        }
    });

    test('each tension axis has one faction on each pole', () => {
        for (const axis of TENSION_AXES) {
            const onAxis = FACTIONS.filter(f => f.tensionAxis === axis);
            const poles = new Set(onAxis.map(f => f.tensionPole));
            expect(poles.size).toBe(2);
        }
    });

    test('FACTIONS_BY_ID round-trip: FACTIONS_BY_ID[id].id === id', () => {
        for (const faction of FACTIONS) {
            expect(FACTIONS_BY_ID[faction.id].id).toBe(faction.id);
        }
    });

    test('each faction homePoiId resolves to a POIS entry', () => {
        for (const faction of FACTIONS) {
            const poi = POIS_BY_ID[faction.homePoiId];
            expect(poi).toBeDefined();
            expect(poi.id).toBe(faction.homePoiId);
        }
    });

    test('each faction homePoiId resolves to a POI whose factionId matches', () => {
        for (const faction of FACTIONS) {
            const poi = POIS_BY_ID[faction.homePoiId];
            expect(poi.factionId).toBe(faction.id);
        }
    });

    test('exactly five POIs (four faction homes + one neutral atrium)', () => {
        expect(POIS).toHaveLength(5);
    });

    test('exactly one neutral POI (no factionId)', () => {
        const neutral = POIS.filter(p => p.factionId === undefined);
        expect(neutral).toHaveLength(1);
        expect(neutral[0].id).toBe('atrium.lumbridge-castle-courtyard');
    });

    test('all POI ids are unique', () => {
        const ids = POIS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('all POI coordinates are valid non-negative integers', () => {
        for (const poi of POIS) {
            expect(Number.isInteger(poi.coordinates.x)).toBe(true);
            expect(Number.isInteger(poi.coordinates.y)).toBe(true);
            expect(poi.coordinates.x).toBeGreaterThan(0);
            expect(poi.coordinates.y).toBeGreaterThan(0);
            expect(poi.coordinates.level).toBeGreaterThanOrEqual(0);
        }
    });

    test('all factions have non-empty flagship slugs', () => {
        for (const faction of FACTIONS) {
            expect(faction.flagshipResidentSlug.length).toBeGreaterThan(0);
            expect(faction.flagshipDisplayName.length).toBeGreaterThan(0);
        }
    });

    test('veil has a distinct accent color and redacted visual treatment', () => {
        const veil = FACTIONS_BY_ID['veil'];
        expect(veil.visualTreatment).toBe('redacted');
        expect(veil.accentColor).toBeDefined();
        expect(veil.accentColor).not.toBe(veil.color);
    });

    test('non-veil factions have standard visual treatment', () => {
        const nonVeil = FACTIONS.filter(f => f.id !== 'veil');
        for (const faction of nonVeil) {
            expect(faction.visualTreatment).toBe('standard');
        }
    });

    test('lookupFaction returns a faction for all valid IDs', () => {
        const ids: FactionId[] = ['foundry', 'bureau-of-continuity', 'ledger', 'veil'];
        for (const id of ids) {
            const f = lookupFaction(id);
            expect(f).toBeDefined();
            expect(f?.id).toBe(id);
        }
    });

    test('lookupFaction returns undefined for unknown ids', () => {
        expect(lookupFaction('unknown-faction')).toBeUndefined();
        expect(lookupFaction('')).toBeUndefined();
        expect(lookupFaction('unaligned')).toBeUndefined();
    });

    test('TENSION_AXES covers all axes used by factions', () => {
        const usedAxes = new Set(FACTIONS.map(f => f.tensionAxis));
        for (const axis of usedAxes) {
            expect(TENSION_AXES).toContain(axis);
        }
    });

    test('K3: each faction flagship soul file exists in starter-souls/', () => {
        const soulsDir = path.join(__dirname, '..', 'soul', 'starter-souls');
        for (const faction of FACTIONS) {
            const soulFile = path.join(soulsDir, `${faction.flagshipResidentSlug}.md`);
            expect(fs.existsSync(soulFile)).toBe(true);
        }
    });
});
