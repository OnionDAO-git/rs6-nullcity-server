import fs from 'fs';
import os from 'os';
import path from 'path';
import { RuntimeStateStore } from './runtime-state';

describe('RuntimeStateStore', () => {
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
});
