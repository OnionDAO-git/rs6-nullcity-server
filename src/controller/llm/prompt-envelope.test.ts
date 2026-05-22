import type { Soul, SoulFrontmatter } from '../soul/soul-schema';
import { buildPromptEnvelope } from './prompt-envelope';

describe('buildPromptEnvelope', () => {
    it('includes the resident name, archetype, and command contract', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul(),
            perception: { tick: 1, actor: { id: 'res:test', type: 'resident' } },
            memories: [],
        });

        expect(rendered).toContain('## contract');
        expect(rendered).toContain('## resident');
        expect(rendered).toContain('res:test');
        expect(rendered).toContain('endurer');
    });

    it('renders the soul body verbatim inside the soul section', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoulWithBody('Agent is steady, reserved, and built around survival through routine.'),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## soul');
        expect(rendered).toContain('Agent is steady, reserved, and built around survival through routine.');
    });

    it('renders archetype as a behavioral framing directive, not just a bare label', () => {
        const enduringSoul = testSoul({ archetype: 'endurer' });
        const rendered = buildPromptEnvelope({
            soul: enduringSoul,
            perception: {},
            memories: [],
        });

        // Archetype must produce a directive section that tells the LLM how
        // this archetype tends to act, not just a JSON label inside resident.
        expect(rendered).toContain('## archetype');
        // Endurer-specific framing
        expect(rendered.toLowerCase()).toMatch(/endur|persever|survive/);
    });

    it('renders distinct directive language for each archetype', () => {
        const mentorRendered = buildPromptEnvelope({
            soul: testSoul({ archetype: 'mentor' }),
            perception: {},
            memories: [],
        });
        const achieverRendered = buildPromptEnvelope({
            soul: testSoul({ archetype: 'achiever' }),
            perception: {},
            memories: [],
        });

        expect(mentorRendered.toLowerCase()).toMatch(/teach|guid|mentor/);
        expect(achieverRendered.toLowerCase()).toMatch(/achiev|goal|accomplish|level/);
    });

    it('renders voice register and quirks as a dedicated directive section', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                voice: {
                    register: 'plain, measured, working-class',
                    quirks: ['ends sentences with a slight pause', 'never says "obviously"'],
                },
            }),
            perception: {},
            memories: [],
        });

        // Voice must surface as its own section with directive language
        expect(rendered).toContain('## voice');
        expect(rendered).toContain('plain, measured, working-class');
        expect(rendered).toContain('ends sentences with a slight pause');
        expect(rendered).toContain('never says "obviously"');
        // Must include directive framing, not just data dump
        expect(rendered.toLowerCase()).toMatch(/speak|tone|sound like/);
    });

    it('omits the voice section gracefully when no voice is configured', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({ voice: undefined }),
            perception: {},
            memories: [],
        });

        // No voice section header when not configured (or empty content)
        const voiceHeaderCount = (rendered.match(/## voice/g) || []).length;
        // Either absent, or present-but-empty — but no empty section noise
        if (voiceHeaderCount > 0) {
            // If we keep the header for stable ordering, it must indicate absence
            expect(rendered).toMatch(/## voice\n(none|not specified|\s*\n)/i);
        }
    });

    it('renders fears as a dedicated directive section that shapes behavior', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                fears: ['being forgotten', 'failing in front of Codex'],
            }),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## fears');
        expect(rendered).toContain('being forgotten');
        expect(rendered).toContain('failing in front of Codex');
        // Must be framed as instruction, not data
        expect(rendered.toLowerCase()).toMatch(/avoid|protect|wary|fear/);
    });

    it('renders loves as a dedicated directive section that shapes behavior', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                loves: ['quiet woodcutting', 'the sound of a crackling fire'],
            }),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## loves');
        expect(rendered).toContain('quiet woodcutting');
        expect(rendered).toContain('the sound of a crackling fire');
        // Must be framed as instruction (lean into, seek out, prefer)
        expect(rendered.toLowerCase()).toMatch(/seek|prefer|drawn to|gravitate|love/);
    });

    it('renders starting beliefs as their own section', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                startingBeliefs: ['Endurance is a choice made again each tick.'],
            }),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## beliefs');
        expect(rendered).toContain('Endurance is a choice made again each tick.');
    });

    it('renders goals as a dedicated directive section that biases plan selection', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                goals: ['become a master firemaker', 'find a lost friend in Lumbridge'],
            }),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## goals');
        expect(rendered).toContain('become a master firemaker');
        expect(rendered).toContain('find a lost friend in Lumbridge');
        // Must be framed as ambitions / direction, not just bullets
        expect(rendered.toLowerCase()).toMatch(/ambit|long-term|pursue|toward|goal/);
    });

    it('renders alignment as a dedicated directive section that shapes social choices', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                alignment: 'loyal to Codex but suspicious of strangers',
            }),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## alignment');
        expect(rendered).toContain('loyal to Codex but suspicious of strangers');
        expect(rendered.toLowerCase()).toMatch(/treat|toward other|alignment|moral|behav/);
    });

    it('renders aesthetic as a dedicated directive section that colours language', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul({
                aesthetic: 'rust and cold iron',
            }),
            perception: {},
            memories: [],
        });

        expect(rendered).toContain('## aesthetic');
        expect(rendered).toContain('rust and cold iron');
        expect(rendered.toLowerCase()).toMatch(/imagery|vibe|colour|color|sensory|aesthetic/);
    });

    it('omits goals/alignment/aesthetic sections cleanly when unset', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul(),
            perception: {},
            memories: [],
        });

        expect(rendered).not.toContain('## goals');
        expect(rendered).not.toContain('## alignment');
        expect(rendered).not.toContain('## aesthetic');
    });

    it('renders memories, perception, and the JSON output contract', () => {
        const rendered = buildPromptEnvelope({
            soul: testSoul(),
            perception: { tick: 42, actor: { id: 'res:test', type: 'resident' } },
            memories: ['Yesterday I chopped a tree near Lumbridge.'],
        });

        expect(rendered).toContain('## memories');
        expect(rendered).toContain('Yesterday I chopped a tree near Lumbridge.');
        expect(rendered).toContain('## perception');
        expect(rendered).toContain('"tick": 42');
        expect(rendered).toContain('## output');
        expect(rendered).toContain('memo');
    });
});

function testSoul(overrides: Partial<SoulFrontmatter> = {}): Soul {
    const frontmatter: SoulFrontmatter = {
        name: 'res:test',
        display: 'Test Resident',
        archetype: 'endurer',
        ...overrides,
    };
    return {
        frontmatter,
        body: '# Test soul body',
        sourcePath: '/tmp/test-soul.md',
    };
}

function testSoulWithBody(body: string, overrides: Partial<SoulFrontmatter> = {}): Soul {
    return { ...testSoul(overrides), body };
}
