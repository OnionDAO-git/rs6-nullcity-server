import type { Item } from '@engine/world/items/item';

export interface CraftingRecipe {
    toolIds: number[];
    ingredients: Item[];
    output: Item;
    level: number;
    experience: number;
    animationId?: number;
    successMessage?: string;
}
