import { IdleBrain } from './idle-brain';

describe('IdleBrain', () => {
    it('does not emit a noop when no survival action is needed', () => {
        const brain = new IdleBrain();

        expect(brain.decide(perception({ current: 10, max: 10, inventory: [] }))).toEqual([]);
    });

    it('eats available food when health is low', () => {
        const brain = new IdleBrain();

        expect(brain.decide(perception({ current: 4, max: 10, inventory: [null, { key: 'bread' }] }))).toEqual([{ kind: 'eat', slot: 1 }]);
    });
});

function perception(options: {
    current: number;
    max: number;
    inventory: Array<{ key?: string } | null>;
}) {
    return {
        resident: {
            hp: { current: options.current, max: options.max },
            inventory: options.inventory,
        },
    } as never;
}
