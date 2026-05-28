import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { readRecentLibraryMemories, readRecentPatronMemories } from '../evidence/library-memories';
import type { IndexPatch, MemoWrite, ProposedVariable } from '../llm/completion-parser';
import type { HookDefinition } from '../spark/hooks';
import { readHooksMd, retireHooksMd, upsertHooksMd } from './hooks-md';
import { residentSlug } from './runtime-state';

const templateNames = ['geography.md', 'social.md', 'items.md', 'skills.md', 'monsters.md', 'events.md'];
const libraryMemoryLimit = 4;
// E7 (intelligence-verification-log.md § E7): dedicated patron-event slice
// so out-of-band Shards offers survive the stuck/say spam in the general
// timeline window. 6 fits comfortably alongside the 4 general memories
// without crowding the prompt envelope; revisit if Brain context budget
// gets tight or patrons rarely send more than 1-2 offers per session.
const libraryPatronMemoryLimit = 6;
const factSearchMaxLines = 8;
const factSearchMaxLineChars = 320;
const memoryUsagePreviewChars = 180;

type MemorySource = 'patron' | 'facts' | 'library' | 'index' | 'targeted' | 'qmd';

export interface MemoryTelemetryOptions {
    logPath?: string;
    now?: () => string;
}

export interface MemoryStoreOptions {
    telemetry?: false | MemoryTelemetryOptions;
}

interface LabeledMemory {
    source: MemorySource;
    text: string;
}

export class MemoryStore {
    private warnedAboutQmd = false;
    private readonly telemetry?: MemoryUsageLogger;

    constructor(
        private readonly memoryRoot: string,
        private readonly qmdBin: string,
        options: MemoryStoreOptions = {},
    ) {
        const shouldEnableTelemetry = options.telemetry !== undefined || path.basename(memoryRoot) === 'memory';
        if (options.telemetry !== false && shouldEnableTelemetry) {
            this.telemetry = new MemoryUsageLogger(
                options.telemetry?.logPath || defaultMemoryUsageLogPath(memoryRoot),
                options.telemetry?.now,
            );
        }
    }

    ensureResident(resident: string): string {
        const root = path.join(this.memoryRoot, residentSlug(resident));
        for (const dir of ['geography', 'social', 'items', 'monsters', 'events', 'facts']) {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
        }

        for (const file of ['INDEX.md', 'hooks.md', 'skills.md']) {
            const target = path.join(root, file);
            if (!fs.existsSync(target)) {
                fs.writeFileSync(target, `# ${resident} ${file.replace('.md', '')}\n\n`);
            }
        }

        this.ensureQmdCollection(resident, root);
        return root;
    }

    retrieve(resident: string, query: string, limit = 6): string[] {
        const startedAt = Date.now();
        const root = this.ensureResident(resident);
        const excerpts: LabeledMemory[] = [];
        const pushMemories = (source: MemorySource, memories: string[]) => {
            for (const text of memories) {
                excerpts.push({ source, text });
            }
        };
        // E7: patron memories first so they stay in the prompt even if the
        // tail slice gets clipped. Concrete recipient/amount/tier text gives
        // Brain enough to react meaningfully on the very next decision.
        pushMemories('patron', readRecentPatronMemories(this.memoryRoot, resident, libraryPatronMemoryLimit));
        pushMemories('facts', this.searchFacts(root, query, limit));
        pushMemories('library', readRecentLibraryMemories(this.memoryRoot, resident, libraryMemoryLimit));

        const index = this.readIfExists(path.join(root, 'INDEX.md'));
        if (index) {
            excerpts.push({ source: 'index', text: index });
        }

        const targeted = this.targetedExcerpt(root, query);
        if (targeted) {
            excerpts.push({ source: 'targeted', text: targeted });
        }

        pushMemories('qmd', this.queryQmd(resident, query, limit));
        const result = excerpts.filter(memory => Boolean(memory.text)).slice(0, limit + 2 + libraryMemoryLimit + libraryPatronMemoryLimit);
        this.telemetry?.logRetrieve({
            resident,
            query,
            limit,
            durationMs: Date.now() - startedAt,
            results: result,
        });
        return result.map(memory => memory.text);
    }

    read(resident: string, relativePath: string): string | undefined {
        const root = this.ensureResident(resident);
        const target = this.resolveInside(root, relativePath);
        return this.readIfExists(target);
    }

    write(resident: string, relativePath: string, content: string, mode: 'append' | 'replace' = 'append'): string {
        const root = this.ensureResident(resident);
        const target = this.resolveInside(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (mode === 'replace') {
            fs.writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`);
        } else {
            fs.appendFileSync(target, content.endsWith('\n') ? content : `${content}\n`);
        }
        this.telemetry?.logWrite({ resident, relativePath, content, mode });
        return target;
    }

    upsertIndexPatch(resident: string, patch: string): void {
        if (!patch.trim()) {
            return;
        }

        this.write(resident, 'INDEX.md', `\n${patch.trim()}\n`);
    }

    applyIndexPatch(resident: string, patch?: IndexPatch): void {
        if (!patch?.append?.length) {
            return;
        }

        this.write(resident, 'INDEX.md', `\n${patch.append.map(line => `- ${line}`).join('\n')}\n`);
    }

    writeMemo(resident: string, memo: MemoWrite): void {
        this.write(resident, memo.path, `${memo.text.trim()}\n`, memo.mode || 'append');
    }

    loadHooks(resident: string): { hooks: HookDefinition[]; variables: ProposedVariable[] } {
        return readHooksMd(this.ensureResident(resident));
    }

    upsertHooks(resident: string, hooks: HookDefinition[] = [], variables: ProposedVariable[] = []): void {
        upsertHooksMd(this.ensureResident(resident), { hooks, variables });
    }

    retireHooks(resident: string, ids: string[] = []): void {
        retireHooksMd(this.ensureResident(resident), ids);
    }

    private ensureQmdCollection(resident: string, root: string): void {
        if (!this.qmdBin) {
            this.warnQmdMissing();
            return;
        }

        const version = spawnSync(this.qmdBin, ['--version'], { encoding: 'utf8' });
        if (version.error || version.status !== 0) {
            this.warnQmdMissing();
            return;
        }

        spawnSync(this.qmdBin, ['collection', 'add', residentSlug(resident), root], { encoding: 'utf8' });
    }

    private queryQmd(resident: string, query: string, limit: number): string[] {
        if (!this.qmdBin || !query.trim()) {
            return [];
        }

        const result = spawnSync(this.qmdBin, ['query', '--collection', residentSlug(resident), '--json', query], {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
        });
        if (result.error || result.status !== 0 || !result.stdout.trim()) {
            return [];
        }

        try {
            const parsed = JSON.parse(result.stdout) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .map(item => (isRecord(item) && typeof item.text === 'string' ? item.text : typeof item === 'string' ? item : ''))
                .filter(Boolean)
                .slice(0, limit);
        } catch {
            return [];
        }
    }

    private targetedExcerpt(root: string, query: string): string | undefined {
        const slug = query
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-|-$/g, '');
        if (!slug) {
            return undefined;
        }

        for (const dir of ['social', 'monsters', 'geography', 'items']) {
            const direct = path.join(root, dir, `${slug}.md`);
            const content = this.readIfExists(direct);
            if (content) {
                return content;
            }
        }
        return undefined;
    }

    private searchFacts(root: string, query: string, limit: number): string[] {
        const factsRoot = path.join(root, 'facts');
        if (!fs.existsSync(factsRoot) || !query.trim()) {
            return [];
        }
        const queryTerms = terms(query);
        if (queryTerms.length === 0) {
            return [];
        }

        return this.factLines(factsRoot)
            .map(line => ({ line, score: scoreLine(line.text, queryTerms) }))
            .filter(match => match.score > 0)
            .sort((a, b) => b.score - a.score || a.line.path.localeCompare(b.line.path))
            .slice(0, Math.max(1, Math.min(limit, factSearchMaxLines)))
            .map(match => `Fact memory (${path.basename(match.line.path)}): ${match.line.text}`);
    }

    private factLines(root: string): Array<{ path: string; text: string }> {
        const files = walkMarkdown(root);
        const lines: Array<{ path: string; text: string }> = [];
        for (const file of files) {
            const content = this.readIfExists(file);
            if (!content) {
                continue;
            }
            for (const rawLine of content.split('\n')) {
                const text = rawLine.replace(/\s+/g, ' ').trim();
                if (text.length > 2) {
                    lines.push({ path: file, text: text.slice(0, factSearchMaxLineChars) });
                }
            }
        }
        return lines;
    }

    private resolveInside(root: string, relativePath: string): string {
        const target = path.resolve(root, relativePath);
        const resolvedRoot = path.resolve(root);
        if (!target.startsWith(`${resolvedRoot}${path.sep}`) && target !== resolvedRoot) {
            throw new Error(`Refusing to write memory outside resident directory: ${relativePath}`);
        }
        return target;
    }

    private readIfExists(filePath: string): string | undefined {
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
    }

    private warnQmdMissing(): void {
        if (!this.warnedAboutQmd) {
            this.warnedAboutQmd = true;
            process.stderr.write('[controller] qmd unavailable; memory retrieval is limited to markdown files.\n');
        }
    }
}

export { templateNames };

class MemoryUsageLogger {
    constructor(
        private readonly logPath: string,
        private readonly now: () => string = () => new Date().toISOString(),
    ) {}

    logRetrieve(input: { resident: string; query: string; limit: number; durationMs: number; results: LabeledMemory[] }): void {
        const sourceCounts = countSources(input.results);
        this.append({
            type: 'retrieve',
            ts: this.now(),
            resident: input.resident,
            queryHash: hashText(input.query),
            queryPreview: preview(input.query),
            limit: input.limit,
            durationMs: input.durationMs,
            resultCount: input.results.length,
            sourceCounts,
            topSources: Array.from(new Set(input.results.slice(0, 5).map(result => result.source))),
        });
    }

    logWrite(input: { resident: string; relativePath: string; content: string; mode: 'append' | 'replace' }): void {
        this.append({
            type: 'write',
            ts: this.now(),
            resident: input.resident,
            path: input.relativePath,
            mode: input.mode,
            charCount: input.content.length,
            lineCount: input.content.split(/\r?\n/).filter(line => line.trim().length > 0).length,
            contentHash: hashText(input.content),
            contentPreview: preview(input.content),
        });
    }

    private append(entry: Record<string, unknown>): void {
        try {
            fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
            fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
        } catch {
            // Memory telemetry must never make residents fail to remember or act.
        }
    }
}

function defaultMemoryUsageLogPath(memoryRoot: string): string {
    if (path.basename(memoryRoot) === 'memory') {
        return path.join(path.dirname(memoryRoot), 'logs', 'memory-usage.jsonl');
    }
    return path.join(memoryRoot, 'logs', 'memory-usage.jsonl');
}

function countSources(results: LabeledMemory[]): Record<MemorySource, number> {
    const counts: Record<MemorySource, number> = {
        patron: 0,
        facts: 0,
        library: 0,
        index: 0,
        targeted: 0,
        qmd: 0,
    };
    for (const result of results) {
        counts[result.source] += 1;
    }
    return counts;
}

function hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function preview(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, memoryUsagePreviewChars);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walkMarkdown(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }
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
        'that',
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
