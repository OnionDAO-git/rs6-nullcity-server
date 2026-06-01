import fs from 'fs';
import path from 'path';
import { residentSlug } from './runtime-state';

export interface RememberFactInput {
    resident: string;
    topic: string;
    fact: string;
    reason?: string;
}

export interface ReadTopicInput {
    resident: string;
    topic: string;
}

export interface RelevantFactsInput {
    resident: string;
    query: string;
    limit?: number;
}

export interface ResidentFact {
    source: 'facts';
    resident: string;
    topic: string;
    path: string;
    text: string;
    score: number;
}

export interface ResidentFactTopic {
    topic: string;
    path: string;
    content: string;
}

export type FactMemorySnippet = ResidentFact;
export type FactMemoryTopic = ResidentFactTopic;
export type RelevantMemoryInput = RelevantFactsInput;

const defaultLimit = 5;
const maxLimit = 20;
const maxFactChars = 500;
const maxLineChars = 700;

export class FactsStore {
    constructor(
        private readonly memoryRoot: string,
        private readonly now: () => string = () => new Date().toISOString(),
    ) {}

    rememberFact(input: RememberFactInput): ResidentFact {
        const topic = safeTopic(input.topic);
        const text = cleanFact(input.fact);
        if (!text) {
            throw new Error('Memory fact must not be empty');
        }

        const relativePath = topicPath(topic);
        const filePath = this.resolveFactPath(input.resident, topic);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const reason = cleanOptional(input.reason);
        const line = `- ${this.now()} ${text}${reason ? ` [why: ${reason}]` : ''}\n`;
        fs.appendFileSync(filePath, line);
        return {
            source: 'facts',
            resident: input.resident,
            topic,
            path: relativePath,
            text: line.trim(),
            score: Number.POSITIVE_INFINITY,
        };
    }

    readTopic(input: ReadTopicInput): ResidentFactTopic {
        const topic = safeTopic(input.topic);
        const relativePath = topicPath(topic);
        const filePath = this.resolveFactPath(input.resident, topic);
        return {
            topic,
            path: relativePath,
            content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '',
        };
    }

    relevantTo(input: RelevantFactsInput): ResidentFact[] {
        const queryTerms = terms(input.query);
        if (queryTerms.length === 0) {
            return [];
        }
        const factsRoot = path.join(this.residentRoot(input.resident), 'facts');
        if (!fs.existsSync(factsRoot)) {
            return [];
        }

        const limit = clampLimit(input.limit);
        return walkMarkdown(factsRoot)
            .flatMap(filePath => factLines(input.resident, factsRoot, filePath))
            .map(fact => ({ ...fact, score: scoreLine(fact.text, queryTerms) }))
            .filter(fact => fact.score > 0)
            .sort((a, b) => b.score - a.score || b.text.localeCompare(a.text) || a.path.localeCompare(b.path))
            .slice(0, limit);
    }

    private resolveFactPath(resident: string, topic: string): string {
        const root = path.resolve(this.residentRoot(resident));
        const target = path.resolve(root, topicPath(topic));
        if (!target.startsWith(`${root}${path.sep}`)) {
            throw new Error('Unsafe memory topic');
        }
        return target;
    }

    private residentRoot(resident: string): string {
        return path.join(this.memoryRoot, residentSlug(resident));
    }
}

function topicPath(topic: string): string {
    return path.join('facts', `${topic}.md`);
}

function safeTopic(topic: string): string {
    const trimmed = topic.trim().replace(/\.md$/i, '');
    if (
        !trimmed ||
        trimmed === '.' ||
        trimmed === '..' ||
        trimmed.includes('/') ||
        trimmed.includes('\\') ||
        trimmed.includes('\0') ||
        trimmed.includes('..') ||
        path.isAbsolute(trimmed)
    ) {
        throw new Error('Unsafe memory topic');
    }
    const normalized = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '');
    if (!normalized || normalized === '.' || normalized === '..') {
        throw new Error('Unsafe memory topic');
    }
    return normalized;
}

function cleanFact(fact: string): string {
    return fact.replace(/\s+/g, ' ').trim().slice(0, maxFactChars);
}

function cleanOptional(value: string | undefined): string | undefined {
    const cleaned = value?.replace(/\s+/g, ' ').trim().slice(0, 160);
    return cleaned || undefined;
}

function clampLimit(limit: number | undefined): number {
    if (!Number.isFinite(limit)) {
        return defaultLimit;
    }
    return Math.max(1, Math.min(maxLimit, Math.floor(limit as number)));
}

function factLines(resident: string, factsRoot: string, filePath: string): ResidentFact[] {
    const topic = path.basename(filePath, '.md');
    const relativePath = path.relative(path.dirname(factsRoot), filePath);
    return fs
        .readFileSync(filePath, 'utf8')
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(line => line.length > 2)
        .map(line => ({
            source: 'facts' as const,
            resident,
            topic,
            path: relativePath,
            text: line.slice(0, maxLineChars),
            score: 0,
        }));
}

function walkMarkdown(root: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkMarkdown(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
        }
    }
    return files;
}

function terms(text: string): string[] {
    const stop = new Set([
        'the',
        'and',
        'you',
        'that',
        'what',
        'where',
        'when',
        'with',
        'about',
        'after',
        'near',
        'safe',
        'did',
        'does',
        'was',
        'were',
        'for',
        'from',
        'this',
        'who',
        'into',
    ]);
    return Array.from(
        new Set(
            text
                .toLowerCase()
                .split(/[^a-z0-9@._-]+/g)
                .map(term => term.trim())
                .filter(term => term.length >= 3 && !stop.has(term)),
        ),
    );
}

function scoreLine(line: string, queryTerms: string[]): number {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
        if (lower.includes(term)) {
            score += term.includes('@') || /\d/.test(term) ? 3 : 1;
        }
    }
    return score;
}
