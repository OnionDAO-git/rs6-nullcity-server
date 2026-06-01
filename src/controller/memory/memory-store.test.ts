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

    it('retrieves compact durable facts without qmd even when recent memory is noisy', () => {
        const residentDir = path.join(root, 'res-agent');
        fs.mkdirSync(path.join(residentDir, 'facts'), { recursive: true });
        fs.writeFileSync(
            path.join(residentDir, 'facts', 'social.md'),
            '- 2026-05-28T19:00:00.000Z James said: "Hans remember that I promised Codex shrimp after fishing."\n',
        );
        fs.writeFileSync(
            path.join(residentDir, 'facts', 'routes.md'),
            '- 2026-05-28T19:01:00.000Z Learned route: Draynor bank is near 3092,3243 and safe for fish.\n',
        );
        fs.mkdirSync(path.join(residentDir, 'events'), { recursive: true });
        fs.writeFileSync(
            path.join(residentDir, 'events', 'noise.md'),
            Array.from(
                { length: 400 },
                (_, i) => `- 2026-05-28T19:02:00.000Z {"kind":"stuck_detected","note":"Still here watching the area ${i}"}\n`,
            ).join(''),
        );
        const store = new MemoryStore(root, '');

        const shrimp = store.retrieve('res:agent', 'what did James promise Codex about shrimp?', 3);
        const route = store.retrieve('res:agent', 'where is Draynor bank safe fish?', 3);

        expect(shrimp.some(memory => memory.includes('promised Codex shrimp'))).toBe(true);
        expect(route.some(memory => memory.includes('Draynor bank is near 3092,3243'))).toBe(true);
        expect(shrimp.join('\n')).not.toContain('Still here watching the area');
    });

    it('writes Brain remember facts through the formal facts store', () => {
        const store = new MemoryStore(root, '', { telemetry: false });

        const stored = store.rememberFact(
            'res:agent',
            'Quest Notes',
            'Cook asked for an egg, flour, and milk.',
            'Brain heard NPC dialogue',
        );

        expect(stored.path).toBe('facts/quest-notes.md');
        const topic = fs.readFileSync(path.join(root, 'res-agent', 'facts', 'quest-notes.md'), 'utf8');
        expect(topic).toContain('Cook asked for an egg, flour, and milk.');
        expect(topic).toContain('[why: Brain heard NPC dialogue]');
        expect(store.retrieve('res:agent', 'what did Cook ask me to gather?', 3).join('\n')).toContain(
            'Cook asked for an egg, flour, and milk.',
        );
    });

    it('logs retrieval source counts for memory engine comparisons', () => {
        const logPath = path.join(root, 'logs', 'memory-usage.jsonl');
        const timelineDir = path.join(root, 'library', 'res-agent');
        fs.mkdirSync(timelineDir, { recursive: true });
        fs.writeFileSync(
            path.join(timelineDir, 'timeline.jsonl'),
            JSON.stringify({
                kind: 'patron_gift',
                patronHandle: 'alice@onion',
                artifact: 'rs:tinderbox',
                ts: '2026-05-22T10:00:00.000Z',
            }) + '\n',
        );
        const residentDir = path.join(root, 'res-agent');
        fs.mkdirSync(path.join(residentDir, 'facts'), { recursive: true });
        fs.writeFileSync(
            path.join(residentDir, 'facts', 'social.md'),
            '- 2026-05-28T19:00:00.000Z Alice said: "Remember the tinderbox promise."\n',
        );
        const store = new MemoryStore(root, '', {
            telemetry: { logPath, now: () => '2026-05-28T20:00:00.000Z' },
        });

        store.retrieve('res:agent', 'alice tinderbox promise', 3);

        const entries = fs
            .readFileSync(logPath, 'utf8')
            .trim()
            .split('\n')
            .map(line => JSON.parse(line));
        expect(entries).toEqual([
            expect.objectContaining({
                type: 'retrieve',
                ts: '2026-05-28T20:00:00.000Z',
                resident: 'res:agent',
                queryPreview: 'alice tinderbox promise',
                sourceCounts: expect.objectContaining({
                    patron: 1,
                    facts: 1,
                    library: 1,
                    index: 1,
                    targeted: 0,
                    qmd: 0,
                }),
                topSources: expect.arrayContaining(['patron', 'facts']),
            }),
        ]);
    });

    it('logs memory writes with path and mode but bounded content previews', () => {
        const logPath = path.join(root, 'logs', 'memory-usage.jsonl');
        const store = new MemoryStore(root, '', {
            telemetry: { logPath, now: () => '2026-05-28T20:01:00.000Z' },
        });
        const content = `- ${'remember '.repeat(80)}\n`;

        store.write('res:hans', 'facts/social.md', content);

        const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
        expect(entry).toEqual(
            expect.objectContaining({
                type: 'write',
                ts: '2026-05-28T20:01:00.000Z',
                resident: 'res:hans',
                path: 'facts/social.md',
                mode: 'append',
                charCount: content.length,
                lineCount: 1,
            }),
        );
        expect(entry.contentPreview.length).toBeLessThanOrEqual(180);
    });
});
