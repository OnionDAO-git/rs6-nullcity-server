export interface Cookable {
    rawItemId: number;
    cookedItemId: number;
    burntItemId?: number;
    level: number;
    experience: number;
    stopBurningLevel?: number;
    fireStopBurningLevel?: number;
}

export interface CookingHeatSource {
    id: number;
    type: 'object' | 'world_item';
    name: string;
    burnBonus: number;
}
