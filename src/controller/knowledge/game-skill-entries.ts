import path from 'path';
import { ENGINE_KNOWLEDGE_ENTRIES, type KnowledgeEntry } from './knowledge-retriever';
import { loadSkillGuideKnowledgeEntries } from './skill-guide-importer';
import { loadRuneBenchWikiSnippets } from './wiki-importer';

// Curated subset of the maintainer's RuneScape wiki (docs/runescape-skill/).
// Every path here MUST exist on disk; the importer silently skips missing files,
// so a typo would just drop a page rather than error. These are the highest-value
// pages for a starter resident. Adding more pages here does NOT grow the brain
// prompt: retrieveKnowledge caps results (limit 8) and game-skill-context.ts caps
// the rendered knowledge block (tokenBudget 1500 + maxChars 1600) and the whole
// brain section (renderSection 2600 chars). Per-page text is also truncated to
// maxCharsPerPage below. So this list controls *recall*, not prompt size.
export const STARTER_WIKI_PAGES = [
    // Core skills a level-1 resident trains first
    'skills/combat.md',
    'skills/woodcutting.md',
    'skills/firemaking.md',
    'skills/fishing.md',
    'skills/cooking.md',
    'skills/prayer.md',
    'skills/mining.md',
    'skills/smithing.md',
    'skills/magic.md',
    'skills/ranged.md',
    // World references
    'monsters.md',
    'items.md',
    'economy.md',
    // Key places + NPCs for navigation and dialogue
    'places/lumbridge.md',
    'places/varrock.md',
    'places/al-kharid.md',
    'places/draynor-village.md',
    'places/wilderness.md',
    'npcs/lumbridge.md',
    'npcs/varrock.md',
    // Starter quests
    'quests/cooks-assistant.md',
    'quests/restless-ghost.md',
];

// Per-page text cap. With renderSection's hard 2600-char brain-section ceiling,
// no realistic set of pages can blow the prompt budget; this just keeps any single
// imported page bounded before retrieval/budget caps apply downstream.
const WIKI_MAX_CHARS_PER_PAGE = 600;

export function createDefaultGameSkillEntries(runebenchWikiDir?: string): KnowledgeEntry[] {
    return [
        ...ENGINE_KNOWLEDGE_ENTRIES,
        ...loadSkillGuideKnowledgeEntries(path.resolve(process.cwd(), 'src/plugins/skills/skill-guides'), { maxLinesPerGuide: 8 }),
        ...loadWikiKnowledgeEntries(runebenchWikiDir),
    ];
}

function loadWikiKnowledgeEntries(runebenchWikiDir: string | undefined): KnowledgeEntry[] {
    if (!runebenchWikiDir) {
        return [];
    }

    return loadRuneBenchWikiSnippets(runebenchWikiDir, STARTER_WIKI_PAGES, { maxCharsPerPage: WIKI_MAX_CHARS_PER_PAGE }).map(snippet => ({
        id: snippet.id,
        title: `RuneBench Wiki: ${snippet.title}`,
        summary: snippet.text,
        topics: ['runebench-wiki', ...words(snippet.title)],
        keywords: words(`${snippet.title} ${snippet.text}`),
        source: snippet.sourcePath,
    }));
}

function words(text: string): string[] {
    return Array.from(
        new Set(
            text
                .toLowerCase()
                .replace(/[_:]/g, ' ')
                .split(/[^a-z0-9]+/g)
                .filter(word => word.length > 1),
        ),
    );
}
