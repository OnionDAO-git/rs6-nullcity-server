import { MockPerceptionAdapter } from './mock-perception';

describe('MockPerceptionAdapter', () => {
    it('drains scripted perceptions in insertion order', () => {
        const adapter = new MockPerceptionAdapter();
        adapter.push({ tick: 1, events: [{ kind: 'chat', text: 'hello' }] });
        adapter.push({ tick: 2, resident: { position: { x: 1, y: 2, level: 0 } } });

        expect(adapter.drain()).toEqual([
            { tick: 1, events: [{ kind: 'chat', text: 'hello' }] },
            { tick: 2, resident: { position: { x: 1, y: 2, level: 0 } } },
        ]);
        expect(adapter.drain()).toEqual([]);
    });
});
