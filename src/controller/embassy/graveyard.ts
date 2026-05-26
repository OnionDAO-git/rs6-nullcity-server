import fs from 'fs';
import path from 'path';
import { activeWorld } from '@engine/world';
import { Task } from '@engine/task/task';
import { TaskStackType } from '@engine/task/types';
import { loadControllerConfig } from '../config';
import { SoulLoader } from '../soul/soul-loader';
import { dominantFaction } from '../soul/soul-schema';
import type { LandscapeObject } from '@runejs/filestore';

export const GRAVEYARD_SPOTS = [
    { x: 3241, y: 3193, level: 0 },
    { x: 3243, y: 3193, level: 0 },
    { x: 3245, y: 3193, level: 0 },
    { x: 3247, y: 3193, level: 0 },
    { x: 3241, y: 3195, level: 0 },
    { x: 3243, y: 3195, level: 0 },
    { x: 3245, y: 3195, level: 0 },
    { x: 3247, y: 3195, level: 0 },
    { x: 3241, y: 3197, level: 0 },
    { x: 3243, y: 3197, level: 0 },
    { x: 3245, y: 3197, level: 0 },
    { x: 3247, y: 3197, level: 0 },
    { x: 3241, y: 3199, level: 0 },
    { x: 3243, y: 3199, level: 0 },
    { x: 3245, y: 3199, level: 0 },
    { x: 3247, y: 3199, level: 0 },
    { x: 3241, y: 3201, level: 0 },
    { x: 3243, y: 3201, level: 0 },
    { x: 3245, y: 3201, level: 0 },
    { x: 3247, y: 3201, level: 0 },
    { x: 3241, y: 3203, level: 0 },
    { x: 3243, y: 3203, level: 0 },
    { x: 3245, y: 3203, level: 0 },
    { x: 3247, y: 3203, level: 0 },
];

export interface DeceasedTombstoneDetails {
    resident: string;
    name: string;
    faction: string;
    epitaph: string;
    livedTicks: number;
    cause: string;
}

let activeTombstones: LandscapeObject[] = [];
// In-memory mapping of coordinate keys "x,y" to detailed resident info
const tombstoneMap = new Map<string, DeceasedTombstoneDetails>();

export function getTombstoneAt(x: number, y: number): DeceasedTombstoneDetails | null {
    return tombstoneMap.get(`${x},${y}`) || null;
}

export function refreshGraveyard(): void {
    // 1. Clear previous tombstones from the world instance
    for (const tomb of activeTombstones) {
        try {
            activeWorld.globalInstance.despawnGameObject(tomb);
        } catch {
            // Ignore despawn issues (e.g. if world shutdown)
        }
    }
    activeTombstones = [];
    tombstoneMap.clear();

    // 2. Query and sort deceased residents
    const config = loadControllerConfig();
    const libraryDir = path.join(config.memory.dir, 'library');
    if (!fs.existsSync(libraryDir)) {
        return;
    }

    const deceasedList: { resident: string; updatedAt: string; slug: string }[] = [];
    const dirs = fs.readdirSync(libraryDir);
    for (const dirName of dirs) {
        const indexPath = path.join(libraryDir, dirName, 'index.json');
        if (fs.existsSync(indexPath)) {
            try {
                const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                if (index.currentState === 'ended') {
                    deceasedList.push({
                        resident: index.resident,
                        updatedAt: index.updatedAt || index.createdAt || new Date().toISOString(),
                        slug: dirName,
                    });
                }
            } catch {
                // Ignore malformed files
            }
        }
    }

    // Sort by updatedAt ascending, tie-breaker on resident name
    deceasedList.sort((a, b) => {
        const cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        if (cmp !== 0) {
            return cmp;
        }
        return a.resident.localeCompare(b.resident);
    });

    // 3. Spawn tombstones and populate coordinate map
    const soulLoader = new SoulLoader(config.souls.dir);

    for (let i = 0; i < deceasedList.length && i < GRAVEYARD_SPOTS.length; i++) {
        const item = deceasedList[i];
        const spot = GRAVEYARD_SPOTS[i];

        let name = item.resident.replace(/^res:/, '');
        let faction = 'Unaligned';
        try {
            const soul = soulLoader.load(item.resident);
            name = soul.frontmatter.display || soul.frontmatter.name;
            const rawFaction = dominantFaction(soul.frontmatter.factionAffinity) || 'unaligned';
            faction = rawFaction.charAt(0).toUpperCase() + rawFaction.slice(1);
        } catch {
            // Ignore soul load failure and use fallbacks
        }

        let epitaph = 'The quiet life';
        let livedTicks = 0;
        let cause = 'unknown causes';

        const portraitPath = path.join(libraryDir, item.slug, 'portrait.json');
        if (fs.existsSync(portraitPath)) {
            try {
                const portrait = JSON.parse(fs.readFileSync(portraitPath, 'utf8'));
                const latestLife = portrait.lives?.at(-1);
                if (latestLife) {
                    epitaph = latestLife.epithet || portrait.epithet || epitaph;
                    livedTicks = latestLife.durationTicks || livedTicks;
                    cause = latestLife.deathCause || cause;
                }
            } catch {
                // Ignore portrait parse failure and use fallbacks
            }
        }

        const details: DeceasedTombstoneDetails = {
            resident: item.resident,
            name,
            faction,
            epitaph,
            livedTicks,
            cause,
        };

        const tomb: LandscapeObject = {
            objectId: 402, // Tombstone object ID
            x: spot.x,
            y: spot.y,
            level: spot.level,
            type: 10,
            orientation: 0,
        };

        try {
            activeWorld.globalInstance.spawnGameObject(tomb);
            activeTombstones.push(tomb);
            tombstoneMap.set(`${spot.x},${spot.y}`, details);
        } catch {
            // Spawn failed (e.g. world not fully initialized)
        }
    }
}

export class GraveyardRefreshTask extends Task {
    constructor() {
        super({
            interval: 500,
            repeat: true,
            stackType: TaskStackType.STACK,
            stackGroup: 'graveyard_refresh',
        });
    }

    execute(): void {
        refreshGraveyard();
    }
}

export function resetGraveyard(): void {
    activeTombstones = [];
    tombstoneMap.clear();
}
