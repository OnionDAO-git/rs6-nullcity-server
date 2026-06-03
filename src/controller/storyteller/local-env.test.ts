import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadStorytellerLocalEnv } from './local-env';

describe('loadStorytellerLocalEnv', () => {
    let cwd: string;

    beforeEach(() => {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-local-env-'));
    });

    afterEach(() => {
        fs.rmSync(cwd, { recursive: true, force: true });
    });

    it('loads Storyteller and OpenRouter keys from .env.local without overriding process env', () => {
        fs.writeFileSync(
            path.join(cwd, '.env.local'),
            [
                'OPENROUTER_API_KEY=file-openrouter-key',
                'OPENROUTER_STORYTELLER_MODEL=anthropic/claude-3.5-haiku',
                'STORYTELLER_CONTROLLER_CONFIG=/tmp/nullcity/controller.yml',
                'STORYTELLER_DAILY_COST_CAP_USD=0.75',
                'UNRELATED_ENV=ignored',
            ].join('\n'),
        );
        const env: Record<string, string | undefined> = {
            OPENROUTER_API_KEY: 'shell-openrouter-key',
        };

        const result = loadStorytellerLocalEnv({ cwd, env });

        expect(result.loaded).toBe(true);
        expect(result.keysLoaded).toEqual([
            'OPENROUTER_STORYTELLER_MODEL',
            'STORYTELLER_CONTROLLER_CONFIG',
            'STORYTELLER_DAILY_COST_CAP_USD',
        ]);
        expect(env.OPENROUTER_API_KEY).toBe('shell-openrouter-key');
        expect(env.OPENROUTER_STORYTELLER_MODEL).toBe('anthropic/claude-3.5-haiku');
        expect(env.STORYTELLER_CONTROLLER_CONFIG).toBe('/tmp/nullcity/controller.yml');
        expect(env.STORYTELLER_DAILY_COST_CAP_USD).toBe('0.75');
        expect(env.UNRELATED_ENV).toBeUndefined();
    });

    it('parses quoted values and ignores comments', () => {
        fs.writeFileSync(
            path.join(cwd, '.env.local'),
            [
                '# Storyteller config',
                'STORYTELLER_LLM_BASE_URL="https://openrouter.ai/api"',
                "STORYTELLER_LLM_MODEL='anthropic/claude-3.5-haiku'",
            ].join('\n'),
        );
        const env: Record<string, string | undefined> = {};

        const result = loadStorytellerLocalEnv({ cwd, env });

        expect(result.keysLoaded).toEqual(['STORYTELLER_LLM_BASE_URL', 'STORYTELLER_LLM_MODEL']);
        expect(env.STORYTELLER_LLM_BASE_URL).toBe('https://openrouter.ai/api');
        expect(env.STORYTELLER_LLM_MODEL).toBe('anthropic/claude-3.5-haiku');
    });

    it('quietly noops when .env.local is absent', () => {
        const env: Record<string, string | undefined> = {};

        const result = loadStorytellerLocalEnv({ cwd, env });

        expect(result).toEqual({ loaded: false, keysLoaded: [] });
        expect(env.OPENROUTER_API_KEY).toBeUndefined();
    });
});
