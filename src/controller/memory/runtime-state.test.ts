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
