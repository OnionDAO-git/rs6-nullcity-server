import fs from 'fs';
import path from 'path';
import { createDefaultGameSkillEntries, STARTER_WIKI_PAGES } from './game-skill-entries';
import { GameSkillService } from './game-skill-context';
import { retrieveKnowledge } from './knowledge-retriever';

// S-WIKI-1: enable the maintainer's RuneScape wiki (docs/runescape-skill/) as a
// runtime knowledge source while PROVING the assembled brain prompt stays bounded.
//
// The maintainer's explicit concern: "would the entire wiki be in the prompt?
// wouldn't that overload context?" These tests are the answer — measurement, not
// assertion. They prove the wiki is (a) loadable + searchable and (b) cannot blow
// the brain-prompt budget no matter how large the corpus grows.

const WIKI_DIR = path.resolve(process.cwd(), 'docs/runescape-skill');

// Defensible ceiling. S-INFER-3 trimmed the total brain prompt to ~11KB; the
// knowledge-bearing brainSection is hard-capped at 2600 chars (renderSection) so
// a 16KB ceiling on the section leaves a comfortable >5x margin. If a future edit
// regresses the caps, this test goes red before the live controller bloats.
const BRAIN_SECTION_CEILING_BYTES = 16_000;

function perception(compressed: string) {
    return { tick: 1, compressed } as any;
}

function goal(id: string, description: string) {
    return { id, description, createdAtTick: 1 };
}

describe('RuneBench wiki enablement budget (S-WIKI-1)', () => {
    it('all STARTER_WIKI_PAGES exist on disk in docs/runescape-skill', () => {
        // The importer silently skips missing pages, so a stale path would just
        // drop a page rather than fail. This guards against that silent rot.
        const missing = STARTER_WIKI_PAGES.filter(page => !fs.existsSync(path.join(WIKI_DIR, page)));
        expect(missing).toEqual([]);
        expect(STARTER_WIKI_PAGES.length).toBeGreaterThanOrEqual(10);
    });

    it('imports the wiki as searchable knowledge entries when the dir is configured', () => {
        const withWiki = createDefaultGameSkillEntries(WIKI_DIR);
        const wikiEntries = withWiki.filter(entry => entry.id.startsWith('runebench-wiki:'));

        // Every configured page that exists should become exactly one entry.
        expect(wikiEntries.length).toBe(STARTER_WIKI_PAGES.length);

        // Per-page text bound (maxCharsPerPage = 600) holds for every entry.
        for (const entry of wikiEntries) {
            expect(entry.summary.length).toBeLessThanOrEqual(600);
        }
    });

    it('a relevant query retrieves a wiki-sourced entry (corpus is loaded + searchable)', () => {
        const entries = createDefaultGameSkillEntries(WIKI_DIR);

        // "King Black Dragon" is not in the starter corpus; use real starter content.
        // Anti-dragon-shield / KBD live in higher-level pages we deliberately exclude.
        // These queries target pages we DO import (monsters.md, places/wilderness.md).
        const cases: Array<[string, string]> = [
            ['what monsters can I fight and what do they drop', 'monsters'],
            ['is the wilderness dangerous and what are the rules there', 'wilderness'],
        ];

        for (const [query, pageStem] of cases) {
            const results = retrieveKnowledge(entries, query, { limit: 8, minScore: 1 });
            const hitWiki = results.some(r => r.entry.id.startsWith('runebench-wiki:'));
            const hitSpecific = results.some(r => r.entry.id.includes(pageStem));
            expect(hitWiki || hitSpecific).toBe(true);
        }
    });

    it('enabling the wiki does NOT grow the assembled brain section past the budget', () => {
        const inputs = [
            {
                resident: 'res:agent',
                tick: 10,
                activeGoal: goal('make-fire', 'Make a fire with tinderbox and logs.'),
                perception: perception('Inventory: rs:tinderbox, rs:logs. Nearby Tree, Chicken. HP 9/10.'),
            },
            {
                resident: 'res:agent',
                tick: 20,
                activeGoal: goal('safe-combat', 'Fight a safe low level monster and bury bones.'),
                perception: perception('Inventory: rs:bronze_sword, rs:bread. Nearby NPC: Goblin, Chicken. HP 7/10.'),
            },
            {
                resident: 'res:agent',
                tick: 30,
                activeGoal: goal('explore-varrock', 'Travel to Varrock and find the general store.'),
                perception: perception('Inventory: rs:coins. Nearby: road to Varrock, bank, general store.'),
            },
        ];

        const withWiki = new GameSkillService({ entries: createDefaultGameSkillEntries(WIKI_DIR) });
        const withoutWiki = new GameSkillService({ entries: createDefaultGameSkillEntries() });

        for (const input of inputs) {
            const enabled = withWiki.buildContext(input);
            const disabled = withoutWiki.buildContext(input);

            const enabledBytes = Buffer.byteLength(enabled.brainSection, 'utf8');
            const disabledBytes = Buffer.byteLength(disabled.brainSection, 'utf8');

            // 1) Hard ceiling: the section never exceeds the defensible budget.
            expect(enabledBytes).toBeLessThan(BRAIN_SECTION_CEILING_BYTES);

            // 2) Bounded delta: enabling the wiki cannot add more than a few KB.
            // renderSection caps the section at 2600 chars total, so the wiki can
            // only ever REPLACE engine entries within that envelope, never extend it.
            expect(enabledBytes - disabledBytes).toBeLessThan(3_000);

            // 3) renderSection's own hard cap is respected (defense in depth).
            expect(enabled.brainSection.length).toBeLessThanOrEqual(2600);
        }
    });
});
