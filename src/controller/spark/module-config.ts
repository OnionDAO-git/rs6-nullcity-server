export interface SparkModuleConfigSchema {
    parse(input: unknown): Record<string, unknown>;
}

export interface SparkModuleConfigPolicy {
    maxBytes?: number;
    maxDepth?: number;
    allowEndpointFields?: string[];
    allowPathFields?: string[];
}

export interface SparkModuleConfigValidationOptions {
    schema?: SparkModuleConfigSchema;
    policy?: SparkModuleConfigPolicy;
}

const DEFAULT_MAX_BYTES = 4096;
const DEFAULT_MAX_DEPTH = 6;
const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|auth)/i;
const SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]+|[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)=[^\s,;]+)/i;
const ENDPOINT_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const ABSOLUTE_OR_HOME_PATH_PATTERN = /^(\/|~\/|[a-z]:[\\/])/i;
const PATH_SEGMENT_PATTERN = /(^|[\\/])\.\.([\\/]|$)|[\\/]/;

export function validateSparkModuleConfig(
    input: Record<string, unknown> | undefined,
    options: SparkModuleConfigValidationOptions = {},
): Record<string, unknown> {
    const parsed = options.schema ? options.schema.parse(input || {}) : input || {};
    if (!isPlainObject(parsed)) {
        throw new Error('SPARK module config must be an object');
    }

    const policy = options.policy || {};
    const maxBytes = policy.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxDepth = policy.maxDepth ?? DEFAULT_MAX_DEPTH;
    const bytes = JSON.stringify(parsed).length;
    if (bytes > maxBytes) {
        throw new Error(`SPARK module config exceeds ${maxBytes} bytes`);
    }

    validateValue(parsed, {
        path: '',
        depth: 0,
        maxDepth,
        allowEndpointFields: new Set(policy.allowEndpointFields || []),
        allowPathFields: new Set(policy.allowPathFields || []),
    });

    return deepFreeze(cloneValue(parsed)) as Record<string, unknown>;
}

interface ValidationContext {
    path: string;
    depth: number;
    maxDepth: number;
    allowEndpointFields: Set<string>;
    allowPathFields: Set<string>;
}

function validateValue(value: unknown, context: ValidationContext): void {
    if (context.depth > context.maxDepth) {
        throw new Error(`SPARK module config exceeds max depth ${context.maxDepth}`);
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        validatePrimitive(value, context);
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) =>
            validateValue(item, { ...context, path: pathJoin(context.path, String(index)), depth: context.depth + 1 }),
        );
        return;
    }

    if (!isPlainObject(value)) {
        throw new Error(`SPARK module config ${context.path || '<root>'} must contain only JSON data`);
    }

    for (const [key, child] of Object.entries(value)) {
        const childPath = pathJoin(context.path, key);
        if (SECRET_KEY_PATTERN.test(key)) {
            throw new Error(`SPARK module config ${childPath} is not allowed to contain secret-like fields`);
        }
        validateValue(child, { ...context, path: childPath, depth: context.depth + 1 });
    }
}

function validatePrimitive(value: unknown, context: ValidationContext): void {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`SPARK module config ${context.path || '<root>'} must contain finite numbers`);
    }
    if (typeof value !== 'string') {
        return;
    }

    if (SECRET_VALUE_PATTERN.test(value)) {
        throw new Error(`SPARK module config ${context.path || '<root>'} is not allowed to contain secret-like values`);
    }
    if (ENDPOINT_PATTERN.test(value)) {
        if (!context.allowEndpointFields.has(context.path)) {
            throw new Error(`SPARK module config ${context.path || '<root>'} is not allowed to contain endpoint URLs`);
        }
        return;
    }
    if (looksLikePath(value) && !context.allowPathFields.has(context.path)) {
        throw new Error(`SPARK module config ${context.path || '<root>'} is not allowed to contain filesystem paths`);
    }
}

function looksLikePath(value: string): boolean {
    return ABSOLUTE_OR_HOME_PATH_PATTERN.test(value) || PATH_SEGMENT_PATTERN.test(value);
}

function pathJoin(parent: string, key: string): string {
    return parent ? `${parent}.${key}` : key;
}

function cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
    }
    return value;
}

function deepFreeze<T>(value: T): T {
    if (isPlainObject(value) || Array.isArray(value)) {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
