import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadRuneBenchWikiSnippets } from './wiki-importer';

describe('RuneBench wiki importer', () => {
    it('loads bounded markdown snippets from selected local wiki pages', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runebench-wiki-'));
        fs.mkdirSync(path.join(root, 'npcs'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'npcs', 'chicken.md'),
            [
                '# Chicken',
                '',
                'Chickens are low level monsters. They drop bones, raw chicken, and feathers.',
                'They are useful for early combat and prayer training.',
            ].join('\n'),
        );

        const snippets = loadRuneBenchWikiSnippets(root, ['npcs/chicken.md'], { maxCharsPerPage: 80 });

        expect(snippets).toEqual([
            {
                id: 'runebench-wiki:npcs/chicken',
                title: 'Chicken',
                text: expect.stringContaining('low level monsters'),
                sourcePath: path.join(root, 'npcs', 'chicken.md'),
            },
        ]);
        expect(snippets[0].text.length).toBeLessThanOrEqual(80);
    });

    it('ignores missing or escaped paths', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runebench-wiki-'));

        const snippets = loadRuneBenchWikiSnippets(root, ['missing.md', '../secret.md']);

        expect(snippets).toEqual([]);
    });
});
