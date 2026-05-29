import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuntimeStateStore } from './runtime-state';

describe('RuntimeStateStore', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('preserves optional evidence progress fields across save/load', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-state-evidence-'));
        const store = new RuntimeStateStore(root);
        const state = store.load('res:agent', 100, 'attention');
        state.lastMeaningfulProgressAt = 12;
        state.stuckSince = 33;

        store.save(state);

        const loaded = store.load('res:agent', 100, 'attention');
        expect(loaded.lastMeaningfulProgressAt).toBe(12);
        expect(loaded.stuckSince).toBe(33);
    });

    describe('isAlive (HD-012)', () => {
        it('returns false when no runtime-state.json exists for the resident', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-state-alive-'));
            const store = new RuntimeStateStore(root);
            expect(store.isAlive('res:nobody')).toBe(false);
        });

        it('returns true for a living resident (no deceased field)', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-state-alive-'));
            const store = new RuntimeStateStore(root);
            const state = store.load('res:hans', 100, 'endurer');
            store.save(state);
            expect(store.isAlive('res:hans')).toBe(true);
        });

        it('returns false for a deceased resident', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-state-alive-'));
            const store = new RuntimeStateStore(root);
            const state = store.load('res:hans', 100, 'endurer');
            state.deceased = { cause: 'goblin', date: '2026-05-26T00:00:00.000Z', tick: 42 };
            store.save(state);
            expect(store.isAlive('res:hans')).toBe(false);
        });

        it('returns false for a corrupt state file', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-state-alive-'));
            const store = new RuntimeStateStore(root);
            const stateDir = path.join(root, 'res-hans');
            fs.mkdirSync(stateDir, { recursive: true });
            fs.writeFileSync(path.join(stateDir, 'runtime-state.json'), 'NOT_JSON{{{');
            expect(store.isAlive('res:hans')).toBe(false);
        });
    });

    it('quarantines corrupt runtime state and starts from a fresh state', () => {
        jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-05-25T01:38:00.000Z');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-state-corrupt-'));
        const stateDir = path.join(root, 'res-agent');
        const statePath = path.join(stateDir, 'runtime-state.json');
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(statePath, '');
        const store = new RuntimeStateStore(root);

        const loaded = store.load('res:agent', 250, 'attention');

        expect(loaded).toMatchObject({
            resident: 'res:agent',
            attention: 250,
            tick: 0,
            legacy: { kind: 'attention', progress: {}, complete: false },
        });
        expect(fs.existsSync(statePath)).toBe(false);
        expect(fs.existsSync(`${statePath}.corrupt-2026-05-25T01-38-00-000Z`)).toBe(true);
    });
});
