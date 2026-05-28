import { hasAllCooksAssistantIngredients } from './cooks-assistant-quest-state';

describe('hasAllCooksAssistantIngredients', () => {
    it('returns true only after milk, flour, and egg have all been handed in', () => {
        expect(hasAllCooksAssistantIngredients({ metadata: { givenMilk: true, givenFlour: true, givenEgg: true } })).toBe(true);
        expect(hasAllCooksAssistantIngredients({ metadata: { givenMilk: true, givenFlour: true } })).toBe(false);
        expect(hasAllCooksAssistantIngredients({ metadata: {} })).toBe(false);
    });
});
