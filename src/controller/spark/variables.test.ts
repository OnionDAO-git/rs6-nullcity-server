import { recomputeVariables } from './variables';

describe('recomputeVariables', () => {
    it('applies increment, decay, and clamp operations', () => {
        const variables = recomputeVariables(
            [
                {
                    id: 'wariness',
                    initial: 1,
                    increment: 'threat',
                    decay: 0.5,
                    min: 0,
                    max: 10,
                },
            ],
            {},
            { threat: 3 },
        );

        expect(variables.wariness).toBe(3.5);
    });
});
