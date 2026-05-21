import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { type Soul, validateSoulFrontmatter } from './soul-schema';

export class SoulLoader {
    constructor(private readonly soulsDir: string) {}

    listResidentNames(): string[] {
        if (!fs.existsSync(this.soulsDir)) {
            return [];
        }

        return fs
            .readdirSync(this.soulsDir)
            .filter(file => file.endsWith('.md'))
            .flatMap(file => {
                const sourcePath = path.join(this.soulsDir, file);
                try {
                    const raw = fs.readFileSync(sourcePath, 'utf8');
                    const parsed = parseFrontmatter(raw, sourcePath);
                    return isRecord(parsed.frontmatter) ? [validateSoulFrontmatter(parsed.frontmatter, sourcePath).name] : [];
                } catch {
                    return [];
                }
            })
            .sort((a, b) => a.localeCompare(b));
    }

    load(residentName: string): Soul {
        const sourcePath = this.resolveSoulPath(residentName);
        const raw = fs.readFileSync(sourcePath, 'utf8');
        const parsed = parseFrontmatter(raw, sourcePath);
        const frontmatter = validateSoulFrontmatter(parsed.frontmatter, sourcePath);
        if (frontmatter.name !== residentName) {
            throw new Error(`Soul name ${frontmatter.name} does not match configured resident ${residentName}`);
        }

        return { frontmatter, body: parsed.body, sourcePath };
    }

    private resolveSoulPath(residentName: string): string {
        const slug = residentName.replace(/^res:/, '');
        const fileSafeResidentName = residentName.replace(/[:/\\]/g, '-');
        const candidates = [
            path.join(this.soulsDir, `${slug}.md`),
            path.join(this.soulsDir, `${fileSafeResidentName}.md`),
            path.join(this.soulsDir, `${residentName}.md`),
        ];
        const found = candidates.find(candidate => fs.existsSync(candidate));
        if (!found) {
            throw new Error(`Missing soul for ${residentName}; expected ${candidates.join(' or ')}`);
        }

        return found;
    }
}

function parseFrontmatter(raw: string, sourcePath: string): { frontmatter: unknown; body: string } {
    if (!raw.startsWith('---')) {
        return { frontmatter: {}, body: raw };
    }

    const end = raw.indexOf('\n---', 3);
    if (end === -1) {
        throw new Error(`Unclosed frontmatter in ${sourcePath}`);
    }

    const frontmatterRaw = raw.slice(3, end).trim();
    const body = raw.slice(end + 4).replace(/^\r?\n/, '');
    return {
        frontmatter: yaml.load(frontmatterRaw) || {},
        body,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
