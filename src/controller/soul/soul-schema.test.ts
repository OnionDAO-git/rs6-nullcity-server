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
});
