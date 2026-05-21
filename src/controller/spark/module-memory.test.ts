import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryStore } from '../memory/memory-store';
import { createSparkModuleMemory } from './module-memory';

describe('createSparkModuleMemory', () => {
    it('reads and writes only inside a module-owned resident namespace', () => {
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-module-memory-'));
        const memory = new MemoryStore(memoryRoot, '');
        const facade = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test/module', version: '0.1.0' },
            memory,
        });

        expect(facade.write('notes/plan.md', 'Chop logs, then light a fire.', 'replace')).toBeUndefined();

        expect(
            fs.existsSync(path.join(memoryRoot, 'res-test', 'modules', namespace('onion.test/module', '0.1.0'), 'notes', 'plan.md')),
        ).toBe(true);
        expect(facade.read('notes/plan.md')).toBe('Chop logs, then light a fire.\n');
        expect(fs.existsSync(path.join(memoryRoot, 'res-test', 'notes', 'plan.md'))).toBe(false);
    });

    it('uses collision-free module id and version namespaces', () => {
        const memory = {
            write: jest.fn(() => '/tmp/ignored'),
        };
        const slashModule = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test/module', version: '0.1.0' },
            memory: memory as unknown as MemoryStore,
        });
        const dashModule = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test-module', version: '0.1.0' },
            memory: memory as unknown as MemoryStore,
        });
        const newVersion = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test/module', version: '0.2.0' },
            memory: memory as unknown as MemoryStore,
        });

        slashModule.write('notes.md', 'a');
        dashModule.write('notes.md', 'b');
        newVersion.write('notes.md', 'c');

        const paths = (memory.write.mock.calls as unknown[][]).map(call => call[1]);
        expect(new Set(paths).size).toBe(3);
        expect(paths).toEqual([
            `modules/${namespace('onion.test/module', '0.1.0')}/notes.md`,
            `modules/${namespace('onion.test-module', '0.1.0')}/notes.md`,
            `modules/${namespace('onion.test/module', '0.2.0')}/notes.md`,
        ]);
    });

    it('rejects absolute paths, parent traversal, backslashes, and empty paths', () => {
        const facade = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test', version: '0.1.0' },
            memory: new MemoryStore(fs.mkdtempSync(path.join(os.tmpdir(), 'spark-module-memory-')), ''),
        });

        for (const unsafePath of ['/tmp/out.md', '../out.md', 'notes/../out.md', 'notes\\out.md', '', '.']) {
            expect(() => facade.write(unsafePath, 'nope')).toThrow('SPARK module memory path is not allowed');
            expect(() => facade.read(unsafePath)).toThrow('SPARK module memory path is not allowed');
        }
    });

    it('caps write size and retrieval limits before touching the raw MemoryStore', () => {
        const memory = {
            ensureResident: jest.fn(() => '/tmp/res-test'),
            write: jest.fn(() => '/tmp/res-test/modules/onion-test/notes.md'),
            retrieve: jest.fn(() => ['one', 'two', 'three']),
        };
        const facade = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test', version: '0.1.0' },
            memory: memory as unknown as MemoryStore,
            maxWriteBytes: 8,
            maxRetrieveLimit: 2,
        });

        expect(() => facade.write('notes.md', 'too many bytes')).toThrow('SPARK module memory write exceeds 8 bytes');
        expect(memory.write).not.toHaveBeenCalled();

        expect(facade.retrieve('firemaking', 50)).toEqual(['one', 'two', 'three']);
        expect(memory.retrieve).toHaveBeenCalledWith('res:test', 'firemaking', 2);
    });

    it('does not return absolute paths from the raw MemoryStore', () => {
        const memory = {
            write: jest.fn(() => '/tmp/res-test/modules/onion-test/notes.md'),
        };
        const facade = createSparkModuleMemory({
            resident: 'res:test',
            module: { id: 'onion.test', version: '0.1.0' },
            memory: memory as unknown as MemoryStore,
        });

        expect(facade.write('notes.md', 'safe')).toBeUndefined();
        expect(memory.write).toHaveBeenCalledWith('res:test', `modules/${namespace('onion.test', '0.1.0')}/notes.md`, 'safe', 'append');
    });
});

function namespace(id: string, version: string): string {
    return `m-${Buffer.from(JSON.stringify([id, version]), 'utf8').toString('base64url')}`;
}
