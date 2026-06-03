import fs from 'fs';
import path from 'path';

const STORYTELLER_LOCAL_ENV_KEYS = new Set([
    'STORYTELLER_LLM_BASE_URL',
    'STORYTELLER_LLM_API_KEY',
    'STORYTELLER_LLM_MODEL',
    'STORYTELLER_MODEL_PROFILE',
    'STORYTELLER_DAILY_COST_CAP_USD',
    'OPENROUTER_API_KEY',
    'OPENROUTER_STORYTELLER_MODEL',
    'OPENROUTER_HAIKU_MODEL',
]);

export interface LoadStorytellerLocalEnvOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    filename?: string;
}

export interface LoadStorytellerLocalEnvResult {
    loaded: boolean;
    keysLoaded: string[];
}

export function loadStorytellerLocalEnv(options: LoadStorytellerLocalEnvOptions = {}): LoadStorytellerLocalEnvResult {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const filename = options.filename ?? '.env.local';
    const filePath = path.join(cwd, filename);
    if (!fs.existsSync(filePath)) {
        return { loaded: false, keysLoaded: [] };
    }

    const keysLoaded: string[] = [];
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        if (!STORYTELLER_LOCAL_ENV_KEYS.has(parsed.key)) continue;
        if (env[parsed.key] !== undefined && env[parsed.key] !== '') continue;
        env[parsed.key] = parsed.value;
        keysLoaded.push(parsed.key);
    }

    return { loaded: true, keysLoaded };
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return undefined;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const equalsIndex = withoutExport.indexOf('=');
    if (equalsIndex <= 0) return undefined;
    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return undefined;
    const value = unquoteEnvValue(withoutExport.slice(equalsIndex + 1).trim());
    return { key, value };
}

function unquoteEnvValue(value: string): string {
    if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
    }
    return value;
}
