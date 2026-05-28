export const MIN_LOADED_ZONE_SCALE = 1;
export const DEFAULT_LOADED_ZONE_SCALE = 1;
export const MAX_LOADED_ZONE_SCALE = 4;
export const BASE_LOADED_ZONE_RADIUS = 6;

export interface MapBuildPosition {
    x?: number;
    y?: number;
    chunkX: number;
    chunkY: number;
}

export interface LoadedMapRegion {
    x: number;
    y: number;
    id: number;
}

export interface LoadedMapBuildArea {
    scale: number;
    centerZoneX: number;
    centerZoneY: number;
    radiusZones: number;
    zones: number;
    sizeTiles: number;
    baseTileX: number;
    baseTileY: number;
    localTileX: number;
    localTileY: number;
    minRegionX: number;
    maxRegionX: number;
    minRegionY: number;
    maxRegionY: number;
}

export function normalizeLoadedZoneScale(scale: number | undefined | null): number {
    if (typeof scale !== 'number' || !Number.isFinite(scale)) {
        return DEFAULT_LOADED_ZONE_SCALE;
    }

    return Math.min(MAX_LOADED_ZONE_SCALE, Math.max(MIN_LOADED_ZONE_SCALE, Math.trunc(scale)));
}

export function getLoadedMapBuildArea(position: MapBuildPosition, scale?: number | null): LoadedMapBuildArea {
    const normalizedScale = normalizeLoadedZoneScale(scale);
    const radiusZones = BASE_LOADED_ZONE_RADIUS * normalizedScale;
    const centerZoneX = position.chunkX + BASE_LOADED_ZONE_RADIUS;
    const centerZoneY = position.chunkY + BASE_LOADED_ZONE_RADIUS;
    const zones = radiusZones * 2 + 1;
    const sizeTiles = zones * 8;
    const baseTileX = (centerZoneX - radiusZones) * 8;
    const baseTileY = (centerZoneY - radiusZones) * 8;
    const worldX = position.x ?? centerZoneX * 8;
    const worldY = position.y ?? centerZoneY * 8;

    return {
        scale: normalizedScale,
        centerZoneX,
        centerZoneY,
        radiusZones,
        zones,
        sizeTiles,
        baseTileX,
        baseTileY,
        localTileX: worldX - baseTileX,
        localTileY: worldY - baseTileY,
        minRegionX: Math.floor((centerZoneX - radiusZones) / 8),
        maxRegionX: Math.floor((centerZoneX + radiusZones) / 8),
        minRegionY: Math.floor((centerZoneY - radiusZones) / 8),
        maxRegionY: Math.floor((centerZoneY + radiusZones) / 8),
    };
}

export function getLoadedMapRegions(position: MapBuildPosition, scale?: number | null): LoadedMapRegion[] {
    const area = getLoadedMapBuildArea(position, scale);
    const regions: LoadedMapRegion[] = [];

    for (let mapX = area.minRegionX; mapX <= area.maxRegionX; mapX++) {
        for (let mapY = area.minRegionY; mapY <= area.maxRegionY; mapY++) {
            regions.push({ x: mapX, y: mapY, id: (mapX << 8) + mapY });
        }
    }

    return regions;
}
