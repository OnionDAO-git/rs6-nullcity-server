import fs from 'fs';
import os from 'os';
import path from 'path';
import { BornResidentStore } from './born-resident-store';

function tmpRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'born-resident-store-'));
}

describe('BornResidentStore', () => {
    it('add then list returns the resident', () => {
        const store = new BornResidentStore(tmpRoot());
        store.add('res:born1');
        expect(store.list()).toEqual(['res:born1']);
    });

    it('dedupes repeated adds', () => {
        const store = new BornResidentStore(tmpRoot());
        store.add('res:born1');
        store.add('res:born1');
        store.add('res:born2');
        expect(store.list().sort()).toEqual(['res:born1', 'res:born2']);
    });

    it('persists across instances (survives a controller restart)', () => {
        const root = tmpRoot();
        new BornResidentStore(root).add('res:born1');
        // A fresh store rooted at the same dir (a new controller process) sees it.
        expect(new BornResidentStore(root).list()).toEqual(['res:born1']);
    });

    it('returns [] when the manifest is missing', () => {
        expect(new BornResidentStore(tmpRoot()).list()).toEqual([]);
    });

    it('returns [] defensively when the manifest is corrupt', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, 'born-residents.json'), 'not json{');
        expect(new BornResidentStore(root).list()).toEqual([]);
    });

    it('remove drops a resident and persists the removal', () => {
        const root = tmpRoot();
        const store = new BornResidentStore(root);
        store.add('res:born1');
        store.add('res:born2');
        store.remove('res:born1');
        expect(store.list()).toEqual(['res:born2']);
        // persisted: a fresh instance also sees the removal
        expect(new BornResidentStore(root).list()).toEqual(['res:born2']);
    });

    it('remove is a no-op for an unknown resident', () => {
        const store = new BornResidentStore(tmpRoot());
        store.add('res:born1');
        store.remove('res:nope');
        expect(store.list()).toEqual(['res:born1']);
    });

    it('creates the memory root dir if it does not exist yet', () => {
        const root = path.join(tmpRoot(), 'nested', 'memory');
        const store = new BornResidentStore(root);
        store.add('res:born1');
        expect(new BornResidentStore(root).list()).toEqual(['res:born1']);
    });
});
