import path from 'path';
import { ENGINE_KNOWLEDGE_ENTRIES, type KnowledgeEntry } from './knowledge-retriever';
import { loadSkillGuideKnowledgeEntries } from './skill-guide-importer';
import { loadRuneBenchWikiSnippets } from './wiki-importer';

const STARTER_WIKI_PAGES = ['npcs/chicken.md', 'npcs/cow.md', 'npcs/goblin.md', 'shops/lumbridge-general-store.md'];

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

    return loadRuneBenchWikiSnippets(runebenchWikiDir, STARTER_WIKI_PAGES, { maxCharsPerPage: 600 }).map(snippet => ({
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
