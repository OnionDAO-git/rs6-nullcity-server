import type { Item } from '@engine/world/items/item';
export interface Fletchable {
    category?: 'log_cutting' | 'bow_stringing' | 'headless_arrows' | 'arrows';
    toolIds?: number[];
    item: Item;
    level: number;
    experience: number;
    ingredient: Item[];
    message?: string;
}
