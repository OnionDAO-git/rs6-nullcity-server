/**
 * RIQ-3-1: Phase 3 PlanStore — per-resident durable plan persistence.
 *
 * Stores a resident's active Plan as an atomic-write JSON file so the plan
 * survives controller restarts. Follows the same tmp-then-rename + quarantine
 * pattern used by PatronStore and the memory ledgers.
 *
 * File location: <memoryRoot>/<residentSlug>/active-plan.json
 *
 * This is the read/write seam between:
 *   - PlannerPass (writes a new Plan after deliberation)
 *   - Body (reads currentStage to execute the current step)
 *   - Re-plan triggers (stage done/blocked → PlannerPass → new Plan written here)
 */

import fs from 'fs';
import path from 'path';
import type { Plan } from './planner-pass';
import { residentSlug } from '../memory/runtime-state';

export class PlanStore {
    /** LB-LOOP-7e31: called once when a plan is first saved with status='completed'. */
    onPlanCompleted?: (residentId: string, plan: Plan) => void;

    constructor(private readonly memoryRoot: string) {}

    private planPath(residentId: string): string {
        return path.join(this.memoryRoot, residentSlug(residentId), 'active-plan.json');
    }

    /**
     * Persist a plan atomically. Survives concurrent reads because the rename
     * is atomic on POSIX filesystems.
     */
    save(residentId: string, plan: Plan): void {
        const filePath = this.planPath(residentId);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(plan, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
        if (plan.status === 'completed') {
            this.onPlanCompleted?.(residentId, plan);
        }
    }

    /**
     * Load the resident's active plan.
     *
     * Returns null when:
     *   - No plan file exists yet (first startup, or cleared after plan completion).
     *   - The file is corrupt (quarantined with a timestamped suffix; warning on stderr).
     *
     * Does NOT validate the Plan schema beyond JSON.parse — callers should treat
     * the loaded plan as untrusted input and re-plan if required fields are missing.
     */
    load(residentId: string): Plan | null {
        const filePath = this.planPath(residentId);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw) as Plan;
        } catch (err) {
            const suffix = Date.now();
            const corruptPath = `${filePath}.corrupt-${suffix}`;
            try {
                fs.renameSync(filePath, corruptPath);
            } catch {
                // quarantine rename failed — original stays; will fail again on next load
            }
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(
                `[PlanStore] WARN: corrupt plan for ${residentId} at ${filePath} ` +
                    `(${message}) — quarantined to ${corruptPath}. Returning null.\n`,
            );
            return null;
        }
    }

    /**
     * Remove the active plan file. Call when a plan completes, is abandoned,
     * or the resident fades. A subsequent load() returns null.
     */
    clear(residentId: string): void {
        const filePath = this.planPath(residentId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    /** True when an active plan file exists for the resident. */
    has(residentId: string): boolean {
        return fs.existsSync(this.planPath(residentId));
    }

    /** RIQ-5-5: return all residents that have a readable active plan. */
    listAll(): Array<{ slug: string; plan: Plan }> {
        if (!fs.existsSync(this.memoryRoot)) return [];
        const entries = fs.readdirSync(this.memoryRoot, { withFileTypes: true });
        const result: Array<{ slug: string; plan: Plan }> = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const planPath = path.join(this.memoryRoot, entry.name, 'active-plan.json');
            if (!fs.existsSync(planPath)) continue;
            try {
                result.push({ slug: entry.name, plan: JSON.parse(fs.readFileSync(planPath, 'utf8')) as Plan });
            } catch {
                // corrupt plan — skip silently (listAll is read-only; no quarantine here)
            }
        }
        return result;
    }
}
