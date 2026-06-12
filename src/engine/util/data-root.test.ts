import { agentLogDir, dataRoot, gameCacheDir, playerSaveDir, residentSaveDir, resolveDataDir } from '@engine/util/data-root';

describe('data-root', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    function clearKnobs(): void {
        delete process.env.DATA_ROOT;
        delete process.env.NULLCITY_RESIDENT_SAVE_DIR;
        delete process.env.NULLCITY_PLAYER_SAVE_DIR;
        delete process.env.NULLCITY_AGENT_LOG_DIR;
        delete process.env.NULLCITY_GAME_CACHE_DIR;
    }

    describe('dataRoot()', () => {
        it('returns the legacy relative "data" root when DATA_ROOT is unset (back-compat)', () => {
            clearKnobs();
            expect(dataRoot()).toBe('data');
        });

        it('returns the absolute volume root when DATA_ROOT is set', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data';
            expect(dataRoot()).toBe('/data');
        });

        it('strips a trailing slash from DATA_ROOT', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data/';
            expect(dataRoot()).toBe('/data');
        });
    });

    describe('resolveDataDir()', () => {
        it('joins a subpath under the legacy relative root by default', () => {
            clearKnobs();
            expect(resolveDataDir('saves')).toBe('data/saves');
        });

        it('joins a subpath under the configured DATA_ROOT', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data';
            expect(resolveDataDir('saves')).toBe('/data/saves');
        });
    });

    describe('residentSaveDir()', () => {
        it('defaults to data/residents under the legacy root', () => {
            clearKnobs();
            expect(residentSaveDir()).toBe('data/residents');
        });

        it('rebases under DATA_ROOT', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data';
            expect(residentSaveDir()).toBe('/data/residents');
        });

        it('honors an explicit NULLCITY_RESIDENT_SAVE_DIR override even when DATA_ROOT is set', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data';
            process.env.NULLCITY_RESIDENT_SAVE_DIR = '/custom/residents';
            expect(residentSaveDir()).toBe('/custom/residents');
        });
    });

    describe('playerSaveDir()', () => {
        it('defaults to data/saves under the legacy root', () => {
            clearKnobs();
            expect(playerSaveDir()).toBe('data/saves');
        });

        it('rebases under DATA_ROOT', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data';
            expect(playerSaveDir()).toBe('/data/saves');
        });

        it('honors an explicit NULLCITY_PLAYER_SAVE_DIR override', () => {
            clearKnobs();
            process.env.NULLCITY_PLAYER_SAVE_DIR = '/custom/saves';
            expect(playerSaveDir()).toBe('/custom/saves');
        });
    });

    describe('agentLogDir()', () => {
        it('defaults to data/agent-logs under the legacy root', () => {
            clearKnobs();
            expect(agentLogDir()).toBe('data/agent-logs');
        });

        it('rebases under DATA_ROOT', () => {
            clearKnobs();
            process.env.DATA_ROOT = '/data';
            expect(agentLogDir()).toBe('/data/agent-logs');
        });

        it('honors an explicit NULLCITY_AGENT_LOG_DIR override', () => {
            clearKnobs();
            process.env.NULLCITY_AGENT_LOG_DIR = '/custom/agent-logs';
            expect(agentLogDir()).toBe('/custom/agent-logs');
        });
    });

    describe('gameCacheDir()', () => {
        it('defaults to the baked-in relative "cache" dir', () => {
            clearKnobs();
            expect(gameCacheDir()).toBe('cache');
        });

        it('honors an explicit NULLCITY_GAME_CACHE_DIR override', () => {
            clearKnobs();
            process.env.NULLCITY_GAME_CACHE_DIR = '/app/cache';
            expect(gameCacheDir()).toBe('/app/cache');
        });
    });
});
