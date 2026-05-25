import { spawnSync } from 'child_process';
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

export class MemoryStore {
    private warnedAboutQmd = false;

    constructor(
        private readonly memoryRoot: string,
        private readonly qmdBin: string,
    ) {}

    ensureResident(resident: string): string {
        const root = path.join(this.memoryRoot, residentSlug(resident));
        for (const dir of ['geography', 'social', 'items', 'monsters', 'events']) {
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
        const root = this.ensureResident(resident);
        const excerpts: string[] = [];
        // E7: patron memories first so they stay in the prompt even if the
        // tail slice gets clipped. Concrete recipient/amount/tier text gives
        // Brain enough to react meaningfully on the very next decision.
        excerpts.push(...readRecentPatronMemories(this.memoryRoot, resident, libraryPatronMemoryLimit));
        excerpts.push(...readRecentLibraryMemories(this.memoryRoot, resident, libraryMemoryLimit));

        const index = this.readIfExists(path.join(root, 'INDEX.md'));
        if (index) {
            excerpts.push(index);
        }

        const targeted = this.targetedExcerpt(root, query);
        if (targeted) {
            excerpts.push(targeted);
        }

        const qmd = this.queryQmd(resident, query, limit);
        excerpts.push(...qmd);
        return excerpts.filter(Boolean).slice(0, limit + 2 + libraryMemoryLimit + libraryPatronMemoryLimit);
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
