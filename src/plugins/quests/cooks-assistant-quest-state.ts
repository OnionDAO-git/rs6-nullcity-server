export interface CooksAssistantQuestState {
    metadata: Record<string, unknown>;
}

export function hasAllCooksAssistantIngredients(quest: CooksAssistantQuestState): boolean {
    return quest.metadata.givenMilk === true && quest.metadata.givenFlour === true && quest.metadata.givenEgg === true;
}
