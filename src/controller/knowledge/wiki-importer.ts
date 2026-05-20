import fs from 'fs';
import path from 'path';

export interface RuneBenchWikiSnippet {
    id: string;
    title: string;
    text: string;
    sourcePath: string;
}

export interface RuneBenchWikiSnippetOptions {
    maxCharsPerPage?: number;
}

export function loadRuneBenchWikiSnippets(
    wikiRoot: string,
    relativePages: string[],
    options: RuneBenchWikiSnippetOptions = {},
): RuneBenchWikiSnippet[] {
    const maxCharsPerPage = options.maxCharsPerPage ?? 1200;
    const root = path.resolve(wikiRoot);
    const snippets: RuneBenchWikiSnippet[] = [];

    for (const relativePage of relativePages) {
        const sourcePath = path.resolve(root, relativePage);
        if (!isInside(root, sourcePath) || !sourcePath.endsWith('.md') || !fs.existsSync(sourcePath)) {
            continue;
        }

        const markdown = fs.readFileSync(sourcePath, 'utf8');
        const title = extractTitle(markdown) || titleFromPath(relativePage);
        const text = compactMarkdown(markdown).slice(0, maxCharsPerPage).trimEnd();
        if (!text) {
            continue;
        }

        snippets.push({
            id: `runebench-wiki:${withoutMarkdownExtension(relativePage)}`,
            title,
            text,
            sourcePath,
        });
    }

    return snippets;
}

function compactMarkdown(markdown: string): string {
    return markdown
        .split(/\r?\n/g)
        .map(line => line.replace(/^#+\s*/, '').trim())
        .filter(line => line && !line.startsWith('|') && !line.startsWith('---'))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTitle(markdown: string): string | undefined {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
}

function titleFromPath(relativePage: string): string {
    const base = path.basename(relativePage, '.md');
    return base
        .split('-')
        .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function withoutMarkdownExtension(relativePage: string): string {
    return relativePage.replace(/\.md$/i, '');
}

function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
