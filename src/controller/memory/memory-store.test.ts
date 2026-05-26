import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryStore } from './memory-store';

describe('MemoryStore', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-store-test-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('retrieves recent Library timeline entries alongside resident markdown memories', () => {
        const timelineDir = path.join(root, 'library', 'res-agent');
        fs.mkdirSync(timelineDir, { recursive: true });
        fs.writeFileSync(
            path.join(timelineDir, 'timeline.jsonl'),
            [
                JSON.stringify({
                    kind: 'patron_gift',
                    patronHandle: 'alice@onion',
                    artifact: 'rs:tinderbox',
                    ts: '2026-05-22T10:00:00.000Z',
                }),
                JSON.stringify({ kind: 'say', note: 'I promised to cook shrimp for Codex.', ts: '2026-05-22T11:00:00.000Z' }),
            ].join('\n') + '\n',
        );
        const store = new MemoryStore(root, '');

        const memories = store.retrieve('res:agent', 'Codex patron gift shrimp', 2);

        // After E7, MemoryStore.retrieve emits the dedicated patron slice
        // first (so out-of-band Shards offers survive stuck/say spam in
        // the general window) followed by the general slice. The patron
        // event therefore appears twice in this small fixture — once from
        // each slice — which is fine: the dedicated slot ensures survival,
        // the general slot reflects timeline freshness. Assert semantic
        // presence rather than positional indexing.
        expect(memories[0]).toContain('Patron gift from alice@onion: rs:tinderbox');
        expect(memories.some(memory => memory.includes('I promised to cook shrimp for Codex.'))).toBe(true);
        expect(memories.some(memory => memory.includes('# res:agent INDEX'))).toBe(true);
    });
});
