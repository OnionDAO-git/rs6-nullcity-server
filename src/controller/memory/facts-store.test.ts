import fs from 'fs';
import os from 'os';
import path from 'path';
import { residentSlug } from './runtime-state';
import { FactsStore } from './facts-store';

describe('FactsStore', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-store-test-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('keeps facts isolated per resident', () => {
        const store = new FactsStore(root, () => '2026-05-31T14:45:00.000Z');
        store.rememberFact({ resident: 'res:hans', topic: 'quests', fact: 'Cook needs an egg from the farm.' });
        store.rememberFact({ resident: 'res:pip', topic: 'quests', fact: 'Duke needs a report from the courtyard.' });

        const hansFacts = store.relevantTo({ resident: 'res:hans', query: 'who needs egg farm', limit: 5 });
        const pipFacts = store.relevantTo({ resident: 'res:pip', query: 'who needs egg farm', limit: 5 });

        expect(hansFacts.map(fact => fact.text).join('\n')).toContain('Cook needs an egg from the farm.');
        expect(hansFacts.map(fact => fact.text).join('\n')).not.toContain('Duke needs a report');
        expect(pipFacts.map(fact => fact.text).join('\n')).not.toContain('Cook needs an egg');
    });

    it('appends timestamped fact lines instead of replacing prior memory', () => {
        let tick = 0;
        const store = new FactsStore(root, () => `2026-05-31T14:45:0${tick++}.000Z`);

        store.rememberFact({ resident: 'res:hans', topic: 'dangers', fact: 'Goblin hit hard near 3238,3296.' });
        store.rememberFact({ resident: 'res:hans', topic: 'dangers', fact: 'Cow pen is safer than goblins for weak residents.' });

        const file = fs.readFileSync(path.join(root, residentSlug('res:hans'), 'facts', 'dangers.md'), 'utf8');
        expect(file).toContain('- 2026-05-31T14:45:00.000Z Goblin hit hard near 3238,3296.');
        expect(file).toContain('- 2026-05-31T14:45:01.000Z Cow pen is safer than goblins for weak residents.');
        expect(file.trim().split('\n')).toHaveLength(2);
    });

    it('survives service restart from the same memory root', () => {
        const first = new FactsStore(root, () => '2026-05-31T14:45:00.000Z');
        first.rememberFact({ resident: 'res:agent', topic: 'routes', fact: 'Varrock west bank is north then west from Lumbridge.' });

        const second = new FactsStore(root, () => '2026-05-31T14:46:00.000Z');
        const topic = second.readTopic({ resident: 'res:agent', topic: 'routes' });

        expect(topic.path).toBe('facts/routes.md');
        expect(topic.content).toContain('Varrock west bank is north then west from Lumbridge.');
    });

    it('reads proto-qmd world-events files written by the old durable-facts route', () => {
        const slug = residentSlug('res:hans');
        const factsDir = path.join(root, slug, 'facts');
        fs.mkdirSync(factsDir, { recursive: true });
        fs.writeFileSync(
            path.join(factsDir, 'world-events.md'),
            '- 2026-05-30T11:00:00.000Z Observed res:duke lit a fire at 3243,3209,0.\n',
        );
        const store = new FactsStore(root);

        const topic = store.readTopic({ resident: 'res:hans', topic: 'world-events' });
        const relevant = store.relevantTo({ resident: 'res:hans', query: 'duke fire 3243', limit: 2 });

        expect(topic.content).toContain('Observed res:duke lit a fire');
        expect(relevant).toEqual([
            expect.objectContaining({
                topic: 'world-events',
                text: expect.stringContaining('Observed res:duke lit a fire'),
            }),
        ]);
    });

    it('normalizes human topic labels to safe fact filenames', () => {
        const store = new FactsStore(root, () => '2026-05-31T14:45:00.000Z');

        store.rememberFact({ resident: 'res:hans', topic: 'NPC Memories.md', fact: 'The Cook asked about ingredients.' });

        const topic = store.readTopic({ resident: 'res:hans', topic: 'npc memories' });
        expect(topic.path).toBe('facts/npc-memories.md');
        expect(topic.content).toContain('The Cook asked about ingredients.');
    });

    it('rejects unsafe topic names', () => {
        const store = new FactsStore(root);

        expect(() => store.readTopic({ resident: 'res:hans', topic: '../secrets' })).toThrow('Unsafe memory topic');
        expect(() => store.rememberFact({ resident: 'res:hans', topic: '/tmp/secrets', fact: 'nope' })).toThrow('Unsafe memory topic');
    });
});
