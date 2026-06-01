import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultGameSkillEntries } from './game-skill-entries';
import { retrieveKnowledge } from './knowledge-retriever';

describe('default game skill entries', () => {
    it('includes generated local skill-guide knowledge', () => {
        const entries = createDefaultGameSkillEntries();

        expect(entries.map(entry => entry.id)).toContain('skill-guide:firemaking');
        expect(entries.map(entry => entry.id)).toContain('skill-guide:fishing');
    });

    it('optionally includes bounded RuneBench wiki snippets', () => {
        // S-WIKI-1: STARTER_WIKI_PAGES references real docs/runescape-skill/ pages.
        // Use one of those curated paths (skills/combat.md) so the importer looks for it.
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runebench-wiki-'));
        fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills', 'combat.md'), '# Combat\n\nFight low level monsters with a sword and food on hand.');

        const entries = createDefaultGameSkillEntries(root);

        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'runebench-wiki:skills/combat',
                    title: 'RuneBench Wiki: Combat',
                }),
            ]),
        );
    });

    it('retrieves starter knowledge for the agent-facing game-skill index', () => {
        const entries = createDefaultGameSkillEntries();
        const cases = [
            ['logs and tinderbox make a fire', 'skill-firemaking-basic'],
            ['catch shrimp with a small fishing net', 'skill-fishing-basic'],
            ['bury bones from inventory for prayer', 'skill-prayer-basic'],
            ['Lumbridge general store starter tools', 'shops-starter-tools'],
            ['basic combat against a safe low level enemy with food and retreat', 'combat-safe-basic'],
        ] as const;

        for (const [query, expectedId] of cases) {
            const ids = retrieveKnowledge(entries, query, { limit: 5 }).map(result => result.entry.id);

            expect(ids).toContain(expectedId);
        }
    });
});
