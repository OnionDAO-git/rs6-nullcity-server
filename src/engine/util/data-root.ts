import { join } from 'path';

/**
 * Single source of truth for the directory under which every server-side
 * runtime WRITE lands. The Railway all-in-one image mounts ONE volume at
 * `/data` and sets `DATA_ROOT=/data`; on the Mac (no DATA_ROOT) the legacy
 * relative `data/` layout is preserved exactly, so the dev scripts keep
 * working with zero behavior change.
 *
 * See docs/2026-06-11-railway-allinone.md for the full write-path table.
 */

const LEGACY_DATA_ROOT = 'data';

/**
 * The root directory for runtime state. Defaults to the legacy relative
 * `data/` dir (resolved from the process cwd) so dev behavior is unchanged.
 * In the container, `DATA_ROOT=/data` points every write at the mounted
 * volume.
 */
export function dataRoot(): string {
    const configured = process.env.DATA_ROOT;
    if (configured && configured.length > 0) {
        return stripTrailingSlash(configured);
    }
    return LEGACY_DATA_ROOT;
}

/** Join a subpath under the active data root. */
export function resolveDataDir(...segments: string[]): string {
    return join(dataRoot(), ...segments);
}

/**
 * Where Null City residents (`res:*` agent saves) are persisted. Hardcoded
 * historically to `data/residents`. Override with NULLCITY_RESIDENT_SAVE_DIR,
 * else rebases under DATA_ROOT.
 */
export function residentSaveDir(): string {
    return overrideOr('NULLCITY_RESIDENT_SAVE_DIR', () => resolveDataDir('residents'));
}

/**
 * Where ordinary player saves are persisted. Hardcoded historically to
 * `data/saves`. Override with NULLCITY_PLAYER_SAVE_DIR, else rebases under
 * DATA_ROOT.
 */
export function playerSaveDir(): string {
    return overrideOr('NULLCITY_PLAYER_SAVE_DIR', () => resolveDataDir('saves'));
}

/**
 * Where the agent gateway's per-resident action JSONL logs are written.
 * Hardcoded historically to `data/agent-logs`. Override with
 * NULLCITY_AGENT_LOG_DIR, else rebases under DATA_ROOT.
 */
export function agentLogDir(): string {
    return overrideOr('NULLCITY_AGENT_LOG_DIR', () => resolveDataDir('agent-logs'));
}

/**
 * The game asset cache (RuneScape filestore). This is baked into the image
 * and is read-mostly at runtime, so it stays at the app-relative `cache/`
 * dir by default rather than under the volume. Exposed as an override
 * (NULLCITY_GAME_CACHE_DIR) for completeness / relocation.
 */
export function gameCacheDir(): string {
    const configured = process.env.NULLCITY_GAME_CACHE_DIR;
    return configured && configured.length > 0 ? configured : 'cache';
}

function overrideOr(envVar: string, fallback: () => string): string {
    const configured = process.env[envVar];
    return configured && configured.length > 0 ? configured : fallback();
}

function stripTrailingSlash(value: string): string {
    return value.length > 1 && value.endsWith('/') ? value.replace(/\/+$/, '') : value;
}
