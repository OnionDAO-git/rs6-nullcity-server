import { pickPhrase } from './phrasebook';
import type { Soul } from './soul-schema';

/**
 * Voice-skinning of the presence beacon (the public crowd-visible "I am online /
 * scouting / working my route" bubbles). Previously hardcoded debug-flavored
 * strings that bypassed each soul's register; now routed through the phrasebook
 * so an endurer reads weary and a mentor reads instructive. NO LLM calls —
 * deterministic selection seeded by resident+tick.
 */
function makeSoul(register: string | undefined, display = 'Hans', archetype = 'endurer'): Soul {
    return {
        frontmatter: {
            name: 'res:hans',
            display,
            archetype,
            voice: register ? { register } : undefined,
        },
    } as unknown as Soul;
}

const PHASES = ['online', 'idle', 'scouting', 'route'] as const;
const REGISTERS = ['achiever', 'mentor', 'endurer', 'default'];

describe('phrasebook — presence_beacon situation', () => {
    it('returns a non-empty, telemetry-free line for every register and phase', () => {
        for (const register of REGISTERS) {
            for (const phase of PHASES) {
                const line = pickPhrase({
                    soul: makeSoul(register === 'default' ? undefined : register, 'Hans', 'endurer'),
                    situation: `presence_beacon.${phase}`,
                    seed: `res:hans:42`,
                    params: { display: 'Hans' },
                });
                expect(line.length).toBeGreaterThan(0);
                // Never leak the perception read-out the live audit flagged.
                expect(line).not.toMatch(/\btrees?\b/i);
                expect(line).not.toMatch(/\bNPCs?\b/i);
                expect(line).not.toMatch(/Nearby I see/i);
                // No leftover unfilled template tokens.
                expect(line).not.toMatch(/\{[a-z]+\}/i);
            }
        }
    });

    it('is deterministic for a fixed seed', () => {
        const q = {
            soul: makeSoul('endurer'),
            situation: 'presence_beacon.scouting',
            seed: 'res:hans:1200',
            params: { display: 'Hans' },
        };
        expect(pickPhrase(q)).toBe(pickPhrase(q));
    });

    it('varies the line as the seed (resident+tick) changes', () => {
        const lines = new Set<string>();
        for (let tick = 0; tick < 12; tick++) {
            lines.add(
                pickPhrase({
                    soul: makeSoul('endurer'),
                    situation: 'presence_beacon.scouting',
                    seed: `res:hans:${tick}`,
                    params: { display: 'Hans' },
                }),
            );
        }
        expect(lines.size).toBeGreaterThan(1);
    });

    it('reflects the soul register — endurer and mentor differ in tone', () => {
        const seed = 'res:x:7';
        const endurer = pickPhrase({ soul: makeSoul('endurer'), situation: 'presence_beacon.route', seed, params: { display: 'X' } });
        const mentor = pickPhrase({ soul: makeSoul('mentor'), situation: 'presence_beacon.route', seed, params: { display: 'X' } });
        expect(endurer).not.toBe(mentor);
    });

    it('falls back to the default register for an unknown register', () => {
        const line = pickPhrase({
            soul: makeSoul('whimsical-unknown-register'),
            situation: 'presence_beacon.online',
            seed: 'res:hans:3',
            params: { display: 'Hans' },
        });
        expect(line.length).toBeGreaterThan(0);
        expect(line).not.toMatch(/\{[a-z]+\}/i);
    });
});
