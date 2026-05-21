import path from 'path';
import fs from 'fs';
import os from 'os';
import { SoulLoader } from './soul-loader';

describe('SoulLoader', () => {
    it('loads starter souls named with the resident prefix and a dash', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        const soul = loader.load('res:pip');

        expect(soul.frontmatter.name).toBe('res:pip');
        expect(soul.frontmatter.display).toBe('Pip');
    });

    it('loads the starter agent with the standard SPARK module selected', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        const soul = loader.load('res:agent');

        expect(soul.frontmatter.modules).toEqual([{ id: 'onion.runescape.standard', enabled: true }]);
    });

    it('lists resident names from valid soul files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-soul-loader-list-'));
        fs.writeFileSync(path.join(root, 'res-agent.md'), `---\nname: res:agent\narchetype: endurer\n---\n# Agent\n`);
        fs.writeFileSync(path.join(root, 'README.md'), '# Ignore me\n');

        const loader = new SoulLoader(root);

        expect(loader.listResidentNames()).toEqual(['res:agent']);
    });
});
