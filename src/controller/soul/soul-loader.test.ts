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

    it('loads the starter agent with a long-lived local QA attention profile', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        const soul = loader.load('res:agent');

        expect(soul.frontmatter.attentionProfile?.startingAttention).toBeGreaterThanOrEqual(15000);
        expect(soul.frontmatter.attentionProfile?.decayCurve).toBe('gentle');
    });

    it('lists resident names from valid soul files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-soul-loader-list-'));
        fs.writeFileSync(path.join(root, 'res-agent.md'), `---\nname: res:agent\narchetype: endurer\n---\n# Agent\n`);
        fs.writeFileSync(path.join(root, 'README.md'), '# Ignore me\n');

        const loader = new SoulLoader(root);

        expect(loader.listResidentNames()).toEqual(['res:agent']);
    });

    describe('named heroes (M-α + M-α-2)', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        it('loads res:wise-old-man with heroProfile populated', () => {
            const soul = loader.load('res:wise-old-man');
            expect(soul.frontmatter.heroProfile?.tier).toBe('hero');
            expect(soul.frontmatter.heroProfile?.publicName).toBe('The Wise Old Man');
            expect(soul.frontmatter.heroProfile?.anchor).toEqual([3088, 3253, 0]);
        });

        it('loads res:hans with heroProfile + unaligned faction affinity', () => {
            const soul = loader.load('res:hans');
            expect(soul.frontmatter.heroProfile?.tier).toBe('hero');
            expect(soul.frontmatter.heroProfile?.publicName).toBe('Hans');
            expect(soul.frontmatter.factionAffinity?.unaligned).toBe(80);
        });

        it('loads res:father-aereck with Saradomin-dominant faction affinity', () => {
            const soul = loader.load('res:father-aereck');
            expect(soul.frontmatter.heroProfile?.tier).toBe('hero');
            expect(soul.frontmatter.heroProfile?.publicName).toBe('Father Aereck');
            expect(soul.frontmatter.factionAffinity?.saradomin).toBe(70);
            expect(soul.frontmatter.factionAffinity?.guthix).toBe(10);
        });

        it('lists all three heroes among the starter resident names', () => {
            const names = loader.listResidentNames();
            expect(names).toEqual(expect.arrayContaining(['res:wise-old-man', 'res:hans', 'res:father-aereck']));
        });
    });
});
