import { generateFirstStepCandidates } from './candidates';

describe('generateFirstStepCandidates', () => {
    it('offers a safe nearby movement before noop when the resident position is known', () => {
        const candidates = generateFirstStepCandidates({
            resident: {
                position: { x: 3226, y: 3236, level: 0 },
            },
        });

        expect(candidates[0]).toEqual({
            kind: 'move_to',
            target: { x: 3227, y: 3236, level: 0 },
            cause: 'idle_step',
        });
        expect(candidates).not.toContainEqual({ kind: 'noop', cause: 'no_candidate' });
    });
});
