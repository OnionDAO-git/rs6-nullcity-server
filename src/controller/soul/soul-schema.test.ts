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
});
