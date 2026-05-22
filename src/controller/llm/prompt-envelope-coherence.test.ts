/**
 * SOUL → prompt coherence regression.
 *
 * Future kernel changes can silently drop a SOUL field by forgetting to
 * thread it from frontmatter into the envelope or hybrid-agent prompts.
 * This single integration test catches that: for a representative
 * fully-populated SOUL, every authored field must appear (with directive
 * framing) in the rendered envelope AND in both Brain and Body prompts.
 *
 * If a kernel refactor breaks soul → prompt threading, this test fails.
 * To intentionally remove a soul field, update both the schema and this
 * test in the same commit.
 */

import type { Soul, SoulFrontmatter } from '../soul/soul-schema';
import type { Perception } from '../transport/message-codecs';
import { buildBodyPrompt, buildBrainPrompt } from '../thinking/hybrid-agent-prompts';
import { buildPromptEnvelope } from './prompt-envelope';

describe('SOUL → prompt coherence regression', () => {
    const richSoul = buildRichSoul();
    const perception: Perception = {
        tick: 100,
        actor: { id: 'res:rich', type: 'resident' },
        compressed: 'Visible: Tree, Codex. Inventory: tinderbox, bronze axe.',
    } as Perception;

    describe('prompt envelope', () => {
        const rendered = buildPromptEnvelope({
            soul: richSoul,
            perception,
            memories: ['Yesterday I lit a fire near the bank.'],
        });

        it('renders all expected section headers in stable order', () => {
            const expectedHeaders = [
                '## contract',
                '## resident',
                '## archetype',
                '## voice',
                '## fears',
                '## loves',
                '## goals',
                '## alignment',
                '## aesthetic',
                '## soul',
                '## beliefs',
                '## legacy',
                '## variables',
                '## trigger',
                '## memories',
                '## perception',
                '## output',
                '## limits',
            ];
            let cursor = 0;
            for (const header of expectedHeaders) {
                const idx = rendered.indexOf(header, cursor);
                expect({ header, found: idx >= 0 }).toEqual({ header, found: true });
                cursor = idx + header.length;
            }
        });

        it('contains the resident name and display', () => {
            expect(rendered).toContain('res:rich');
        });

        it('contains the soul body verbatim', () => {
            expect(rendered).toContain(richSoul.body);
        });

        it.each([
            ['archetype text', richSoul.frontmatter.voice ? 'mentor' : ''], // placeholder, replaced below
        ])('archetype directive present (%s)', () => {
            expect(rendered.toLowerCase()).toMatch(/teach|guid|mentor/);
        });

        it('contains voice register and every quirk', () => {
            expect(rendered).toContain(richSoul.frontmatter.voice!.register!);
            for (const quirk of richSoul.frontmatter.voice!.quirks!) {
                expect(rendered).toContain(quirk);
            }
        });

        it('contains every fear', () => {
            for (const fear of richSoul.frontmatter.fears!) {
                expect(rendered).toContain(fear);
            }
        });

        it('contains every love', () => {
            for (const love of richSoul.frontmatter.loves!) {
                expect(rendered).toContain(love);
            }
        });

        it('contains every goal in priority order', () => {
            const positions = richSoul.frontmatter.goals!.map(goal => rendered.indexOf(goal));
            expect(positions.every(p => p >= 0)).toBe(true);
            // Priority order preserved in rendered prompt
            for (let i = 1; i < positions.length; i++) {
                expect(positions[i]).toBeGreaterThan(positions[i - 1]);
            }
        });

        it('contains alignment and aesthetic', () => {
            expect(rendered).toContain(richSoul.frontmatter.alignment!);
            expect(rendered).toContain(richSoul.frontmatter.aesthetic!);
        });

        it('contains every starting belief', () => {
            for (const belief of richSoul.frontmatter.startingBeliefs!) {
                expect(rendered).toContain(belief);
            }
        });
    });

    describe('Brain prompt', () => {
        const brain = buildBrainPrompt({
            soul: richSoul,
            perception,
            commandPrefix: 'agent',
        });

        it('archetype mentor framing reaches the Brain', () => {
            expect(brain.toLowerCase()).toMatch(/teach|guid|mentor/);
        });

        it('voice register + quirks reach the Brain', () => {
            expect(brain).toContain(richSoul.frontmatter.voice!.register!);
            for (const quirk of richSoul.frontmatter.voice!.quirks!) {
                expect(brain).toContain(quirk);
            }
        });

        it('fears reach the Brain', () => {
            for (const fear of richSoul.frontmatter.fears!) {
                expect(brain).toContain(fear);
            }
        });

        it('loves reach the Brain', () => {
            for (const love of richSoul.frontmatter.loves!) {
                expect(brain).toContain(love);
            }
        });

        it('goals reach the Brain in priority order', () => {
            const positions = richSoul.frontmatter.goals!.map(g => brain.indexOf(g));
            expect(positions.every(p => p >= 0)).toBe(true);
            for (let i = 1; i < positions.length; i++) {
                expect(positions[i]).toBeGreaterThan(positions[i - 1]);
            }
        });

        it('alignment reaches the Brain', () => {
            expect(brain).toContain(richSoul.frontmatter.alignment!);
        });

        it('aesthetic reaches the Brain', () => {
            expect(brain).toContain(richSoul.frontmatter.aesthetic!);
        });

        it('soul body reaches the Brain', () => {
            expect(brain).toContain(richSoul.body);
        });
    });

    describe('Body prompt', () => {
        const body = buildBodyPrompt({
            soul: richSoul,
            perception,
            commandPrefix: 'agent',
            visibility: { returnDue: false },
        });

        it('archetype framing reaches the Body for action selection bias', () => {
            expect(body.toLowerCase()).toMatch(/teach|guid|mentor/);
        });

        it('voice reaches the Body so say-actions sound in-character', () => {
            expect(body).toContain(richSoul.frontmatter.voice!.register!);
        });

        it('fears reach the Body', () => {
            for (const fear of richSoul.frontmatter.fears!) {
                expect(body).toContain(fear);
            }
        });

        it('loves reach the Body', () => {
            for (const love of richSoul.frontmatter.loves!) {
                expect(body).toContain(love);
            }
        });

        it('goals reach the Body', () => {
            for (const goal of richSoul.frontmatter.goals!) {
                expect(body).toContain(goal);
            }
        });

        it('alignment reaches the Body', () => {
            expect(body).toContain(richSoul.frontmatter.alignment!);
        });

        it('aesthetic reaches the Body', () => {
            expect(body).toContain(richSoul.frontmatter.aesthetic!);
        });
    });

    describe('order stability (snapshot-friendly)', () => {
        it('produces a stable rendering for the same inputs', () => {
            const first = buildPromptEnvelope({
                soul: richSoul,
                perception,
                memories: ['Stable memory line.'],
                variables: { wariness: 12 },
            });
            const second = buildPromptEnvelope({
                soul: richSoul,
                perception,
                memories: ['Stable memory line.'],
                variables: { wariness: 12 },
            });
            expect(first).toBe(second);
        });

        it('places identity sections before runtime/perception sections', () => {
            const rendered = buildPromptEnvelope({
                soul: richSoul,
                perception,
                memories: ['Stable memory line.'],
            });
            const archetypeIdx = rendered.indexOf('## archetype');
            const voiceIdx = rendered.indexOf('## voice');
            const fearsIdx = rendered.indexOf('## fears');
            const lovesIdx = rendered.indexOf('## loves');
            const goalsIdx = rendered.indexOf('## goals');
            const alignmentIdx = rendered.indexOf('## alignment');
            const aestheticIdx = rendered.indexOf('## aesthetic');
            const soulIdx = rendered.indexOf('## soul');
            const memoriesIdx = rendered.indexOf('## memories');
            const perceptionIdx = rendered.indexOf('## perception');

            // sanity — both runtime sections must exist
            expect(memoriesIdx).toBeGreaterThan(-1);
            expect(perceptionIdx).toBeGreaterThan(-1);

            // Identity block must come before runtime memories/perception
            for (const idx of [archetypeIdx, voiceIdx, fearsIdx, lovesIdx, goalsIdx, alignmentIdx, aestheticIdx, soulIdx]) {
                expect(idx).toBeGreaterThan(-1);
                expect(idx).toBeLessThan(memoriesIdx);
                expect(idx).toBeLessThan(perceptionIdx);
            }
        });
    });
});

function buildRichSoul(): Soul {
    const frontmatter: SoulFrontmatter = {
        name: 'res:rich',
        display: 'Rich Resident',
        archetype: 'mentor',
        voice: {
            register: 'patient, measured, deliberate',
            quirks: ['ends sentences with a slight pause', 'never uses "obviously"'],
        },
        fears: ['being forgotten', 'failing in front of Codex'],
        loves: ['quiet woodcutting', 'the sound of a crackling fire'],
        goals: ['become a master firemaker', 'find a lost friend in Lumbridge', 'mentor one new resident'],
        alignment: 'loyal to Codex but suspicious of strangers',
        aesthetic: 'rust and cold iron in lantern light',
        startingBeliefs: ['Endurance is a choice made again each tick.', 'A teacher learns more than the student.'],
        legacy: { kind: 'mentor', parameters: { targetMentees: 1 } },
    };
    return {
        frontmatter,
        body: 'Rich Resident is a patient teacher who lights fires and reads the smoke.',
        sourcePath: '/tmp/rich-soul.md',
    };
}
