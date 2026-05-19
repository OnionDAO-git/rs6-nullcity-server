import * as spellsImport from '../../../../data/config/spells.json';

/**
 * A single rune cost line on a spell definition.
 *
 * `item_key` references an item key from `data/config/items/**` (e.g. `rs:air_rune`),
 * which is resolved via `findItem(...)` to its in-game `gameId` at runtime.
 */
export interface SpellRune {
    item_key: string;
    amount: number;
}

/**
 * A standard-spellbook attack spell definition loaded from `data/config/spells.json`.
 *
 * NOTE on graphic / projectile ids: the values shipped in `spells.json` are
 * best-guess RuneScape ids — if a centralised gfx-id registry shows up later,
 * those should replace the literals in the JSON.
 */
export interface Spell {
    name: string;
    /** Child widget button id (the button the player clicked on the spellbook). */
    button_id: number;
    /** The spellbook widget id this spell lives under (192 = standard book). */
    widget_id: number;
    /** Minimum magic level required to cast. */
    level_required: number;
    /** Base damage used by `magicMaxHit(...)`. */
    base_damage: number;
    /** Base magic xp awarded on cast (a splash still grants this). */
    base_xp: number;
    /** Projectile graphic id fired toward the target. */
    projectile_id: number;
    /** Graphic to play ON the target when the spell hits. */
    impact_gfx: number;
    /** Graphic to play ON the target when the spell misses (splash). */
    splash_gfx: number;
    /** Animation the caster plays when casting. */
    cast_anim: number;
    /** Rune cost. All entries must be in the inventory for a successful cast. */
    runes: SpellRune[];
}

const spellsByKey: Record<string, Spell> = spellsImport as unknown as Record<string, Spell>;
const spellsByButton: Map<number, Spell> = new Map(
    Object.values(spellsByKey)
        .filter((s): s is Spell => !!s && typeof (s as Spell).button_id === 'number')
        .map(s => [s.button_id, s]),
);

/**
 * Look up a spell by the `widget_id`+`button_id` pair we received from the
 * magic-on-npc packet. Returns `null` if no spell matches, or if the button
 * matched but the widget id does not (defends against accidental collisions
 * with future ancient-/lunar-book entries).
 */
export function findSpellByButton(widgetId: number, buttonId: number): Spell | null {
    const spell = spellsByButton.get(buttonId);
    if (!spell || spell.widget_id !== widgetId) {
        return null;
    }
    return spell;
}

/**
 * Look up a spell by its config key (e.g. `'rs:wind_strike'`). Returns `null`
 * if the key is not defined in `spells.json`.
 */
export function findSpellByKey(key: string): Spell | null {
    return spellsByKey[key] ?? null;
}
