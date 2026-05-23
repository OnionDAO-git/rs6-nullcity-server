import { validateSoulFrontmatter } from './soul-schema';

describe('validateSoulFrontmatter modules', () => {
    it('parses data-only SPARK module selections', () => {
        const frontmatter = validateSoulFrontmatter(
            {
                name: 'res:agent',
                archetype: 'endurer',
                modules: [{ id: 'onion.runescape.standard', config: { followPlayer: 'codex' } }],
            },
            '/tmp/res-agent.md',
        );

        expect(frontmatter.modules).toEqual([{ id: 'onion.runescape.standard', config: { followPlayer: 'codex' } }]);
    });

    it('rejects module selections with executable entrypoints', () => {
        expect(() =>
            validateSoulFrontmatter(
                {
                    name: 'res:agent',
                    archetype: 'endurer',
                    modules: [{ id: 'onion.bad', entrypoint: './hack.js' }],
                },
                '/tmp/res-agent.md',
            ),
        ).toThrow('Invalid soul frontmatter');
    });

    it('rejects duplicate module selections', () => {
        expect(() =>
            validateSoulFrontmatter(
                {
                    name: 'res:agent',
                    archetype: 'endurer',
                    modules: [{ id: 'onion.runescape.standard' }, { id: 'onion.runescape.standard' }],
                },
                '/tmp/res-agent.md',
            ),
        ).toThrow('Duplicate SPARK module selection onion.runescape.standard');
    });

    it('rejects top-level typos that would otherwise fall back to legacy behavior', () => {
        expect(() =>
            validateSoulFrontmatter(
                {
                    name: 'res:agent',
                    archetype: 'endurer',
                    module: [{ id: 'onion.runescape.standard' }],
                },
                '/tmp/res-agent.md',
            ),
        ).toThrow('Invalid soul frontmatter');
    });

    it('accepts per-resident model overrides in soul and hybrid inference profiles', () => {
        const frontmatter = validateSoulFrontmatter(
            {
                name: 'res:agent',
                archetype: 'endurer',
                model: { endpoint: 'local', model: 'resident-model', temperature: 0.4 },
                behavior: {
                    kind: 'hybrid-agent',
                    brain: { model: 'resident-brain-model', thinking: true },
                    body: { model: 'resident-body-model', thinking: false },
                },
            },
            '/tmp/res-agent.md',
        );

        expect(frontmatter.model).toEqual({ endpoint: 'local', model: 'resident-model', temperature: 0.4 });
        expect(frontmatter.behavior).toMatchObject({
            brain: { model: 'resident-brain-model' },
            body: { model: 'resident-body-model' },
        });
    });

    describe('heroProfile (M-α)', () => {
        it('accepts a hero soul with tier=hero, publicName, signatureAction, and anchor', () => {
            const frontmatter = validateSoulFrontmatter(
                {
                    name: 'res:wise-old-man',
                    archetype: 'mentor',
                    heroProfile: {
                        tier: 'hero',
                        publicName: 'The Wise Old Man',
                        signatureAction: 'advises on quests with a sigh',
                        anchor: [3088, 3253, 0],
                    },
                },
                '/tmp/wise-old-man.md',
            );

            expect(frontmatter.heroProfile?.tier).toBe('hero');
            expect(frontmatter.heroProfile?.publicName).toBe('The Wise Old Man');
            expect(frontmatter.heroProfile?.signatureAction).toBe('advises on quests with a sigh');
            expect(frontmatter.heroProfile?.anchor).toEqual([3088, 3253, 0]);
        });

        it('accepts a novice tier without an anchor', () => {
            const frontmatter = validateSoulFrontmatter(
                {
                    name: 'res:apprentice',
                    archetype: 'achiever',
                    heroProfile: {
                        tier: 'novice',
                        publicName: 'A Hopeful Apprentice',
                        signatureAction: 'asks for help often',
                    },
                },
                '/tmp/apprentice.md',
            );

            expect(frontmatter.heroProfile?.tier).toBe('novice');
            expect(frontmatter.heroProfile?.anchor).toBeUndefined();
        });

        it('accepts a soul without heroProfile (back-compat: existing souls still load)', () => {
            const frontmatter = validateSoulFrontmatter(
                {
                    name: 'res:agent',
                    archetype: 'endurer',
                },
                '/tmp/agent.md',
            );
            expect(frontmatter.heroProfile).toBeUndefined();
        });

        it('rejects an unknown heroProfile.tier value', () => {
            expect(() =>
                validateSoulFrontmatter(
                    {
                        name: 'res:bad',
                        archetype: 'achiever',
                        heroProfile: {
                            tier: 'legend' as any,
                            publicName: 'Bad',
                            signatureAction: 'x',
                        },
                    },
                    '/tmp/bad.md',
                ),
            ).toThrow('Invalid soul frontmatter');
        });

        it('rejects heroProfile with empty publicName or signatureAction', () => {
            expect(() =>
                validateSoulFrontmatter(
                    {
                        name: 'res:bad',
                        archetype: 'achiever',
                        heroProfile: {
                            tier: 'hero',
                            publicName: '',
                            signatureAction: 'x',
                        },
                    },
                    '/tmp/bad.md',
                ),
            ).toThrow();
        });
    });
});
