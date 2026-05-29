import {
    BASE_LOADED_ZONE_RADIUS,
    DEFAULT_LOADED_ZONE_SCALE,
    MAX_LOADED_ZONE_SCALE,
    getLoadedMapBuildArea,
    getLoadedMapRegions,
    normalizeLoadedZoneScale,
} from './map-build-area';

describe('map build area', () => {
    it('preserves the current 13x13-zone area at 1x', () => {
        const position = { chunkX: 50, chunkY: 44 };
        const area = getLoadedMapBuildArea(position, 1);

        expect(area).toEqual({
            scale: 1,
            centerZoneX: position.chunkX + BASE_LOADED_ZONE_RADIUS,
            centerZoneY: position.chunkY + BASE_LOADED_ZONE_RADIUS,
            radiusZones: BASE_LOADED_ZONE_RADIUS,
            zones: 13,
            sizeTiles: 104,
            baseTileX: position.chunkX * 8,
            baseTileY: position.chunkY * 8,
            localTileX: BASE_LOADED_ZONE_RADIUS * 8,
            localTileY: BASE_LOADED_ZONE_RADIUS * 8,
            minRegionX: Math.floor(position.chunkX / 8),
            maxRegionX: Math.floor((position.chunkX + 12) / 8),
            minRegionY: Math.floor(position.chunkY / 8),
            maxRegionY: Math.floor((position.chunkY + 12) / 8),
        });
    });

    it('expands the implicit region list by loaded-zone scale', () => {
        const position = { chunkX: 50, chunkY: 44 };
        const regions = getLoadedMapRegions(position, 4);

        expect(regions[0]).toEqual({ x: 4, y: 3, id: (4 << 8) + 3 });
        expect(regions[regions.length - 1]).toEqual({ x: 10, y: 9, id: (10 << 8) + 9 });
        expect(regions).toHaveLength(49);
    });

    it('expands local coordinates around the same center chunk', () => {
        const position = {
            x: 3222,
            y: 3219,
            chunkX: (3222 >> 3) - BASE_LOADED_ZONE_RADIUS,
            chunkY: (3219 >> 3) - BASE_LOADED_ZONE_RADIUS,
        };
        const area = getLoadedMapBuildArea(position, 4);

        expect(area.radiusZones).toBe(24);
        expect(area.zones).toBe(49);
        expect(area.localTileX).toBe(24 * 8 + (3222 & 0x7));
        expect(area.localTileY).toBe(24 * 8 + (3219 & 0x7));
    });

    it('normalizes configured scale to the supported packet range', () => {
        expect(normalizeLoadedZoneScale(undefined)).toBe(DEFAULT_LOADED_ZONE_SCALE);
        expect(normalizeLoadedZoneScale(0)).toBe(1);
        expect(normalizeLoadedZoneScale(1)).toBe(1);
        expect(normalizeLoadedZoneScale(2.8)).toBe(2);
        expect(normalizeLoadedZoneScale(99)).toBe(MAX_LOADED_ZONE_SCALE);
    });
});
