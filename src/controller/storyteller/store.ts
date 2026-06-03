import fs from 'fs';
import path from 'path';
import { projectorStoryFrameSchema, type CityEventDigest, type ProjectorStoryFrame, type StorytellerDispatch } from './types';

// ---------------------------------------------------------------------------
// StorytellerStore — file-backed persistence for digest + dispatch artifacts.
//
// Layout: <rootDir>/<runId>/digest.json
//                          summary.txt
//                          dispatch.json   (written by model-backed Storyteller, S7)
// ---------------------------------------------------------------------------

export class StorytellerStore {
    constructor(private readonly rootDir: string) {}

    private runDir(runId: string): string {
        return path.join(this.rootDir, runId);
    }

    writeDigest(digest: CityEventDigest): void {
        const dir = this.runDir(digest.digestId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'digest.json'), JSON.stringify(digest, null, 2), 'utf-8');
    }

    writeSummary(runId: string, summary: string): void {
        const dir = this.runDir(runId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'summary.txt'), summary, 'utf-8');
    }

    writeDispatch(dispatch: StorytellerDispatch): void {
        const dir = this.runDir(dispatch.digestId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'dispatch.json'), JSON.stringify(dispatch, null, 2), 'utf-8');
    }

    writeLatestProjectorFrame(frame: ProjectorStoryFrame): void {
        fs.mkdirSync(this.rootDir, { recursive: true });
        fs.writeFileSync(path.join(this.rootDir, 'latest-frame.json'), JSON.stringify(frame, null, 2), 'utf-8');
    }

    readDigest(runId: string): CityEventDigest | null {
        const filePath = path.join(this.runDir(runId), 'digest.json');
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CityEventDigest;
    }

    readSummary(runId: string): string | null {
        const filePath = path.join(this.runDir(runId), 'summary.txt');
        if (!fs.existsSync(filePath)) return null;
        return fs.readFileSync(filePath, 'utf-8');
    }

    readDispatch(runId: string): StorytellerDispatch | null {
        const filePath = path.join(this.runDir(runId), 'dispatch.json');
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorytellerDispatch;
    }

    readLatestProjectorFrame(): ProjectorStoryFrame | null {
        const filePath = path.join(this.rootDir, 'latest-frame.json');
        if (!fs.existsSync(filePath)) return null;
        const parsed = projectorStoryFrameSchema.safeParse(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
        return parsed.success ? (parsed.data as ProjectorStoryFrame) : null;
    }

    /** List all run-ids for which a digest.json exists. */
    listDigestIds(): string[] {
        if (!fs.existsSync(this.rootDir)) return [];
        return fs
            .readdirSync(this.rootDir, { withFileTypes: true })
            .filter(e => e.isDirectory() && fs.existsSync(path.join(this.rootDir, e.name, 'digest.json')))
            .map(e => e.name);
    }

    /**
     * Return the digest with the latest `builtAt` timestamp, or null if the
     * store is empty.
     */
    readLatestDigest(): CityEventDigest | null {
        const ids = this.listDigestIds();
        if (ids.length === 0) return null;

        let latest: CityEventDigest | null = null;
        for (const id of ids) {
            const d = this.readDigest(id);
            if (!d) continue;
            if (!latest || d.builtAt > latest.builtAt) {
                latest = d;
            }
        }
        return latest;
    }
}

// ---------------------------------------------------------------------------
// buildOperatorSummary — deterministic plain-text render of a CityEventDigest.
// No model calls. AP and GP are kept separate.
//
// AP = Attention Points (Null City ledger balance).
// GP = real RuneScape gold (coin item 995).
// ---------------------------------------------------------------------------

export function buildOperatorSummary(digest: CityEventDigest): string {
    const lines: string[] = [];

    lines.push(`=== Null City Operator Summary ===`);
    lines.push(`Digest: ${digest.digestId}`);
    lines.push(`Window: ${digest.windowStart} → ${digest.windowEnd}`);
    lines.push(`Built at: ${digest.builtAt}`);
    lines.push('');

    const { totalResidents, activeResidents, fadedResidents, lowApResidents } = digest.systemHealth;
    lines.push(
        `System health: ${totalResidents} residents total, ${activeResidents} active, ${fadedResidents} faded, ${lowApResidents} low-AP`,
    );
    lines.push('');

    // Resident snapshots
    if (digest.residents.length > 0) {
        lines.push('--- Resident Snapshots ---');
        for (const r of digest.residents) {
            const apStatus = r.isFaded ? 'FADED' : r.isLowAp ? `LOW AP (${r.attention})` : `AP ${r.attention}`;
            const gpStatus = r.gpObserved === null ? 'GP unobserved' : `GP ${r.gpObserved} (real RuneScape gold)`;
            const goal = r.goalText ? ` | Goal: ${r.goalText}` : '';
            lines.push(`  ${r.residentName}: ${apStatus}, ${gpStatus}${goal}`);
        }
        lines.push('');
    }

    // Top events (already sorted by importance)
    if (digest.topEvents.length > 0) {
        lines.push('--- Top Events (by importance) ---');
        for (const e of digest.topEvents) {
            lines.push(`  [${e.importance.toUpperCase()}] ${e.residentName} — ${e.note}`);
        }
        lines.push('');
    }

    // Category counts
    const counts = [
        digest.apEvents.length > 0 && `AP events: ${digest.apEvents.length}`,
        digest.gpEvents.length > 0 && `GP events (real RuneScape gold): ${digest.gpEvents.length}`,
        digest.exchangeEvents.length > 0 && `AP-for-GP exchanges: ${digest.exchangeEvents.length}`,
        digest.ncriEvents.length > 0 && `NCRI events: ${digest.ncriEvents.length}`,
        digest.goalEvents.length > 0 && `Goal events: ${digest.goalEvents.length}`,
        digest.stuckEvents.length > 0 && `Stuck/recovered events: ${digest.stuckEvents.length}`,
        digest.miscEvents.length > 0 && `Misc events: ${digest.miscEvents.length}`,
    ].filter(Boolean);

    if (counts.length > 0) {
        lines.push('--- Event Counts ---');
        for (const c of counts) lines.push(`  ${c}`);
        lines.push('');
    }

    lines.push('(Dry run — no model call. Storyteller model narration requires S7 run.)');

    return lines.join('\n');
}
