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
                model: { endpoint: 'local', model: 'resident-model', temperature: 0.4, thinking: false },
                behavior: {
                    kind: 'hybrid-agent',
                    brain: { model: 'resident-brain-model', thinking: true },
                    body: { model: 'resident-body-model', thinking: false },
                },
            },
            '/tmp/res-agent.md',
        );

        expect(frontmatter.model).toEqual({ endpoint: 'local', model: 'resident-model', temperature: 0.4, thinking: false });
        expect(frontmatter.behavior).toMatchObject({
            brain: { model: 'resident-brain-model' },
            body: { model: 'resident-body-model' },
        });
    });

    it('accepts explicit restart respawn policy for development residents', () => {
        const frontmatter = validateSoulFrontmatter(
            {
                name: 'res:agent',
                archetype: 'endurer',
                respawnPolicy: 'on_restart',
            },
            '/tmp/res-agent.md',
        );

        expect(frontmatter.respawnPolicy).toBe('on_restart');
    });

    it('rejects unknown respawn policies', () => {
        expect(() =>
            validateSoulFrontmatter(
                {
                    name: 'res:agent',
                    archetype: 'endurer',
                    respawnPolicy: 'always',
                },
                '/tmp/res-agent.md',
            ),
        ).toThrow('Invalid soul frontmatter');
    });

    it('rejects resident names that the live gateway cannot create or connect', () => {
        expect(() =>
            validateSoulFrontmatter(
                {
                    name: 'res:forgemaster-mother-anvil',
                    archetype: 'achiever',
                },
                '/tmp/res-forgemaster-mother-anvil.md',
            ),
        ).toThrow('Invalid soul frontmatter');
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

    describe('factionAffinity + dominantFaction (K-α)', () => {
        it('accepts a soul with partial affinity scores', () => {
            const frontmatter = validateSoulFrontmatter(
                {
                    name: 'res:fern',
                    archetype: 'mentor',
                    factionAffinity: { saradomin: 60, guthix: 25 },
                },
                '/tmp/fern.md',
            );
            expect(frontmatter.factionAffinity?.saradomin).toBe(60);
            expect(frontmatter.factionAffinity?.guthix).toBe(25);
            expect(frontmatter.factionAffinity?.zamorak).toBeUndefined();
        });

        it('rejects a score outside 0..100', () => {
            expect(() =>
                validateSoulFrontmatter(
                    {
                        name: 'res:bad',
                        archetype: 'achiever',
                        factionAffinity: { saradomin: 150 },
                    },
                    '/tmp/bad.md',
                ),
            ).toThrow();
            expect(() =>
                validateSoulFrontmatter(
                    {
                        name: 'res:bad',
                        archetype: 'achiever',
                        factionAffinity: { saradomin: -1 },
                    },
                    '/tmp/bad.md',
                ),
            ).toThrow();
        });

        it('back-compat: soul without factionAffinity still parses', () => {
            const frontmatter = validateSoulFrontmatter({ name: 'res:agent', archetype: 'endurer' }, '/tmp/agent.md');
            expect(frontmatter.factionAffinity).toBeUndefined();
        });
    });

    describe('factionId (K3)', () => {
        it('accepts a valid Null City faction id', () => {
            const frontmatter = validateSoulFrontmatter(
                { name: 'res:mother-anvil', archetype: 'achiever', factionId: 'foundry' },
                '/tmp/anvil.md',
            );
            expect(frontmatter.factionId).toBe('foundry');
        });

        it('back-compat: soul without factionId still parses', () => {
            const frontmatter = validateSoulFrontmatter({ name: 'res:agent', archetype: 'endurer' }, '/tmp/agent.md');
            expect(frontmatter.factionId).toBeUndefined();
        });

        it('rejects an empty factionId string', () => {
            expect(() => validateSoulFrontmatter({ name: 'res:test', archetype: 'endurer', factionId: '' }, '/tmp/test.md')).toThrow();
        });
    });
});

describe('dominantFaction', () => {
    const { dominantFaction } = require('./soul-schema') as typeof import('./soul-schema');

    it('returns null when affinity is undefined', () => {
        expect(dominantFaction(undefined)).toBeNull();
    });

    it('returns null when all scores are zero or undefined', () => {
        expect(dominantFaction({})).toBeNull();
        expect(dominantFaction({ saradomin: 0, guthix: 0 })).toBeNull();
    });

    it('returns the faction with the strictly highest score', () => {
        expect(dominantFaction({ saradomin: 60, guthix: 25 })).toBe('saradomin');
        expect(dominantFaction({ saradomin: 10, zamorak: 80 })).toBe('zamorak');
        expect(dominantFaction({ guthix: 100 })).toBe('guthix');
    });

    it('first-listed faction wins on tie (saradomin > guthix > zamorak > unaligned)', () => {
        // 'first listed' = iteration order in dominantFaction.
        expect(dominantFaction({ saradomin: 50, guthix: 50 })).toBe('saradomin');
        expect(dominantFaction({ guthix: 50, zamorak: 50 })).toBe('guthix');
    });

    it('respects unaligned only when no other faction strictly exceeds it', () => {
        expect(dominantFaction({ unaligned: 80 })).toBe('unaligned');
        expect(dominantFaction({ saradomin: 81, unaligned: 80 })).toBe('saradomin');
    });
});
