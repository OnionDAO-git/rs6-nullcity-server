import { ScriptedBrain } from './scripted-brain';

describe('ScriptedBrain', () => {
    it('is idle by default', () => {
        const brain = new ScriptedBrain();

        expect(brain.decide({} as never)).toEqual([]);
    });

    it('uses an explicit handler when provided', () => {
        const brain = new ScriptedBrain(() => [{ kind: 'noop' }]);

        expect(brain.decide({} as never)).toEqual([{ kind: 'noop' }]);
    });
});
