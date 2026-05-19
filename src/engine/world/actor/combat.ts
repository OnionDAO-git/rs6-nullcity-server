import type { SkillName } from '@engine/world/actor/skills';
import * as combatStylesImport from '../../../../data/config/combat-styles.json';

export interface CombatStyles {
    [key: string]: CombatStyle[];
}

export interface CombatStyle {
    type: 'slash' | 'stab' | 'crush' | 'ranged';
    exp: SkillName | SkillName[];
    anim: string | string[];
    button_id: number;
    stance?: 'accurate' | 'aggressive' | 'controlled' | 'defensive' | 'rapid' | 'longrange';
    speed_modifier?: number;
}

export const combatStyles: CombatStyles = combatStylesImport as CombatStyles;
