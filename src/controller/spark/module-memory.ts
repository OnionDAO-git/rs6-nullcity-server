import fs from 'fs';
import path from 'path';
import type { MemoryStore } from '../memory/memory-store';
import type { SparkModuleIdentity } from './modules';

export interface SparkModuleMemory {
    read(relativePath: string): string | undefined;
    write(relativePath: string, content: string, mode?: 'append' | 'replace'): void;
    retrieve(query: string, limit?: number): string[];
}

export interface SparkModuleMemoryOptions {
    resident: string;
    module: SparkModuleIdentity;
    memory: MemoryStore;
    maxWriteBytes?: number;
    maxRetrieveLimit?: number;
}

const DEFAULT_MAX_WRITE_BYTES = 16 * 1024;
const DEFAULT_MAX_RETRIEVE_LIMIT = 6;

export function createSparkModuleMemory(options: SparkModuleMemoryOptions): SparkModuleMemory {
    const namespace = moduleNamespace(options.module);
    const maxWriteBytes = options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES;
    const maxRetrieveLimit = options.maxRetrieveLimit ?? DEFAULT_MAX_RETRIEVE_LIMIT;

    return {
        read(relativePath) {
            const safePath = namespacedPath(namespace, relativePath);
            const root = options.memory.ensureResident(options.resident);
            const target = resolveInside(root, safePath);
            return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
        },
        write(relativePath, content, mode = 'append') {
            if (Buffer.byteLength(content, 'utf8') > maxWriteBytes) {
                throw new Error(`SPARK module memory write exceeds ${maxWriteBytes} bytes`);
            }
            options.memory.write(options.resident, namespacedPath(namespace, relativePath), content, mode);
        },
        retrieve(query, limit = maxRetrieveLimit) {
            return options.memory.retrieve(options.resident, String(query).slice(0, 512), clampLimit(limit, maxRetrieveLimit));
        },
    };
}

function namespacedPath(namespace: string, relativePath: string): string {
    const safePath = normalizeRelativePath(relativePath);
    return path.posix.join('modules', namespace, safePath);
}

function normalizeRelativePath(relativePath: string): string {
    if (!relativePath.trim() || relativePath === '.' || relativePath.includes('\\') || relativePath.includes('\0')) {
        throw new Error('SPARK module memory path is not allowed');
    }
    if (/^(\/|~\/|[a-z]:[\\/])/i.test(relativePath)) {
        throw new Error('SPARK module memory path is not allowed');
    }
    if (relativePath.split('/').some(segment => segment === '..')) {
        throw new Error('SPARK module memory path is not allowed');
    }

    const normalized = path.posix.normalize(relativePath);
    if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
        throw new Error('SPARK module memory path is not allowed');
    }
    return normalized;
}

function resolveInside(root: string, relativePath: string): string {
    const target = path.resolve(root, relativePath);
    const resolvedRoot = path.resolve(root);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`) && target !== resolvedRoot) {
        throw new Error('SPARK module memory path is not allowed');
    }
    return target;
}

function moduleNamespace(module: SparkModuleIdentity): string {
    return `m-${Buffer.from(JSON.stringify([module.id, module.version]), 'utf8').toString('base64url')}`;
}

function clampLimit(limit: number, maxRetrieveLimit: number): number {
    if (!Number.isFinite(limit)) {
        return maxRetrieveLimit;
    }
    return Math.max(1, Math.min(maxRetrieveLimit, Math.floor(limit)));
}
