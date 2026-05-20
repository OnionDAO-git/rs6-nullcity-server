import fs from 'fs';
import path from 'path';
import type { KnowledgeEntry } from './knowledge-retriever';

interface SkillGuideJson {
    name?: unknown;
    sub_guides?: Array<{
        name?: unknown;
        lines?: Array<{
            item?: unknown;
            text?: unknown;
            level?: unknown;
        }>;
    }>;
}

export interface SkillGuideImportOptions {
    maxLinesPerGuide?: number;
}

export function loadSkillGuideKnowledgeEntries(skillGuideRoot: string, options: SkillGuideImportOptions = {}): KnowledgeEntry[] {
    if (!fs.existsSync(skillGuideRoot)) {
        return [];
    }

    const maxLinesPerGuide = options.maxLinesPerGuide ?? 12;

    return fs
        .readdirSync(skillGuideRoot)
        .filter(fileName => fileName.endsWith('.json'))
        .flatMap(fileName => loadSkillGuideEntry(path.join(skillGuideRoot, fileName), maxLinesPerGuide));
}

function loadSkillGuideEntry(sourcePath: string, maxLinesPerGuide: number): KnowledgeEntry[] {
    let guide: SkillGuideJson;
    try {
        guide = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as SkillGuideJson;
    } catch {
        return [];
    }

    const skillName = typeof guide.name === 'string' ? guide.name : path.basename(sourcePath, '.json');
    const facts = compactGuideFacts(guide, maxLinesPerGuide);
    if (!facts.length) {
        return [];
    }

    const slug = slugify(skillName);
    const keywords = Array.from(new Set([slug, ...words(skillName), ...facts.flatMap(fact => words(`${fact.text} ${fact.item || ''}`))]));

    return [
        {
            id: `skill-guide:${slug}`,
            title: `Skill Guide: ${skillName}`,
            topics: [slug, 'skill-guide'],
            keywords,
            source: sourcePath,
            summary: `${skillName} guide: ${facts.map(formatFact).join('; ')}.`,
        },
    ];
}

function compactGuideFacts(
    guide: SkillGuideJson,
    maxLinesPerGuide: number,
): Array<{ subGuide: string; item?: string; text: string; level?: number }> {
    const facts: Array<{ subGuide: string; item?: string; text: string; level?: number }> = [];
    for (const subGuide of guide.sub_guides || []) {
        const subGuideName = typeof subGuide.name === 'string' ? subGuide.name : 'Guide';
        for (const line of subGuide.lines || []) {
            const text = typeof line.text === 'string' ? line.text : undefined;
            if (!text) {
                continue;
            }

            facts.push({
                subGuide: subGuideName,
                item: typeof line.item === 'string' ? line.item : undefined,
                text,
                level: typeof line.level === 'number' ? line.level : undefined,
            });

            if (facts.length >= maxLinesPerGuide) {
                return facts;
            }
        }
    }

    return facts;
}

function formatFact(fact: { subGuide: string; item?: string; text: string; level?: number }): string {
    const level = typeof fact.level === 'number' ? `level ${fact.level} ` : '';
    const item = fact.item ? ` (${fact.item})` : '';
    return `${fact.subGuide}: ${level}${fact.text}${item}`;
}

function words(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[_:]/g, ' ')
        .split(/[^a-z0-9]+/g)
        .filter(word => word.length > 1);
}

function slugify(text: string): string {
    return words(text).join('-') || 'unknown';
}
