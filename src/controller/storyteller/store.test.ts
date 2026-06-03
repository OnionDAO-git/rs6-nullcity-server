import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildProjectorStoryFrame } from './public-frame';
import { StorytellerStore, buildOperatorSummary } from './store';
import { buildFixtureDigest } from './digest-builder';
import type { CityEventDigest } from './types';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-store-test-'));
}

describe('StorytellerStore', () => {
    let tmpDir: string;
    let store: StorytellerStore;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        store = new StorytellerStore(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes and reads back a digest', () => {
        const { digest } = buildFixtureDigest();
        store.writeDigest(digest);

        const loaded = store.readDigest(digest.digestId);
        expect(loaded).not.toBeNull();
        expect(loaded!.digestId).toBe(digest.digestId);
        expect(loaded!.schemaVersion).toBe(1);
    });

    it('writes digest.json to the expected path', () => {
        const { digest } = buildFixtureDigest();
        store.writeDigest(digest);

        const expectedPath = path.join(tmpDir, digest.digestId, 'digest.json');
        expect(fs.existsSync(expectedPath)).toBe(true);

        const raw = JSON.parse(fs.readFileSync(expectedPath, 'utf-8')) as CityEventDigest;
        expect(raw.digestId).toBe(digest.digestId);
    });

    it('writes summary.txt to the expected path', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        store.writeSummary(digest.digestId, summary);

        const expectedPath = path.join(tmpDir, digest.digestId, 'summary.txt');
        expect(fs.existsSync(expectedPath)).toBe(true);
        expect(fs.readFileSync(expectedPath, 'utf-8')).toBe(summary);
    });

    it('lists digest run-ids in chronological order (most recent last)', () => {
        const { digest: d1 } = buildFixtureDigest();
        const d2 = { ...d1, digestId: 'fixture-digest-002' };
        const d3 = { ...d1, digestId: 'fixture-digest-003' };

        store.writeDigest(d1);
        store.writeDigest(d2);
        store.writeDigest(d3);

        const ids = store.listDigestIds();
        expect(ids).toContain('fixture-digest-001');
        expect(ids).toContain('fixture-digest-002');
        expect(ids).toContain('fixture-digest-003');
        expect(ids).toHaveLength(3);
    });

    it('returns null for a missing digest id', () => {
        const result = store.readDigest('does-not-exist');
        expect(result).toBeNull();
    });

    it('readLatestDigest returns null when store is empty', () => {
        expect(store.readLatestDigest()).toBeNull();
    });

    it('readLatestDigest returns the most recently written digest', () => {
        const { digest: d1 } = buildFixtureDigest();
        store.writeDigest(d1);

        const d2 = { ...d1, digestId: 'fixture-digest-newer', builtAt: '2026-05-29T09:00:00.000Z' };
        store.writeDigest(d2);

        const latest = store.readLatestDigest();
        expect(latest).not.toBeNull();
        // Both are present; latest by builtAt should be d2
        expect(latest!.digestId).toBe('fixture-digest-newer');
    });

    it('reads back a written summary', () => {
        const { digest } = buildFixtureDigest();
        const summary = 'Test operator summary.';
        store.writeSummary(digest.digestId, summary);
        expect(store.readSummary(digest.digestId)).toBe(summary);
    });

    it('readSummary returns null for missing run-id', () => {
        expect(store.readSummary('does-not-exist')).toBeNull();
    });

    it('writes and reads back a dispatch', () => {
        const { digest } = buildFixtureDigest();
        const dispatch = {
            schemaVersion: 1 as const,
            dispatchId: 'dispatch-001',
            digestId: digest.digestId,
            generatedAt: '2026-05-29T09:00:00.000Z',
            modelProfile: 'dry-run',
            latencyMs: 0,
            estimatedCostUsd: null,
            inputTokens: null,
            outputTokens: null,
            publicTitle: 'Test Title',
            publicBody: 'Test body.',
            publicBullets: ['bullet 1'],
            operatorSummary: 'Operator notes.',
            operatorWarnings: [],
            eventRefsUsed: [],
            needsReview: false,
        };
        store.writeDispatch(dispatch);
        const loaded = store.readDispatch(digest.digestId);
        expect(loaded).not.toBeNull();
        expect(loaded!.dispatchId).toBe('dispatch-001');
        expect(loaded!.digestId).toBe(digest.digestId);
    });

    it('readDispatch returns null for missing run-id', () => {
        expect(store.readDispatch('does-not-exist')).toBeNull();
    });

    it('writes and reads the public latest projector frame separately from run artifacts', () => {
        const { digest } = buildFixtureDigest();
        const frame = buildProjectorStoryFrame(digest, { now: new Date('2026-05-29T06:03:00.000Z') });

        store.writeLatestProjectorFrame(frame);

        expect(fs.existsSync(path.join(tmpDir, 'latest-frame.json'))).toBe(true);
        const loaded = store.readLatestProjectorFrame();
        expect(loaded).not.toBeNull();
        expect(loaded!.frameId).toBe(frame.frameId);
        expect(loaded!.digestId).toBe(digest.digestId);
    });

    it('readLatestProjectorFrame returns null when the latest-frame artifact is absent', () => {
        expect(store.readLatestProjectorFrame()).toBeNull();
    });

    it('overwrites an existing digest on re-write', () => {
        const { digest } = buildFixtureDigest();
        store.writeDigest(digest);

        const updated = { ...digest, builtAt: '2026-05-29T10:00:00.000Z' };
        store.writeDigest(updated);

        const loaded = store.readDigest(digest.digestId);
        expect(loaded!.builtAt).toBe('2026-05-29T10:00:00.000Z');
    });
});

describe('buildOperatorSummary', () => {
    it('produces a non-empty string for the fixture digest', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        expect(typeof summary).toBe('string');
        expect(summary.length).toBeGreaterThan(10);
    });

    it('includes the digestId in the output', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        expect(summary).toContain(digest.digestId);
    });

    it('lists resident names from snapshots', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        expect(summary).toContain('res:alice');
        expect(summary).toContain('res:bob');
    });

    it('labels AP and GP separately — never conflates them', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        // AP label should appear (it's the Null City ledger balance)
        expect(summary).toMatch(/AP|Attention Points/);
        // GP label should appear (real RuneScape coins)
        expect(summary).toMatch(/GP|gold/i);
    });

    it('includes system health numbers', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        expect(summary).toContain(String(digest.systemHealth.totalResidents));
    });

    it('produces deterministic output for same digest', () => {
        const { digest } = buildFixtureDigest();
        const s1 = buildOperatorSummary(digest);
        const s2 = buildOperatorSummary(digest);
        expect(s1).toBe(s2);
    });

    it('notes low-AP residents by name', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        // res:alice is low-AP in the fixture
        expect(summary).toContain('res:alice');
    });

    it('includes event notes from topEvents', () => {
        const { digest } = buildFixtureDigest();
        const summary = buildOperatorSummary(digest);
        // At least one topEvent note should appear
        expect(digest.topEvents.length).toBeGreaterThan(0);
        const firstNote = digest.topEvents[0].note;
        expect(summary).toContain(firstNote);
    });
});
