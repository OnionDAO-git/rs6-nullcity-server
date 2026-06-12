import fs from 'fs';
import path from 'path';
import { residentSlug } from '../memory/runtime-state';

/**
 * LB-H2R-8m13: Read the most recent say action from a resident's current
 * evidence trajectory, filtering for entries after `sinceTs`.
 *
 * This mirrors the trajectory-reading logic in `patron/cli.ts`
 * `findRecentSay`, extracted here so non-CLI code can use it without pulling
 * in CLI/MCP dependencies.
 */
export interface TrajectoryReplyResult {
    text: string;
    ts: string;
}

/**
 * Scan the resident's current evidence-trajectory file for the newest
 * `kind=say` entry with a timestamp strictly after `sinceTs`.
 *
 * Returns `null` when no matching entry exists (not yet emitted, or the
 * trajectory file is missing).
 */
export function findTrajectoryReply(memoryDir: string, residentName: string, sinceTs: string): TrajectoryReplyResult | null {
    const slug = residentSlug(residentName);
    const trajectoryPath = resolveCurrentTrajectoryPath(memoryDir, slug);
    if (!trajectoryPath || !fs.existsSync(trajectoryPath)) {
        return null;
    }

    let latest: TrajectoryReplyResult | null = null;
    try {
        const lines = fs.readFileSync(trajectoryPath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as {
                    kind?: string;
                    text?: string;
                    ts?: string;
                };
                if (
                    entry.kind === 'say' &&
                    typeof entry.text === 'string' &&
                    entry.text.length > 0 &&
                    typeof entry.ts === 'string' &&
                    entry.ts > sinceTs
                ) {
                    if (!latest || entry.ts > latest.ts) {
                        latest = { text: entry.text, ts: entry.ts };
                    }
                }
            } catch {
                // skip malformed lines
            }
        }
    } catch {
        return null;
    }
    return latest;
}

/**
 * Resolve the path to the resident's current trajectory file.
 * Looks first at `<evidenceRoot>/trajectory/current` (symlink or text pointer),
 * then falls back to the newest `<evidenceRoot>/index.json` session entry.
 */
function resolveCurrentTrajectoryPath(memoryDir: string, slug: string): string | null {
    const evidenceRoot = path.join(memoryDir, slug, 'evidence');
    const trajectoryDir = path.join(evidenceRoot, 'trajectory');
    const currentPath = path.join(trajectoryDir, 'current');

    if (fs.existsSync(currentPath)) {
        try {
            if (fs.lstatSync(currentPath).isSymbolicLink()) {
                return fs.realpathSync(currentPath);
            }
            const target = fs.readFileSync(currentPath, 'utf8').trim();
            if (target && !target.startsWith('{')) {
                return path.join(trajectoryDir, target);
            }
            return currentPath;
        } catch {
            // fall through to index.json
        }
    }

    const indexPath = path.join(evidenceRoot, 'index.json');
    if (fs.existsSync(indexPath)) {
        try {
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
                currentSessionId?: string;
                sessions?: Array<{ sessionId?: string; trajectoryPath?: string }>;
            };
            const current =
                index.sessions?.find(s => s.sessionId === index.currentSessionId) ?? index.sessions?.[index.sessions.length - 1];
            if (current?.trajectoryPath) {
                return path.join(evidenceRoot, current.trajectoryPath);
            }
        } catch {
            // ignore corrupt index
        }
    }

    return null;
}
