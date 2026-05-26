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

    it('loads the starter agent with restart respawn enabled for local QA', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        const soul = loader.load('res:agent');

        expect(soul.frontmatter.respawnPolicy).toBe('on_restart');
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

        it('loads Pip and Thrand with hero anchors and authored goals', () => {
            const pip = loader.load('res:pip');
            const thrand = loader.load('res:thrand');

            expect(pip.frontmatter.heroProfile?.tier).toBe('hero');
            expect(pip.frontmatter.heroProfile?.anchor).toEqual([3208, 3209, 0]);
            expect(pip.frontmatter.goals?.length).toBeGreaterThanOrEqual(2);

            expect(thrand.frontmatter.heroProfile?.tier).toBe('hero');
            expect(thrand.frontmatter.heroProfile?.anchor).toEqual([3235, 3234, 0]);
            expect(thrand.frontmatter.goals?.length).toBeGreaterThanOrEqual(2);
        });

        it('lists all six heroes among the starter resident names', () => {
            const names = loader.listResidentNames();
            expect(names).toEqual(
                expect.arrayContaining(['res:wise-old-man', 'res:hans', 'res:father-aereck', 'res:duke-horacio', 'res:pip', 'res:thrand']),
            );
        });
    });

    describe('specialized QA resident cohort', () => {
        const loader = new SoulLoader(path.join(__dirname, 'starter-souls'));

        it('loads behavior-focused test residents with standard SPARK modules', () => {
            const names = loader.listResidentNames();
            expect(names).toEqual(
                expect.arrayContaining([
                    'res:qa-woodcutter',
                    'res:qa-angler',
                    'res:qa-guardian',
                    'res:qa-social',
                    'res:qa-cook',
                    'res:qa-scout',
                    'res:qa-trader',
                    'res:qa-survivor',
                    'res:qa-banker',
                    'res:qa-guide',
                    'res:qa-priest',
                    'res:qa-forager',
                ]),
            );

            for (const name of [
                'res:qa-woodcutter',
                'res:qa-angler',
                'res:qa-guardian',
                'res:qa-social',
                'res:qa-cook',
                'res:qa-scout',
                'res:qa-trader',
                'res:qa-survivor',
                'res:qa-banker',
                'res:qa-guide',
                'res:qa-priest',
                'res:qa-forager',
            ]) {
                const soul = loader.load(name);
                expect(soul.frontmatter.modules).toEqual([{ id: 'onion.runescape.standard', enabled: true }]);
                expect(soul.frontmatter.behavior?.kind).toBe('hybrid-agent');
                expect(soul.frontmatter.respawnPolicy).toBe('on_restart');
                expect(soul.frontmatter.attentionProfile?.startingAttention).toBeGreaterThanOrEqual(30000);
            }
        });

        it('assigns each QA resident a distinct seeded behavior target', () => {
            expect(loader.load('res:qa-woodcutter').frontmatter.legacy?.parameters?.benchmarkTask).toBe('woodcutting-firemaking-10m');
            expect(loader.load('res:qa-angler').frontmatter.legacy?.parameters?.benchmarkTask).toBe('fishing-cooking-10m');
            expect(loader.load('res:qa-guardian').frontmatter.legacy?.parameters?.benchmarkTask).toBe('combat-prayer-10m');
            expect(loader.load('res:qa-social').frontmatter.behavior).toEqual(
                expect.objectContaining({ followPlayer: 'codex', commandPrefix: 'social' }),
            );
            expect(loader.load('res:qa-cook').frontmatter.legacy?.parameters?.benchmarkTask).toBe('fishing-cooking-10m');
            expect(loader.load('res:qa-scout').frontmatter.legacy?.parameters?.benchmarkTask).toBe('explore-report-5m');
            expect(loader.load('res:qa-trader').frontmatter.behavior).toEqual(
                expect.objectContaining({ followPlayer: 'codex', commandPrefix: 'trade' }),
            );
            expect(loader.load('res:qa-survivor').frontmatter.legacy?.parameters?.benchmarkTask).toBe('combat-prayer-10m');
            expect(loader.load('res:qa-banker').frontmatter.behavior).toEqual(
                expect.objectContaining({ followPlayer: 'codex', commandPrefix: 'bank' }),
            );
            expect(loader.load('res:qa-guide').frontmatter.behavior).toEqual(expect.objectContaining({ commandPrefix: 'guide' }));
            expect(loader.load('res:qa-priest').frontmatter.legacy?.parameters?.benchmarkTask).toBe('combat-prayer-10m');
            expect(loader.load('res:qa-forager').frontmatter.legacy?.parameters?.benchmarkTask).toBe('explore-report-5m');
        });

        it('uses only synthetic QA residents for the qwopus canary split', () => {
            expect(loader.load('res:agent').frontmatter.model?.endpoint).toBe('default');
            expect(loader.load('res:hans').frontmatter.model?.endpoint ?? 'default').toBe('default');
            expect(loader.load('res:qa-scout').frontmatter.model?.endpoint).toBe('spacetower_qwopus_q4');
            expect(loader.load('res:qa-forager').frontmatter.model?.endpoint).toBe('spacetower_qwopus_q4');
        });
    });
});
