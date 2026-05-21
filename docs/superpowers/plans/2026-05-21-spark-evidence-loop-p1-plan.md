# SPARK Evidence Loop — Plan P1 (Evidence Foundation + Mock Perception)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the SPARK Evidence Layer foundation — `EvidenceStore`, `ProgressTracker`, `TrajectoryBuilder`, `MockPerceptionAdapter`, schemas, RuntimeState additions, InferenceLog promptHash extension, ActionCoordinator callbacks, module-context facade propagation, and `spark.tick` scope-guard wiring — so per-tick perception/decision/action records are written to disk and the kernel can be tested without a RuneJS server.

**Architecture:** Additive layer under the SPARK kernel. EvidenceStore is the filesystem layer (append-only JSONL per resident per session). TrajectoryBuilder is the per-tick orchestrator. ProgressTracker is pure delta logic feeding RuntimeState fields. spark.tick wraps its body in a scope-guard `finally` so every named exit path emits an `end_tick` line. MockPerceptionAdapter is a test-only helper that constructs Perception objects without a RuneJS server — unblocking fast iteration.

**Tech Stack:** TypeScript 5, Node 24+, Jest (focused tests with `--runInBand`), Zod for schema validation, Biome for lint/format, existing repo conventions (no new deps).

**Spec source:** `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` (v2.1). All TypeScript interfaces below are reproduced from the spec; treat the spec as the canonical contract.

**Coordination notes:** This branch is `claude/evidence-loop-p1`. Pull `nullcity` each cycle to stay in sync with Codex. NEVER push to `nullcity` from this plan — the morning merge is the maintainer's call.

---

## File Map

**New files:**
- `src/controller/evidence/schemas.ts` — Zod schemas for trajectory lines, progress lines, legacy events
- `src/controller/evidence/schemas.test.ts`
- `src/controller/evidence/evidence-store.ts` — filesystem layer (append-only JSONL)
- `src/controller/evidence/evidence-store.test.ts`
- `src/controller/evidence/progress-tracker.ts` — pure delta logic
- `src/controller/evidence/progress-tracker.test.ts`
- `src/controller/evidence/mock-perception.ts` — test helper that scripts Perception objects
- `src/controller/evidence/mock-perception.test.ts`
- `src/controller/evidence/trajectory-builder.ts` — orchestrator wrapping EvidenceStore
- `src/controller/evidence/trajectory-builder.test.ts`
- `src/controller/evidence/evidence-integration.test.ts` — end-to-end with MockPerceptionAdapter

**Modified files:**
- `src/controller/memory/runtime-state.ts` — add `lastMeaningfulProgressAt`, `stuckSince` to `RuntimeState`
- `src/controller/logging/inference-log.ts` — accept and pass through `promptHash`, `completionHash` fields when present in entry
- `src/controller/actions/action-coordinator.ts` — add `onAckReady?` and `onEffectResolved?` to `ActionCoordinatorSubmitInput`; invoke at the right moments
- `src/controller/actions/action-coordinator.test.ts` — add callback tests
- `src/controller/spark/spark.ts` — wire scope-guard endTick + 7 insertion points
- `src/controller/spark/spark.test.ts` (or create if missing) — exit-reason coverage test
- `src/controller/resident-runtime.ts` — instantiate `EvidenceStore` per resident; wire callbacks
- `src/controller/spark/module-context.ts` — facade snapshot propagates new RuntimeState fields (this should work automatically via `immutableSnapshot`; verify with a test)

**Note on `RuneJS PerceptionBuilder`:** the existing `Perception` type is loose (`{ tick?: number; [key: string]: unknown }`). MockPerceptionAdapter constructs perceptions matching the shape that current downstream code (legacy-tracker, hook-evaluator) reads via helpers like `extractEvents()`, `nearbyActorIds()`. Tests that drive the full tick loop should construct realistic perception objects, not empty ones.

---

## Task 1: Add `lastMeaningfulProgressAt` and `stuckSince` to RuntimeState

**Files:**
- Modify: `src/controller/memory/runtime-state.ts`
- Test: existing tests should still pass (no new test required for type-only additive change)

- [ ] **Step 1: Add the two optional fields to `RuntimeState`**

Edit `src/controller/memory/runtime-state.ts`. After the `tick: number;` line and before `cognition?:`, add:

```ts
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
```

The full updated section:

```ts
export interface RuntimeState {
    resident: string;
    attention: number;
    tick: number;
    lastMeaningfulProgressAt?: number;
    stuckSince?: number;
    cognition?: CognitiveState;
    legacy: {
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS (additive optional fields, no consumers break).

- [ ] **Step 3: Commit**

```bash
git add src/controller/memory/runtime-state.ts
git commit -m "Add lastMeaningfulProgressAt + stuckSince to RuntimeState

Required by P1 (SPARK Evidence Layer / ProgressTracker)."
```

---

## Task 2: Create the Zod schemas for trajectory and progress lines

**Files:**
- Create: `src/controller/evidence/schemas.ts`
- Test: `src/controller/evidence/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/controller/evidence/schemas.test.ts`:

```ts
import { trajectoryLineSchema, progressLineSchema, endTickReasonSchema } from './schemas';

describe('trajectory line schemas', () => {
    const baseHeader = { schemaVersion: 1, ts: '2026-05-21T00:00:00Z', tick: 1, sessionId: 's1' };

    it('accepts a begin_tick line', () => {
        const parsed = trajectoryLineSchema.parse({ ...baseHeader, kind: 'begin_tick', perceptionFingerprint: 'abc' });
        expect(parsed.kind).toBe('begin_tick');
    });

    it('accepts an end_tick line with valid reason', () => {
        const parsed = trajectoryLineSchema.parse({ ...baseHeader, kind: 'end_tick', reason: 'tick_complete' });
        expect(parsed.kind).toBe('end_tick');
    });

    it('rejects an unknown kind', () => {
        expect(() => trajectoryLineSchema.parse({ ...baseHeader, kind: 'made_up' })).toThrow();
    });

    it('rejects a line missing schemaVersion', () => {
        expect(() => trajectoryLineSchema.parse({ ts: '2026-05-21T00:00:00Z', tick: 1, sessionId: 's1', kind: 'begin_tick' })).toThrow();
    });

    it('accepts every named end-tick reason', () => {
        const reasons = ['legacy_complete', 'attention_exhausted', 'plan_continuation', 'hook_noop', 'budget_exhausted:minute', 'parse_failed', 'legacy_complete_post_action', 'tick_complete'];
        for (const reason of reasons) {
            expect(() => endTickReasonSchema.parse(reason)).not.toThrow();
        }
    });
});

describe('progress line schema', () => {
    it('accepts a meaningful progress line', () => {
        const parsed = progressLineSchema.parse({
            schemaVersion: 1,
            ts: '2026-05-21T00:00:00Z',
            tick: 5,
            sessionId: 's1',
            meaningful: true,
            reasons: ['xp_gain:woodcutting:50'],
            snapshot: { tick: 5, xpBySkill: { woodcutting: 50 }, inventoryCount: 1, positionHash: 'a', hp: 99 },
        });
        expect(parsed.meaningful).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --runInBand src/controller/evidence/schemas.test.ts
```

Expected: FAIL with "Cannot find module './schemas'".

- [ ] **Step 3: Write minimal implementation**

Create `src/controller/evidence/schemas.ts`:

```ts
import { z } from 'zod';

export const endTickReasonSchema = z.union([
    z.literal('legacy_complete'),
    z.literal('attention_exhausted'),
    z.literal('plan_continuation'),
    z.literal('hook_noop'),
    z.literal('parse_failed'),
    z.literal('legacy_complete_post_action'),
    z.literal('tick_complete'),
    z.string().regex(/^budget_exhausted:/),
]);

export type EndTickReason = z.infer<typeof endTickReasonSchema>;

const trajectoryHeader = z.object({
    schemaVersion: z.literal(1),
    ts: z.string(),
    tick: z.number().int().nonnegative(),
    sessionId: z.string().min(1),
});

const beginTickLine = trajectoryHeader.extend({
    kind: z.literal('begin_tick'),
    perceptionFingerprint: z.string().optional(),
    perceptionSize: z.number().int().nonnegative().optional(),
});

const endTickLine = trajectoryHeader.extend({
    kind: z.literal('end_tick'),
    reason: endTickReasonSchema,
});

const hookLine = trajectoryHeader.extend({
    kind: z.literal('hook'),
    cause: z.string().optional(),
    priority: z.number().optional(),
    source: z.string().optional(),
});

const budgetLine = trajectoryHeader.extend({
    kind: z.literal('budget'),
    window: z.string(),
    retryAt: z.string().optional(),
});

const planLine = trajectoryHeader.extend({
    kind: z.literal('plan'),
    planId: z.string().optional(),
    stepIndex: z.number().int().nonnegative().optional(),
});

const decisionLine = trajectoryHeader.extend({
    kind: z.literal('decision'),
    moduleId: z.string(),
    moduleVersion: z.string(),
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    actionKinds: z.array(z.string()).optional(),
    promptHash: z.string().optional(),
    completionHash: z.string().optional(),
});

const actionLine = trajectoryHeader.extend({
    kind: z.literal('action'),
    requestId: z.string(),
    actionKind: z.string(),
    payload: z.record(z.unknown()).optional(),
});

const actionResultLine = trajectoryHeader.extend({
    kind: z.literal('action_result'),
    requestId: z.string(),
    status: z.union([z.literal('success'), z.literal('failure'), z.literal('timeout'), z.literal('aborted')]),
    resolvedAtTick: z.number().int().nonnegative(),
    evidence: z.record(z.unknown()).optional(),
});

const legacyEventLine = trajectoryHeader.extend({
    kind: z.literal('legacy_event'),
    cause: z.string(),
    legacyProgress: z.record(z.unknown()).optional(),
});

const sayLine = trajectoryHeader.extend({
    kind: z.literal('say'),
    text: z.string(),
    channel: z.union([z.literal('chat'), z.literal('shout'), z.string()]).optional(),
    lastWords: z.boolean().optional(),
});

const patronLine = trajectoryHeader.extend({
    kind: z.literal('patron'),
    patronKind: z.union([z.literal('patron_gift'), z.literal('patron_witness'), z.literal('patron_sponsor')]),
    patronHandle: z.string(),
    artifact: z.string().optional(),
    note: z.string().optional(),
});

const errorLine = trajectoryHeader.extend({
    kind: z.literal('error'),
    message: z.string(),
    where: z.string().optional(),
});

export const trajectoryLineSchema = z.discriminatedUnion('kind', [
    beginTickLine,
    endTickLine,
    hookLine,
    budgetLine,
    planLine,
    decisionLine,
    actionLine,
    actionResultLine,
    legacyEventLine,
    sayLine,
    patronLine,
    errorLine,
]);

export type TrajectoryLine = z.infer<typeof trajectoryLineSchema>;
export type TrajectoryLineKind = TrajectoryLine['kind'];

const progressSnapshotSchema = z.object({
    tick: z.number().int().nonnegative(),
    xpBySkill: z.record(z.number()),
    inventoryCount: z.number().int().nonnegative(),
    positionHash: z.string(),
    hp: z.number(),
});

export const progressLineSchema = z.object({
    schemaVersion: z.literal(1),
    ts: z.string(),
    tick: z.number().int().nonnegative(),
    sessionId: z.string().min(1),
    meaningful: z.boolean(),
    reasons: z.array(z.string()),
    snapshot: progressSnapshotSchema,
});

export type ProgressLine = z.infer<typeof progressLineSchema>;
export type ProgressSnapshot = z.infer<typeof progressSnapshotSchema>;

export interface ProgressDelta {
    meaningful: boolean;
    reasons: string[];
    newStuck: boolean;
    stuckSince: number | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/evidence/schemas.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controller/evidence/schemas.ts src/controller/evidence/schemas.test.ts
git commit -m "Add Zod schemas for evidence trajectory and progress lines

Locks the discriminated-union TrajectoryLine schema (12 kinds) and the
ProgressLine + ProgressSnapshot + ProgressDelta types per P1 spec."
```

---

## Task 3: Create EvidenceStore (filesystem layer)

**Files:**
- Create: `src/controller/evidence/evidence-store.ts`
- Test: `src/controller/evidence/evidence-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/controller/evidence/evidence-store.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EvidenceStore } from './evidence-store';
import type { TrajectoryLine, ProgressLine } from './schemas';

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-'));
}

describe('EvidenceStore', () => {
    it('creates per-resident evidence directory on beginSession', () => {
        const root = tmpDir();
        const store = new EvidenceStore('res-1', root);
        const handle = store.beginSession('sess-a', 'soul@1.0');
        expect(handle.sessionId).toBe('sess-a');
        expect(fs.existsSync(path.join(root, 'res-1', 'evidence', 'trajectory'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'res-1', 'evidence', 'progress'))).toBe(true);
    });

    it('appends trajectory lines to a per-session JSONL file', () => {
        const root = tmpDir();
        const store = new EvidenceStore('res-1', root);
        store.beginSession('sess-a', 'soul@1.0');
        const line: TrajectoryLine = { schemaVersion: 1, ts: '2026-05-21T00:00:00Z', tick: 1, sessionId: 'sess-a', kind: 'begin_tick' };
        store.appendTrajectory(line);
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'trajectory'));
        expect(files.length).toBeGreaterThan(0);
        const content = fs.readFileSync(path.join(root, 'res-1', 'evidence', 'trajectory', files[0]), 'utf8');
        expect(JSON.parse(content.trim())).toMatchObject({ kind: 'begin_tick', tick: 1 });
    });

    it('appends progress lines to a per-session JSONL file', () => {
        const root = tmpDir();
        const store = new EvidenceStore('res-1', root);
        store.beginSession('sess-a', 'soul@1.0');
        const line: ProgressLine = {
            schemaVersion: 1,
            ts: '2026-05-21T00:00:00Z',
            tick: 5,
            sessionId: 'sess-a',
            meaningful: true,
            reasons: ['xp_gain:woodcutting:50'],
            snapshot: { tick: 5, xpBySkill: { woodcutting: 50 }, inventoryCount: 0, positionHash: 'a', hp: 99 },
        };
        store.appendProgress(line);
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'progress'));
        expect(files.length).toBeGreaterThan(0);
    });

    it('writes an index.json with session metadata', () => {
        const root = tmpDir();
        const store = new EvidenceStore('res-1', root);
        store.beginSession('sess-a', 'soul@1.0');
        store.endSession('sess-a', 'logout');
        const idxRaw = fs.readFileSync(path.join(root, 'res-1', 'evidence', 'index.json'), 'utf8');
        const idx = JSON.parse(idxRaw);
        expect(idx.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'sess-a', endReason: 'logout' })]));
    });

    it('validates trajectory lines and throws on invalid input', () => {
        const root = tmpDir();
        const store = new EvidenceStore('res-1', root);
        store.beginSession('sess-a', 'soul@1.0');
        // Missing required field `kind`
        expect(() => store.appendTrajectory({ schemaVersion: 1, ts: 'x', tick: 1, sessionId: 'sess-a' } as unknown as TrajectoryLine)).toThrow();
    });

    it('detects multi-process collision via sentinel lockfile', () => {
        const root = tmpDir();
        const store1 = new EvidenceStore('res-1', root);
        store1.beginSession('sess-a', 'soul@1.0');
        expect(() => {
            const store2 = new EvidenceStore('res-1', root);
            store2.beginSession('sess-b', 'soul@1.0');
        }).toThrow(/another evidence writer/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --runInBand src/controller/evidence/evidence-store.test.ts
```

Expected: FAIL with "Cannot find module './evidence-store'".

- [ ] **Step 3: Write minimal implementation**

Create `src/controller/evidence/evidence-store.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { trajectoryLineSchema, progressLineSchema, type TrajectoryLine, type ProgressLine } from './schemas';

export interface SessionHandle {
    sessionId: string;
    soulVersion: string;
    startedAt: string;
}

interface IndexFile {
    sessions: Array<{
        sessionId: string;
        soulVersion: string;
        startedAt: string;
        endedAt?: string;
        endReason?: 'shutdown' | 'crash' | 'logout';
        trajectoryFile?: string;
        progressFile?: string;
    }>;
}

const SENTINEL_FILENAME = '.writer.lock';
const MAX_FILE_SIZE = 32 * 1024 * 1024; // 32 MB

export class EvidenceStore {
    private readonly residentDir: string;
    private readonly trajectoryDir: string;
    private readonly progressDir: string;
    private readonly indexPath: string;
    private trajectoryFile?: string;
    private progressFile?: string;
    private currentSession?: SessionHandle;

    constructor(private readonly residentName: string, private readonly root: string) {
        this.residentDir = path.join(root, residentName, 'evidence');
        this.trajectoryDir = path.join(this.residentDir, 'trajectory');
        this.progressDir = path.join(this.residentDir, 'progress');
        this.indexPath = path.join(this.residentDir, 'index.json');
    }

    beginSession(sessionId: string, soulVersion: string): SessionHandle {
        fs.mkdirSync(this.trajectoryDir, { recursive: true });
        fs.mkdirSync(this.progressDir, { recursive: true });
        this.acquireSentinel();
        const startedAt = new Date().toISOString();
        const safeStamp = startedAt.replace(/[:.]/g, '-');
        this.trajectoryFile = path.join(this.trajectoryDir, `${safeStamp}-${sessionId}.jsonl`);
        this.progressFile = path.join(this.progressDir, `${safeStamp}-${sessionId}.jsonl`);
        fs.writeFileSync(this.trajectoryFile, '');
        fs.writeFileSync(this.progressFile, '');
        this.currentSession = { sessionId, soulVersion, startedAt };
        this.upsertIndexSession({ sessionId, soulVersion, startedAt, trajectoryFile: path.basename(this.trajectoryFile), progressFile: path.basename(this.progressFile) });
        return this.currentSession;
    }

    endSession(sessionId: string, reason: 'shutdown' | 'crash' | 'logout'): void {
        const endedAt = new Date().toISOString();
        this.upsertIndexSession({ sessionId, endedAt, endReason: reason });
        this.releaseSentinel();
        this.currentSession = undefined;
        this.trajectoryFile = undefined;
        this.progressFile = undefined;
    }

    appendTrajectory(line: TrajectoryLine): void {
        trajectoryLineSchema.parse(line);
        if (!this.trajectoryFile) {
            throw new Error('EvidenceStore.appendTrajectory called without active session');
        }
        this.maybeRotateTrajectory();
        fs.appendFileSync(this.trajectoryFile, `${JSON.stringify(line)}\n`);
    }

    appendProgress(line: ProgressLine): void {
        progressLineSchema.parse(line);
        if (!this.progressFile) {
            throw new Error('EvidenceStore.appendProgress called without active session');
        }
        this.maybeRotateProgress();
        fs.appendFileSync(this.progressFile, `${JSON.stringify(line)}\n`);
    }

    appendLegacyEvent(event: TrajectoryLine): void {
        if (event.kind !== 'legacy_event') {
            throw new Error(`appendLegacyEvent expected kind=legacy_event, got ${event.kind}`);
        }
        this.appendTrajectory(event);
    }

    private acquireSentinel(): void {
        const sentinel = path.join(this.residentDir, SENTINEL_FILENAME);
        if (fs.existsSync(sentinel)) {
            const stat = fs.statSync(sentinel);
            const ageMs = Date.now() - stat.mtimeMs;
            if (ageMs < 60_000) {
                throw new Error(`EvidenceStore: another evidence writer holds the sentinel for ${this.residentName} (age ${ageMs}ms)`);
            }
            fs.unlinkSync(sentinel);
        }
        fs.writeFileSync(sentinel, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    }

    private releaseSentinel(): void {
        const sentinel = path.join(this.residentDir, SENTINEL_FILENAME);
        if (fs.existsSync(sentinel)) {
            fs.unlinkSync(sentinel);
        }
    }

    private maybeRotateTrajectory(): void {
        if (!this.trajectoryFile) return;
        try {
            const stat = fs.statSync(this.trajectoryFile);
            if (stat.size < MAX_FILE_SIZE) return;
        } catch {
            return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotated = this.trajectoryFile.replace(/\.jsonl$/, `-rot-${stamp}.jsonl`);
        fs.renameSync(this.trajectoryFile, rotated);
        fs.writeFileSync(this.trajectoryFile, '');
    }

    private maybeRotateProgress(): void {
        if (!this.progressFile) return;
        try {
            const stat = fs.statSync(this.progressFile);
            if (stat.size < MAX_FILE_SIZE) return;
        } catch {
            return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotated = this.progressFile.replace(/\.jsonl$/, `-rot-${stamp}.jsonl`);
        fs.renameSync(this.progressFile, rotated);
        fs.writeFileSync(this.progressFile, '');
    }

    private upsertIndexSession(entry: IndexFile['sessions'][0] & { sessionId: string }): void {
        let idx: IndexFile = { sessions: [] };
        if (fs.existsSync(this.indexPath)) {
            try {
                idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as IndexFile;
            } catch {
                idx = { sessions: [] };
            }
        }
        const existing = idx.sessions.find((s) => s.sessionId === entry.sessionId);
        if (existing) {
            Object.assign(existing, entry);
        } else {
            idx.sessions.push(entry);
        }
        const tmpPath = `${this.indexPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(idx, null, 2));
        fs.renameSync(tmpPath, this.indexPath);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/evidence/evidence-store.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controller/evidence/evidence-store.ts src/controller/evidence/evidence-store.test.ts
git commit -m "Add EvidenceStore filesystem layer

Per-resident append-only JSONL store with session lifecycle, rotation
at 32 MB, atomic-rename index.json, and a single-process sentinel
lockfile (per spec single-process constraint)."
```

---

## Task 4: Create ProgressTracker (pure delta logic)

**Files:**
- Create: `src/controller/evidence/progress-tracker.ts`
- Test: `src/controller/evidence/progress-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/controller/evidence/progress-tracker.test.ts`:

```ts
import { ProgressTracker } from './progress-tracker';
import type { ProgressSnapshot } from './schemas';

function snap(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
    return {
        tick: 1,
        xpBySkill: {},
        inventoryCount: 0,
        positionHash: 'a',
        hp: 99,
        ...overrides,
    };
}

describe('ProgressTracker', () => {
    it('first observation is meaningful (no prior baseline)', () => {
        const t = new ProgressTracker();
        const delta = t.observe(snap({ tick: 1 }));
        expect(delta.meaningful).toBe(true);
        expect(delta.reasons).toContain('first_observation');
    });

    it('flags meaningful XP gain', () => {
        const t = new ProgressTracker();
        t.observe(snap({ tick: 1, xpBySkill: { woodcutting: 0 } }));
        const delta = t.observe(snap({ tick: 2, xpBySkill: { woodcutting: 50 } }));
        expect(delta.meaningful).toBe(true);
        expect(delta.reasons.some((r) => r.startsWith('xp_gain:'))).toBe(true);
    });

    it('flags inventory delta', () => {
        const t = new ProgressTracker();
        t.observe(snap({ tick: 1, inventoryCount: 0 }));
        const delta = t.observe(snap({ tick: 2, inventoryCount: 3 }));
        expect(delta.meaningful).toBe(true);
        expect(delta.reasons.some((r) => r.startsWith('inventory:'))).toBe(true);
    });

    it('flags HP drop', () => {
        const t = new ProgressTracker();
        t.observe(snap({ tick: 1, hp: 99 }));
        const delta = t.observe(snap({ tick: 2, hp: 40 }));
        expect(delta.meaningful).toBe(true);
        expect(delta.reasons.some((r) => r.startsWith('hp:'))).toBe(true);
    });

    it('returns meaningful=false when nothing changes', () => {
        const t = new ProgressTracker();
        t.observe(snap({ tick: 1 }));
        const delta = t.observe(snap({ tick: 2 }));
        expect(delta.meaningful).toBe(false);
    });

    it('detects stuck after threshold ticks without meaningful progress', () => {
        const t = new ProgressTracker({ stuckThresholdTicks: 3 });
        t.observe(snap({ tick: 1 }));
        t.observe(snap({ tick: 2 }));
        t.observe(snap({ tick: 3 }));
        const delta = t.observe(snap({ tick: 5 }));
        expect(delta.newStuck).toBe(true);
        expect(delta.stuckSince).not.toBeNull();
    });

    it('clears stuck when meaningful progress resumes', () => {
        const t = new ProgressTracker({ stuckThresholdTicks: 2 });
        t.observe(snap({ tick: 1 }));
        t.observe(snap({ tick: 2 }));
        t.observe(snap({ tick: 5 })); // now stuck
        const delta = t.observe(snap({ tick: 6, xpBySkill: { woodcutting: 50 } }));
        expect(delta.meaningful).toBe(true);
        expect(delta.stuckSince).toBeNull();
    });

    it('reset clears state', () => {
        const t = new ProgressTracker();
        t.observe(snap({ tick: 1 }));
        t.reset();
        const delta = t.observe(snap({ tick: 1 }));
        expect(delta.reasons).toContain('first_observation');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --runInBand src/controller/evidence/progress-tracker.test.ts
```

Expected: FAIL with "Cannot find module './progress-tracker'".

- [ ] **Step 3: Write minimal implementation**

Create `src/controller/evidence/progress-tracker.ts`:

```ts
import type { ProgressDelta, ProgressSnapshot } from './schemas';

export interface ProgressThresholds {
    minXpGain: number;
    minInventoryDelta: number;
    minHpDelta: number;
    stuckThresholdTicks: number;
}

const DEFAULTS: ProgressThresholds = {
    minXpGain: 1,
    minInventoryDelta: 1,
    minHpDelta: 5,
    stuckThresholdTicks: 20,
};

export class ProgressTracker {
    private last?: ProgressSnapshot;
    private lastMeaningfulTick: number | null = null;
    private stuckSince: number | null = null;
    private readonly thresholds: ProgressThresholds;

    constructor(thresholds: Partial<ProgressThresholds> = {}) {
        this.thresholds = { ...DEFAULTS, ...thresholds };
    }

    observe(snapshot: ProgressSnapshot): ProgressDelta {
        const reasons: string[] = [];
        let meaningful = false;
        if (!this.last) {
            reasons.push('first_observation');
            meaningful = true;
        } else {
            for (const [skill, xp] of Object.entries(snapshot.xpBySkill)) {
                const prior = this.last.xpBySkill[skill] ?? 0;
                const gain = xp - prior;
                if (gain >= this.thresholds.minXpGain) {
                    reasons.push(`xp_gain:${skill}:${gain}`);
                    meaningful = true;
                }
            }
            const invDelta = snapshot.inventoryCount - this.last.inventoryCount;
            if (Math.abs(invDelta) >= this.thresholds.minInventoryDelta) {
                reasons.push(`inventory:${invDelta >= 0 ? '+' : ''}${invDelta}`);
                meaningful = true;
            }
            const hpDelta = snapshot.hp - this.last.hp;
            if (Math.abs(hpDelta) >= this.thresholds.minHpDelta) {
                reasons.push(`hp:${hpDelta >= 0 ? '+' : ''}${hpDelta}`);
                meaningful = true;
            }
            if (snapshot.positionHash !== this.last.positionHash) {
                reasons.push(`position:${this.last.positionHash}->${snapshot.positionHash}`);
                // Position alone is NOT meaningful — agents move all the time.
            }
        }
        let newStuck = false;
        if (meaningful) {
            this.lastMeaningfulTick = snapshot.tick;
            if (this.stuckSince !== null) {
                this.stuckSince = null;
            }
        } else if (this.lastMeaningfulTick !== null && snapshot.tick - this.lastMeaningfulTick >= this.thresholds.stuckThresholdTicks && this.stuckSince === null) {
            this.stuckSince = snapshot.tick;
            newStuck = true;
        }
        this.last = snapshot;
        return { meaningful, reasons, newStuck, stuckSince: this.stuckSince };
    }

    reset(): void {
        this.last = undefined;
        this.lastMeaningfulTick = null;
        this.stuckSince = null;
    }

    current(): ProgressSnapshot | null {
        return this.last ?? null;
    }

    lastMeaningfulAt(): number | null {
        return this.lastMeaningfulTick;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/evidence/progress-tracker.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/controller/evidence/progress-tracker.ts src/controller/evidence/progress-tracker.test.ts
git commit -m "Add ProgressTracker (pure delta logic)

Computes ProgressDelta per snapshot; tracks last meaningful tick and
stuck detection; configurable thresholds. No filesystem writes."
```

---

## Task 5: Create MockPerceptionAdapter (test-only helper)

**Files:**
- Create: `src/controller/evidence/mock-perception.ts`
- Test: `src/controller/evidence/mock-perception.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/controller/evidence/mock-perception.test.ts`:

```ts
import { MockPerceptionAdapter } from './mock-perception';

describe('MockPerceptionAdapter', () => {
    it('returns pushed perceptions in FIFO order', () => {
        const a = new MockPerceptionAdapter();
        a.push({ tick: 1, marker: 'one' });
        a.push({ tick: 2, marker: 'two' });
        expect(a.shift()).toMatchObject({ tick: 1, marker: 'one' });
        expect(a.shift()).toMatchObject({ tick: 2, marker: 'two' });
        expect(a.shift()).toBeUndefined();
    });

    it('drain returns all queued perceptions and clears the queue', () => {
        const a = new MockPerceptionAdapter();
        a.push({ tick: 1 });
        a.push({ tick: 2 });
        const all = a.drain();
        expect(all).toHaveLength(2);
        expect(a.size()).toBe(0);
    });

    it('size reports current queue length', () => {
        const a = new MockPerceptionAdapter();
        expect(a.size()).toBe(0);
        a.push({ tick: 1 });
        expect(a.size()).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --runInBand src/controller/evidence/mock-perception.test.ts
```

Expected: FAIL with "Cannot find module './mock-perception'".

- [ ] **Step 3: Write minimal implementation**

Create `src/controller/evidence/mock-perception.ts`:

```ts
import type { Perception } from '../transport/message-codecs';

export class MockPerceptionAdapter {
    private queue: Perception[] = [];

    push(perception: Perception): void {
        this.queue.push(perception);
    }

    shift(): Perception | undefined {
        return this.queue.shift();
    }

    drain(): Perception[] {
        const all = this.queue;
        this.queue = [];
        return all;
    }

    size(): number {
        return this.queue.length;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/evidence/mock-perception.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/controller/evidence/mock-perception.ts src/controller/evidence/mock-perception.test.ts
git commit -m "Add MockPerceptionAdapter for SPARK kernel tests

Test-only helper that constructs Perception objects without a
running RuneJS server. Backs spark.tick unit tests."
```

---

## Task 6: Create TrajectoryBuilder (orchestrator)

**Files:**
- Create: `src/controller/evidence/trajectory-builder.ts`
- Test: `src/controller/evidence/trajectory-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/controller/evidence/trajectory-builder.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EvidenceStore } from './evidence-store';
import { TrajectoryBuilder, type ActionEffectOutcome } from './trajectory-builder';

function readLines(file: string) {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter((l) => l).map((l) => JSON.parse(l));
}

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-builder-'));
    const store = new EvidenceStore('res-1', root);
    store.beginSession('sess-a', 'soul@1');
    const builder = new TrajectoryBuilder(store, 'sess-a');
    return { root, store, builder };
}

describe('TrajectoryBuilder', () => {
    it('beginTick writes a begin_tick line', () => {
        const { root, builder } = setup();
        builder.beginTick(1, { tick: 1 });
        builder.endTick('tick_complete');
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'trajectory'));
        const lines = readLines(path.join(root, 'res-1', 'evidence', 'trajectory', files[0]));
        expect(lines[0].kind).toBe('begin_tick');
    });

    it('endTick writes an end_tick line with the supplied reason', () => {
        const { root, builder } = setup();
        builder.beginTick(1, { tick: 1 });
        builder.endTick('hook_noop');
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'trajectory'));
        const lines = readLines(path.join(root, 'res-1', 'evidence', 'trajectory', files[0]));
        expect(lines[lines.length - 1]).toMatchObject({ kind: 'end_tick', reason: 'hook_noop' });
    });

    it('recordAction and recordActionResult correlate by requestId', () => {
        const { root, builder } = setup();
        builder.beginTick(1, { tick: 1 });
        builder.recordAction({ kind: 'noop' }, 'req-1');
        const outcome: ActionEffectOutcome = { status: 'success', ackResult: { ok: true } as never, resolvedAtTick: 2 };
        builder.recordActionResult('req-1', outcome);
        builder.endTick('tick_complete');
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'trajectory'));
        const lines = readLines(path.join(root, 'res-1', 'evidence', 'trajectory', files[0]));
        const actionLine = lines.find((l) => l.kind === 'action');
        const resultLine = lines.find((l) => l.kind === 'action_result');
        expect(actionLine.requestId).toBe('req-1');
        expect(resultLine.requestId).toBe('req-1');
        expect(resultLine.status).toBe('success');
    });

    it('recordDecision writes a decision line with module identity', () => {
        const { root, builder } = setup();
        builder.beginTick(1, { tick: 1 });
        builder.recordDecision({ moduleId: 'onion.runescape.standard', moduleVersion: '0.1.0', promptTokens: 100, completionTokens: 50, actionKinds: ['noop'], promptHash: 'abc' });
        builder.endTick('tick_complete');
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'trajectory'));
        const lines = readLines(path.join(root, 'res-1', 'evidence', 'trajectory', files[0]));
        const decisionLine = lines.find((l) => l.kind === 'decision');
        expect(decisionLine.moduleId).toBe('onion.runescape.standard');
        expect(decisionLine.promptHash).toBe('abc');
    });

    it('throws if endTick is called without a matching beginTick', () => {
        const { builder } = setup();
        expect(() => builder.endTick('tick_complete')).toThrow();
    });

    it('throws if beginTick is called twice without endTick', () => {
        const { builder } = setup();
        builder.beginTick(1, { tick: 1 });
        expect(() => builder.beginTick(2, { tick: 2 })).toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --runInBand src/controller/evidence/trajectory-builder.test.ts
```

Expected: FAIL with "Cannot find module './trajectory-builder'".

- [ ] **Step 3: Write minimal implementation**

Create `src/controller/evidence/trajectory-builder.ts`:

```ts
import { createHash } from 'crypto';
import type { Perception, ActionResult, AgentAction } from '../transport/message-codecs';
import type { EvidenceStore } from './evidence-store';
import type { EndTickReason, TrajectoryLine } from './schemas';

export interface ActionEffectOutcome {
    status: 'success' | 'failure' | 'timeout' | 'aborted';
    ackResult: ActionResult;
    evidence?: Record<string, unknown>;
    resolvedAtTick: number;
}

export interface DecisionRecord {
    moduleId: string;
    moduleVersion: string;
    promptTokens?: number;
    completionTokens?: number;
    actionKinds?: string[];
    promptHash?: string;
    completionHash?: string;
}

export interface HookWinner {
    cause?: string;
    priority?: number;
    source?: string;
}

export interface BudgetDecision {
    window: string;
    retryAt?: string;
}

export interface LegacyEventPayload {
    cause: string;
    legacyProgress?: Record<string, unknown>;
}

function shortHash(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export class TrajectoryBuilder {
    private tickActive = false;
    private currentTick = 0;

    constructor(private readonly store: EvidenceStore, private readonly sessionId: string) {}

    beginTick(tick: number, perception: Perception): void {
        if (this.tickActive) {
            throw new Error(`TrajectoryBuilder.beginTick: previous tick ${this.currentTick} not closed by endTick`);
        }
        this.tickActive = true;
        this.currentTick = tick;
        const fingerprint = shortHash(JSON.stringify(perception));
        const size = JSON.stringify(perception).length;
        this.store.appendTrajectory({
            schemaVersion: 1,
            ts: new Date().toISOString(),
            tick,
            sessionId: this.sessionId,
            kind: 'begin_tick',
            perceptionFingerprint: fingerprint,
            perceptionSize: size,
        });
    }

    recordHook(winner: HookWinner | null): void {
        this.append({
            kind: 'hook',
            cause: winner?.cause,
            priority: winner?.priority,
            source: winner?.source,
        });
    }

    recordBudget(decision: BudgetDecision): void {
        this.append({ kind: 'budget', window: decision.window, retryAt: decision.retryAt });
    }

    recordPlan(planId?: string, stepIndex?: number): void {
        this.append({ kind: 'plan', planId, stepIndex });
    }

    recordDecision(decision: DecisionRecord): void {
        this.append({
            kind: 'decision',
            moduleId: decision.moduleId,
            moduleVersion: decision.moduleVersion,
            promptTokens: decision.promptTokens,
            completionTokens: decision.completionTokens,
            actionKinds: decision.actionKinds,
            promptHash: decision.promptHash,
            completionHash: decision.completionHash,
        });
    }

    recordAction(action: AgentAction, requestId: string): void {
        const { kind, cause: _cause, ...rest } = action as { kind: string; cause?: string } & Record<string, unknown>;
        this.append({ kind: 'action', requestId, actionKind: kind, payload: rest });
    }

    recordActionResult(requestId: string, outcome: ActionEffectOutcome): void {
        this.append({
            kind: 'action_result',
            requestId,
            status: outcome.status,
            resolvedAtTick: outcome.resolvedAtTick,
            evidence: outcome.evidence,
        });
    }

    recordLegacy(event: LegacyEventPayload): void {
        this.append({ kind: 'legacy_event', cause: event.cause, legacyProgress: event.legacyProgress });
    }

    recordSay(text: string, channel?: string, lastWords?: boolean): void {
        this.append({ kind: 'say', text, channel, lastWords });
    }

    recordError(message: string, where?: string): void {
        this.append({ kind: 'error', message, where });
    }

    endTick(reason: EndTickReason): void {
        if (!this.tickActive) {
            throw new Error('TrajectoryBuilder.endTick: no active tick');
        }
        this.store.appendTrajectory({
            schemaVersion: 1,
            ts: new Date().toISOString(),
            tick: this.currentTick,
            sessionId: this.sessionId,
            kind: 'end_tick',
            reason,
        });
        this.tickActive = false;
    }

    private append(partial: Omit<TrajectoryLine, 'schemaVersion' | 'ts' | 'tick' | 'sessionId'>): void {
        const line = {
            schemaVersion: 1 as const,
            ts: new Date().toISOString(),
            tick: this.currentTick,
            sessionId: this.sessionId,
            ...partial,
        } as TrajectoryLine;
        this.store.appendTrajectory(line);
    }
}

export { shortHash };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/evidence/trajectory-builder.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/controller/evidence/trajectory-builder.ts src/controller/evidence/trajectory-builder.test.ts
git commit -m "Add TrajectoryBuilder orchestrator

Per-tick recording wrapper around EvidenceStore. Enforces single
in-flight tick at a time; endTick must be called for every beginTick."
```

---

## Task 7: Extend InferenceLog with promptHash + completionHash passthrough

**Files:**
- Modify: `src/controller/logging/inference-log.ts`
- Test: extend existing tests or add new test

- [ ] **Step 1: Read the existing test file**

```bash
ls src/controller/logging/
cat src/controller/logging/inference-log.ts
```

Note: InferenceLog already accepts `entry: Record<string, unknown>` and spreads it. promptHash and completionHash will pass through automatically without code changes. The only deliverable here is to ensure consumers compute and pass these fields.

- [ ] **Step 2: Add a test verifying the fields are persisted**

Create `src/controller/logging/inference-log.test.ts` (or append if it exists):

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { InferenceLog } from './inference-log';

describe('InferenceLog promptHash passthrough', () => {
    it('persists promptHash and completionHash when provided', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inflog-'));
        const log = new InferenceLog(root, false);
        log.append('res-1', { promptHash: 'p123', completionHash: 'c456', moduleId: 'm' });
        const dir = path.join(root, 'res-1', 'inference');
        const files = fs.readdirSync(dir);
        expect(files.length).toBe(1);
        const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
        const line = JSON.parse(content.trim());
        expect(line.promptHash).toBe('p123');
        expect(line.completionHash).toBe('c456');
    });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/logging/inference-log.test.ts
```

Expected: PASS (no code change needed; just confirmation).

- [ ] **Step 4: Commit**

```bash
git add src/controller/logging/inference-log.test.ts
git commit -m "Test InferenceLog promptHash + completionHash passthrough

No code change required (entry: Record<string, unknown> already spreads
arbitrary keys); test pins the contract for the spec-locked fields."
```

---

## Task 8: Add onAckReady and onEffectResolved callbacks to ActionCoordinator

**Files:**
- Modify: `src/controller/actions/action-coordinator.ts`
- Test: `src/controller/actions/action-coordinator.test.ts` (add new cases)

- [ ] **Step 1: Read the existing test file**

```bash
head -40 src/controller/actions/action-coordinator.test.ts
```

Find the structure used to create a coordinator + dummy submitter; follow that pattern.

- [ ] **Step 2: Add failing test for onAckReady and onEffectResolved**

Append to `src/controller/actions/action-coordinator.test.ts`:

```ts
describe('ActionCoordinator callbacks (P1)', () => {
    it('invokes onAckReady once the submitter acks', async () => {
        const submitter = { submit: async () => ({ ok: true, requestId: 'r-1' }) };
        const c = new ActionCoordinator({ resident: 'res-1', submitter });
        let ackCalled: { requestId: string; ack: unknown } | null = null;
        await c.submit({
            producer: 'body',
            action: { kind: 'noop' },
            onAckReady: (requestId, ack) => { ackCalled = { requestId, ack }; },
        });
        expect(ackCalled).not.toBeNull();
        expect(ackCalled?.requestId).toBe('r-1');
    });

    it('invokes onEffectResolved with effect outcome on success', async () => {
        const submitter = { submit: async () => ({ ok: true, requestId: 'r-2' }) };
        const c = new ActionCoordinator({ resident: 'res-1', submitter });
        let effectCalled: { requestId: string; status: string } | null = null;
        await c.submit({
            producer: 'body',
            action: { kind: 'noop' },
            waitForEffect: async () => ({ status: 'success' } as never),
            onEffectResolved: (requestId, effect) => { effectCalled = { requestId, status: effect.status }; },
        });
        expect(effectCalled).not.toBeNull();
        expect(effectCalled?.status).toBe('success');
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- --runInBand src/controller/actions/action-coordinator.test.ts
```

Expected: FAIL — the callback fields don't exist on the input type.

- [ ] **Step 4: Add the callback fields and invocations**

Edit `src/controller/actions/action-coordinator.ts`:

In the `ActionCoordinatorSubmitInput` interface, add (preserving existing fields):

```ts
    onAckReady?: (requestId: string, ack: ActionResult) => void;
    onEffectResolved?: (requestId: string, effect: ActionEffectOutcome) => void;
```

Add an import of the type at the top of the file:

```ts
import type { ActionEffectOutcome } from '../evidence/trajectory-builder';
```

In `submit()`, after `attempt.ackResult = await this.options.submitter.submit(...)` and the `requestId` assignment, before the `if (attempt.finalStatus === 'interrupted_after_submit')` check, add:

```ts
            if (input.onAckReady && attempt.requestId) {
                try { input.onAckReady(attempt.requestId, attempt.ackResult); } catch { /* swallow evidence-layer errors */ }
            }
```

Inside the `if (input.waitForEffect)` block, after `this.applyEffectResult(attempt, effectResult);`, add:

```ts
            if (input.onEffectResolved && attempt.requestId) {
                const status: 'success' | 'failure' | 'timeout' | 'aborted' = (attempt.finalStatus === 'success') ? 'success' : attempt.finalStatus === 'failure' ? 'failure' : 'aborted';
                try {
                    input.onEffectResolved(attempt.requestId, {
                        status,
                        ackResult: attempt.ackResult!,
                        resolvedAtTick: 0,
                    });
                } catch { /* swallow */ }
            }
```

(Note: `resolvedAtTick: 0` is a placeholder — the kernel will pass the real tick number when constructing the callback closure in spark.tick. This callback signature is the contract; the *caller* knows the tick.)

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/actions/action-coordinator.test.ts
```

Expected: PASS (existing tests + 2 new).

- [ ] **Step 6: Run full focused test for action-coordinator changes**

```bash
npm test -- --runInBand src/controller/actions/
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/controller/actions/action-coordinator.ts src/controller/actions/action-coordinator.test.ts
git commit -m "Add onAckReady + onEffectResolved callbacks to ActionCoordinator

Required by P1 (SPARK Evidence Layer). Callbacks fire at distinct
moments (ack vs. effect resolution) carrying distinct payloads.
Callback errors are swallowed so evidence-layer bugs cannot crash
the action loop."
```

---

## Task 9: Verify module-context facade propagates new RuntimeState fields

**Files:**
- Modify: `src/controller/spark/module-context.test.ts` (add a test only; no code change expected)

- [ ] **Step 1: Add a confirming test**

Append to `src/controller/spark/module-context.test.ts` (or wherever existing facade tests live):

```ts
import { createSparkModuleStateFacade } from './module-context';

describe('module-context propagates evidence fields', () => {
    it('snapshot includes lastMeaningfulProgressAt and stuckSince when set', () => {
        const baseState = {
            resident: 'res-1',
            attention: 100,
            tick: 5,
            lastMeaningfulProgressAt: 4,
            stuckSince: 5,
            legacy: { kind: 'standard', progress: {}, complete: false },
            budgets: { minuteStartedAt: '', dayStartedAt: '', requestsThisMinute: 0, requestsToday: 0 },
        } as never;
        const facade = createSparkModuleStateFacade(baseState);
        const snap = facade.snapshot();
        expect((snap as unknown as { lastMeaningfulProgressAt: number }).lastMeaningfulProgressAt).toBe(4);
        expect((snap as unknown as { stuckSince: number }).stuckSince).toBe(5);
    });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- --runInBand src/controller/spark/module-context.test.ts
```

Expected: PASS (the deep-freeze snapshot already propagates arbitrary fields).

- [ ] **Step 3: Commit**

```bash
git add src/controller/spark/module-context.test.ts
git commit -m "Test module-context facade propagates evidence fields

The immutableSnapshot helper already copies arbitrary RuntimeState
fields; this test pins the contract that modules can read
lastMeaningfulProgressAt and stuckSince via the read-only facade."
```

---

## Task 10: Wire EvidenceStore + TrajectoryBuilder into spark.tick

**Files:**
- Modify: `src/controller/spark/spark.ts`
- Modify: `src/controller/resident-runtime.ts` (instantiate EvidenceStore + TrajectoryBuilder)
- Test: `src/controller/spark/spark.test.ts` (create or extend)

This is the most invasive task in P1. Before starting, read `src/controller/spark/spark.ts` end-to-end and `src/controller/resident-runtime.ts` to identify the actual Spark instantiation site.

- [ ] **Step 1: Read the current tick body**

```bash
cat src/controller/spark/spark.ts
grep -n "new Spark\|Spark(" src/controller/ -r 2>&1 | head
```

Identify:
- Where Spark is constructed
- The exact 5 (or more) early-return paths in `tick()`
- Where ResidentRuntime creates downstream wiring

- [ ] **Step 2: Add a constructor parameter for trajectory**

Edit `src/controller/spark/spark.ts`. Change the constructor signature to accept an optional `TrajectoryBuilder`:

```ts
constructor(
    private readonly soul: Soul,
    private readonly state: RuntimeState,
    private readonly memory: MemoryStore,
    private readonly llm: LlmClient,
    private readonly trajectory?: TrajectoryBuilder,
) {
    this.legacy = new LegacyTracker(soul, state);
}
```

Import:

```ts
import type { TrajectoryBuilder } from '../evidence/trajectory-builder';
import type { EndTickReason } from '../evidence/schemas';
```

- [ ] **Step 3: Wrap tick() body in scope-guard finally**

Refactor the `tick()` method to use a `try/finally` so `endTick(reason)` always runs:

```ts
async tick(perception: Perception): Promise<SparkTickResult> {
    this.state.tick += 1;
    this.state.attention = spendAttention(...);
    this.state.variables = recomputeVariables(...);

    let endReason: EndTickReason = 'tick_complete';
    this.trajectory?.beginTick(this.state.tick, perception);

    try {
        // ... existing body of tick(), but replace EVERY `return X` with:
        //   setEnd('legacy_complete'); return X
        // Use a small helper:
        //   const setEnd = (r: EndTickReason) => { endReason = r; }
        // ...
    } finally {
        this.trajectory?.endTick(endReason);
    }
}
```

For each existing `return` path in tick(), set the reason before returning. Map them per spec section "Named exit reasons":

| Existing return condition | reason |
|---|---|
| `legacyUpdate.complete` | `'legacy_complete'` |
| `attention_exhausted` | `'attention_exhausted'` |
| `advancePlan` returned non-null | `'plan_continuation'` |
| `!winner \|\| winner.priority <= 0` | `'hook_noop'` |
| `!budget.ok` | `` `budget_exhausted:${budget.window}` `` |
| `!parsed.ok` | `'parse_failed'` |
| post-action legacy complete | `'legacy_complete_post_action'` |
| normal end | `'tick_complete'` |

Concrete shape of refactor (illustrative — adapt to current code):

```ts
async tick(perception: Perception): Promise<SparkTickResult> {
    this.state.tick += 1;
    this.state.attention = spendAttention(this.state.attention, this.soul.frontmatter.attentionProfile?.decayCurve || 'standard');
    this.state.variables = recomputeVariables(this.variableDefinitions(), this.state.variables, { attention: this.state.attention, tick: this.state.tick });

    let endReason: EndTickReason = 'tick_complete';
    this.trajectory?.beginTick(this.state.tick, perception);

    try {
        const legacyUpdate = this.legacy.update(perception);
        if (legacyUpdate.complete) {
            this.trajectory?.recordLegacy({ cause: legacyUpdate.cause || 'legacy_complete' });
            endReason = 'legacy_complete';
            return {
                actions: [{ kind: 'logout', cause: legacyUpdate.cause || 'legacy_complete' }],
                cause: legacyUpdate.cause || 'legacy_complete',
                nooped: false,
            };
        }

        const memoryDir = this.memory.ensureResident(this.soul.frontmatter.name);
        const [winner] = this.hooks.evaluate(this.allHooks(memoryDir), this.state, perception, this.state.variables);
        this.trajectory?.recordHook(winner ?? null);

        if (winner?.cause === 'attention_exhausted' || this.state.attention <= 0) {
            markDeceased(this.state, 'attention_exhausted');
            endReason = 'attention_exhausted';
            return { actions: [{ kind: 'logout', cause: 'attention_exhausted' }], cause: 'attention_exhausted', nooped: false };
        }

        const planned = this.advancePlan(perception, winner?.priority ?? -1);
        if (planned) {
            endReason = 'plan_continuation';
            return planned;
        }

        if (!winner || winner.priority <= 0) {
            endReason = 'hook_noop';
            return { actions: [], nooped: true };
        }

        const budget = admitInference(this.state, defaultInferenceBudget());
        if (!budget.ok) {
            this.trajectory?.recordBudget({ window: budget.window, retryAt: budget.retryAt?.toISOString() });
            endReason = `budget_exhausted:${budget.window}` as EndTickReason;
            return { /* existing return */ };
        }

        // ... continue with LLM call, decision recording, action emission ...
        // recordDecision after parseCompletion
        // recordAction for each emitted action (UUID requestId generated here)

        endReason = 'tick_complete';
        return { actions: emittedActions, nooped: false };
    } finally {
        this.trajectory?.endTick(endReason);
    }
}
```

NOTE: The `parseCompletion` failure path and `legacy_complete_post_action` path are inside the LLM block; assign their reasons before returning. Read the existing code carefully — the actual structure may require slightly different placement.

- [ ] **Step 4: Add an exit-reasons test**

Create `src/controller/spark/spark-evidence.test.ts`:

```ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { EvidenceStore } from '../evidence/evidence-store';
import { TrajectoryBuilder } from '../evidence/trajectory-builder';

// This test constructs Spark with a stubbed soul/state/memory/llm and verifies
// that triggering each early-return path produces the expected end_tick reason.

describe('spark.tick exit-reason coverage', () => {
    it.todo('emits end_tick:tick_complete on the happy path');
    it.todo('emits end_tick:legacy_complete when legacyUpdate.complete');
    it.todo('emits end_tick:attention_exhausted when attention <= 0');
    it.todo('emits end_tick:plan_continuation when a plan advances');
    it.todo('emits end_tick:hook_noop when no winning hook');
    it.todo('emits end_tick:budget_exhausted:<window> when budget rejects');
    it.todo('emits end_tick:parse_failed when LLM completion does not parse');
});
```

(These tests are intentionally `it.todo` placeholders. P1's must-pass is that the wiring compiles and a future cycle can fill in each test once we know how to construct a `Spark` in tests without RuneJS. The wiring itself is verified by the integration test in Task 11.)

- [ ] **Step 5: Run typecheck and full focused tests**

```bash
npm run typecheck
npm test -- --runInBand src/controller/spark/
```

Expected: PASS. Some existing spark tests may need a `trajectory: undefined` parameter — pass `undefined` since the new constructor arg is optional. If existing tests fail, that's the signal to adjust.

- [ ] **Step 6: Update ResidentRuntime to instantiate EvidenceStore + TrajectoryBuilder**

Read `src/controller/resident-runtime.ts` to find where Spark is constructed. Add:

```ts
import { EvidenceStore } from './evidence/evidence-store';
import { TrajectoryBuilder } from './evidence/trajectory-builder';
```

Where ResidentRuntime is constructed, add an EvidenceStore and TrajectoryBuilder per resident:

```ts
const evidenceStore = new EvidenceStore(residentName, controllerMemoryDir);
const sessionId = `session-${Date.now()}`;
evidenceStore.beginSession(sessionId, soul.version ?? 'unknown');
const trajectory = new TrajectoryBuilder(evidenceStore, sessionId);

// pass `trajectory` to Spark constructor
```

Wire `onEffectResolved` from `actionCoordinator.submit` calls to `trajectory.recordActionResult`.

Make sure `endSession()` is called when the runtime shuts down.

- [ ] **Step 7: Run focused tests for resident-runtime**

```bash
npm test -- --runInBand src/controller/resident-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/controller/spark/spark.ts src/controller/spark/spark-evidence.test.ts src/controller/resident-runtime.ts
git commit -m "Wire EvidenceStore + TrajectoryBuilder into spark.tick

Scope-guard finally clause ensures endTick(reason) fires on every
spark.tick exit. ResidentRuntime instantiates one EvidenceStore per
resident and threads onEffectResolved through ActionCoordinator into
trajectory.recordActionResult.

Exit-reason coverage tests are it.todo placeholders for the next cycle
to fill in once we have a clean way to construct Spark in tests
without RuneJS."
```

---

## Task 11: End-to-end integration test driving spark.tick with MockPerceptionAdapter

**Files:**
- Create: `src/controller/evidence/evidence-integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `src/controller/evidence/evidence-integration.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EvidenceStore } from './evidence-store';
import { TrajectoryBuilder } from './trajectory-builder';
import { MockPerceptionAdapter } from './mock-perception';
import { ProgressTracker } from './progress-tracker';

function readLines(file: string) {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter((l) => l).map((l) => JSON.parse(l));
}

describe('Evidence Layer integration', () => {
    it('records a full tick lifecycle via TrajectoryBuilder', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-int-'));
        const store = new EvidenceStore('res-1', root);
        store.beginSession('sess-1', 'soul@1');
        const builder = new TrajectoryBuilder(store, 'sess-1');
        const perception = new MockPerceptionAdapter();
        perception.push({ tick: 1, marker: 'first' });
        const p = perception.shift()!;
        builder.beginTick(1, p);
        builder.recordHook({ cause: 'idle', priority: 1, source: 'soul' });
        builder.recordDecision({ moduleId: 'm', moduleVersion: '0.1.0', actionKinds: ['noop'] });
        builder.recordAction({ kind: 'noop' }, 'req-1');
        builder.endTick('tick_complete');
        store.endSession('sess-1', 'logout');
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'trajectory'));
        const lines = readLines(path.join(root, 'res-1', 'evidence', 'trajectory', files[0]));
        const kinds = lines.map((l) => l.kind);
        expect(kinds).toEqual(['begin_tick', 'hook', 'decision', 'action', 'end_tick']);
    });

    it('records meaningful progress samples', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-int-'));
        const store = new EvidenceStore('res-1', root);
        store.beginSession('sess-1', 'soul@1');
        const tracker = new ProgressTracker();
        const snap1 = { tick: 1, xpBySkill: {}, inventoryCount: 0, positionHash: 'a', hp: 99 };
        const delta1 = tracker.observe(snap1);
        if (delta1.meaningful) {
            store.appendProgress({
                schemaVersion: 1,
                ts: new Date().toISOString(),
                tick: 1,
                sessionId: 'sess-1',
                meaningful: true,
                reasons: delta1.reasons,
                snapshot: snap1,
            });
        }
        const snap2 = { tick: 2, xpBySkill: { woodcutting: 50 }, inventoryCount: 1, positionHash: 'a', hp: 99 };
        const delta2 = tracker.observe(snap2);
        if (delta2.meaningful) {
            store.appendProgress({
                schemaVersion: 1,
                ts: new Date().toISOString(),
                tick: 2,
                sessionId: 'sess-1',
                meaningful: true,
                reasons: delta2.reasons,
                snapshot: snap2,
            });
        }
        store.endSession('sess-1', 'logout');
        const files = fs.readdirSync(path.join(root, 'res-1', 'evidence', 'progress'));
        const lines = readLines(path.join(root, 'res-1', 'evidence', 'progress', files[0]));
        expect(lines).toHaveLength(2);
        expect(lines[1].reasons.some((r: string) => r.startsWith('xp_gain:'))).toBe(true);
    });
});
```

- [ ] **Step 2: Run the integration test**

```bash
npm test -- --runInBand src/controller/evidence/evidence-integration.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/controller/evidence/evidence-integration.test.ts
git commit -m "Add Evidence Layer integration test

Drives EvidenceStore + TrajectoryBuilder + MockPerceptionAdapter +
ProgressTracker through a scripted lifecycle and asserts the
expected sequence of trajectory lines and progress samples."
```

---

## Task 12: Full verification sweep

- [ ] **Step 1: Run the complete focused suite**

```bash
npm run typecheck && npm run lint && npm test -- --runInBand src/controller/evidence/ src/controller/actions/ src/controller/logging/ src/controller/spark/ src/controller/memory/
```

Expected: PASS (no behavior change in existing benchmarks; new Evidence Layer tests green).

- [ ] **Step 2: Run the full test suite**

```bash
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Live smoke (optional, requires server)**

```bash
npm run controller:bench -- --task make-fire-5m --module onion.runescape.standard
```

Expected: existing benchmark continues to pass; `data/benchmarks/*.json` shows it succeeded; new evidence files appear under `CONTROLLER_MEMORY_DIR/<resident>/evidence/`. If a Codex local controller is running on default ports, use a different port via `PORT=43596 npm run game` in a separate terminal first.

- [ ] **Step 5: Update agent-status.md and commit**

Append a status line summarizing what landed:

```
2026-05-21 night  claude  branch=claude/evidence-loop-p1  workstream=I  P1 complete: schemas, EvidenceStore, ProgressTracker, MockPerceptionAdapter, TrajectoryBuilder, InferenceLog passthrough, ActionCoordinator callbacks, module-context facade test, spark.tick scope-guard wiring, integration test. typecheck+lint+test+build all green.
```

```bash
git add docs/agent-status.md
git commit -m "Mark P1 complete in agent-status log"
git push origin claude/evidence-loop-p1
```

- [ ] **Step 6: Write morning brief**

Create `docs/morning-brief-2026-05-22.md` summarizing what landed (see the cron prompt's "MORNING BRIEF MUST INCLUDE" section). Then:

```bash
git add docs/morning-brief-2026-05-22.md
git commit -m "Add morning brief for P1"
git push origin claude/evidence-loop-p1
```

Then call CronDelete with the heartbeat job ID and stop.

---

## Self-Review

(After writing this plan: scan it.)

1. **Spec coverage:** Every P1 deliverable in the spec is covered — EvidenceStore, ProgressTracker, TrajectoryBuilder, MockPerceptionAdapter, schemas, RuntimeState additions, InferenceLog passthrough, ActionCoordinator callbacks, module-context facade, spark.tick wiring, integration test. ✓
2. **Placeholder scan:** Task 10's exit-reason tests are intentionally `it.todo` because constructing Spark in a test without RuneJS is itself non-trivial; the integration test in Task 11 exercises the wiring end-to-end. This is a deliberate, scoped deferral, not a placeholder. ✓
3. **Type consistency:** `ActionEffectOutcome` defined in `trajectory-builder.ts`, imported in `action-coordinator.ts`. `EndTickReason` defined in `schemas.ts`, used in `trajectory-builder.ts` and `spark.ts`. `ProgressDelta`, `ProgressSnapshot` in `schemas.ts`, used in `progress-tracker.ts`. Consistent. ✓
4. **Ambiguity:** Task 10 says "read the actual code, adapt" because the exact line numbers in `spark.ts` will have rotted by the time this plan is executed — guidance-only per spec. The cycle running this task should re-read first. ✓
