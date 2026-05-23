import {
    EMBASSY_REGION,
    embassyCenter,
    embassyContainsAny,
    isInsideEmbassy,
    type EmbassyRegion,
    type Coord3,
} from './embassy';

describe('EMBASSY_REGION', () => {
    it('defaults to a 10x10 tile cluster in the Lumbridge churchyard at level 0', () => {
        // Lumbridge church coord per docs/runescape-skill/places/lumbridge.md is 3242,3208,0.
        // The cluster spans the church + grounds.
        expect(EMBASSY_REGION).toEqual({
            id: 'lumbridge-churchyard',
            level: 0,
            x: { min: 3238, max: 3248 },
            y: { min: 3204, max: 3214 },
        });
    });

    it('is at least 10x10 tiles so the reception NPC + plaque + faction kiosks fit (per N spec)', () => {
        const width = EMBASSY_REGION.x.max - EMBASSY_REGION.x.min;
        const height = EMBASSY_REGION.y.max - EMBASSY_REGION.y.min;
        expect(width).toBeGreaterThanOrEqual(10);
        expect(height).toBeGreaterThanOrEqual(10);
    });
});

describe('isInsideEmbassy', () => {
    it('returns true for a coord strictly inside the embassy bounds', () => {
        expect(isInsideEmbassy({ x: 3243, y: 3209, level: 0 })).toBe(true);
    });

    it('returns true for a coord exactly on the embassy boundary', () => {
        expect(isInsideEmbassy({ x: 3238, y: 3204, level: 0 })).toBe(true);
        expect(isInsideEmbassy({ x: 3248, y: 3214, level: 0 })).toBe(true);
    });

    it('returns false for a coord one tile outside the embassy bounds', () => {
        expect(isInsideEmbassy({ x: 3237, y: 3209, level: 0 })).toBe(false);
        expect(isInsideEmbassy({ x: 3249, y: 3209, level: 0 })).toBe(false);
        expect(isInsideEmbassy({ x: 3243, y: 3203, level: 0 })).toBe(false);
        expect(isInsideEmbassy({ x: 3243, y: 3215, level: 0 })).toBe(false);
    });

    it('returns false for a coord at the correct x/y but wrong level', () => {
        expect(isInsideEmbassy({ x: 3243, y: 3209, level: 1 })).toBe(false);
        expect(isInsideEmbassy({ x: 3243, y: 3209, level: 2 })).toBe(false);
    });

    it('returns false for a coord far away (Varrock)', () => {
        expect(isInsideEmbassy({ x: 3211, y: 3424, level: 0 })).toBe(false);
    });

    it('accepts an alternate region passed explicitly', () => {
        const alt: EmbassyRegion = {
            id: 'varrock-museum',
            level: 0,
            x: { min: 3251, max: 3261 },
            y: { min: 3447, max: 3457 },
        };
        expect(isInsideEmbassy({ x: 3255, y: 3452, level: 0 }, alt)).toBe(true);
        expect(isInsideEmbassy({ x: 3243, y: 3209, level: 0 }, alt)).toBe(false);
    });
});

describe('embassyCenter', () => {
    it('returns the geometric centre of the default region', () => {
        // (3238+3248)/2 = 3243, (3204+3214)/2 = 3209
        expect(embassyCenter()).toEqual({ x: 3243, y: 3209, level: 0 });
    });

    it('returns the centre of an alternate region', () => {
        const alt: EmbassyRegion = {
            id: 'varrock-museum',
            level: 0,
            x: { min: 3250, max: 3260 },
            y: { min: 3440, max: 3450 },
        };
        expect(embassyCenter(alt)).toEqual({ x: 3255, y: 3445, level: 0 });
    });
});

describe('embassyContainsAny', () => {
    it('returns true when at least one coord is inside the region', () => {
        const coords: Coord3[] = [
            { x: 3211, y: 3424, level: 0 }, // Varrock — outside
            { x: 3243, y: 3209, level: 0 }, // Lumbridge churchyard — inside
        ];
        expect(embassyContainsAny(coords)).toBe(true);
    });

    it('returns false when no coords are inside the region', () => {
        const coords: Coord3[] = [
            { x: 3211, y: 3424, level: 0 },
            { x: 3094, y: 3243, level: 0 },
        ];
        expect(embassyContainsAny(coords)).toBe(false);
    });

    it('returns false for an empty list', () => {
        expect(embassyContainsAny([])).toBe(false);
    });
});
