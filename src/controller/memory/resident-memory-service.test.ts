import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryStore } from './memory-store';
import { ResidentMemoryService } from './resident-memory-service';

describe('ResidentMemoryService', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'resident-memory-service-test-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('remembers explicit facts and reads them back by topic', () => {
        const memory = new ResidentMemoryService({ memoryRoot: root, now: () => '2026-05-31T14:50:00.000Z' });

        memory.rememberFact({
            resident: 'res:hans',
            topic: 'patrons',
            fact: 'alice@onion promised 50 AP after Hans brings flour.',
            reason: 'patron promise',
        });

        const topic = memory.readTopic({ resident: 'res:hans', topic: 'patrons' });
        const relevant = memory.relevantTo({ resident: 'res:hans', query: 'alice promised AP flour', limit: 3 });

        expect(topic.content).toContain('alice@onion promised 50 AP after Hans brings flour.');
        expect(relevant).toEqual([
            expect.objectContaining({
                source: 'facts',
                topic: 'patrons',
                text: expect.stringContaining('alice@onion promised 50 AP'),
            }),
        ]);
    });

    it('keeps the semantic search method typed but empty until S-MEM-2', () => {
        const memory = new ResidentMemoryService({ memoryRoot: root });

        expect(memory.searchSemantic({ resident: 'res:hans', query: 'alice promise' })).toEqual([]);
    });

    it('keeps existing MemoryStore retrieval working through formal facts', () => {
        const memory = new ResidentMemoryService({ memoryRoot: root, now: () => '2026-05-31T14:50:00.000Z' });
        memory.rememberFact({
            resident: 'res:agent',
            topic: 'routes',
            fact: 'Draynor bank is near 3092,3243 and useful after fishing.',
        });

        const store = new MemoryStore(root, '', { telemetry: false });
        const retrieved = store.retrieve('res:agent', 'where is Draynor bank after fishing?', 3);

        expect(retrieved.join('\n')).toContain('Draynor bank is near 3092,3243');
    });
});
