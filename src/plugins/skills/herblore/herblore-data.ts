import { findItem } from '@engine/config/config-handler';

export interface CleanHerbRecipe {
    grimy: string;
    clean: string;
    level: number;
    xp: number;
}

export interface UnfinishedPotionRecipe {
    herb: string;
    unfinished: string;
}

export interface FinishedPotionRecipe {
    unfinished: string;
    secondary: string;
    potion: string;
    level: number;
    xp: number;
}

export interface GrindingRecipe {
    raw: string;
    ground: string;
}

export const cleanHerbRecipes: CleanHerbRecipe[] = [
    { grimy: 'rs:grimy_guam', clean: 'rs:herb_guam', level: 3, xp: 2.5 },
    { grimy: 'rs:grimy_marrentill', clean: 'rs:herb_marrentill', level: 5, xp: 3.8 },
    { grimy: 'rs:grimy_tarromin', clean: 'rs:herb_tarromin', level: 11, xp: 5 },
    { grimy: 'rs:grimy_harralander', clean: 'rs:herb_harralander', level: 20, xp: 6.3 },
    { grimy: 'rs:grimy_ranarr', clean: 'rs:herb_ranarr', level: 25, xp: 7.5 },
    { grimy: 'rs:grimy_toadflax', clean: 'rs:herb_toadflax', level: 30, xp: 8 },
    { grimy: 'rs:grimy_irit', clean: 'rs:herb_irit', level: 40, xp: 8.8 },
    { grimy: 'rs:grimy_avantoe', clean: 'rs:herb_avantoe', level: 48, xp: 10 },
    { grimy: 'rs:grimy_kwuarm', clean: 'rs:herb_kwuarm', level: 54, xp: 11.3 },
    { grimy: 'rs:grimy_snapdragon', clean: 'rs:herb_snapdragon', level: 59, xp: 11.8 },
    { grimy: 'rs:grimy_cadantine', clean: 'rs:herb_cadantine', level: 65, xp: 12.5 },
    { grimy: 'rs:grimy_lantadyme', clean: 'rs:herb_lantadyme', level: 67, xp: 13.1 },
    { grimy: 'rs:grimy_dwarf_weed', clean: 'rs:herb_dwarf_weed', level: 70, xp: 13.8 },
    { grimy: 'rs:grimy_torstol', clean: 'rs:herb_torstol', level: 75, xp: 15 },
];

export const unfinishedPotionRecipes: UnfinishedPotionRecipe[] = [
    { herb: 'rs:herb_guam', unfinished: 'rs:guam_potion_unf' },
    { herb: 'rs:herb_marrentill', unfinished: 'rs:marrentill_potion_unf' },
    { herb: 'rs:herb_tarromin', unfinished: 'rs:tarromin_potion_unf' },
    { herb: 'rs:herb_harralander', unfinished: 'rs:harralander_potion_unf' },
    { herb: 'rs:herb_ranarr', unfinished: 'rs:ranarr_potion_unf' },
    { herb: 'rs:herb_toadflax', unfinished: 'rs:toadflax_potion_unf' },
    { herb: 'rs:herb_irit', unfinished: 'rs:irit_potion_unf' },
    { herb: 'rs:herb_avantoe', unfinished: 'rs:avantoe_potion_unf' },
    { herb: 'rs:herb_kwuarm', unfinished: 'rs:kwuarm_potion_unf' },
    { herb: 'rs:herb_cadantine', unfinished: 'rs:cadantine_potion_unf' },
    { herb: 'rs:herb_lantadyme', unfinished: 'rs:lantadyme_potion_unf' },
    { herb: 'rs:herb_dwarf_weed', unfinished: 'rs:dwarf_weed_potion_unf' },
];

export const finishedPotionRecipes: FinishedPotionRecipe[] = [
    { unfinished: 'rs:guam_potion_unf', secondary: 'rs:eye_of_newt', potion: 'rs:herblore_attack_potion', level: 3, xp: 25 },
    {
        unfinished: 'rs:marrentill_potion_unf',
        secondary: 'rs:unicorn_horn_dust',
        potion: 'rs:herblore_anti_poison_potion',
        level: 5,
        xp: 37.5,
    },
    { unfinished: 'rs:tarromin_potion_unf', secondary: 'rs:limpwurt_root', potion: 'rs:herblore_strength_potion', level: 12, xp: 50 },
    {
        unfinished: 'rs:harralander_potion_unf',
        secondary: 'rs:red_spiders_eggs',
        potion: 'rs:herblore_stat_restore_potion',
        level: 22,
        xp: 62.5,
    },
    { unfinished: 'rs:harralander_potion_unf', secondary: 'rs:chocolate_dust', potion: 'rs:herblore_energy_potion', level: 26, xp: 67.5 },
    { unfinished: 'rs:ranarr_potion_unf', secondary: 'rs:white_berries', potion: 'rs:herblore_defence_potion', level: 30, xp: 75 },
    { unfinished: 'rs:ranarr_potion_unf', secondary: 'rs:snape_grass', potion: 'rs:herblore_prayer_restore_potion', level: 38, xp: 87.5 },
    { unfinished: 'rs:irit_potion_unf', secondary: 'rs:eye_of_newt', potion: 'rs:herblore_super_attack_potion', level: 45, xp: 100 },
    { unfinished: 'rs:kwuarm_potion_unf', secondary: 'rs:limpwurt_root', potion: 'rs:herblore_super_strength_potion', level: 55, xp: 125 },
    {
        unfinished: 'rs:cadantine_potion_unf',
        secondary: 'rs:white_berries',
        potion: 'rs:herblore_super_defence_potion',
        level: 66,
        xp: 150,
    },
    { unfinished: 'rs:dwarf_weed_potion_unf', secondary: 'rs:wine_of_zamorak', potion: 'rs:herblore_ranging_potion', level: 72, xp: 162.5 },
    { unfinished: 'rs:lantadyme_potion_unf', secondary: 'rs:potato_cactus', potion: 'rs:herblore_magic_potion', level: 76, xp: 172.5 },
    { unfinished: 'rs:toadflax_potion_unf', secondary: 'rs:crushed_nest', potion: 'rs:herblore_saradomin_brew', level: 81, xp: 180 },
];

export const grindingRecipes: GrindingRecipe[] = [
    { raw: 'rs:unicorn_horn', ground: 'rs:unicorn_horn_dust' },
    { raw: 'rs:chocolate_bar', ground: 'rs:chocolate_dust' },
    { raw: 'rs:birds_nest', ground: 'rs:crushed_nest' },
];

export function itemId(key: string): number {
    const item = findItem(key);
    if (!item) {
        throw new Error(`Herblore recipe references unknown item ${key}.`);
    }
    return item.gameId;
}

export function recipeItemIds(): number[] {
    return [
        ...cleanHerbRecipes.flatMap(recipe => [recipe.grimy, recipe.clean]),
        'rs:vial:water',
        'rs:pestle_and_mortar',
        ...unfinishedPotionRecipes.flatMap(recipe => [recipe.herb, recipe.unfinished]),
        ...finishedPotionRecipes.flatMap(recipe => [recipe.unfinished, recipe.secondary]),
        ...grindingRecipes.flatMap(recipe => [recipe.raw, recipe.ground]),
    ].map(itemId);
}
